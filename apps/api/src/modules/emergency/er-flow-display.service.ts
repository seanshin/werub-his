import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

/**
 * ER 환자 흐름 TV 보드(공개·emergency-flow-tv-board.plan.md).
 *
 * - 공개 등급 = 외래 호출 전광판 선례 ③(공개+PHI 강마스킹) — 서버에서 마스킹·필드 화이트리스트,
 *   클라이언트 신뢰 금지. KTAS(중증도)·주호소·진단·실명은 절대 내보내지 않는다(D1·계약 테스트).
 * - 단계는 전량 실데이터 파생(D2·추정 금지): arrivalAt→triagedAt→doctorId→status→disposition→COMPLETED.
 * - 종결(COMPLETED) 후 60분 유지(D3) — 보호자가 입원/귀가 결과를 확인할 시간.
 */

/** 흐름 단계 정의 — 라벨은 보호자 눈높이(임상 약어 금지) */
const STAGES = ['도착', '중증도 분류', '담당의사 배정', '진료·검사', '처분 결정', '퇴실'] as const;

/** 홍○동 마스킹 — waiting-queue maskName 과 동일 규약(정본 이관 없이 규약 일치·계약 테스트로 고정) */
export function maskPublicName(familyName: string, givenName: string): string {
  const full = `${familyName}${givenName}`;
  if (full.length <= 1) return full;
  if (full.length === 2) return `${full[0]}○`;
  return `${full[0]}○${full[full.length - 1]}`;
}

const DISP_KO: Record<string, string> = {
  ADMISSION: '입원', DISCHARGE: '귀가', TRANSFER: '전원', DEATH: '', LEAVE_AMA: '귀가',
};

@Injectable()
export class ErFlowDisplayService {
  constructor(private readonly prisma: PrismaService) {}

  async getFlowBoard() {
    const now = Date.now();
    const visits = await this.prisma.emergencyVisit.findMany({
      where: {
        OR: [
          { status: { not: 'COMPLETED' } },
          // 종결 후 60분 유지(D3) — dispositionAt 기준(COMPLETED 전이 시각 근사·별도 컬럼 없음)
          { status: 'COMPLETED', dispositionAt: { gte: new Date(now - 60 * 60000) } },
        ],
      },
      orderBy: { arrivalAt: 'asc' }, // D6 — 도착순(중증 우선 정렬은 중증도 노출이라 배제)
      take: 40,
      select: {
        id: true, patientId: true, arrivalAt: true, triagedAt: true, doctorId: true, treatmentStartedAt: true,
        status: true, disposition: true, dispositionAt: true, admissionId: true, bedId: true,
        patient: { select: { familyName: true, givenName: true } },
      },
    });

    // 베드 라벨(구역-번호) — 보호자의 위치 인지용(민감 아님)
    const bedIds = visits.map((v) => v.bedId).filter((b): b is string => !!b);
    const beds = bedIds.length
      ? await this.prisma.bed.findMany({ where: { id: { in: bedIds } }, select: { id: true, roomNumber: true, bedNumber: true } })
      : [];
    const bedLabel = new Map(beds.map((b) => [b.id, `${b.roomNumber}-${b.bedNumber}`]));

    // 검사·처치 오더 집계(P1) — prescription(procedureCodeId 有)→encounter→patient 경유 실데이터.
    // 재실 창(도착 이후) 오더만 귀속. 약 처방은 제외(보호자 표시는 '검사 n건'이 자연스럽고 투약 상세는 민감).
    const alive = visits.filter((v) => v.disposition !== 'DEATH');
    const patientIds = [...new Set(alive.map((v) => v.patientId))];
    const minArrival = alive.length ? new Date(Math.min(...alive.map((v) => v.arrivalAt.getTime()))) : new Date();
    const orders = patientIds.length
      ? await this.prisma.order.findMany({
          where: {
            createdAt: { gte: minArrival },
            prescription: { procedureCodeId: { not: null }, encounter: { patientId: { in: patientIds } } },
          },
          select: { status: true, createdAt: true, prescription: { select: { encounter: { select: { patientId: true } } } } },
        })
      : [];
    const testsOf = (patientId: string, arrivalAt: Date) => {
      const mine = orders.filter((o) => o.prescription.encounter.patientId === patientId && o.createdAt >= arrivalAt && o.status !== 'CANCELLED');
      if (!mine.length) return null;
      return { total: mine.length, done: mine.filter((o) => o.status === 'COMPLETED').length };
    };

    // 사망(DEATH)은 공용 화면에 표시하지 않는다 — 가족 통지는 사람의 일
    const rows = alive.map((v) => {
      // 현재 단계 파생(D2) — status 가 흐름의 정본
      let current = 0; // 도착
      if (v.triagedAt || !['PENDING_TRIAGE'].includes(v.status)) current = 1;
      if (v.doctorId) current = 2;
      if (['IN_TREATMENT', 'PENDING_RESULT', 'UNDER_OBSERVATION'].includes(v.status)) current = 3;
      if (v.status === 'PENDING_DISPOSITION' || (v.disposition && v.status !== 'COMPLETED')) current = 4;
      const completed = v.status === 'COMPLETED';
      if (completed) current = 5;

      const dispLabel = v.admissionId ? '입원' : (v.disposition ? DISP_KO[v.disposition] ?? '' : '');
      const careLabel = v.status === 'IN_TREATMENT' ? '진료 중'
        : v.status === 'PENDING_RESULT' ? '검사·결과 대기'
        : v.status === 'UNDER_OBSERVATION' ? '관찰 중' : null;

      return {
        id: v.id,
        name: maskPublicName(v.patient.familyName, v.patient.givenName),
        bed: v.bedId ? bedLabel.get(v.bedId) ?? null : null,
        arrivalAt: v.arrivalAt,
        currentStage: current,
        careLabel, // 4단계 상세 라벨(진료 중/검사·결과 대기/관찰 중)
        tests: testsOf(v.patientId, v.arrivalAt), // {total, done} | null — 검사·처치 오더 실집계(P1)
        dispositionLabel: dispLabel || null, // 처분·퇴실 라벨(입원/귀가/전원)
        completed,
        completedAt: completed ? v.dispositionAt : null,
      };
    });

    return { stages: STAGES, rows, activeCount: rows.filter((r) => !r.completed).length };
  }

  /**
   * 포털 본인/가족 조회(P1) — 인증된 환자 스코프(PortalOrPatientGuard·가족 전환 포함)라 마스킹 불요.
   * 재실 또는 종결 60분 내 방문 1건의 흐름 — 없으면 null(포털 카드 미표시).
   */
  async getPatientFlow(patientId: string) {
    const visit = await this.prisma.emergencyVisit.findFirst({
      where: {
        patientId,
        OR: [
          { status: { not: 'COMPLETED' } },
          { status: 'COMPLETED', dispositionAt: { gte: new Date(Date.now() - 60 * 60000) } },
        ],
        // 🔴 사망 제외를 SQL NOT 로 걸면 disposition=null(미결정) 행까지 통째로 빠진다(NULL 비교 함정) — JS 에서 거른다
      },
      orderBy: { arrivalAt: 'desc' },
      select: {
        id: true, patientId: true, arrivalAt: true, triagedAt: true, doctorId: true,
        status: true, disposition: true, dispositionAt: true, admissionId: true, bedId: true,
      },
    });
    if (!visit || visit.disposition === 'DEATH') return null; // 사망 통지는 사람의 일 — 앱 카드로 전하지 않는다

    const [bed, doctor, orders] = await Promise.all([
      visit.bedId ? this.prisma.bed.findUnique({ where: { id: visit.bedId }, select: { roomNumber: true, bedNumber: true } }) : null,
      visit.doctorId ? this.prisma.user.findUnique({ where: { id: visit.doctorId }, select: { familyName: true, givenName: true } }) : null,
      this.prisma.order.findMany({
        where: {
          createdAt: { gte: visit.arrivalAt },
          status: { not: 'CANCELLED' },
          prescription: { procedureCodeId: { not: null }, encounter: { patientId } },
        },
        select: { status: true },
      }),
    ]);

    let current = 0;
    if (visit.triagedAt || visit.status !== 'PENDING_TRIAGE') current = 1;
    if (visit.doctorId) current = 2;
    if (['IN_TREATMENT', 'PENDING_RESULT', 'UNDER_OBSERVATION'].includes(visit.status)) current = 3;
    if (visit.status === 'PENDING_DISPOSITION' || (visit.disposition && visit.status !== 'COMPLETED')) current = 4;
    const completed = visit.status === 'COMPLETED';
    if (completed) current = 5;

    return {
      stages: STAGES,
      arrivalAt: visit.arrivalAt,
      currentStage: current,
      careLabel: visit.status === 'IN_TREATMENT' ? '진료 중'
        : visit.status === 'PENDING_RESULT' ? '검사·결과 대기'
        : visit.status === 'UNDER_OBSERVATION' ? '관찰 중' : null,
      bed: bed ? `${bed.roomNumber}-${bed.bedNumber}` : null,
      doctorName: doctor ? `${doctor.familyName}${doctor.givenName}` : null, // 본인 스코프 — 실명
      tests: orders.length ? { total: orders.length, done: orders.filter((o) => o.status === 'COMPLETED').length } : null,
      dispositionLabel: visit.admissionId ? '입원' : (visit.disposition ? DISP_KO[visit.disposition] ?? null : null),
      completed,
      completedAt: completed ? visit.dispositionAt : null,
    };
  }
}
