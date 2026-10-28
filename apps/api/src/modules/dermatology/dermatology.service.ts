import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { specialtyTodayList, specialtyTodayStats, specialtyRecordPatients } from '../../common/specialty-board';

@Injectable()
export class DermatologyService {
  private readonly logger = new Logger(DermatologyService.name);
  constructor(private readonly prisma: PrismaService) {}

  /* ───── Patients (내 환자 목록) ───── */

  /** 기록이 있는 환자 — 최근 기록 순 상한 + 전체 수·잘림(정본 specialtyRecordPatients · 2026-10-10) */
  async getPatients() {
    return specialtyRecordPatients(this.prisma, (a) => this.prisma.skinLesion.groupBy(a as never), 'recordedAt');
  }

  /* ───── Lesions ───── */

  async createLesion(data: {
    patientId: string; encounterId?: string;
    location: string; bodyRegion: string; morphology: string;
    color?: string; size?: string; border?: string;
    distribution?: string; surface?: string; dermoscopy?: unknown;
    abcdeScore?: number; photoUrls?: unknown;
    biopsyTaken?: boolean; biopsyResult?: string;
    diagnosis?: string; diagnosisCode?: string; notes?: string;
    recordedBy: string;
  }) {
    return this.prisma.skinLesion.create({
      data: {
        patientId: data.patientId,
        encounterId: data.encounterId,
        location: data.location,
        bodyRegion: data.bodyRegion,
        morphology: data.morphology,
        color: data.color,
        size: data.size,
        border: data.border,
        distribution: data.distribution,
        surface: data.surface,
        dermoscopy: data.dermoscopy as never,
        abcdeScore: data.abcdeScore,
        photoUrls: data.photoUrls as never,
        biopsyTaken: data.biopsyTaken,
        biopsyResult: data.biopsyResult,
        diagnosis: data.diagnosis,
        diagnosisCode: data.diagnosisCode,
        notes: data.notes,
        recordedBy: data.recordedBy,
      },
      include: { patient: { select: { familyName: true, givenName: true, mrn: true } } },
    });
  }

  async getLesions(patientId: string) {
    return this.prisma.skinLesion.findMany({
      where: { patientId },
      include: {
        recorder: { select: { familyName: true, givenName: true } },
        _count: { select: { treatments: true } },
      },
      orderBy: { recordedAt: 'desc' },
    });
  }

  async getLesionDetail(id: string) {
    const lesion = await this.prisma.skinLesion.findUnique({
      where: { id },
      include: {
        patient: { select: { familyName: true, givenName: true, mrn: true } },
        recorder: { select: { familyName: true, givenName: true } },
        treatments: { orderBy: { treatedAt: 'desc' } },
      },
    });
    if (!lesion) throw new NotFoundException('병변 기록을 찾을 수 없습니다');
    return lesion;
  }

  async updateLesion(id: string, data: {
    size?: string; diagnosis?: string; diagnosisCode?: string;
    biopsyResult?: string; notes?: string; photoUrls?: unknown;
  }) {
    const lesion = await this.prisma.skinLesion.findUnique({ where: { id } });
    if (!lesion) throw new NotFoundException('병변 기록을 찾을 수 없습니다');
    return this.prisma.skinLesion.update({
      where: { id },
      data: {
        ...(data.size && { size: data.size }),
        ...(data.diagnosis && { diagnosis: data.diagnosis }),
        ...(data.diagnosisCode && { diagnosisCode: data.diagnosisCode }),
        ...(data.biopsyResult && { biopsyResult: data.biopsyResult }),
        ...(data.notes !== undefined && { notes: data.notes }),
        ...(data.photoUrls ? { photoUrls: data.photoUrls as never } : {}),
      },
    });
  }

  /* ───── Treatments ───── */

  async createTreatment(data: {
    lesionId?: string; patientId: string; treatmentType: string;
    procedure: string; area?: string; parameters?: unknown;
    medication?: string; beforePhotoUrl?: string; afterPhotoUrl?: string;
    complications?: string; nextSession?: string; treatedBy: string;
  }) {
    return this.prisma.skinTreatment.create({
      data: {
        lesionId: data.lesionId,
        patientId: data.patientId,
        treatmentType: data.treatmentType,
        procedure: data.procedure,
        area: data.area,
        parameters: data.parameters as never,
        medication: data.medication,
        beforePhotoUrl: data.beforePhotoUrl,
        afterPhotoUrl: data.afterPhotoUrl,
        complications: data.complications,
        nextSession: data.nextSession ? new Date(data.nextSession) : undefined,
        treatedBy: data.treatedBy,
      },
    });
  }

  async getTreatments(patientId: string) {
    return this.prisma.skinTreatment.findMany({
      where: { patientId },
      include: {
        lesion: { select: { location: true, bodyRegion: true, morphology: true } },
        treatedByUser: { select: { familyName: true, givenName: true } },
      },
      orderBy: { treatedAt: 'desc' },
    });
  }

  /* ───── Body Map / Today / Stats ───── */

  /**
   * 전신 바디맵 일괄 기록 — 무저장 스텁 근절(R1b). 정본 SkinLesion에 부위별 create
   * (getBodyMap이 skinLesion을 읽으므로 읽기/쓰기 대칭 회복 — 별도 스냅샷 테이블 없음).
   * regions: 배열 [{bodyRegion, location?, morphology?, size?, notes?}] 또는 부위 키 객체 허용.
   */
  async createBodyMap(patientId: string, data: { regions: unknown; notes?: string; recordedBy: string }) {
    const raw = Array.isArray(data.regions)
      ? data.regions
      : data.regions && typeof data.regions === 'object'
        ? Object.entries(data.regions as Record<string, unknown>).map(([bodyRegion, v]) => ({
            bodyRegion, ...(typeof v === 'object' && v !== null ? v : { notes: v != null ? String(v) : undefined }),
          }))
        : [];
    const items = raw as { bodyRegion?: string; location?: string; morphology?: string; size?: string; notes?: string }[];
    if (items.length === 0) throw new BadRequestException('regions가 비어 있습니다 — 부위별 병변 배열 또는 부위 키 객체를 전송하세요.');
    const invalid = items.map((r, i) => (!r.bodyRegion?.trim() ? i + 1 : null)).filter((x): x is number => x !== null);
    if (invalid.length) throw new BadRequestException(`bodyRegion 누락: ${invalid.join(', ')}번째 항목`);

    const created = await this.prisma.$transaction(
      items.map((r) =>
        this.prisma.skinLesion.create({
          data: {
            patientId,
            bodyRegion: r.bodyRegion!.trim(),
            location: r.location?.trim() || r.bodyRegion!.trim(),
            morphology: r.morphology?.trim() || 'UNSPECIFIED',
            size: r.size,
            notes: [r.notes, data.notes].filter(Boolean).join(' / ') || null,
            recordedBy: data.recordedBy,
          },
          select: { id: true, bodyRegion: true, location: true, morphology: true, recordedAt: true },
        }),
      ),
    );
    return { patientId, createdCount: created.length, lesions: created };
  }

  async getBodyMap(patientId: string) {
    return this.prisma.skinLesion.findMany({
      where: { patientId },
      select: { id: true, location: true, bodyRegion: true, morphology: true, size: true, diagnosis: true, recordedAt: true },
      orderBy: { recordedAt: 'desc' },
    });
  }

  async getToday() {
    // 🔴 라벨은 '오늘 예약'인데 검사·시술 기록을 반환하고 있었다(환자명·시간 칸이 전부 '-' 였던 원인).
    //    정본 = Appointment. 종전 목록은 각 과의 exams/records EP 로 계속 볼 수 있다.
    return specialtyTodayList(this.prisma, 'dermatology');
  }

  async getStats() {
    const [totalLesions, totalTreatments, typeCounts] = await Promise.all([
      this.prisma.skinLesion.count(),
      this.prisma.skinTreatment.count(),
      this.prisma.skinTreatment.groupBy({ by: ['treatmentType'], _count: true }),
    ]);
    // 🔴 화면 상단 4카드(completed/inProgress/waiting)의 키가 이 응답에 없어 개통 이래 항상 0 이었다.
    //    정본 = specialtyTodayStats(Appointment). import 만 해두고 부르지 않았다.
    return { totalLesions, totalTreatments, typeCounts, ...(await specialtyTodayStats(this.prisma, 'dermatology')) };
  }

  /* ───── Pathology Integration (Phase 2) ───── */

  /**
   * 🔴 2026-08-20 전송 정직성 — 종전 이 메서드는 `biopsyStatus:'SUBMITTED'` 와 JSON `submittedAt: now` 를
   * 적었다. 그러나 **병리과가 받는 곳이 만들어지지 않는다.** 병리 워크리스트 정본은
   * `modules/pathology`(`PathologySpecimen` · accessionNo 채번 · status RECEIVED)인데 이 경로는
   * 그 행을 만들지 않으므로, 병리과에는 이 의뢰가 **존재한 적이 없다**(수신자 0).
   *
   * 대신 접수를 만들지 않는 이유: 검체 접수(accession)는 **물리 검체가 실제 도착해야** 성립한다.
   * 여기서 대신 만들면 도착하지 않은 검체를 '접수됨'으로 적는 새 거짓말이 된다.
   * 그래서 남기는 것은 **의뢰의 원내 기록**뿐이다 —
   *  · 상태는 정본 어휘 `LOCAL_RECORDED`(원내 기록만·병리과로 나가지 않음. 어휘 정본은
   *    `modules/infection-control/external-reporting.ts` `NOTIFIABLE_STATUS`)
   *  · 시각은 `requestedAt` = **의사가 의뢰한 시각**(사용자가 방금 한 행위라 사실이다).
   *    병리과가 접수한 시각은 모르므로 적지 않는다
   *  · `pathologyAccession: null` — 기관(병리과) 부여 번호가 없음을 명시
   * 병리 접수 연동은 검체 동선·라벨링이 걸린 운영 결정이라 사람 판단이다(코드가 채널을 새로 만들지 않는다).
   */
  async submitPathology(lesionId: string, data: {
    specimenType: string; clinicalHistory: string; requestedBy: string;
  }) {
    const lesion = await this.prisma.skinLesion.findUnique({ where: { id: lesionId } });
    if (!lesion) throw new NotFoundException('병변 기록을 찾을 수 없습니다');
    const now = new Date();
    this.logger.warn(
      `병변 ${lesionId} 병리 의뢰 — 원내 기록만(NOT_TRANSMITTED). 병리 검체접수(PathologySpecimen) 경로 미배선 · 조치: 검체를 병리과에 전달한 뒤 병리 검체접수에 등록하십시오`,
    );
    return this.prisma.skinLesion.update({
      where: { id: lesionId },
      data: {
        biopsyTaken: true,
        biopsyStatus: 'LOCAL_RECORDED',
        biopsyResult: JSON.stringify({
          specimenType: data.specimenType,
          clinicalHistory: data.clinicalHistory,
          requestedBy: data.requestedBy,
          requestedAt: now.toISOString(),
          pathologyAccession: null,
          transmission: {
            channel: 'PATHOLOGY',
            outcome: 'NOT_TRANSMITTED',
            reason: '병리 검체접수(PathologySpecimen) 생성 경로 미배선 — 병리과에 이 의뢰가 등록되지 않았습니다',
            manualFallback: '검체를 병리과에 전달한 뒤 병리 검체접수(accession)에 등록하십시오',
          },
        }),
      },
      include: { patient: { select: { familyName: true, givenName: true, mrn: true } } },
    });
  }

  async receivePathologyResult(lesionId: string, data: {
    diagnosis: string; grade?: string; margins?: string; biopsyResult: string;
  }) {
    const lesion = await this.prisma.skinLesion.findUnique({ where: { id: lesionId } });
    if (!lesion) throw new NotFoundException('병변 기록을 찾을 수 없습니다');

    // Merge existing biopsy metadata with result
    let existingMeta: Record<string, unknown> = {};
    if (lesion.biopsyResult) {
      try { existingMeta = JSON.parse(lesion.biopsyResult) as Record<string, unknown>; } catch { /* plain text */ }
    }
    const fullResult = JSON.stringify({
      ...existingMeta,
      diagnosis: data.diagnosis,
      grade: data.grade,
      margins: data.margins,
      result: data.biopsyResult,
      completedAt: new Date().toISOString(),
    });

    return this.prisma.skinLesion.update({
      where: { id: lesionId },
      data: {
        biopsyStatus: 'COMPLETED',
        biopsyResult: fullResult,
        diagnosis: data.diagnosis,
      },
      include: { patient: { select: { familyName: true, givenName: true, mrn: true } } },
    });
  }

  async getPathologyHistory(patientId: string) {
    return this.prisma.skinLesion.findMany({
      where: {
        patientId,
        biopsyTaken: true,
      },
      select: {
        id: true,
        location: true,
        bodyRegion: true,
        morphology: true,
        biopsyStatus: true,
        biopsyResult: true,
        diagnosis: true,
        recordedAt: true,
        recorder: { select: { familyName: true, givenName: true } },
      },
      orderBy: { recordedAt: 'desc' },
    });
  }
}
