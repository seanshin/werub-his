import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { withAdvisoryLock } from '../../common/util/advisory-lock';
import { MedicalAiService } from '../medical-ai/medical-ai.service';
import { promptList } from '../medical-ai/ai-grounding';
import {
  KCCR_CHANNEL,
  classifyKccrTransmission,
  localKccrRef,
} from './kccr-reporting';

export interface TimelineEntry {
  date: Date;
  type: string;
  title: string;
  detail: Record<string, unknown>;
}

/**
 * 🔴 원결함: generateKccrReport 는 payload 를 **반환만** 하는데(전송 코드 없음)
 * 화면은 "KCCR 일괄 보고가 완료되었습니다" 라고 말하고, 서버는 reportedToKccr=true 로
 * 전건을 봉인했다 = 보내지 않고 '보냈다'고 기록(P16).
 *
 * 이 시스템에는 중앙암등록본부(KCCR) 전송 연동이 **없다**. 없는 전송을 흉내내지 않는다.
 * 대신 '나가지 않았다'는 사실을 응답에 실어 화면이 그대로 말하게 한다.
 *  - reportedToKccr = **보고 대상 확정(제출 자료 산출 완료 · 미전송)** 의 뜻으로만 쓴다.
 *  - 실제 전송 완료는 이 필드로 표현할 수 없다(transmission.status 가 정본).
 */
export const KCCR_TRANSMISSION = {
  status: 'NOT_TRANSMITTED' as const,
  channel: null,
  /** reportedToKccr 필드의 정확한 의미 */
  markMeaning: 'PREPARED_NOT_TRANSMITTED' as const,
  note:
    '중앙암등록본부(KCCR) 전송 연동이 구축되어 있지 않습니다. ' +
    '이 결과는 제출용 데이터 산출물이며, 전송된 것이 아닙니다.',
  /** 연동을 붙이는 날 여기 하나가 true 가 된다 — 그 전엔 어떤 코드도 전송 완료를 적을 수 없다 */
  channelImplemented: KCCR_CHANNEL.implemented,
  manualFallback: KCCR_CHANNEL.manualFallback,
};

/**
 * 🔴 `ALREADY_TRANSMITTED` 만이 재제출을 막는다. `ALREADY_PREPARED`(보고 대상 확정)는
 *    **나가지 않은 상태**이므로 자료를 다시 산출할 수 있어야 한다 — 한 번 눌러 영구
 *    미보고로 굳는 것을 막는다(external-reporting 의 RESUBMITTABLE 규약과 동일).
 */
export type KccrSkipReason = 'NOT_FOUND' | 'NOT_VERIFIED' | 'ALREADY_PREPARED' | 'ALREADY_TRANSMITTED';

export interface KccrSkipped {
  id: string;
  registrationNo: string | null;
  reason: KccrSkipReason;
}

/** KCCR 제출 자료 구성에 필요한 조회 형태 */
type KccrSourceRegistry = Prisma.CancerRegistryGetPayload<{
  include: {
    patient: {
      select: {
        id: true;
        mrn: true;
        familyName: true;
        givenName: true;
        dateOfBirth: true;
        gender: true;
      };
    };
    treatments: true;
  };
}>;

/**
 * 확인(VERIFIED)이 보증하는 **등록 내용** — 바뀌면 확인이 풀린다.
 * 추적관찰 칸은 확인 뒤에도 계속 갱신되는 사실이라 확인을 풀지 않는다(`update` 주석 참조).
 */
const REGISTRATION_STRING_FIELDS = [
  'primarySite', 'morphology', 'behavior', 'grade', 'laterality',
  'diagnosisBasis', 'icdCode', 'tnmClinical', 'tnmPathological', 'ajccStage', 'firstTreatment',
] as const;
const REGISTRATION_DATE_FIELDS = ['diagnosisDate', 'firstTreatmentDate'] as const;
const FOLLOW_UP_STRING_FIELDS = ['vitalStatus', 'recurrenceSite', 'causeOfDeath'] as const;
const FOLLOW_UP_DATE_FIELDS = ['recurrenceDate', 'lastContactDate', 'deathDate'] as const;

@Injectable()
export class CancerRegistryService {
  private readonly logger = new Logger(CancerRegistryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly medicalAi: MedicalAiService,
  ) {}

  /** 암등록 목록 조회 */
  async findAll(filters: {
    primarySite?: string;
    ajccStage?: string;
    status?: string;
    /** 🔴 원결함: 화면은 vitalStatus= 로 필터를 보내는데 서버가 받지 않아 필터가 무효였다 */
    vitalStatus?: string;
    /** 🔴 원결함: KCCR 탭이 reportedToKccr=false 로 '미보고 목록'을 요청하는데
     *  서버가 무시해 이미 확정된 건까지 미보고로 보였다 */
    reportedToKccr?: boolean;
    page?: number;
    limit?: number;
  }) {
    const { primarySite, ajccStage, status, vitalStatus, reportedToKccr, page = 1, limit = 20 } = filters;
    const where: Prisma.CancerRegistryWhereInput = {};
    if (primarySite) where.primarySite = primarySite;
    if (ajccStage) where.ajccStage = ajccStage;
    if (status) where.status = status;
    if (vitalStatus) where.vitalStatus = vitalStatus;
    if (reportedToKccr !== undefined) where.reportedToKccr = reportedToKccr;

    const [items, total] = await Promise.all([
      this.prisma.cancerRegistry.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          patient: { select: { id: true, mrn: true, familyName: true, givenName: true, dateOfBirth: true, gender: true } },
        },
      }),
      this.prisma.cancerRegistry.count({ where }),
    ]);

    // 🔴 전송 여부 판정은 서비스에서 한 번만 한다 — 화면이 reportedToKccr 를 보고 스스로
    //    '보고 완료'로 읽으면 정본이 둘이 된다(P12).
    return {
      items: items.map((r) => ({ ...r, transmission: classifyKccrTransmission(r) })),
      total,
      page,
      limit,
    };
  }

  /** 암등록 생성 (registrationNo 자동 생성: CR-YYYY-NNNNN) */
  async create(data: Record<string, unknown>, userId: string) {
    const year = new Date().getFullYear();
    const prefix = `CR-${year}-`;

    // 채번 원자화 — registrationNo @unique 동시 생성 충돌(P2002) 방지
    return withAdvisoryLock(this.prisma, `cancer-reg:${year}`, async (tx) => {
    const lastRegistry = await tx.cancerRegistry.findFirst({
      where: { registrationNo: { startsWith: prefix } },
      orderBy: { registrationNo: 'desc' },
      select: { registrationNo: true },
    });

    let seq = 1;
    if (lastRegistry) {
      const lastSeq = parseInt(lastRegistry.registrationNo.replace(prefix, ''), 10);
      seq = lastSeq + 1;
    }
    const registrationNo = `${prefix}${String(seq).padStart(5, '0')}`;

    return tx.cancerRegistry.create({
      data: {
        registrationNo,
        patientId: data.patientId as string,
        diagnosisDate: new Date(data.diagnosisDate as string),
        primarySite: data.primarySite as string,
        morphology: data.morphology as string,
        behavior: data.behavior as string,
        grade: (data.grade as string) ?? null,
        laterality: (data.laterality as string) ?? null,
        diagnosisBasis: data.diagnosisBasis as string,
        icdCode: data.icdCode as string,
        tnmClinical: (data.tnmClinical as string) ?? null,
        tnmPathological: (data.tnmPathological as string) ?? null,
        ajccStage: (data.ajccStage as string) ?? null,
        ajccEdition: data.ajccEdition ? Number(data.ajccEdition) : null,
        firstTreatment: (data.firstTreatment as string) ?? null,
        firstTreatmentDate: data.firstTreatmentDate ? new Date(data.firstTreatmentDate as string) : null,
        vitalStatus: (data.vitalStatus as string) ?? 'ALIVE',
        registrarId: userId,
        status: 'REGISTERED',
      },
      include: {
        patient: { select: { id: true, mrn: true, familyName: true, givenName: true } },
      },
    });
    });
  }

  /** 암등록 상세 조회 */
  async findOne(id: string) {
    const registry = await this.prisma.cancerRegistry.findUnique({
      where: { id },
      include: {
        patient: { select: { id: true, mrn: true, familyName: true, givenName: true, dateOfBirth: true, gender: true } },
        treatments: { orderBy: { startDate: 'asc' } },
        followUps: { orderBy: { followUpDate: 'desc' } },
      },
    });
    if (!registry) throw new NotFoundException('Cancer registry not found');
    // 전송 여부는 판정 정본을 통해서만 나간다(화면이 reportedToKccr 로 자체 판정하지 않게)
    return { ...registry, transmission: classifyKccrTransmission(registry) };
  }

  /**
   * 암등록 수정
   *
   * 🔴 (2026-09-15 P3) 확인(VERIFIED) 뒤에도 등록 내용을 고칠 수 있었고, 고쳐도 **확인 표시가 그대로** 남았다 —
   *    KCCR 제출 대상(`status='VERIFIED'`)에 아무도 확인하지 않은 내용이 섞였다.
   *    수정 자체는 막지 않는다(정정은 원내 절차의 몫). 대신 **등록 내용**이 실제로 바뀌면 확인을 해제해
   *    '확인 전(REGISTERED)'으로 되돌리고(재확인은 기존 확인 EP) 무엇이 바뀌었는지 응답에 싣는다.
   *    추적관찰 칸(생존상태·재발·사망·마지막 접촉일)은 확인 뒤에도 계속 갱신되는 사실이라 해제하지 않는다
   *    (`addFollowUp` 이 마지막 접촉일을 매번 갱신한다 — 여기에 넣으면 추적관찰마다 확인이 풀린다).
   *    이미 산출된 KCCR 제출 자료(`reportedToKccr`)는 소급해 고치지 않는다 — 응답이 그 사실만 알린다.
   */
  async update(id: string, data: Record<string, unknown>) {
    const before = await this.findOne(id);

    const updateData: Record<string, unknown> = {};
    for (const field of [...REGISTRATION_STRING_FIELDS, ...FOLLOW_UP_STRING_FIELDS]) {
      if (data[field] !== undefined) updateData[field] = data[field];
    }
    for (const field of [...REGISTRATION_DATE_FIELDS, ...FOLLOW_UP_DATE_FIELDS]) {
      if (data[field] !== undefined) updateData[field] = data[field] ? new Date(data[field] as string) : null;
    }
    if (data.ajccEdition !== undefined) updateData.ajccEdition = data.ajccEdition ? Number(data.ajccEdition) : null;

    // 등록 내용 중 **값이 실제로 달라진** 칸만 센다(같은 값을 다시 보낸 저장은 확인을 풀지 않는다)
    const prev = before as unknown as Record<string, unknown>;
    // 날짜 칸은 @db.Date — 저장되는 것은 달력 날짜(UTC 기준 날짜부)라 그 단위로 비교한다(시각 차이를 변경으로 세지 않는다)
    const norm = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : v == null || v === '' ? null : String(v));
    const changedRegistrationFields = [...REGISTRATION_STRING_FIELDS, ...REGISTRATION_DATE_FIELDS, 'ajccEdition']
      .filter((f) => f in updateData && norm(updateData[f]) !== norm(prev[f]));

    const include = { patient: { select: { id: true, mrn: true, familyName: true, givenName: true } } };
    if (changedRegistrationFields.length === 0) {
      const updated = await this.prisma.cancerRegistry.update({ where: { id }, data: updateData, include });
      return { ...updated, verificationReset: null };
    }

    const result = await this.prisma.$transaction(async (tx) => {
      await tx.cancerRegistry.update({ where: { id }, data: updateData });
      // 조건부 — 읽은 뒤 확인이 끼어들었어도 확인된 행이면 해제한다(확인이 수정보다 먼저였다)
      const reset = await tx.cancerRegistry.updateMany({
        where: { id, status: 'VERIFIED' },
        data: { status: 'REGISTERED', verifiedAt: null, verifiedBy: null },
      });
      const updated = await tx.cancerRegistry.findUnique({ where: { id }, include });
      return { updated, resetCount: reset.count };
    });
    return {
      ...result.updated,
      verificationReset: result.resetCount > 0
        ? {
            reason: 'MODIFIED_AFTER_VERIFICATION' as const,
            changedFields: changedRegistrationFields,
            previousVerifiedAt: before.verifiedAt ?? null,
            previousVerifiedBy: before.verifiedBy ?? null,
            kccrPrepared: before.reportedToKccr === true,
          }
        : null,
    };
  }

  /** 확인 처리 (REGISTERED → VERIFIED) */
  async verify(id: string, verifiedBy?: string) {
    const registry = await this.findOne(id);
    if (registry.status !== 'REGISTERED') {
      throw new BadRequestException(`Cannot verify registry in status: ${registry.status}`);
    }

    return this.prisma.cancerRegistry.update({
      where: { id },
      data: { status: 'VERIFIED', verifiedAt: new Date(), verifiedBy: verifiedBy ?? null },
    });
  }

  /** 치료 기록 추가 */
  async addTreatment(registryId: string, data: Record<string, unknown>) {
    await this.findOne(registryId);

    return this.prisma.cancerTreatment.create({
      data: {
        registryId,
        treatmentType: data.treatmentType as string,
        startDate: new Date(data.startDate as string),
        endDate: data.endDate ? new Date(data.endDate as string) : null,
        regimen: (data.regimen as string) ?? null,
        cycles: data.cycles ? Number(data.cycles) : null,
        response: (data.response as string) ?? null,
        surgeryType: (data.surgeryType as string) ?? null,
        radiationDose: (data.radiationDose as string) ?? null,
        note: (data.note as string) ?? null,
      },
    });
  }

  /** 치료 기록 수정 */
  async updateTreatment(id: string, data: Record<string, unknown>) {
    const existing = await this.prisma.cancerTreatment.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Treatment record not found');

    const updateData: Record<string, unknown> = {};
    if (data.treatmentType !== undefined) updateData.treatmentType = data.treatmentType;
    if (data.startDate !== undefined) updateData.startDate = new Date(data.startDate as string);
    if (data.endDate !== undefined) updateData.endDate = data.endDate ? new Date(data.endDate as string) : null;
    if (data.regimen !== undefined) updateData.regimen = data.regimen;
    if (data.cycles !== undefined) updateData.cycles = data.cycles ? Number(data.cycles) : null;
    if (data.response !== undefined) updateData.response = data.response;
    if (data.surgeryType !== undefined) updateData.surgeryType = data.surgeryType;
    if (data.radiationDose !== undefined) updateData.radiationDose = data.radiationDose;
    if (data.note !== undefined) updateData.note = data.note;

    return this.prisma.cancerTreatment.update({
      where: { id },
      data: updateData,
    });
  }

  /** 추적관찰 기록 추가 */
  async addFollowUp(registryId: string, data: Record<string, unknown>, userId: string) {
    await this.findOne(registryId);

    const followUp = await this.prisma.cancerFollowUp.create({
      data: {
        registryId,
        followUpDate: new Date(data.followUpDate as string),
        status: data.status as string,
        recurrence: (data.recurrence as boolean) ?? false,
        metastasisSite: (data.metastasisSite as string) ?? null,
        performanceStatus: (data.performanceStatus as string) ?? null,
        note: (data.note as string) ?? null,
        recordedBy: userId,
      },
    });

    // 마지막 접촉일 자동 업데이트
    await this.prisma.cancerRegistry.update({
      where: { id: registryId },
      data: { lastContactDate: new Date(data.followUpDate as string) },
    });

    return followUp;
  }

  /** 타임라인 (진단 → 치료 → 추적관찰 통합) */
  async getTimeline(id: string) {
    const registry = await this.findOne(id);

    const timeline: TimelineEntry[] = [];

    // 진단
    timeline.push({
      date: registry.diagnosisDate,
      type: 'DIAGNOSIS',
      title: `진단: ${registry.icdCode} (${registry.primarySite})`,
      detail: {
        icdCode: registry.icdCode,
        primarySite: registry.primarySite,
        morphology: registry.morphology,
        ajccStage: registry.ajccStage,
      },
    });

    // 치료
    for (const tx of registry.treatments) {
      timeline.push({
        date: tx.startDate,
        type: 'TREATMENT',
        title: `치료: ${tx.treatmentType}${tx.regimen ? ` (${tx.regimen})` : ''}`,
        detail: { id: tx.id, treatmentType: tx.treatmentType, regimen: tx.regimen, response: tx.response },
      });
    }

    // 추적관찰
    for (const fu of registry.followUps) {
      timeline.push({
        date: fu.followUpDate,
        type: 'FOLLOW_UP',
        title: `추적관찰: ${fu.status}${fu.recurrence ? ' (재발)' : ''}`,
        detail: { id: fu.id, status: fu.status, recurrence: fu.recurrence, performanceStatus: fu.performanceStatus },
      });
    }

    timeline.sort((a, b) => a.date.getTime() - b.date.getTime());

    return { registryId: id, registrationNo: registry.registrationNo, timeline };
  }

  /** 환자별 암등록 이력 */
  async getPatientHistory(patientId: string) {
    return this.prisma.cancerRegistry.findMany({
      where: { patientId },
      orderBy: { diagnosisDate: 'desc' },
      include: {
        treatments: { select: { id: true, treatmentType: true, startDate: true, response: true } },
        followUps: { select: { id: true, followUpDate: true, status: true, recurrence: true }, orderBy: { followUpDate: 'desc' }, take: 3 },
      },
    });
  }

  /** 통계 (부위별, 병기별, 생존상태별) */
  async getStats(primarySite?: string) {
    const where: Prisma.CancerRegistryWhereInput = {};
    if (primarySite) where.primarySite = primarySite;

    const [total, bySite, byStage, byVitalStatus] = await Promise.all([
      this.prisma.cancerRegistry.count({ where }),
      this.prisma.cancerRegistry.groupBy({
        by: ['primarySite'],
        where,
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
      }),
      this.prisma.cancerRegistry.groupBy({
        by: ['ajccStage'],
        where,
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
      }),
      this.prisma.cancerRegistry.groupBy({
        by: ['vitalStatus'],
        where,
        _count: { id: true },
      }),
    ]);

    return {
      total,
      bySite: bySite.map((s) => ({ site: s.primarySite, count: s._count.id })),
      byStage: byStage.map((s) => ({ stage: s.ajccStage ?? 'UNKNOWN', count: s._count.id })),
      byVitalStatus: byVitalStatus.map((s) => ({ status: s.vitalStatus, count: s._count.id })),
    };
  }

  /** 생존분석 데이터 (진단 후 개월 수 vs 생존상태) */
  async getSurvivalData(primarySite?: string) {
    const where: Prisma.CancerRegistryWhereInput = {};
    if (primarySite) where.primarySite = primarySite;

    const registries = await this.prisma.cancerRegistry.findMany({
      where,
      select: {
        id: true,
        diagnosisDate: true,
        vitalStatus: true,
        deathDate: true,
        lastContactDate: true,
        ajccStage: true,
        primarySite: true,
      },
    });

    const now = new Date();
    const data = registries.map((r) => {
      const endDate = r.deathDate ?? r.lastContactDate ?? now;
      const monthsSinceDiagnosis = Math.round(
        (endDate.getTime() - r.diagnosisDate.getTime()) / (1000 * 60 * 60 * 24 * 30.44),
      );
      return {
        id: r.id,
        primarySite: r.primarySite,
        ajccStage: r.ajccStage,
        monthsSinceDiagnosis,
        vitalStatus: r.vitalStatus,
        censored: r.vitalStatus === 'ALIVE',
      };
    });

    return { count: data.length, data };
  }

  /** KCCR 제출 자료 1행 구성 (조회 전용 — 어떤 상태도 바꾸지 않는다) */
  private buildKccrRow(r: KccrSourceRegistry) {
    return {
      registryId: r.id,
      registrationNo: r.registrationNo,
      patientMrn: r.patient.mrn,
      patientName: `${r.patient.familyName}${r.patient.givenName}`,
      birthDate: r.patient.dateOfBirth,
      gender: r.patient.gender,
      diagnosisDate: r.diagnosisDate,
      primarySite: r.primarySite,
      morphology: r.morphology,
      behavior: r.behavior,
      grade: r.grade,
      laterality: r.laterality,
      diagnosisBasis: r.diagnosisBasis,
      icdCode: r.icdCode,
      tnmClinical: r.tnmClinical,
      tnmPathological: r.tnmPathological,
      ajccStage: r.ajccStage,
      ajccEdition: r.ajccEdition,
      firstTreatment: r.firstTreatment,
      firstTreatmentDate: r.firstTreatmentDate,
      vitalStatus: r.vitalStatus,
      lastContactDate: r.lastContactDate,
      deathDate: r.deathDate,
      causeOfDeath: r.causeOfDeath,
      status: r.status,
      /** 🔴 '보고 대상 확정'일 뿐 전송 여부가 아니다 — 전송 판정은 아래 transmission 이 정본 */
      reportedToKccr: r.reportedToKccr,
      kccrTransmittedAt: r.kccrTransmittedAt,
      kccrSubmissionId: r.kccrSubmissionId,
      transmission: classifyKccrTransmission(r),
      treatments: r.treatments.map((t) => ({
        type: t.treatmentType,
        startDate: t.startDate,
        endDate: t.endDate,
      })),
    };
  }

  /**
   * KCCR (중앙암등록본부) 제출 자료 생성 — **전송이 아니다**.
   *
   * 🔴 원결함 두 가지를 여기서 함께 막는다.
   *  1) ids 가 비면 `{ reportedToKccr:false, status:'VERIFIED' }` **전건**으로 확대돼
   *     선택하지 않은 건까지 한 번에 봉인됐다(되돌릴 경로 없음) → **fail-closed 거부**.
   *  2) 전송 코드가 없는데 reportedToKccr=true 로 "보고 완료"처럼 기록됐다
   *     → confirm 을 명시한 경우에만 '보고 대상 확정(미전송)' 으로 표시하고,
   *       응답에 transmission(NOT_TRANSMITTED) 을 실어 화면이 사실을 말하게 한다.
   */
  async generateKccrReport(ids: string[], options: { confirm?: boolean } = {}) {
    if (!Array.isArray(ids) || ids.length === 0) {
      throw new BadRequestException(
        '보고 대상(ids)이 비어 있습니다. 대상이 없으면 전건으로 확대하지 않고 거부합니다.',
      );
    }

    const uniqueIds = Array.from(new Set(ids));

    const registries = await this.prisma.cancerRegistry.findMany({
      where: { id: { in: uniqueIds } },
      include: {
        patient: { select: { id: true, mrn: true, familyName: true, givenName: true, dateOfBirth: true, gender: true } },
        treatments: true,
      },
      orderBy: { diagnosisDate: 'asc' },
    });

    const foundIds = new Set(registries.map((r) => r.id));
    const skipped: KccrSkipped[] = uniqueIds
      .filter((id) => !foundIds.has(id))
      .map((id) => ({ id, registrationNo: null, reason: 'NOT_FOUND' as const }));

    // 검증(VERIFIED) 전 건은 제출 대상이 아니다 — 자료는 보여주되 확정에서 제외한다.
    const eligible = registries.filter((r) => r.status === 'VERIFIED');
    for (const r of registries) {
      if (r.status !== 'VERIFIED') {
        skipped.push({ id: r.id, registrationNo: r.registrationNo, reason: 'NOT_VERIFIED' });
      } else if (classifyKccrTransmission(r).transmitted) {
        // 🔴 실제로 나간 건만 재제출을 막는다
        skipped.push({ id: r.id, registrationNo: r.registrationNo, reason: 'ALREADY_TRANSMITTED' });
      } else if (r.reportedToKccr) {
        // 확정만 되어 있고 나가지는 않았다 — 사유는 남기되 **자료 재산출은 막지 않는다**
        skipped.push({ id: r.id, registrationNo: r.registrationNo, reason: 'ALREADY_PREPARED' });
      }
    }

    const rows = eligible.map((r) => this.buildKccrRow(r));

    // '보고 대상 확정' 표시 — 요청한 ids 안에서만, 그리고 confirm 이 명시된 경우에만.
    // 🔴 어떤 경로로도 kccrTransmittedAt 을 여기서 적지 않는다(전송이 일어나지 않았다).
    let preparedIds: string[] = [];
    let localRefs: Array<{ id: string; kccrSubmissionId: string }> = [];
    if (options.confirm) {
      const targets = eligible.filter((r) => !classifyKccrTransmission(r).transmitted);
      preparedIds = targets.filter((r) => !r.reportedToKccr).map((r) => r.id);
      if (preparedIds.length > 0) {
        await this.prisma.cancerRegistry.updateMany({
          where: { id: { in: preparedIds } },
          data: { reportedToKccr: true },
        });
      }
      // 원내 접수번호 발급(없는 건에만) — `LOCAL-` 접두로 기관 번호가 아님을 드러낸다.
      const needRef = targets.filter((r) => !r.kccrSubmissionId);
      localRefs = needRef.map((r) => ({ id: r.id, kccrSubmissionId: localKccrRef() }));
      await Promise.all(
        localRefs.map((x) =>
          this.prisma.cancerRegistry.update({
            where: { id: x.id },
            data: { kccrSubmissionId: x.kccrSubmissionId },
          }),
        ),
      );
      if (targets.length > 0) {
        this.logger.warn(
          `[KCCR] 보고 대상 확정 ${preparedIds.length}건 · 원내 접수번호 발급 ${localRefs.length}건 — ` +
            `전송 연동 없음(NOT_TRANSMITTED · kccrTransmittedAt=null). 조치: ${KCCR_CHANNEL.manualFallback}. ` +
            `ids=${targets.map((r) => r.id).join(',')}`,
        );
      }
    }

    const localRefById = new Map(localRefs.map((x) => [x.id, x.kccrSubmissionId]));

    return {
      reportDate: new Date(),
      requested: uniqueIds.length,
      count: rows.length,
      // 방금 발급한 원내 접수번호를 응답에 반영한다(재조회 없이 화면이 사실을 말하게)
      rows: rows.map((row) =>
        localRefById.has(row.registryId)
          ? {
              ...row,
              kccrSubmissionId: localRefById.get(row.registryId) as string,
              transmission: classifyKccrTransmission({
                reportedToKccr: true,
                kccrTransmittedAt: null,
                kccrSubmissionId: localRefById.get(row.registryId) as string,
              }),
            }
          : row,
      ),
      confirmed: options.confirm === true,
      preparedIds,
      preparedCount: preparedIds.length,
      /** 원내 접수번호(기관 번호 아님) */
      localSubmissionIds: localRefs,
      skipped,
      /** 🔴 나가지 않은 건은 다시 제출할 수 있다 — 한 번 눌러 영구 미보고로 굳지 않는다 */
      resubmittable: true,
      /** 🔴 이 응답은 '전송'이 아니다 — 화면은 이 값을 그대로 말해야 한다 */
      transmission: KCCR_TRANSMISSION,
    };
  }

  /**
   * 🔴 실제 KCCR 전송이 일어나는 유일한 자리 — 연동이 붙는 날 여기만 고친다.
   *
   * 지금은 채널이 구현되지 않았으므로 **아무 것도 나가지 않는다.**
   * 전송 성공(`outcome === 'SENT'`)일 때만 `kccrTransmittedAt` 과 기관 접수번호를 적는다.
   * 미구현 동안 이 함수는 원장을 **바꾸지 않는다** — 모르는 시각을 박지 않기 위해서다.
   */
  private async transmitKccr(
    registryIds: string[],
  ): Promise<{ outcome: 'SENT' | 'NOT_TRANSMITTED' | 'FAILED'; reason: string; transmittedIds: string[] }> {
    if (!KCCR_CHANNEL.implemented) {
      this.logger.warn(
        `[KCCR] 미전송 ${registryIds.length}건 — ${KCCR_CHANNEL.name} 연동 미구축(전송 코드 없음). ` +
          `조치: ${KCCR_CHANNEL.manualFallback}`,
      );
      return {
        outcome: 'NOT_TRANSMITTED',
        reason: `${KCCR_CHANNEL.name} 연동 미구축 — 전송 코드 없음`,
        transmittedIds: [],
      };
    }
    /* istanbul ignore next — 연동 구축 시 이 자리에 실제 전송을 넣는다 */
    throw new Error('KCCR 전송 연동이 implemented=true 로 선언되었으나 구현되지 않았습니다');
  }

  /** KCCR 보고서 미리보기 (단일 건 · 조회 전용 — 어떤 값도 바꾸지 않는다) */
  async previewKccrReport(id: string) {
    if (!id) throw new BadRequestException('id 가 필요합니다');

    const registry = await this.prisma.cancerRegistry.findUnique({
      where: { id },
      include: {
        patient: { select: { id: true, mrn: true, familyName: true, givenName: true, dateOfBirth: true, gender: true } },
        treatments: true,
      },
    });
    if (!registry) throw new NotFoundException('Registry not found');

    const row = this.buildKccrRow(registry);
    return {
      ...row,
      /** 제출 가능 여부 — 검증(VERIFIED) 전이면 제출 대상이 아니다 */
      eligible: registry.status === 'VERIFIED',
      ineligibleReason: registry.status === 'VERIFIED' ? null : ('NOT_VERIFIED' as const),
      /** 이 건 하나의 전송 근거 판정(정본) */
      transmissionState: row.transmission,
      /** 채널 수준 사실 — 화면 배너용 */
      transmission: KCCR_TRANSMISSION,
    };
  }

  /** 추적관찰 지연 환자 목록 (마지막 추적 후 6개월 초과) */
  async getOverdueFollowUps() {
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    const registries = await this.prisma.cancerRegistry.findMany({
      where: {
        vitalStatus: 'ALIVE',
        status: { in: ['REGISTERED', 'VERIFIED'] },
        OR: [
          { lastContactDate: { lt: sixMonthsAgo } },
          { lastContactDate: null },
        ],
      },
      include: {
        patient: { select: { id: true, mrn: true, familyName: true, givenName: true } },
        followUps: { orderBy: { followUpDate: 'desc' }, take: 1 },
      },
      // 한 번도 추적하지 않은 건(lastContactDate=null)이 가장 위급하다 → 맨 앞에 둔다.
      orderBy: { lastContactDate: { sort: 'asc', nulls: 'first' } },
    });

    const now = Date.now();
    const days = (from: Date) => Math.floor((now - from.getTime()) / (1000 * 60 * 60 * 24));

    return registries.map((r) => ({
      registryId: r.id,
      registrationNo: r.registrationNo,
      patient: r.patient,
      primarySite: r.primarySite,
      ajccStage: r.ajccStage,
      diagnosisDate: r.diagnosisDate,
      lastContactDate: r.lastContactDate,
      lastFollowUp: r.followUps[0] ?? null,
      daysSinceLastContact: r.lastContactDate ? days(r.lastContactDate) : null,
      /**
       * 🔴 원결함: 화면이 daysSinceLastContact(null)만 보고 `undefined > 365 = false` 로
       * 낙착해 **한 번도 추적하지 않은 환자를 가장 약한 노랑**으로 칠했다.
       * 미상을 최경증으로 폴백하지 않도록, '추적 이력 없음' 을 별도 사실로 내보낸다.
       */
      neverContacted: r.lastContactDate === null,
      /** 추적 이력이 없을 때 얼마나 방치됐는지의 정직한 대체 척도 */
      daysSinceDiagnosis: days(r.diagnosisDate),
    }));
  }

  /** AI TNM 병기 자동 추정 */
  async autoStage(id: string) {
    const registry = await this.findOne(id);

    const question = [
      `암 TNM 병기 결정을 도와주세요.`,
      `원발부위: ${registry.primarySite}`,
      `형태학코드: ${registry.morphology}`,
      `ICD코드: ${registry.icdCode}`,
      `임상 TNM: ${registry.tnmClinical ?? '미확인'}`,
      `병리 TNM: ${registry.tnmPathological ?? '미확인'}`,
      `진단 근거: ${registry.diagnosisBasis}`,
      `현재 AJCC 병기: ${registry.ajccStage ?? '미설정'}`,
      `치료 기록: ${promptList(registry.treatments.map((t) => `${t.treatmentType}(${t.response ?? '반응미확인'})`))}`,
      `AJCC 8판 기준으로 TNM 분류와 병기 그룹을 추정해주세요.`,
    ].join('\n');

    try {
      const aiResult = await this.medicalAi.reference(question, 'oncology');
      return {
        registryId: id,
        currentStage: registry.ajccStage,
        currentTnmClinical: registry.tnmClinical,
        currentTnmPathological: registry.tnmPathological,
        aiSuggestion: aiResult,
        note: 'AI 추정 결과이며, 의사 확인 후 적용해야 합니다.',
        disclaimer: await this.medicalAi.getDisclaimer(),
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`AI auto-staging failed for registry ${id}: ${message}`);
      throw new BadRequestException('AI 병기 추정 실패: ' + message);
    }
  }
}
