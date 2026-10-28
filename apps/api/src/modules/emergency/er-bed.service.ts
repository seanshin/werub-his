import { Injectable, NotFoundException, BadRequestException, ConflictException, Optional, Logger } from '@nestjs/common';
import { BedStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { JourneyService } from '../journey/journey.service';
import { ConfigRuntimeService } from '../config/config-runtime.service';
import { mergeTargetMap, positiveNumberOr, KTAS_REASSESS_MIN } from '../../common/qi-targets';
// 🔴 마스킹 표기 정본 — 공개 전광판·검진 보드와 같은 함수를 쓴다(W9). 로컬 재구현 금지.
import { maskPublicName } from './er-flow-display.service';

/**
 * ER 베드 보드 P0(2026-08-05) — 배정·이동·해제·상태 전환과 보드 단일 조회.
 *
 * - 배정 이력 정본 = EmergencyBedAssignment. visit.bedId 는 캐시(불일치 시 assignment 가 이긴다).
 * - 동시 배정 방지 = DB 부분 유니크 인덱스(uq_er_bed_active·uq_er_visit_active) — 애플리케이션
 *   검사는 안내용이고 최종 방어는 인덱스(P2002→409). check-then-act 만으로는 동시 요청에 진다.
 * - 결정(disposition)≠퇴실 — 자동 해제 훅은 P1. P0 은 수동 배정/이동/해제만.
 */
@Injectable()
export class ErBedService {
  private readonly logger = new Logger(ErBedService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly journey?: JourneyService, // JourneyModule 은 @Global — imports 불요 확인(2026-08-05)
    @Optional() private readonly config?: ConfigRuntimeService, // EmergencyModule 이 ConfigRuntimeModule 임포트 확인
  ) {}

  /** 응급 방문 활성 상태(베드를 점유할 수 있는 상태) */
  private static readonly ACTIVE_STATUSES = [
    'PENDING_TRIAGE', 'TRIAGED', 'PENDING_DOCTOR', 'IN_TREATMENT',
    'PENDING_RESULT', 'UNDER_OBSERVATION', 'PENDING_DISPOSITION',
  ];

  private async erWardIds(): Promise<string[]> {
    const wards = await this.prisma.ward.findMany({ where: { type: 'EMERGENCY', isActive: true }, select: { id: true } });
    return wards.map((w) => w.id);
  }

  /** 보드 단일 조회 — 구역 그룹 베드 + 현재 배정 방문 요약 + 미배정 재실 목록 (1폴링 1콜) */
  async getBoard() {
    const wardIds = await this.erWardIds();
    const [beds, actives] = await Promise.all([
      this.prisma.bed.findMany({
        where: { wardId: { in: wardIds } },
        orderBy: [{ roomNumber: 'asc' }, { bedNumber: 'asc' }],
        select: { id: true, roomNumber: true, bedNumber: true, status: true },
      }),
      this.prisma.emergencyVisit.findMany({
        where: { status: { in: ErBedService.ACTIVE_STATUSES } },
        select: {
          id: true, bedId: true, patientId: true, triageLevel: true, chiefComplaint: true, arrivalAt: true,
          status: true, disposition: true, dispositionAt: true, onVentilator: true, admissionId: true,
          patient: { select: { familyName: true, givenName: true, mrn: true, gender: true, dateOfBirth: true } },
        },
        orderBy: { arrivalAt: 'asc' },
      }),
    ]);

    // 정본 대조 — visit.bedId 캐시가 아니라 활성 assignment 기준으로 점유를 판정(유령 점유 탐지 포함)
    const activeAssigns = await this.prisma.emergencyBedAssignment.findMany({
      where: { releasedAt: null, bedId: { in: beds.map((b) => b.id) } },
      select: { bedId: true, visitId: true, assignedAt: true },
    });
    const byBed = new Map(activeAssigns.map((a) => [a.bedId, a]));
    const byVisit = new Map(activeAssigns.map((a) => [a.visitId, a]));
    const visitById = new Map(actives.map((v) => [v.id, v]));

    // P1 배지 파생 — 재평가 지연(관제와 동일 판정·qi.targets 공유)·청소 경과·boarding 경고 기준
    const now = Date.now();
    const [reassessRaw, slaRaw, boardingRaw, separatedRaw, guardianGateRaw] = await Promise.all([
      this.config?.get('qi.targets.ktasReassessMin').catch(() => null) ?? null,
      this.config?.get('er.cleaning.slaMinutes').catch(() => null) ?? null,
      this.config?.get('er.boarding.warnMinutes').catch(() => null) ?? null,
      this.config?.get('er.reception.separated').catch(() => null) ?? null,
      this.config?.get('er.registration.guardianGate').catch(() => null) ?? null,
    ]);
    const reassessTargets = mergeTargetMap(KTAS_REASSESS_MIN, reassessRaw);
    const cleaningSlaMinutes = positiveNumberOr(slaRaw, 30);
    const boardingWarnMinutes = positiveNumberOr(boardingRaw, 120);
    const receptionSeparated = separatedRaw !== false; // 기본 true(D10)
    const guardianGate = guardianGateRaw === 'OFF' ? 'OFF' : 'WARN'; // 기본 WARN(D11·BLOCK 없음)

    // 접수 트랙(D10/D11) — 신원미상(EMG- 임시 MRN)·보호자 미등록(PatientContact 0건)
    const patientIds = [...new Set(actives.map((v) => v.patientId))];
    const guardianCounts = patientIds.length
      ? await this.prisma.patientContact.groupBy({ by: ['patientId'], where: { patientId: { in: patientIds } }, _count: true })
      : [];
    const hasGuardian = new Set(guardianCounts.map((g) => g.patientId));
    // 도착 상황 기록 수 — 신원미상(EMG-)만 센다(er-arrival-record). 센 결과의 0 은 진짜 0 · 세지 않은 환자는 null
    const unverifiedIds = [...new Set(actives.filter((v) => v.patient?.mrn?.startsWith('EMG-')).map((v) => v.patientId))];
    const arrivalCounts = unverifiedIds.length
      ? await this.prisma.emergencyArrivalNote.groupBy({ by: ['patientId'], where: { patientId: { in: unverifiedIds } }, _count: true })
      : [];
    const arrivalCountOf = new Map(arrivalCounts.map((g) => [g.patientId, g._count]));

    const visitIds = actives.map((v) => v.id);
    const reassessments = visitIds.length
      ? await this.prisma.emergencyReassessment.findMany({
          where: { visitId: { in: visitIds } }, orderBy: { assessedAt: 'desc' }, select: { visitId: true, assessedAt: true },
        })
      : [];
    const lastReassess = new Map<string, Date>();
    for (const r of reassessments) if (!lastReassess.has(r.visitId)) lastReassess.set(r.visitId, r.assessedAt);

    // 청소 경과 = 그 베드의 마지막 해제 시각(assignment.releasedAt)부터
    const cleaningIds = beds.filter((b) => b.status === BedStatus.CLEANING).map((b) => b.id);
    const lastReleases = cleaningIds.length
      ? await this.prisma.emergencyBedAssignment.findMany({
          where: { bedId: { in: cleaningIds }, releasedAt: { not: null } },
          orderBy: { releasedAt: 'desc' }, select: { bedId: true, releasedAt: true },
        })
      : [];
    const cleaningSince = new Map<string, Date>();
    for (const r of lastReleases) if (!cleaningSince.has(r.bedId) && r.releasedAt) cleaningSince.set(r.bedId, r.releasedAt);

    const decorate = (v: (typeof actives)[number]) => {
      const target = reassessTargets[v.triageLevel] ?? 60;
      const lastAt = lastReassess.get(v.id) ?? new Date(v.arrivalAt);
      const sinceReassessMins = Math.floor((now - lastAt.getTime()) / 60000);
      return {
        ...v,
        sinceReassessMins,
        reassessOverdue: sinceReassessMins > target,
        identityUnverified: v.patient?.mrn?.startsWith('EMG-') ?? false,
        guardianRegistered: hasGuardian.has(v.patientId),
        arrivalNoteCount: unverifiedIds.includes(v.patientId) ? arrivalCountOf.get(v.patientId) ?? 0 : null,
        suggestedZone: ErBedService.suggestZone(v),
      };
    };

    const bedRows = beds.map((b) => {
      const assign = byBed.get(b.id);
      const visit = assign ? visitById.get(assign.visitId) ?? null : null;
      const since = b.status === BedStatus.CLEANING ? cleaningSince.get(b.id) : undefined;
      const cleaningMins = since ? Math.floor((now - since.getTime()) / 60000) : null;
      return {
        ...b,
        assignedAt: assign?.assignedAt ?? null,
        // OCCUPIED 인데 활성 배정이 없으면 유령 점유(자동 훅 실패 잔재) — 보드에서 한 번에 정리
        ghost: b.status === BedStatus.OCCUPIED && !assign,
        visit: visit ? decorate(visit) : null,
        cleaningMins,
        cleaningOverdue: cleaningMins != null && cleaningMins > cleaningSlaMinutes,
      };
    });
    const unassigned = actives.filter((v) => !byVisit.has(v.id)).map(decorate);
    return {
      beds: bedRows, unassigned,
      meta: { cleaningSlaMinutes, boardingWarnMinutes, receptionSeparated, guardianGate },
    };
  }

  /**
   * 배치 제안(P3·§9) — 서버 결정적 규칙. LLM 없음(규칙으로 충분 — AI 는 장식이 아니라 필요할 때만).
   * KTAS 1=소생, KTAS 2/인공호흡기=중증, 관찰 상태=관찰, 그 외=일반. 격리(ISO)는 감염 플래그
   * 정본 부재로 제안하지 않는다(현장 판단). 권장일 뿐 강제 없음(WARN 확인과 세트).
   */
  static suggestZone(v: { triageLevel: string; onVentilator?: boolean | null; status?: string }): string {
    if (v.triageLevel === 'LEVEL_1') return 'RESUS';
    if (v.triageLevel === 'LEVEL_2' || v.onVentilator) return 'ACUTE';
    if (v.status === 'UNDER_OBSERVATION') return 'OBS';
    return 'GEN';
  }

  /**
   * 베드사이드 디스플레이(P2·§4.3) — 서버 조립 단일 EP. 마스킹·표시 필드는 config 로 서버에서
   * 적용(클라 신뢰 금지·URL 우회 불가). 금식(NPO)은 확실한 정본이 없어 표시하지 않는다(날조 금지).
   */
  async getBedDisplay(bedId: string) {
    const bed = await this.prisma.bed.findUnique({ where: { id: bedId }, include: { ward: { select: { type: true } } } });
    if (!bed || bed.ward.type !== 'EMERGENCY') throw new NotFoundException('응급실 베드가 아닙니다');

    /**
     * 🔴 설정을 **못 읽은 것**과 **false 로 정한 것**을 구분한다 — 화면 실사용 점검 W9(2026-08-14).
     *
     * 기본값 `false`(실명)는 결함이 아니다 — "베드 곁 본인 확인 목적"으로 문서화돼 있고
     * `config:er.bedDisplay.nameMasking` 은 **SAFE 위원회 거버넌스 대상**이다(governance.service.ts:62).
     * 문제는 종전 `masking = maskingRaw === true` 가 **조회 실패(`.catch(() => null)`)까지 false 로 접었다**는 것이다.
     * 위원회가 마스킹을 `true` 로 올려둔 병원에서도 **config 서비스가 잠깐 죽으면 조용히 실명이 뜬다.**
     * 이 저장소 규약은 fail-closed — **모르면 안전한 쪽(마스킹)** 이다.
     */
    const [maskingRes, fieldsRaw] = await Promise.all([
      this.config
        ? this.config.get('er.bedDisplay.nameMasking').then((v) => ({ ok: true, v })).catch(() => ({ ok: false, v: null }))
        : Promise.resolve({ ok: false, v: null }),
      this.config?.get('er.bedDisplay.fields').catch(() => null) ?? null,
    ]);
    if (!maskingRes.ok) {
      this.logger?.warn?.('er.bedDisplay.nameMasking 조회 실패 — 안전측으로 마스킹 적용(실명 노출 금지)');
    }
    // 조회 실패 = 마스킹(fail-closed) · 읽었으면 위원회가 정한 값을 그대로 따른다
    const masking = maskingRes.ok ? maskingRes.v === true : true;
    const f = (k: string) => ((fieldsRaw as Record<string, unknown>)?.[k] ?? true) !== false;

    const assign = await this.prisma.emergencyBedAssignment.findFirst({
      where: { bedId, releasedAt: null }, select: { visitId: true, assignedAt: true },
    });
    const base = { bed: { id: bed.id, zone: bed.roomNumber, bedNumber: bed.bedNumber, status: bed.status } };
    if (!assign) return { ...base, empty: true };

    const visit = await this.prisma.emergencyVisit.findUnique({
      where: { id: assign.visitId },
      select: {
        id: true, patientId: true, doctorId: true, triageLevel: true, chiefComplaint: true,
        arrivalAt: true, status: true, disposition: true, onVentilator: true,
        patient: { select: { familyName: true, givenName: true, mrn: true, gender: true, dateOfBirth: true } },
      },
    });
    if (!visit) return { ...base, empty: true };

    const [doctor, allergies, fallRisk, guardian] = await Promise.all([
      f('doctor') && visit.doctorId
        ? this.prisma.user.findUnique({ where: { id: visit.doctorId }, select: { familyName: true, givenName: true } })
        : null,
      f('allergies')
        ? this.prisma.allergy.findMany({
            where: { patientId: visit.patientId }, take: 5,
            select: { allergen: true, severity: true }, orderBy: { createdAt: 'desc' },
          })
        : [],
      f('fallRisk')
        ? this.prisma.fallRiskAssessment.findFirst({
            where: { patientId: visit.patientId }, orderBy: { assessedAt: 'desc' }, select: { riskLevel: true },
          })
        : null,
      f('guardian')
        ? this.prisma.patientContact.findFirst({
            where: { patientId: visit.patientId },
            orderBy: [{ isPrimaryContact: 'desc' }, { priority: 'asc' }],
            select: { name: true, relationship: true, relationshipDetail: true, phone: true },
          })
        : null,
    ]);

    // 🔴 마스킹 정본이 셋이었다 — 화면 실사용 점검 W9(2026-08-14).
    //    여기만 `'*'.repeat(len-2)` 라서 **이름 길이가 그대로 드러났고**(`김**수` vs `홍○동`),
    //    공개 전광판·검진 보드가 쓰는 정본(`maskPublicName`)과 표기도 달랐다.
    //    같은 환자가 화면마다 다른 이름으로 보이면 그 자체가 오인의 씨앗이다.
    const rawName = `${visit.patient.familyName}${visit.patient.givenName}`;
    const name = masking ? maskPublicName(visit.patient.familyName, visit.patient.givenName) : rawName;

    return {
      ...base,
      empty: false,
      visit: {
        id: visit.id,
        name,
        gender: visit.patient.gender ?? null,
        dateOfBirth: visit.patient.dateOfBirth ?? null,
        mrn: f('mrn') ? visit.patient.mrn : null,
        triageLevel: visit.triageLevel,
        chiefComplaint: f('complaint') ? visit.chiefComplaint : null,
        arrivalAt: visit.arrivalAt,
        status: visit.status,
        disposition: visit.disposition ?? null,
        onVentilator: visit.onVentilator,
        doctor: doctor ? `${doctor.familyName}${doctor.givenName}` : null,
        allergies: allergies.map((a) => ({ allergen: a.allergen, severity: a.severity })),
        fallRisk: fallRisk?.riskLevel ?? null,
        guardian,
      },
    };
  }

  /**
   * 운영 리포트(P3) — 배정 이력 기반 구역 점유율·베드 회전. 표본이 없으면 없는 대로 반환(추정 금지).
   */
  async getStats(days = 7) {
    const windowDays = Math.min(Math.max(Math.floor(days) || 7, 1), 90);
    const since = new Date(Date.now() - windowDays * 86400_000);
    const assigns = await this.prisma.emergencyBedAssignment.findMany({
      where: { assignedAt: { gte: since } },
      select: { bedId: true, assignedAt: true, releasedAt: true, releaseReason: true },
    });
    const beds = await this.prisma.bed.findMany({
      where: { ward: { type: 'EMERGENCY', isActive: true } }, select: { id: true, roomNumber: true },
    });
    const zoneOf = new Map(beds.map((b) => [b.id, b.roomNumber]));

    const byZone: Record<string, { zone: string; assignments: number; completed: number; totalMins: number }> = {};
    const reasons: Record<string, number> = {};
    for (const a of assigns) {
      const zone = zoneOf.get(a.bedId) ?? '(제거됨)';
      const z = (byZone[zone] ??= { zone, assignments: 0, completed: 0, totalMins: 0 });
      z.assignments++;
      if (a.releasedAt) {
        z.completed++;
        z.totalMins += Math.floor((a.releasedAt.getTime() - a.assignedAt.getTime()) / 60000);
        if (a.releaseReason) reasons[a.releaseReason] = (reasons[a.releaseReason] ?? 0) + 1;
      }
    }
    const zones = Object.values(byZone).map((z) => ({
      zone: z.zone, assignments: z.assignments,
      avgOccupancyMinutes: z.completed ? Math.round(z.totalMins / z.completed) : null,
    }));
    const completedAll = assigns.filter((a) => a.releasedAt);
    return {
      windowDays,
      totalAssignments: assigns.length,
      avgOccupancyMinutes: completedAll.length
        ? Math.round(completedAll.reduce((s, a) => s + (a.releasedAt!.getTime() - a.assignedAt.getTime()) / 60000, 0) / completedAll.length)
        : null,
      zones,
      releaseReasons: reasons,
      bedCount: beds.length,
    };
  }

  /** 베드 추가(관리·§4.4) — 삭제는 없다(이력 보존). 비활성=MAINTENANCE 전환으로 갈음 */
  async createBed(zone: string, bedNumber: string) {
    const ward = await this.prisma.ward.findFirst({ where: { type: 'EMERGENCY', isActive: true }, select: { id: true } });
    if (!ward) throw new NotFoundException('응급병동이 없습니다');
    if (!/^[A-Z]{2,10}$/.test(zone)) throw new BadRequestException('구역 코드는 대문자 2~10자입니다 (예: RESUS·ACUTE)');
    if (!/^[0-9]{1,3}$/.test(bedNumber)) throw new BadRequestException('베드 번호는 숫자 1~3자리입니다');
    try {
      return await this.prisma.bed.create({
        data: { wardId: ward.id, roomNumber: zone, bedNumber, status: BedStatus.AVAILABLE },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new BadRequestException(`${zone}-${bedNumber} 베드가 이미 있습니다`);
      }
      throw e;
    }
  }

  /** 베드 구역/번호 변경(관리) — 점유·활성 배정이 있으면 거부 */
  async renameBed(bedId: string, zone: string, bedNumber: string) {
    const bed = await this.prisma.bed.findUnique({ where: { id: bedId }, include: { ward: { select: { type: true } } } });
    if (!bed || bed.ward.type !== 'EMERGENCY') throw new NotFoundException('응급실 베드가 아닙니다');
    const active = await this.prisma.emergencyBedAssignment.findFirst({ where: { bedId, releasedAt: null }, select: { id: true } });
    if (active || bed.status === BedStatus.OCCUPIED) throw new ConflictException('점유 중인 베드는 이름을 바꿀 수 없습니다');
    if (!/^[A-Z]{2,10}$/.test(zone)) throw new BadRequestException('구역 코드는 대문자 2~10자입니다');
    if (!/^[0-9]{1,3}$/.test(bedNumber)) throw new BadRequestException('베드 번호는 숫자 1~3자리입니다');
    try {
      return await this.prisma.bed.update({ where: { id: bedId }, data: { roomNumber: zone, bedNumber } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new BadRequestException(`${zone}-${bedNumber} 베드가 이미 있습니다`);
      }
      throw e;
    }
  }

  /**
   * 워크플로 훅용 무예외 해제(P1) — 배정이 없으면 조용히 넘어가고, 실패해도 진료 흐름을 막지 않는다
   * (실패 잔재는 보드의 유령 점유 배지로 회수). 호출: admit 성공·퇴실(checkout)·사망 확정·stale auto-close.
   */
  async releaseByVisit(visitId: string, reason: string): Promise<boolean> {
    try {
      const current = await this.prisma.emergencyBedAssignment.findFirst({
        where: { visitId, releasedAt: null }, select: { id: true, bedId: true },
      });
      if (!current) return false;
      await this.prisma.$transaction([
        this.prisma.emergencyBedAssignment.update({
          where: { id: current.id }, data: { releasedAt: new Date(), releaseReason: reason.slice(0, 30) },
        }),
        this.prisma.bed.update({ where: { id: current.bedId }, data: { status: BedStatus.CLEANING } }),
        this.prisma.emergencyVisit.update({ where: { id: visitId }, data: { bedId: null } }),
      ]);
      return true;
    } catch (e) {
      this.logger.warn(`ER 베드 자동 해제 실패(비차단·${reason}): ${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
  }

  async assign(visitId: string, bedId: string, userId: string) {
    const [visit, bed] = await Promise.all([
      this.prisma.emergencyVisit.findUnique({ where: { id: visitId }, select: { id: true, patientId: true, status: true, triageLevel: true } }),
      this.prisma.bed.findUnique({ where: { id: bedId }, include: { ward: { select: { type: true } } } }),
    ]);
    if (!visit) throw new NotFoundException('응급 방문을 찾을 수 없습니다');
    if (!ErBedService.ACTIVE_STATUSES.includes(visit.status)) throw new BadRequestException('재실 상태의 방문만 베드에 배정할 수 있습니다');
    if (!bed || bed.ward.type !== 'EMERGENCY') throw new NotFoundException('응급실 베드가 아닙니다');
    if (!([BedStatus.AVAILABLE, BedStatus.RESERVED] as BedStatus[]).includes(bed.status)) {
      throw new ConflictException(`배정할 수 없는 베드 상태입니다(${bed.status})`);
    }

    try {
      await this.prisma.$transaction([
        this.prisma.emergencyBedAssignment.create({ data: { visitId, bedId, assignedBy: userId } }),
        this.prisma.bed.update({ where: { id: bedId }, data: { status: BedStatus.OCCUPIED } }),
        this.prisma.emergencyVisit.update({ where: { id: visitId }, data: { bedId } }),
      ]);
    } catch (e) {
      this.throwIfConflict(e);
      throw e;
    }
    this.journey?.emit({
      patientId: visit.patientId, eventType: 'ER_BED_ASSIGNED', refType: 'EmergencyVisit', refId: visitId, // 여정 P0-5: 방문 단위 귀속
      title: `응급 베드 배정 (${bed.roomNumber}-${bed.bedNumber})`,
      department: '응급의학과', severity: 'INFO',
    });
    return { assigned: true, bedId, visitId };
  }

  async move(visitId: string, toBedId: string, userId: string) {
    const current = await this.prisma.emergencyBedAssignment.findFirst({
      where: { visitId, releasedAt: null }, select: { id: true, bedId: true },
    });
    if (!current) throw new BadRequestException('현재 배정된 베드가 없습니다 — 배정을 사용하세요');
    if (current.bedId === toBedId) throw new BadRequestException('같은 베드입니다');
    const [visit, toBed] = await Promise.all([
      this.prisma.emergencyVisit.findUnique({ where: { id: visitId }, select: { patientId: true } }),
      this.prisma.bed.findUnique({ where: { id: toBedId }, include: { ward: { select: { type: true } } } }),
    ]);
    if (!toBed || toBed.ward.type !== 'EMERGENCY') throw new NotFoundException('응급실 베드가 아닙니다');
    if (!([BedStatus.AVAILABLE, BedStatus.RESERVED] as BedStatus[]).includes(toBed.status)) {
      throw new ConflictException(`이동할 수 없는 베드 상태입니다(${toBed.status})`);
    }

    try {
      await this.prisma.$transaction([
        this.prisma.emergencyBedAssignment.update({
          where: { id: current.id }, data: { releasedAt: new Date(), releaseReason: 'MOVE' },
        }),
        this.prisma.emergencyBedAssignment.create({ data: { visitId, bedId: toBedId, assignedBy: userId } }),
        // 원 베드는 청소 대기 — 환자가 누웠던 자리는 즉시 재사용 불가
        this.prisma.bed.update({ where: { id: current.bedId }, data: { status: BedStatus.CLEANING } }),
        this.prisma.bed.update({ where: { id: toBedId }, data: { status: BedStatus.OCCUPIED } }),
        this.prisma.emergencyVisit.update({ where: { id: visitId }, data: { bedId: toBedId } }),
      ]);
    } catch (e) {
      this.throwIfConflict(e);
      throw e;
    }
    if (visit) {
      this.journey?.emit({
        patientId: visit.patientId, eventType: 'ER_BED_MOVED', refType: 'EmergencyVisit', refId: visitId, // 여정 P0-5: 방문 단위 귀속
        title: `응급 베드 이동 (${toBed.roomNumber}-${toBed.bedNumber})`,
        department: '응급의학과', severity: 'INFO',
      });
    }
    return { moved: true, fromBedId: current.bedId, toBedId };
  }

  async release(visitId: string, userId: string, reason = 'MANUAL') {
    const current = await this.prisma.emergencyBedAssignment.findFirst({
      where: { visitId, releasedAt: null }, select: { id: true, bedId: true },
    });
    if (!current) throw new BadRequestException('현재 배정된 베드가 없습니다');
    const visit = await this.prisma.emergencyVisit.findUnique({ where: { id: visitId }, select: { patientId: true } });

    await this.prisma.$transaction([
      this.prisma.emergencyBedAssignment.update({
        where: { id: current.id }, data: { releasedAt: new Date(), releaseReason: reason.slice(0, 30) },
      }),
      this.prisma.bed.update({ where: { id: current.bedId }, data: { status: BedStatus.CLEANING } }),
      this.prisma.emergencyVisit.update({ where: { id: visitId }, data: { bedId: null } }),
    ]);
    if (visit) {
      this.journey?.emit({
        patientId: visit.patientId, eventType: 'ER_BED_RELEASED', refType: 'EmergencyVisit', refId: visitId, // 여정 P0-5: 방문 단위 귀속
        title: '응급 베드 해제', department: '응급의학과', severity: 'INFO',
      });
    }
    return { released: true, bedId: current.bedId };
  }

  /** 상태 전환(청소완료·정비·격리·예약) — 점유 중 베드·활성 배정이 남은 베드는 거부. OCCUPIED 지정 불가(DTO 제한) */
  async setBedStatus(bedId: string, status: string) {
    const bed = await this.prisma.bed.findUnique({ where: { id: bedId }, include: { ward: { select: { type: true } } } });
    if (!bed || bed.ward.type !== 'EMERGENCY') throw new NotFoundException('응급실 베드가 아닙니다');
    const active = await this.prisma.emergencyBedAssignment.findFirst({ where: { bedId, releasedAt: null }, select: { id: true } });
    if (active) throw new ConflictException('점유 중인 베드입니다 — 해제/이동 후 상태를 바꿀 수 있습니다');
    // 유령 점유(OCCUPIED + 활성 배정 없음)는 여기로 정리 가능
    return this.prisma.bed.update({ where: { id: bedId }, data: { status: status as BedStatus } });
  }

  /** 부분 유니크 인덱스 위반(동시 배정 경합)을 409 로 번역 */
  private throwIfConflict(e: unknown) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      throw new ConflictException('방금 다른 사용자가 먼저 배정했습니다 — 보드를 새로고침해 주세요');
    }
    // 부분 인덱스는 Prisma 미인지 — raw 유니크 위반 메시지도 방어
    if (e instanceof Error && /uq_er_(bed|visit)_active/.test(e.message)) {
      throw new ConflictException('방금 다른 사용자가 먼저 배정했습니다 — 보드를 새로고침해 주세요');
    }
  }
}
