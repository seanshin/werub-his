import { Injectable, OnModuleInit, NotFoundException, BadRequestException, ForbiddenException, ConflictException, Logger } from '@nestjs/common';
import { ISOLATION_PROTOCOL_DEFAULTS } from './isolation-protocol.defaults';
import { IsolationPrecautionType, Prisma, type StaffExposureIncident } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import {
  KCDC_CHANNEL,
  KONIS_CHANNEL,
  NOTIFIABLE_STATUS,
  RESUBMITTABLE_STATUSES,
  classifyNotifiableTransmission,
  localReportRef,
  notTransmittedLog,
  type TransmitResult,
} from './external-reporting';
import {
  STAFF_EXPOSURE_TYPES,
  STAFF_EXPOSURE_TYPE_LABELS,
  STAFF_EXPOSURE_FOLLOW_UP_LABELS,
  sourceStatusOf,
  sourceStatusNote,
  type StaffExposureType,
  type StaffExposureFollowUpStatus,
} from './staff-exposure';
import {
  CreateInfectionReportDto,
  UpdateInfectionStatusDto,
  ContactTracingDto,
  BulkContactTracingDto,
  InfectionQueueItemDto,
  InfectionStatsDto,
  InfectionAlertDto,
  IsolationType,
  InfectionStatus,
  RecordStaffExposureDto,
  UpdateStaffExposureFollowUpDto,
} from './dto/infection-control.dto';
import type { KonisReportDto } from './dto/konis-report.dto';

/** 노출 사고 목록 상한 — 넘으면 truncated 로 잘렸음을 말한다 */
const STAFF_EXPOSURE_LIST_LIMIT = 500;

/** 피노출 직원 표시용 최소 필드(이름 없이 UUID 만 남기지 않기 위한 것) */
export interface ExposureStaffRef {
  id: string;
  familyName: string;
  givenName: string;
  department: string;
  position: string;
}
/** 원환자 표시용 최소 필드 — 🔴 암호화 PID(주민/여권/CI/보험번호)는 절대 싣지 않는다 */
export interface ExposurePatientRef {
  id: string;
  mrn: string;
  familyName: string;
  givenName: string;
}

@Injectable()
export class InfectionControlService implements OnModuleInit {
  async onModuleInit() {
    void this.ensureIsolationProtocolsSeeded().catch(() => undefined); // 비차단 — 실패해도 폴백으로 동작
  }

  private readonly logger = new Logger(InfectionControlService.name);
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 감염 감시 목록.
   *
   * 🔴 화면 실사용 점검 W7(2026-08-14) — 종전에는 해소 여부를 **아무 데도 드러내지 않고**
   *    전 건을 같은 표로 돌려줬다(해소된 건도 격리 배지를 단 채 '현재 감염'처럼 보였다).
   *    또 `reportedToKCDC` 는 실려 나가는데 화면이 쓰지 않았다.
   *    → 미해소를 먼저, 해소는 뒤로. `isResolved` 로 화면이 구분해 말할 수 있게 한다.
   *
   * 🔴 `reportedToKCDC` 는 **원내 플래그일 뿐 전송 근거가 아니다** — 질병관리청 전송 채널은
   *    구현된 적이 없다(`KCDC_CHANNEL.implemented=false`). 플래그가 true 여도 '신고완료'라
   *    번역하지 않는다(법정보고 정본 `external-reporting.ts` 규약과 동일).
   */
  async findAll() {
    const rows = await this.prisma.infectionSurveillance.findMany({
      include: { patient: { select: { id: true, familyName: true, givenName: true, mrn: true } } },
      orderBy: { detectedAt: 'desc' },
    });

    const decorated = rows.map(r => ({
      ...r,
      isResolved: r.resolvedAt != null,
      kcdc: {
        flagged: r.reportedToKCDC,
        // 채널 미구현 동안에는 어떤 플래그도 '전송됨'을 뜻할 수 없다.
        transmitted: r.reportedToKCDC && KCDC_CHANNEL.implemented,
        label: !r.reportedToKCDC
          ? '신고 표시 없음'
          : KCDC_CHANNEL.implemented
            ? '신고완료'
            : '신고 표시(전송 근거 없음)',
        note: !r.reportedToKCDC
          ? null
          : KCDC_CHANNEL.implemented
            ? null
            : `${KCDC_CHANNEL.name} 연동이 구축된 적이 없습니다 — ${KCDC_CHANNEL.manualFallback}`,
      },
    }));

    return [...decorated.filter(r => !r.isResolved), ...decorated.filter(r => r.isResolved)];
  }

  /**
   * 🔴 '격리 환자'의 정본 정의 — 화면 실사용 점검 W7(2026-08-14).
   *
   * 종전 `getStats().isolated` 는 `infection_surveillance.isolationType != null` 만 셌고
   * `resolvedAt` 도 무시했다(해소된 과거 감염이 영구히 '격리 환자'에 남았다 — 같은 서비스의
   * `active` 는 `resolvedAt:null` 을 쓰는데 비대칭이었다). 그 결과 같은 화면에서
   * 상단 카드 '격리 환자 1' 과 MDRO 탭 '4명 전원 접촉격리' 가 동시에 보였다.
   *
   * 한편 차트 안전배지가 읽는 `patient-safety.getPatientIsolation()` 은
   * MDRO(active) + 감염감시(미해소) + 중환자실 격리를 **병합**해 판정한다 — 정본이 둘이었다.
   * 넓은 쪽(병합)으로 수렴한다. 근거: 격리 주의는 **오더가 없어도 필요**하고(MDRO 4명은
   * 격리 오더가 아예 없다), 좁게 세면 접촉주의가 필요한 환자를 화면이 숨긴다.
   *
   * 단위는 **환자**다(한 환자가 MDRO+감염감시에 동시에 있어도 1명). 무엇을 셌는지는
   * `isolatedBy` 로 함께 돌려주어 화면이 밝힐 수 있게 한다.
   */
  private async getIsolationCensus() {
    const [orders, surveillance, mdro, icu] = await Promise.all([
      this.prisma.isolationPrecaution.findMany({ where: { status: 'ACTIVE' }, select: { patientId: true } }),
      this.prisma.infectionSurveillance.findMany({
        where: { resolvedAt: null, isolationType: { not: null } },
        select: { patientId: true },
      }),
      this.prisma.mdroRegistry.findMany({ where: { active: true, clearedAt: null }, select: { patientId: true } }),
      this.prisma.icuAdmission.findMany({ where: { status: 'ADMITTED', isolation: true }, select: { patientId: true } }),
    ]);

    const uniq = (rows: { patientId: string }[]) => new Set(rows.map(r => r.patientId));
    const sets = {
      order: uniq(orders ?? []),
      surveillance: uniq(surveillance ?? []),
      mdro: uniq(mdro ?? []),
      icu: uniq(icu ?? []),
    };
    const all = new Set<string>([...sets.order, ...sets.surveillance, ...sets.mdro, ...sets.icu]);

    return {
      patients: all.size,
      by: {
        order: sets.order.size,
        surveillance: sets.surveillance.size,
        mdro: sets.mdro.size,
        icu: sets.icu.size,
      },
    };
  }

  async getStats() {
    const today = new Date(); today.setHours(0, 0, 0, 0);

    const [total, active, census, resolved, newToday, byTypeGroups] = await Promise.all([
      this.prisma.infectionSurveillance.count(),
      this.prisma.infectionSurveillance.count({ where: { resolvedAt: null } }),
      this.getIsolationCensus(),
      this.prisma.infectionSurveillance.count({ where: { resolvedAt: { not: null } } }),
      this.prisma.infectionSurveillance.count({ where: { detectedAt: { gte: today } } }),
      this.prisma.infectionSurveillance.groupBy({
        by: ['infectionType'],
        _count: true,
      }),
    ]);

    const byType: Record<string, number> = {};
    for (const g of byTypeGroups) byType[g.infectionType] = g._count;

    return {
      total,
      active,
      resolved,
      newToday,
      byType,
      // 격리 환자 = 병합 정의(환자 단위 중복제거). 화면은 isolatedBy 로 출처를 밝힌다.
      isolated: census.patients,
      isolatedBy: census.by,
      isolatedBasis:
        '환자 단위 중복제거 — 격리오더(ACTIVE) + 감염감시(미해소·격리유형) + MDRO(active) + 중환자실 격리',
      /** total/active/resolved/newToday 는 감염감시(infection_surveillance) 건수다 — 격리 환자와 세는 대상이 다르다 */
      surveillanceScope: 'infection_surveillance' as const,
    };
  }

  async createInfectionReport(dto: CreateInfectionReportDto) {
    const patient = await this.prisma.patient.findUnique({
      where: { id: dto.patientId },
    });
    if (!patient) throw new NotFoundException('Patient not found');

    const notes = `Disease: ${dto.diseaseName}|Code: ${dto.diseaseCode || 'N/A'}|Symptoms: ${dto.clinicalSymptoms || 'N/A'}|Route: ${dto.transmissionRoute || 'N/A'}|Remarks: ${dto.remarks || 'N/A'}`;

    return this.prisma.infectionSurveillance.create({
      data: {
        patientId: dto.patientId,
        infectionType: dto.diseaseName,
        organism: dto.diseaseCode || null,
        isolationType: dto.isolationType as string,
        detectedAt: new Date(dto.confirmationDate),
        notes,
      },
      include: {
        patient: { select: { id: true, familyName: true, givenName: true } },
      },
    });
  }

  async updateInfectionStatus(infectionId: string, dto: UpdateInfectionStatusDto) {
    const infection = await this.prisma.infectionSurveillance.findUnique({
      where: { id: infectionId },
    });
    if (!infection) throw new NotFoundException('Infection not found');

    // active/resolved는 resolvedAt(null=활성)로 표현. dto.status를 반영해 resolvedAt 결정:
    //  RESOLVED/DECEASED면 종료시각 설정(활성 목록·격리 배지에서 제외), 그 외 상태면 기존값 보존.
    //  (기존: resolvedAt을 isolationEndDate로만 결정 → status=RESOLVED인데 종료일 없으면 미해소 잔존,
    //   해소건 무관 수정 시 resolvedAt=null로 조용히 재활성화되던 버그.)
    const isTerminal = dto.status === InfectionStatus.RESOLVED || dto.status === InfectionStatus.DECEASED;
    const resolvedAt = isTerminal
      ? (dto.isolationEndDate ? new Date(dto.isolationEndDate) : new Date())
      : null;

    return this.prisma.infectionSurveillance.update({
      where: { id: infectionId },
      data: {
        isolationType: dto.isolationType as any,
        resolvedAt,
        notes: dto.updateNotes
          ? `${infection.notes || ''}\n[Update] ${dto.updateNotes}`
          : infection.notes,
      },
      include: {
        patient: { select: { id: true, familyName: true, givenName: true } },
      },
    });
  }

  async getInfectionQueue(): Promise<InfectionQueueItemDto[]> {
    const infections = await this.prisma.infectionSurveillance.findMany({
      where: {
        resolvedAt: null,
      },
      include: {
        patient: { select: { familyName: true, givenName: true } },
      },
      orderBy: { detectedAt: 'asc' },
    });

    return infections.map(inf => ({
      id: inf.id,
      patientId: inf.patientId,
      patientName: `${inf.patient.familyName}${inf.patient.givenName}`,
      diseaseName: inf.infectionType,
      status: inf.resolvedAt ? 'RESOLVED' : 'CONFIRMED',
      confirmationDate: inf.detectedAt,
      isolationType: (inf.isolationType as IsolationType) || 'STANDARD',
      contactCount: 0,
      isolationEndDate: inf.resolvedAt || undefined,
    }));
  }

  async addContactTrace(dto: ContactTracingDto) {
    const [source, contact] = await Promise.all([
      this.prisma.patient.findUnique({ where: { id: dto.sourcePatientId } }),
      this.prisma.patient.findUnique({ where: { id: dto.contactPersonId } }),
    ]);

    if (!source || !contact) {
      throw new NotFoundException('Source or contact patient not found');
    }

    const infection = await this.prisma.infectionSurveillance.findFirst({
      where: { patientId: dto.sourcePatientId, resolvedAt: null },
    });

    if (!infection) throw new NotFoundException('Active infection not found');

    // 🔴 (2026-09-28) 같은 접촉자를 두 번 등록하면 감시 레코드가 둘 생겼다(후보 화면에서 두 번 누르기) — 미해소 건이 있으면 거절
    const infectionType = `${InfectionControlService.CONTACT_TRACE_PREFIX}${infection.infectionType}`;
    const existing = await this.prisma.infectionSurveillance.findFirst({
      where: { patientId: dto.contactPersonId, infectionType, resolvedAt: null },
      select: { id: true },
    });
    if (existing) throw new ConflictException({ code: 'CONTACT_ALREADY_REGISTERED', id: existing.id });

    // 🔴 (2026-09-28) 모르는 값을 지어내지 않는다 — 종전 `Risk: undefined`·보호구 미입력을 `PPE: No`(착용 안 함)로 적었다
    const ppe = dto.wearingPPE == null ? 'UNKNOWN' : dto.wearingPPE ? 'Yes' : 'No';
    const duration = dto.contactDurationMinutes == null ? 'UNKNOWN' : `${dto.contactDurationMinutes}min`;
    const traceNotes = `Contact: ${dto.relationshipType}|Risk: ${dto.riskLevel ?? 'UNSPECIFIED'}|Duration: ${duration}|PPE: ${ppe}|${dto.notes || ''}`;

    return this.prisma.infectionSurveillance.create({
      data: {
        patientId: dto.contactPersonId,
        infectionType,
        organism: infection.organism,
        isolationType: (dto.riskLevel === 'HIGH' ? 'CONTACT' : 'STANDARD') as string,
        detectedAt: new Date(),
        notes: traceNotes,
      },
    });
  }

  async addBulkContactTraces(dto: BulkContactTracingDto) {
    const created = [];
    // 🔴 (2026-09-28) 종전 실패를 `catch {}` 로 삼켜 "몇 건이 왜 빠졌는지"를 말하지 않았다 — 사유를 함께 낸다
    const failed: Array<{ contactPersonId: string; reason: string }> = [];
    for (const contactId of dto.contactPersonIds) {
      try {
        const result = await this.addContactTrace({
          sourcePatientId: dto.sourcePatientId,
          contactPersonId: contactId,
          relationshipType: dto.relationshipType,
          riskLevel: dto.riskLevel,
        });
        created.push(result);
      } catch (error) {
        const res = (error as { response?: { code?: string } })?.response;
        failed.push({ contactPersonId: contactId, reason: res?.code ?? (error instanceof Error ? error.message : String(error)) });
      }
    }

    return { created: created.length, total: dto.contactPersonIds.length, failed };
  }

  /** 접촉자 추적 레코드의 표식 — `addContactTrace` 가 이 접두사로 감시 레코드를 만든다 */
  static readonly CONTACT_TRACE_PREFIX = 'Contact Exposure: ';

  /**
   * 감염 통계 및 분석.
   *
   * 🔴 원 결함(W8 이연·2026-08-14 회수) 3건 —
   *   ① `byWard: {}` · `dailyTrend: []` 를 **하드코딩**으로 내보냈다. 화면은 이것을
   *      "병동별 감염 0" · "추세 없음" 으로 그린다 — 미산출을 '없음'이라 말한 것이다(P1·P17).
   *   ② `totalContacts` 가 `activeIsolations` 의 **무고지 별칭**이었다. 같은 수가 두 칸에
   *      다른 이름으로 떠서 "격리 3명 · 접촉자 3명" 처럼 보였다(P12).
   *   ③ `highRiskContacts` 는 **접촉자가 아니라 전체 감시 레코드**의 격리유형을 셌다.
   *      운영 실측(2026-08-14): 감시 3건 중 isolationType='CONTACT' 1건 —
   *      접촉자 추적 레코드는 0건인데 화면은 "고위험 접촉 1명"이라 말했다.
   *
   *   회수: 병동은 **감지 시점에 그 환자가 입원해 있던 병동**으로 실집계하되, 알 수 없는 건은
   *   `byWardUnknown` 으로 분리해 드러낸다(외래·응급 감지는 병동이 없는 것이 사실이다).
   *   추세는 detectedAt(KST 일자)으로 실집계한다. 접촉자는 추적 레코드만 센다.
   *   **표본이 없으면 빈 객체/빈 배열**이고, 그것이 '0'과 다르다는 건 `*Basis` 로 말한다.
   */
  async getInfectionAnalytics(startDate?: Date, endDate?: Date): Promise<InfectionStatsDto> {
    const whereClause: any = {};
    if (startDate || endDate) {
      whereClause.detectedAt = {};
      if (startDate) whereClause.detectedAt.gte = startDate;
      if (endDate) whereClause.detectedAt.lte = endDate;
    }

    const infections = await this.prisma.infectionSurveillance.findMany({
      where: whereClause,
    });

    const prefix = InfectionControlService.CONTACT_TRACE_PREFIX;
    const isContactTrace = (t: string) => typeof t === 'string' && t.startsWith(prefix);
    /** 접촉자 추적으로 생성된 레코드 — 지표(감염 사례)와 성격이 다르다 */
    const contactTraces = infections.filter(inf => isContactTrace(inf.infectionType));

    const activeCount = infections.filter(inf => !inf.resolvedAt).length;
    const resolvedCount = infections.filter(inf => inf.resolvedAt).length;

    const byDisease = infections.reduce(
      (acc, inf) => {
        acc[inf.infectionType] = (acc[inf.infectionType] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );

    const byIsolationType = infections.reduce(
      (acc, inf) => {
        const type = inf.isolationType || 'STANDARD';
        acc[type] = (acc[type] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );

    const { byWard, byWardUnknown } = await this.aggregateByWard(infections);
    const dailyTrend = this.aggregateDailyTrend(infections);

    return {
      totalCases: infections.length,
      suspectedCases: infections.filter(inf => !inf.organism).length,
      confirmedCases: infections.filter(inf => inf.organism).length,
      resolvedCases: resolvedCount,
      activeIsolations: activeCount,

      // ── 접촉자 — 🔴 격리 건수의 별칭이 아니다. 접촉자 추적 레코드만 센다 ──
      totalContacts: contactTraces.length,
      highRiskContacts: contactTraces.filter(c => c.isolationType === 'CONTACT').length,
      contactBasis:
        '접촉자 추적(addContactTrace)으로 생성된 감시 레코드만 셈 · 고위험 = 등록 시 riskLevel HIGH(격리유형 CONTACT)',

      byDisease,

      // ── 병동별 — 🔴 하드코딩 {} 제거. 감지 시점 재원 병동으로 실집계 ──
      byWard,
      /** 🔴 병동을 알 수 없는 건수(외래·응급 감지 등) — 0 으로 접어 넣지 않는다 */
      byWardUnknown,
      byWardBasis:
        '감지 시각(detectedAt)에 재원 중이던 입원 건의 병상→병동 · 해당 입원이 없으면 byWardUnknown 으로 분리(병동 미상은 0 이 아니다)',

      byIsolationType,

      // ── 일별 추세 — 🔴 하드코딩 [] 제거. detectedAt(KST) 일자로 실집계 ──
      dailyTrend,
      dailyTrendBasis: '감지일(detectedAt · KST 일자) 기준 · 감시 레코드가 없는 날은 행 자체가 없다(0 행을 만들지 않는다)',
    };
  }

  /** 감지 시점에 그 환자가 재원 중이던 병동으로 집계. 알 수 없으면 세지 않고 따로 센다 */
  private async aggregateByWard(
    infections: Array<{ patientId: string; detectedAt: Date }>,
  ): Promise<{ byWard: Record<string, number>; byWardUnknown: number }> {
    const byWard: Record<string, number> = {};
    if (infections.length === 0) return { byWard, byWardUnknown: 0 };

    // N+1 회피 — 관련 환자의 입원 이력을 한 번에 가져와 메모리에서 구간 매칭
    const admissions = await this.prisma.admission.findMany({
      where: { patientId: { in: [...new Set(infections.map(i => i.patientId))] } },
      select: {
        patientId: true,
        admitDate: true,
        dischargeDate: true,
        bed: { select: { ward: { select: { name: true } } } },
      },
    });

    let unknown = 0;
    for (const inf of infections) {
      const at = inf.detectedAt?.getTime();
      const hit = at == null ? undefined : admissions.find(
        a =>
          a.patientId === inf.patientId &&
          a.admitDate.getTime() <= at &&
          (a.dischargeDate == null || a.dischargeDate.getTime() >= at),
      );
      const ward = hit?.bed?.ward?.name;
      // 🔴 병동을 모르면 '미상' 같은 이름으로 지어내지 않고 별도 카운터로 뺀다
      if (!ward) { unknown += 1; continue; }
      byWard[ward] = (byWard[ward] ?? 0) + 1;
    }
    return { byWard, byWardUnknown: unknown };
  }

  /** 감지일(KST) 기준 일별 건수. 감시 레코드가 없는 날은 **행을 만들지 않는다** */
  private aggregateDailyTrend(infections: Array<{ detectedAt: Date }>): Array<{ date: string; count: number }> {
    const byDate = new Map<string, number>();
    for (const inf of infections) {
      if (!inf.detectedAt) continue;
      const kst = new Date(inf.detectedAt.getTime() + 9 * 3_600_000);
      const date = kst.toISOString().slice(0, 10);
      byDate.set(date, (byDate.get(date) ?? 0) + 1);
    }
    return [...byDate.entries()]
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  async detectOutbreakAlert(): Promise<InfectionAlertDto | null> {
    const last7days = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const recentCases = await this.prisma.infectionSurveillance.findMany({
      where: {
        detectedAt: { gte: last7days },
        resolvedAt: null,
      },
    });

    if (recentCases.length >= 5) {
      const diseases = [...new Set(recentCases.map(c => c.infectionType))];
      return {
        type: 'OUTBREAK',
        severity: 'CRITICAL',
        message: `Potential outbreak: ${recentCases.length} cases in 7 days`,
        affectedCount: recentCases.length,
        diseaseNames: diseases,
        recommendedActions: [
          'Initiate outbreak investigation',
          'Increase surveillance',
          'Review isolation protocols',
        ],
      };
    }

    return null;
  }

  /**
   * 격리 프로토콜 조회 — 정본은 IsolationProtocol 테이블(P0-a④·감염관리위 개정 표면).
   * 미등재 타입/로드 실패는 코드 기본값 폴백(fail-safe — 격리 지시가 프로토콜 부재로 죽지 않게).
   */
  private isolationProtocolCache: { at: number; map: Map<string, unknown> } | null = null;

  private async loadIsolationProtocols(): Promise<Map<string, unknown>> {
    if (this.isolationProtocolCache && Date.now() - this.isolationProtocolCache.at < 60_000) return this.isolationProtocolCache.map;
    const map = new Map<string, unknown>();
    try {
      const rows = await this.prisma.isolationProtocol.findMany({ where: { isActive: true } });
      for (const r of rows) {
        map.set(r.isolationType, {
          isolationType: r.isolationType,
          standardDurationDays: r.standardDurationDays,
          requiredPPE: r.requiredPPE,
          environmentalMeasures: r.environmentalMeasures,
          visitationPolicy: r.visitationPolicy,
          staffEducationRequired: r.staffEducationRequired,
          source: r.source ?? undefined,
        });
      }
      this.isolationProtocolCache = { at: Date.now(), map };
    } catch {
      // 로드 실패 — 빈 맵 반환(아래 폴백이 받친다)
    }
    return map;
  }

  /** 부팅 시 테이블 비면 기본값 이관 — advisory lock 직렬화(다중 인스턴스 시드 레이스 예방·DUR 사고 교훈) */
  async ensureIsolationProtocolsSeeded(): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('isolation-protocol-seed'))`;
      const count = await tx.isolationProtocol.count();
      if (count > 0) return 0;
      await tx.isolationProtocol.createMany({
        data: ISOLATION_PROTOCOL_DEFAULTS.map((d) => ({ ...d, source: 'SEED' })),
      });
      return ISOLATION_PROTOCOL_DEFAULTS.length;
    });
  }

  async getIsolationProtocol(isolationType: IsolationType) {
    const table = await this.loadIsolationProtocols();
    if (table.has(isolationType)) return table.get(isolationType);
    const fallback = ISOLATION_PROTOCOL_DEFAULTS.find((d) => d.isolationType === isolationType);
    return fallback ?? null;
  }

  /** 프로토콜 개정(감염관리위) — source 에 의결번호(GOV-…) 기입 자리. 캐시 즉시 무효화 */
  async upsertIsolationProtocol(isolationType: string, data: {
    standardDurationDays: number; requiredPPE: string[]; environmentalMeasures: string[];
    visitationPolicy: string; staffEducationRequired: boolean; source?: string; isActive?: boolean;
  }) {
    const row = await this.prisma.isolationProtocol.upsert({
      where: { isolationType },
      create: { isolationType, ...data },
      update: data,
    });
    this.isolationProtocolCache = null;
    return row;
  }

  // ─── C3. 감염 관리 고도화 (10 endpoints) ───────────────────────────

  /**
   * KONIS HAI 감시 보고(집계 제출).
   *
   * 🔴 종전: `status:'SUBMITTED'` + `KONIS-<ts>` 를 돌려주면서 **전송도 저장도 하지 않았다**
   *    (prisma 호출이 한 줄도 없는 순수 객체). 호출한 화면은 보고가 접수된 줄 안다.
   *
   * 지금: 전송하지 않았다는 사실과 **서버에 남지 않는다는 사실**을 응답에 그대로 싣는다.
   * (집계 보고를 담을 전용 모델이 스키마에 없다 — 신설은 스키마 소유자 판단.)
   */
  async reportKonis(data: KonisReportDto) {
    const at = new Date();
    const result = await this.transmitKonis({ ...data });
    const transmitted = result.outcome === 'SENT';
    const report = {
      id: transmitted ? (result.externalRef ?? localReportRef('KONIS', at)) : localReportRef('KONIS', at),
      reportedAt: at.toISOString(),
      facilityCode: data.facilityCode ?? null,
      infectionType: data.infectionType ?? null,
      unit: data.unit ?? null,
      deviceDays: data.deviceDays ?? null,
      patientDays: data.patientDays ?? null,
      eventsCount: data.eventsCount ?? null,
      // 분모가 없으면 감염률은 산출할 수 없다 — 0.00 으로 채우지 않는다(표본 부재 ≠ 0).
      rate: data.patientDays
        ? Number(((Number(data.eventsCount) || 0) / Number(data.patientDays)) * 1000).toFixed(2)
        : null,
      submittedBy: data.submittedBy ?? null,
      status: transmitted ? 'SUBMITTED' : 'NOT_TRANSMITTED',
      transmitted,
      persisted: false,
      channel: KONIS_CHANNEL.name,
      warning: transmitted
        ? null
        : `🔴 이 보고는 KONIS 로 전송되지 않았고 서버에도 저장되지 않습니다(전용 모델 없음). ${KONIS_CHANNEL.manualFallback}`,
    };
    if (!transmitted) {
      this.logger.warn(`[KONIS] 집계 보고 미전송·미저장 — ${result.reason ?? ''} · ${KONIS_CHANNEL.manualFallback}`);
    }
    return report;
  }

  /**
   * KONIS 통계.
   *
   * 🔴 종전: CLABSI 2건/기구일수 450/율 4.44, 전국 벤치마크 50th·75th 까지 **전부 상수**였다
   *    (P15 지표 날조 — 출처 없는 전국 평균 비교). 원내 실제 HAI 등록과 무관하게 같은 숫자가
   *    매달 나왔다.
   *
   * 지금: 건수는 등록된 HaiCase 실측만 쓰고, **분모(기구일수·재원일수·수술건수)는 원내에
   * 집계되지 않으므로 감염률을 산출하지 않는다**(null + 사유). 전국 벤치마크는 등재된 출처가
   * 없어 표시하지 않는다.
   */
  async getKonisStats(period?: string) {
    const now = new Date();
    const year = period ? parseInt(period.slice(0, 4), 10) : now.getFullYear();
    const month = period ? parseInt(period.slice(5, 7), 10) : now.getMonth() + 1;

    const monthStart = (y: number, m: number) => new Date(Date.UTC(y, m - 1, 1));
    const from = monthStart(year, month);
    const to = monthStart(month === 12 ? year + 1 : year, month === 12 ? 1 : month + 1);

    const groups = await this.prisma.haiCase.groupBy({
      by: ['haiType'],
      _count: { id: true },
      where: { onsetAt: { gte: from, lt: to } },
    });
    const hai: Record<string, { events: number; deviceDays: number | null; rate: number | null }> = {};
    for (const t of ['CLABSI', 'CAUTI', 'VAP', 'SSI']) {
      hai[t] = { events: groups.find((g) => g.haiType === t)?._count.id ?? 0, deviceDays: null, rate: null };
    }
    for (const g of groups) {
      if (!hai[g.haiType]) hai[g.haiType] = { events: g._count.id, deviceDays: null, rate: null };
    }

    // 최근 3개월 실측 추이(등록 건수)
    const trend: { month: string; totalEvents: number }[] = [];
    for (let back = 2; back >= 0; back--) {
      const d = new Date(Date.UTC(year, month - 1 - back, 1));
      const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
      const totalEvents = await this.prisma.haiCase.count({ where: { onsetAt: { gte: d, lt: next } } });
      trend.push({ month: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`, totalEvents });
    }

    return {
      period: `${year}-${String(month).padStart(2, '0')}`,
      source: 'HaiCase(원내 등록)',
      hai,
      rate: null,
      rateNote: '기구일수·재원일수·수술건수 분모가 원내에 집계되지 않아 감염률(‰)을 산출할 수 없습니다 — 건수만 제공합니다',
      benchmark: null,
      benchmarkNote: '전국 KONIS 벤치마크는 원내에 등재된 출처가 없어 표시하지 않습니다',
      trend,
      konisChannelImplemented: KONIS_CHANNEL.implemented,
    };
  }

  /**
   * 항균제 내성 패턴 조회.
   *
   * 🔴 종전: MRSA/Oxacillin 62.5%, CRE/Meropenem 95% … 8줄이 **전부 하드코딩 상수**였다
   *    (원내에 무엇이 검출되든 같은 표 — P15 임상 지표 날조).
   *
   * 지금: MDRO 레지스트리 실측 검출 건수만 준다. 내성률(%)은 감수성 시험 **분모**(시험 건수)가
   * 원내에 집계되지 않아 산출하지 않는다(null + 사유).
   */
  async getResistancePatterns(organism?: string) {
    const groups = await this.prisma.mdroRegistry.groupBy({
      by: ['organism', 'mdroType'],
      _count: { id: true },
      where: organism ? { organism } : {},
    });
    const patterns = groups
      .map((g) => ({
        organism: g.organism,
        mdroType: g.mdroType,
        detectedCount: g._count.id,
        resistanceRate: null as number | null, // 분모 부재 — 산출 불가
        sampleCount: null as number | null,
        trend: null as string | null,
      }))
      .sort((a, b) => b.detectedCount - a.detectedCount);

    return {
      patterns,
      source: 'MdroRegistry(원내 검출)',
      rateNote: '감수성 시험 건수(분모)가 원내에 집계되지 않아 내성률(%)·추세를 산출할 수 없습니다 — 검출 건수만 제공합니다',
      updatedAt: new Date().toISOString(),
    };
  }

  /**
   * 내성 감시 케이스 등록.
   *
   * 🔴 종전: `status:'CONFIRMED'` 객체를 돌려주는데 **prisma 호출이 한 줄도 없어** 등록이
   *    그대로 사라졌다(검사실이 등록한 내성균이 어디에도 남지 않음).
   *
   * 지금: 전용 내성감시 모델이 스키마에 없으므로 **MdroRegistry 에 영속**한다
   * (같은 사실 = 원내 내성균 검출. 정본을 둘로 만들지 않는다). 감수성 상세
   * (시험 약제·내성·감수)는 컬럼이 없어 notes 에 텍스트로 보존한다.
   */
  async createResistanceSurveillance(data: Record<string, unknown>, userId?: string) {
    const patientId = String(data.patientId ?? '');
    if (!/^[0-9a-fA-F-]{36}$/.test(patientId)) throw new BadRequestException('유효한 patientId(UUID) 필요');
    const patient = await this.prisma.patient.findUnique({ where: { id: patientId }, select: { id: true } });
    if (!patient) throw new NotFoundException('환자를 찾을 수 없습니다');
    const organism = String(data.organism ?? '').trim();
    if (!organism) throw new BadRequestException('organism(검출균) 필수 — 미상으로 저장하지 않습니다');

    const list = (v: unknown) => (Array.isArray(v) ? v.map(String).filter(Boolean) : []);
    const detail = [
      data.specimen ? `검체 ${String(data.specimen)}` : null,
      list(data.antibioticsTested).length ? `시험 ${list(data.antibioticsTested).join('/')}` : null,
      list(data.resistantTo).length ? `내성 ${list(data.resistantTo).join('/')}` : null,
      list(data.sensitiveTo).length ? `감수성 ${list(data.sensitiveTo).join('/')}` : null,
      data.reportedBy ? `보고 ${String(data.reportedBy)}` : null,
    ].filter(Boolean).join(' · ');

    const row = await this.addMdro({
      patientId,
      organism: organism.slice(0, 200),
      mdroType: String(data.resistanceType ?? 'OTHER').slice(0, 20),
      specimen: data.specimen ? String(data.specimen).slice(0, 50) : null,
      ward: data.ward ? String(data.ward).slice(0, 50) : null,
      detectedAt: data.detectedAt ? String(data.detectedAt) : undefined,
      notes: `[내성감시] ${detail || '상세 없음'}`,
    }, userId);

    return {
      ...row,
      persisted: true,
      persistedAs: 'MdroRegistry',
      note: '전용 내성감시 모델이 없어 MDRO 레지스트리에 등록됩니다(감수성 상세는 notes 텍스트). 종전에는 저장되지 않고 사라졌습니다.',
    };
  }

  /** 격리실 배정 */
  /** 격리 오더 발행(영속) — 종전 인메모리 배열 대체. userId=발행 의료진 */
  async assignIsolationRoom(data: Record<string, unknown>, userId: string) {
    const patientId = String(data.patientId ?? '');
    // 입력 검증 — 잘못된 UUID/미존재 환자/잘못된 enum이 raw Prisma 500으로 새지 않도록 400/404로.
    if (!/^[0-9a-fA-F-]{36}$/.test(patientId)) throw new BadRequestException('유효한 patientId(UUID) 필요');
    const patient = await this.prisma.patient.findUnique({ where: { id: patientId }, select: { id: true } });
    if (!patient) throw new NotFoundException('환자를 찾을 수 없습니다');
    const type = (data.isolationType as IsolationPrecautionType) ?? 'CONTACT';
    if (!Object.values(IsolationPrecautionType).includes(type)) {
      throw new BadRequestException(`유효하지 않은 격리유형: ${String(data.isolationType)}`);
    }
    const admissionId = data.admissionId ? String(data.admissionId) : undefined;
    if (admissionId && !/^[0-9a-fA-F-]{36}$/.test(admissionId)) throw new BadRequestException('유효하지 않은 admissionId');
    const expDays = Number(data.expectedDurationDays ?? 0);
    const rec = await this.prisma.isolationPrecaution.create({
      data: {
        patientId,
        admissionId,
        type,
        reason: String(data.reason ?? '').slice(0, 500), // VarChar(500) 초과 방지
        organism: data.organism ? String(data.organism).slice(0, 200) : undefined,
        roomNumber: data.roomNumber ? String(data.roomNumber).slice(0, 30) : undefined,
        expectedEndDate: expDays > 0 ? new Date(Date.now() + expDays * 86400000) : undefined,
        orderedBy: userId,
        notes: data.notes ? String(data.notes) : undefined,
      },
      include: { patient: { select: { id: true, familyName: true, givenName: true, mrn: true } } },
    });
    return { ...rec, protocol: await this.getIsolationProtocol(type as unknown as IsolationType) };
  }

  /** 격리 해제(영속·감사) */
  async releaseIsolation(id: string, userId?: string, reason?: string) {
    const existing = await this.prisma.isolationPrecaution.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`Isolation ${id} not found`);
    if (existing.status === 'DISCONTINUED') return existing;
    return this.prisma.isolationPrecaution.update({
      where: { id },
      data: { status: 'DISCONTINUED', endDate: new Date(), discontinuedBy: userId, discontinueReason: reason },
    });
  }

  /** 현재 격리 환자 목록(영속 오더 + 감염감시 기반 합산·환자 중복제거) */
  async getIsolationList() {
    const [active, dbIsolated] = await Promise.all([
      this.prisma.isolationPrecaution.findMany({
        where: { status: 'ACTIVE' },
        orderBy: { startDate: 'desc' },
        include: { patient: { select: { id: true, familyName: true, givenName: true, mrn: true } } },
      }),
      this.prisma.infectionSurveillance.findMany({
        where: { resolvedAt: null, isolationType: { not: null } },
        include: { patient: { select: { id: true, familyName: true, givenName: true, mrn: true } } },
      }),
    ]);
    const orders = active.map(i => ({
      id: i.id,
      patientId: i.patientId,
      patientName: `${i.patient.familyName}${i.patient.givenName}`,
      mrn: i.patient.mrn,
      isolationType: i.type,
      since: i.startDate,
      infectionType: i.reason,
      source: 'ORDER' as const,
    }));
    const seen = new Set(orders.map(o => o.patientId));
    const surv = dbIsolated
      .filter(i => !seen.has(i.patientId))
      .map(i => ({
        id: i.id,
        patientId: i.patientId,
        patientName: `${i.patient.familyName}${i.patient.givenName}`,
        mrn: i.patient.mrn,
        isolationType: i.isolationType,
        since: i.detectedAt,
        infectionType: i.infectionType,
        source: 'SURVEILLANCE' as const,
      }));
    const merged = [...orders, ...surv];
    // fromSurveillance 키는 기존 위젯 호환(오더+감시 합산 노출)
    return { orders, fromSurveillance: merged, totalCount: merged.length };
  }

  /** 환자 격리 상태(배너·차트용) — 활성 격리 오더 + 프로토콜(PPE) */
  async getPatientIsolationStatus(patientId: string) {
    const active = await this.prisma.isolationPrecaution.findMany({
      where: { patientId, status: 'ACTIVE' },
      orderBy: { startDate: 'desc' },
      include: { orderedByUser: { select: { id: true, familyName: true, givenName: true } } },
    });
    const precautions = await Promise.all(
      active.map(async a => ({ ...a, protocol: await this.getIsolationProtocol(a.type as unknown as IsolationType) })),
    );
    return { isolated: active.length > 0, precautions };
  }

  /**
   * 직원 혈액·체액 노출 사고(니들스틱 등) 접수 — **영속 기록**(2026-08-18 배선).
   *
   * 🔴 종전에는 프로세스 메모리 배열(`staffExposures`)에 담아 pm2 재기동(=매 배포)마다
   *    전량 소실됐다. 산업안전보건법·감염관리 법정기록인데 남는 것이 없었고,
   *    대시보드의 '노출 0건'은 사고가 없었다는 뜻이 아니라 기록이 지워졌다는 뜻이었다.
   *
   * 🔴 전용 모델 `StaffExposureIncident` 를 쓴다. `SafetyIncident`(환자안전 사고 정본)는
   *    재사용하지 않는다 — 재사용하면 patient-safety 통계·QI 보드·경영 대시보드가
   *    직원 사고를 환자안전 사고로 세어 지표가 오염된다.
   *
   * 🔴 원환자 감염상태(HBV/HCV/HIV)는 **보내지 않으면 null(미상)** 로 남는다.
   *    모르는 것을 '음성'으로 접지 않는다(`serologyOf`).
   *
   * @param reportedBy 접수자 User.id (감사 주체)
   */
  async recordStaffExposure(dto: RecordStaffExposureDto, reportedBy: string) {
    const staffId = await this.resolveExposureStaffId(dto.staffId, reportedBy);

    // 원환자를 지목했다면 실재하는 환자여야 한다 — 없는 UUID 를 원장에 박지 않는다.
    if (dto.sourcePatientId) {
      const exists = await this.prisma.patient.findUnique({
        where: { id: dto.sourcePatientId },
        select: { id: true },
      });
      if (!exists) throw new NotFoundException('원환자를 찾을 수 없습니다');
    }

    const occurredAt = dto.occurredAt ? new Date(dto.occurredAt) : new Date();
    if (Number.isNaN(occurredAt.getTime())) throw new BadRequestException('발생 시각이 올바르지 않습니다');
    // 미래 시각은 사고 발생 시각이 될 수 없다 — 모르는 시각을 추정해 박지 않는다.
    if (occurredAt.getTime() > Date.now() + 60_000) {
      throw new BadRequestException('발생 시각이 미래입니다');
    }

    const created = await this.prisma.staffExposureIncident.create({
      data: {
        staffId,
        occurredAt,
        exposureType: dto.exposureType,
        bodyPart: dto.bodyPart ?? null,
        deviceType: dto.deviceType ?? null,
        place: dto.place ?? null,
        sourcePatientId: dto.sourcePatientId ?? null,
        // undefined → Prisma 가 컬럼을 건드리지 않아 null(미상)로 남는다. false 로 접지 않는다.
        sourceHbv: dto.sourceHbv ?? null,
        sourceHcv: dto.sourceHcv ?? null,
        sourceHiv: dto.sourceHiv ?? null,
        ppeUsed: dto.ppeUsed ?? null,
        immediateAction: dto.immediateAction ?? null,
        prophylaxis: dto.prophylaxis ?? null,
        followUpStatus: 'OPEN',
        followUpNotes: dto.followUpNotes ?? null,
        reportedBy,
      },
    });

    const actors = await this.loadExposureActors([created]);
    const view = this.toExposureView(created, {
      staff: actors.staff.get(created.staffId) ?? null,
      sourcePatient: created.sourcePatientId ? actors.patients.get(created.sourcePatientId) ?? null : null,
    });
    this.logger.warn(
      `[직원 노출] 접수 id=${created.id} staff=${staffId} type=${created.exposureType} · ` +
        `원환자 감염상태 ${view.sourceStatus.anyUnknown ? '미상 항목 있음' : '전부 판명'} · 추적 OPEN`,
    );
    return view;
  }

  /**
   * 피노출 직원(Staff.id) 결정 — 지정이 없으면 로그인 사용자의 직원 원장 레코드를 쓴다.
   * 🔴 찾지 못하면 임의로 만들지 않고 거부한다(fail-closed) — 엉뚱한 직원 앞으로 법정기록이 남는다.
   */
  private async resolveExposureStaffId(staffId: string | undefined, reportedBy: string): Promise<string> {
    if (staffId) {
      const s = await this.prisma.staff.findUnique({ where: { id: staffId }, select: { id: true } });
      if (!s) throw new NotFoundException('직원 원장에서 해당 직원을 찾을 수 없습니다');
      return s.id;
    }
    const self = await this.prisma.staff.findFirst({ where: { userId: reportedBy }, select: { id: true } });
    if (!self) {
      throw new BadRequestException(
        '피노출 직원(staffId)을 확인할 수 없습니다 — 로그인 계정에 연결된 직원 원장 레코드가 없습니다.',
      );
    }
    return self.id;
  }

  /**
   * 저장된 사고 1건을 화면이 읽는 형태로 — 원환자 상태는 3상(양성/음성/**미상**)으로만 말한다.
   *
   * 🔴 `actors` 는 **선택**이고, 붙이지 못했으면 `null` 로 남긴다. `staffId`(UUID)를 이름 자리에
   *    흘리거나 '-' 로 뭉개면 화면이 "누가 찔렸는지"를 잃는다(스키마에 relation 이 없어
   *    include 로 못 가져오므로 목록 조회가 별도 배치 조회로 채워 넣는다).
   */
  private toExposureView(
    r: StaffExposureIncident,
    actors?: { staff?: ExposureStaffRef | null; sourcePatient?: ExposurePatientRef | null },
  ) {
    const sourceStatus = sourceStatusOf(r);
    return {
      ...r,
      exposureTypeLabel:
        STAFF_EXPOSURE_TYPE_LABELS[r.exposureType as StaffExposureType] ?? r.exposureType,
      followUpStatusLabel:
        STAFF_EXPOSURE_FOLLOW_UP_LABELS[r.followUpStatus as StaffExposureFollowUpStatus] ?? r.followUpStatus,
      sourceStatus,
      /** null = 알려야 할 것이 없음(확실하지 않을 때만 말한다 — 거짓 경보는 진짜 경보를 죽인다) */
      sourceStatusNote: sourceStatusNote(sourceStatus),
      /** 피노출 직원 — 조회하지 못했으면 null(UUID 를 이름처럼 보여주지 않는다) */
      staff: actors?.staff ?? null,
      /** 원환자 — 무명 노출이면 애초에 null 이다(sourceStatus.sourceIdentified 로 구분) */
      sourcePatient: actors?.sourcePatient ?? null,
      persisted: true,
    };
  }

  /**
   * 사고 목록에 피노출 직원·원환자를 배치로 붙인다.
   * 🔴 `StaffExposureIncident` 에는 Prisma relation 이 없다(스키마 변경 없이 영속화된 모델).
   *    화면마다 개별 조회하면 N+1 이고, 안 붙이면 UUID 만 남는다 → 여기서 한 번에 채운다.
   */
  private async loadExposureActors(rows: StaffExposureIncident[]) {
    const staffIds = [...new Set(rows.map(r => r.staffId))];
    const patientIds = [...new Set(rows.map(r => r.sourcePatientId).filter((v): v is string => !!v))];

    const [staffRows, patientRows] = await Promise.all([
      staffIds.length
        ? this.prisma.staff.findMany({
            where: { id: { in: staffIds } },
            select: { id: true, familyName: true, givenName: true, department: true, position: true },
          })
        : Promise.resolve([] as ExposureStaffRef[]),
      // 🔴 select 로만 가져온다 — `include: { patient: true }` 는 암호화 PID(주민/여권/CI/보험번호)를
      //    응답에 실어 나른다(PATIENT_SENSITIVE_OMIT 축). 노출 사고 추적에 필요한 것은 식별뿐이다.
      patientIds.length
        ? this.prisma.patient.findMany({
            where: { id: { in: patientIds } },
            select: { id: true, mrn: true, familyName: true, givenName: true },
          })
        : Promise.resolve([] as ExposurePatientRef[]),
    ]);

    return {
      staff: new Map(staffRows.map((r: ExposureStaffRef) => [r.id, r])),
      patients: new Map(patientRows.map((r: ExposurePatientRef) => [r.id, r])),
    };
  }

  /**
   * 직원 노출 이력 조회 — 이제 원장에서 읽는다(프로세스 기동 이후 값이 아니다).
   * 🔴 0 건은 '원장에 기록이 없다'는 사실이다. 미접수(수기 서식으로만 처리)일 수 있으므로
   *    화면은 '사고 없음'이 아니라 '접수된 기록 없음'으로 말한다.
   */
  async getStaffExposures(filters: { staffId?: string; followUpStatus?: string; from?: string; to?: string } = {}) {
    const where: Prisma.StaffExposureIncidentWhereInput = {};
    if (filters.staffId) where.staffId = filters.staffId;
    if (filters.followUpStatus) where.followUpStatus = filters.followUpStatus;
    if (filters.from || filters.to) {
      where.occurredAt = {
        ...(filters.from ? { gte: new Date(filters.from) } : {}),
        ...(filters.to ? { lte: new Date(filters.to) } : {}),
      };
    }

    const [rows, total, openCount, unknownCount] = await Promise.all([
      this.prisma.staffExposureIncident.findMany({
        where,
        orderBy: { occurredAt: 'desc' },
        take: STAFF_EXPOSURE_LIST_LIMIT,
      }),
      this.prisma.staffExposureIncident.count({ where }),
      // 🔴 요약은 **잘린 페이지가 아니라 전체**를 센다. 페이지에서 세면 같은 응답 안에서
      //    `totalCount 700 · 추적중 500` 같은 모순이 생기고, 관리자는 500 을 전부로 읽는다.
      this.prisma.staffExposureIncident.count({ where: { ...where, followUpStatus: { not: 'CLOSED' } } }),
      this.prisma.staffExposureIncident.count({
        where: { ...where, OR: [{ sourceHbv: null }, { sourceHcv: null }, { sourceHiv: null }] },
      }),
    ]);

    const actors = await this.loadExposureActors(rows);
    const exposures = rows.map(r =>
      this.toExposureView(r, {
        staff: actors.staff.get(r.staffId) ?? null,
        sourcePatient: r.sourcePatientId ? actors.patients.get(r.sourcePatientId) ?? null : null,
      }),
    );

    const byTypeRows = await this.prisma.staffExposureIncident.groupBy({
      by: ['exposureType'],
      where,
      _count: { _all: true },
    });
    const byTypeCounted = new Map(
      (byTypeRows as { exposureType: string; _count: { _all: number } }[]).map(r => [
        r.exposureType,
        r._count._all,
      ]),
    );
    const byType = Object.fromEntries(
      STAFF_EXPOSURE_TYPES.map(t => [t, byTypeCounted.get(t) ?? 0]),
    ) as Record<StaffExposureType, number>;

    return {
      exposures,
      totalCount: total,
      // 잘랐으면 잘랐다고 말한다
      truncated: total > exposures.length,
      limit: STAFF_EXPOSURE_LIST_LIMIT,
      persisted: true,
      summary: {
        byType,
        open: openCount,
        /** 원환자 감염상태가 아직 미상인 건 — PEP 판단이 걸려 있다 */
        sourceStatusUnknown: unknownCount,
      },
      /** 🔴 0 = '사고 없음'이 아니다 — 이 시스템에 접수된 기록이 없다는 뜻이다 */
      zeroMeaning:
        total === 0 ? '이 시스템에 접수된 노출 사고 기록이 없습니다(수기 서식 접수분은 포함되지 않습니다)' : null,
    };
  }

  /**
   * 🔴 **본인** 노출 이력 — 신고한 당사자가 자기 추적관찰 상태를 확인하는 경로.
   *
   * 종전엔 조회 EP 가 `AUDIT_VIEW` 하나뿐이라, 신고는 할 수 있어도 **자기 기록을 못 보는**
   * 직군(원무·검진·급양·행정·의무기록)이 생겼다. 반대로 `AUDIT_VIEW` 만 있으면 동료 전건이
   * 보였다(CRM 담당 포함). 그래서 self-scope 를 따로 연다.
   *
   * 🔴 직원 원장에 연결이 없으면 **빈 목록이 아니라 '산출 불가'** 로 말한다.
   *    "본인 사고가 0건"과 "본인이 누구인지 알 수 없다"는 다른 사실이다.
   */
  async getMyStaffExposures(userId: string) {
    const self = await this.prisma.staff.findFirst({ where: { userId }, select: { id: true } });
    if (!self) {
      return {
        staffLinked: false as const,
        exposures: [],
        /** 🔴 0 이 아니라 null — 셀 수 없었다는 뜻이다 */
        totalCount: null,
        persisted: true,
        unavailableReason:
          '로그인 계정에 연결된 직원 원장 레코드가 없어 본인 이력을 조회할 수 없습니다(인사 담당에게 계정↔직원 연결을 요청하십시오).',
        zeroMeaning: null,
      };
    }
    const list = await this.getStaffExposures({ staffId: self.id });
    return {
      staffLinked: true as const,
      ...list,
      unavailableReason: null,
      zeroMeaning:
        list.totalCount === 0
          ? '본인 명의로 접수된 노출 사고 기록이 없습니다(수기 서식 접수분은 포함되지 않습니다)'
          : null,
    };
  }

  /**
   * 노출 사고 1건 상세.
   * 🔴 타인의 기록은 `canManage` 인 사람만 볼 수 있다 — 원환자 HIV/HBV/HCV 와 피노출자 신원이
   *    한 화면에 같이 있다. 없는 id 와 권한 없는 id 를 같은 404 로 뭉개지 않고, 존재는 확인한 뒤
   *    권한으로 막는다(감염관리 담당에게 문의할 수 있어야 한다).
   */
  async getStaffExposureDetail(id: string, viewer: { userId: string; canManage: boolean }) {
    const row = await this.prisma.staffExposureIncident.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('노출 사고 기록을 찾을 수 없습니다');

    if (!viewer.canManage) {
      const self = await this.prisma.staff.findFirst({ where: { userId: viewer.userId }, select: { id: true } });
      if (!self || self.id !== row.staffId) {
        throw new ForbiddenException('본인 노출 사고 기록만 조회할 수 있습니다(전건 열람은 감염관리 담당 권한)');
      }
    }

    const actors = await this.loadExposureActors([row]);
    return this.toExposureView(row, {
      staff: actors.staff.get(row.staffId) ?? null,
      sourcePatient: row.sourcePatientId ? actors.patients.get(row.sourcePatientId) ?? null : null,
    });
  }

  /** 노출 사고 추적관찰 갱신 — 🔴 종결(CLOSED)일 때만 closedAt 을 박는다. */
  async updateStaffExposureFollowUp(id: string, dto: UpdateStaffExposureFollowUpDto) {
    const existing = await this.prisma.staffExposureIncident.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('노출 사고 기록을 찾을 수 없습니다');

    const closing = dto.followUpStatus === 'CLOSED';
    const updated = await this.prisma.staffExposureIncident.update({
      where: { id },
      data: {
        followUpStatus: dto.followUpStatus,
        ...(dto.followUpNotes !== undefined ? { followUpNotes: dto.followUpNotes } : {}),
        ...(dto.prophylaxis !== undefined ? { prophylaxis: dto.prophylaxis } : {}),
        // 보내지 않은 항목은 손대지 않는다 — 미상을 음성으로 덮어쓰지 않기 위해서다.
        ...(dto.sourceHbv !== undefined ? { sourceHbv: dto.sourceHbv } : {}),
        ...(dto.sourceHcv !== undefined ? { sourceHcv: dto.sourceHcv } : {}),
        ...(dto.sourceHiv !== undefined ? { sourceHiv: dto.sourceHiv } : {}),
        // 재개(OPEN/IN_FOLLOW_UP)하면 종결 시각을 지운다 — 열려 있는데 종결 시각이 남으면 거짓말이다.
        closedAt: closing ? (existing.closedAt ?? new Date()) : null,
      },
    });
    const actors = await this.loadExposureActors([updated]);
    return this.toExposureView(updated, {
      staff: actors.staff.get(updated.staffId) ?? null,
      sourcePatient: updated.sourcePatientId ? actors.patients.get(updated.sourcePatientId) ?? null : null,
    });
  }

  /** 종합 감염 대시보드 */
  async getInfectionDashboard() {
    const [stats, konisStats, resistancePatterns, isolationList, outbreakAlert, staffExposureSummary] =
      await Promise.all([
        this.getStats(),
        this.getKonisStats(),
        this.getResistancePatterns(),
        this.getIsolationList(),
        this.detectOutbreakAlert(),
        this.getStaffExposures(),
      ]);

    return {
      overview: stats,
      konis: konisStats,
      // 🔴 내성률(%)·추세는 분모가 없어 산출 불가 — 종전 하드코딩 상수로 세던
      //    criticalOrganisms/increasingTrends 는 지어낸 수치였다. 검출 건수만 말한다.
      resistance: {
        detectedOrganisms: resistancePatterns.patterns.length,
        detectedCount: resistancePatterns.patterns.reduce((s, p) => s + p.detectedCount, 0),
        rateAvailable: false,
        rateNote: resistancePatterns.rateNote,
        topPatterns: resistancePatterns.patterns.slice(0, 5),
      },
      isolation: {
        currentCount: isolationList.totalCount,
        byType: isolationList.fromSurveillance.reduce((acc, i) => {
          const t = (i.isolationType as string) || 'STANDARD';
          acc[t] = (acc[t] || 0) + 1;
          return acc;
        }, {} as Record<string, number>),
      },
      alerts: outbreakAlert ? [outbreakAlert] : [],
      // 🔴 이제 원장에서 읽는다(2026-08-18). 0 은 '사고 없음'이 아니라 '접수된 기록 없음'이다 —
      //    zeroMeaning 이 null 이 아니면 화면은 그 문장을 그대로 말해야 한다.
      staffSafety: {
        totalExposures: staffExposureSummary.totalCount,
        summary: staffExposureSummary.summary,
        persisted: true,
        openFollowUps: staffExposureSummary.summary.open,
        sourceStatusUnknown: staffExposureSummary.summary.sourceStatusUnknown,
        zeroMeaning: staffExposureSummary.zeroMeaning,
      },
      generatedAt: new Date().toISOString(),
    };
  }

  // ── 손위생 모니터링 (Hand Hygiene, JCI IPSG.5 / WHO 5 Moments) ──

  static readonly HH_MOMENTS = [
    '환자 접촉 전', '청결·무균처치 전', '체액 노출 위험 후', '환자 접촉 후', '환자 주변환경 접촉 후',
  ];

  /** 손위생 관찰 기록 */
  async recordHandHygiene(observerId: string, dto: {
    department?: string; observedRole: string; moment: number; action: 'PERFORMED' | 'MISSED'; method?: string; notes?: string;
  }) {
    if (dto.moment < 1 || dto.moment > 5) throw new BadRequestException('WHO 손위생 순간은 1~5입니다');
    if (dto.action !== 'PERFORMED' && dto.action !== 'MISSED') throw new BadRequestException('action은 PERFORMED 또는 MISSED');
    return this.prisma.handHygieneObservation.create({
      data: {
        observerId,
        department: dto.department,
        observedRole: dto.observedRole,
        moment: dto.moment,
        action: dto.action,
        method: dto.method,
        notes: dto.notes,
      },
    });
  }

  /**
   * 손위생 준수율 통계 (기간/부서)
   *
   * 🔴 화면 실사용 점검 W7(2026-08-14) — 종전 `rate(n,0)` 은 **0** 을 돌려줬다.
   *    관측이 0건인데 화면은 목표 90% 대비 빨간 큰 글씨로 "0%"를 단정했고,
   *    읽는 사람에게는 '직원이 손을 전혀 안 씻는다'로 보였다(표본 부재 ≠ 0).
   *    같은 사실을 `/safety-quality-board`·patient-safety 는 이미 `null`(→ '-')로 말한다 —
   *    정본이 둘이었고, **정직한 쪽(null)으로 수렴**한다.
   *    → 분모 0 이면 비율은 `null`, `sampleAvailable:false`, 사유는 `note` 로 말한다.
   */
  async getHandHygieneCompliance(params: { dateFrom?: string; dateTo?: string; department?: string }) {
    const where: any = {};
    if (params.department) where.department = params.department;
    if (params.dateFrom || params.dateTo) {
      where.observedAt = {};
      if (params.dateFrom) where.observedAt.gte = new Date(params.dateFrom);
      if (params.dateTo) where.observedAt.lte = new Date(params.dateTo);
    } else {
      // 기본: 최근 30일
      where.observedAt = { gte: new Date(Date.now() - 30 * 86400000) };
    }

    const obs = await this.prisma.handHygieneObservation.findMany({ where, select: { observedRole: true, moment: true, action: true, method: true } });
    const total = obs.length;
    const performed = obs.filter((o) => o.action === 'PERFORMED').length;
    // 표본이 없으면 비율은 존재하지 않는다 — 0 이 아니라 null.
    const rate = (n: number, d: number): number | null => (d > 0 ? Math.round((n / d) * 1000) / 10 : null);

    const groupRate = <K extends string>(keyFn: (o: typeof obs[number]) => K) => {
      const m = new Map<K, { performed: number; total: number }>();
      for (const o of obs) {
        const k = keyFn(o);
        const e = m.get(k) ?? { performed: 0, total: 0 };
        e.total++; if (o.action === 'PERFORMED') e.performed++;
        m.set(k, e);
      }
      return Array.from(m.entries()).map(([key, v]) => ({ key, performed: v.performed, total: v.total, rate: rate(v.performed, v.total) }));
    };

    return {
      overall: {
        total,
        performed,
        missed: total - performed,
        complianceRate: rate(performed, total), // null = 관측 0건(산출 불가)
        target: 90,
        sampleAvailable: total > 0,
        note: total > 0 ? null : '해당 기간 손위생 관찰 기록이 없어 준수율을 산출할 수 없습니다(관측 0건)',
      },
      byRole: groupRate((o) => o.observedRole),
      byMoment: [1, 2, 3, 4, 5].map((m) => {
        const items = obs.filter((o) => o.moment === m);
        const p = items.filter((o) => o.action === 'PERFORMED').length;
        return { moment: m, label: InfectionControlService.HH_MOMENTS[m - 1], performed: p, total: items.length, rate: rate(p, items.length) };
      }),
      byMethod: groupRate((o) => o.method ?? 'UNKNOWN'),
      period: { from: where.observedAt?.gte ?? null, to: where.observedAt?.lte ?? null },
    };
  }

  // ── 보강(P1~P3): HAI·MDRO·법정감염병 ──

  async createHaiCase(dto: any, userId: string) {
    return this.prisma.haiCase.create({
      data: {
        patientId: dto.patientId, haiType: dto.haiType, organism: dto.organism ?? null,
        deviceType: dto.deviceType ?? null, deviceInsertedAt: dto.deviceInsertedAt ? new Date(dto.deviceInsertedAt) : null,
        deviceDays: dto.deviceDays ?? null, site: dto.site ?? null,
        onsetAt: dto.onsetAt ? new Date(dto.onsetAt) : new Date(), ward: dto.ward ?? null,
        criteriaMet: dto.criteriaMet ?? null, notes: dto.notes ?? null, detectedBy: userId,
      },
    });
  }

  async listHaiCases(status?: string, haiType?: string) {
    const where: Record<string, unknown> = {};
    if (status) where.status = status;
    if (haiType) where.haiType = haiType;
    return this.prisma.haiCase.findMany({ where, orderBy: { onsetAt: 'desc' }, take: 200 });
  }

  /**
   * HAI 케이스 종결(+KONIS 보고).
   *
   * 🔴 종전: FE 가 보낸 `reportedToKonis:true` 를 **그대로 저장**했다. KONIS 로 나가는
   *    코드는 없는데 화면 토스트는 "HAI 종결·KONIS 보고"였다 — 보고하지 않은 것이
   *    보고된 것으로 기록됐다.
   *
   * 지금:
   *  - 자동 전송 요청 → `transmitKonis()` 결과에 따른다. 미구축이면 `reportedToKonis` 는
   *    **false 로 남기고** notes 에 미전송 사유를 적는다(화면은 'KONIS 미보고'를 계속 말한다).
   *  - 사람이 KONIS 웹에 수기 보고했다면 근거번호(`konisManualRef`)를 함께 보내야만
   *    보고완료로 기록한다(누가·언제·무슨 번호로 보고했는지 notes 에 남는다).
   */
  async resolveHaiCase(
    id: string,
    opts?: { reportedToKonis?: boolean; konisManualRef?: string },
    userId?: string,
  ) {
    const c = await this.prisma.haiCase.findUnique({ where: { id } });
    if (!c) throw new NotFoundException('HAI 케이스 없음');

    const at = new Date();
    const manualRef = opts?.konisManualRef?.trim();
    const data: { status: string; reportedToKonis?: boolean; notes?: string } = { status: 'RESOLVED' };
    const appendNote = (line: string) => { data.notes = `${c.notes ? `${c.notes}\n` : ''}${line}`; };

    let konis: { requested: boolean; transmitted: boolean; state: string; message: string };

    if (manualRef) {
      // 수기 보고 확인 — 사람이 근거번호를 제시한 경우에만 '보고완료'
      data.reportedToKonis = true;
      appendNote(`[KONIS 수기보고] ref=${manualRef} · ${at.toISOString()} · 등록자 ${userId ?? '미상'}`);
      konis = {
        requested: true, transmitted: false, state: 'MANUAL_ATTESTED',
        message: `KONIS 수기 보고 근거번호(${manualRef})로 기록했습니다 — HIS 자동 전송은 아닙니다`,
      };
    } else if (opts?.reportedToKonis === true) {
      const result = await this.transmitKonis({ haiCaseId: id, haiType: c.haiType });
      if (result.outcome === 'SENT') {
        data.reportedToKonis = true;
        appendNote(`[KONIS 전송] ref=${result.externalRef ?? '-'} · ${(result.at ?? at).toISOString()}`);
        konis = { requested: true, transmitted: true, state: 'SENT', message: 'KONIS 전송 완료' };
      } else {
        appendNote(notTransmittedLog(KONIS_CHANNEL, at, { attemptedBy: userId, reason: result.reason }));
        this.logger.warn(`[KONIS] HAI ${id}(${c.haiType}) 미전송 — ${result.reason ?? ''}`);
        konis = {
          requested: true, transmitted: false, state: 'NOT_TRANSMITTED',
          message: `KONIS 연동이 없어 보고되지 않았습니다 — ${KONIS_CHANNEL.manualFallback}`,
        };
      }
    } else {
      if (opts?.reportedToKonis === false) data.reportedToKonis = false;
      konis = {
        requested: false, transmitted: false, state: 'NOT_REQUESTED',
        message: 'KONIS 보고는 요청되지 않았습니다(종결만 처리)',
      };
    }

    const updated = await this.prisma.haiCase.update({ where: { id }, data });
    return { ...updated, konis };
  }

  /**
   * 🔴 `konisPending` 은 **종결 여부와 무관하게** 미보고면 센다.
   * 종전에는 `status:'ACTIVE'` 로 한정돼, 종결 버튼을 누르는 순간 미보고인 채로
   * 지표에서 사라졌다(미보고 케이스가 조용히 0으로 수렴).
   */
  async haiStats() {
    const byType = await this.prisma.haiCase.groupBy({ by: ['haiType'], _count: { id: true }, where: { status: 'ACTIVE' } });
    const active = await this.prisma.haiCase.count({ where: { status: 'ACTIVE' } });
    const konisPending = await this.prisma.haiCase.count({ where: { reportedToKonis: false } });
    const konisPendingResolved = await this.prisma.haiCase.count({ where: { reportedToKonis: false, status: { not: 'ACTIVE' } } });
    return {
      active,
      konisPending,
      konisPendingResolved, // 종결됐지만 아직 KONIS 미보고 — 놓치기 쉬운 잔여분
      konisChannelImplemented: KONIS_CHANNEL.implemented,
      byType: byType.map((b) => ({ haiType: b.haiType, count: b._count.id })),
    };
  }

  async addMdro(dto: any, userId?: string) {
    // 동일 환자·organism 활성 MDRO 중복 방지 — activeTotal 감시통계 왜곡·이중격리 차단(멱등).
    const dup = await this.prisma.mdroRegistry.findFirst({
      where: { patientId: dto.patientId, organism: dto.organism, active: true },
    });
    if (dup) return dup;

    const mdro = await this.prisma.mdroRegistry.create({
      data: {
        patientId: dto.patientId, organism: dto.organism, mdroType: dto.mdroType, mechanism: dto.mechanism ?? null,
        specimen: dto.specimen ?? null, ward: dto.ward ?? null, detectedAt: dto.detectedAt ? new Date(dto.detectedAt) : new Date(),
        isolationType: dto.isolationType ?? null, notes: dto.notes ?? null,
      },
    });

    // MDRO 검출 → 접촉격리 자동 오더(원내 전파 차단). 기존: 등록만 하고 격리 미연동 → "등록됐으나 격리 안 된" 환자 발생.
    //  이미 활성 격리가 있으면 생략. orderedBy(User FK) 확보 시에만 생성(없으면 수동 격리 유도). 비차단.
    if (userId) {
      try {
        const isoType = (dto.isolationType as IsolationPrecautionType) ?? 'CONTACT';
        const existingIso = await this.prisma.isolationPrecaution.findFirst({
          where: { patientId: dto.patientId, status: 'ACTIVE' },
        });
        if (!existingIso) {
          await this.prisma.isolationPrecaution.create({
            data: {
              patientId: dto.patientId,
              type: Object.values(IsolationPrecautionType).includes(isoType) ? isoType : IsolationPrecautionType.CONTACT,
              reason: `MDRO 검출 자동격리: ${dto.organism ?? ''}`.slice(0, 500),
              organism: dto.organism ? String(dto.organism).slice(0, 200) : undefined,
              orderedBy: userId,
              notes: 'MDRO 레지스트리 등록 시 자동 생성',
            },
          });
        }
      } catch (e) {
        this.logger?.warn?.(`MDRO 자동격리 생성 실패(비차단): ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    return mdro;
  }

  async listMdro(activeOnly = true) {
    return this.prisma.mdroRegistry.findMany({ where: activeOnly ? { active: true } : {}, orderBy: { detectedAt: 'desc' }, take: 200 });
  }

  async clearMdro(id: string) {
    const m = await this.prisma.mdroRegistry.findUnique({ where: { id } });
    if (!m) throw new NotFoundException('MDRO 없음');
    return this.prisma.mdroRegistry.update({ where: { id }, data: { active: false, clearedAt: new Date() } });
  }

  async mdroStats() {
    const byType = await this.prisma.mdroRegistry.groupBy({ by: ['mdroType'], _count: { id: true }, where: { active: true } });
    return { activeTotal: byType.reduce((s, b) => s + b._count.id, 0), byType: byType.map((b) => ({ mdroType: b.mdroType, count: b._count.id })) };
  }

  async createNotifiable(dto: any, userId: string) {
    return this.prisma.notifiableDiseaseReport.create({
      data: { patientId: dto.patientId, diseaseName: dto.diseaseName, diseaseGrade: dto.diseaseGrade ?? null, kcdcCode: dto.kcdcCode ?? null, diagnosisType: dto.diagnosisType ?? null, reportedBy: userId },
    });
  }

  /**
   * 🔴 목록은 '전송 사실'을 함께 준다 — 저장값은 변조하지 않고 읽는 쪽에서 구분한다.
   * 운영에 남아 있는 `KCDC-DEMO01`(status=SUBMITTED) 도 전송 채널이 존재한 적이 없으므로
   * '신고완료'가 아니라 `UNVERIFIED`(전송 근거 없음)로 읽힌다.
   */
  async listNotifiable(status?: string) {
    const rows = await this.prisma.notifiableDiseaseReport.findMany({ where: status ? { status } : {}, orderBy: { createdAt: 'desc' }, take: 200 });
    return rows.map((r) => ({ ...r, transmission: classifyNotifiableTransmission(r) }));
  }

  // ── 법정보고 외부 전송(W7) — 전송을 흉내내지 않는다 ────────────────────

  /**
   * 🔴 질병관리청(KCDC) 전송 — **연동이 없다**. 화면 실사용 점검 W7(2026-08-14).
   *
   * 실제 연동이 붙는 날 고칠 자리는 여기 한 곳이다(그때 `KCDC_CHANNEL.implemented=true`).
   * 그 전까지는 어떤 경로로도 'SUBMITTED'(전송 완료)가 새로 기록되지 않는다.
   */
  private async transmitNotifiable(_report: { id: string; diseaseName: string }): Promise<TransmitResult> {
    if (!KCDC_CHANNEL.implemented) {
      return { outcome: 'NOT_TRANSMITTED', reason: `${KCDC_CHANNEL.name} 연동 미구축 — 전송 코드 없음` };
    }
    /* istanbul ignore next — 연동 구현 자리 */
    return { outcome: 'FAILED', reason: '전송 구현이 채널을 부르지 않았다' };
  }

  /** 🔴 KONIS 전송 — 마찬가지로 연동이 없다(플래그만 세우던 것을 여기로 모았다). */
  private async transmitKonis(_payload: Record<string, unknown>): Promise<TransmitResult> {
    if (!KONIS_CHANNEL.implemented) {
      return { outcome: 'NOT_TRANSMITTED', reason: `${KONIS_CHANNEL.name} 연동 미구축 — 전송 코드 없음` };
    }
    /* istanbul ignore next — 연동 구현 자리 */
    return { outcome: 'FAILED', reason: '전송 구현이 채널을 부르지 않았다' };
  }

  /**
   * 법정감염병 신고 제출.
   *
   * 🔴 종전: 전송 없이 `status:'SUBMITTED'` + `reportRef:'KCDC-…'` 만 적어 화면이
   *    초록 '신고완료 + 질병관리청 접수번호'를 보여줬고(감염병예방법 §11 미이행이
   *    이행으로 보였다), `DRAFT/REJECTED` 외 재제출을 막아 **영구 미신고**로 굳었다.
   *
   * 지금: 전송 결과대로만 적는다.
   *  - SENT            → SUBMITTED · 기관 접수번호 · 기관 접수시각
   *  - NOT_TRANSMITTED → LOCAL_RECORDED · `LOCAL-KCDC-…`(원내 번호) · submittedAt 은 **비운다**
   *                      (전송 시각을 모르면 추정하지 않는다) · errorLog 에 미전송 사유·조치
   *  - FAILED          → SEND_FAILED (재시도 가능)
   */
  async submitNotifiable(id: string, userId?: string) {
    const r = await this.prisma.notifiableDiseaseReport.findUnique({ where: { id } });
    if (!r) throw new NotFoundException('신고 없음');
    // 🔴 재제출 차단은 **실제로 나간 건**에만 건다. 종전 규칙(DRAFT/REJECTED 만 허용)은
    //    시뮬레이션 'SUBMITTED' 가 재신고를 영구 차단해 미신고를 굳혔다.
    const before = classifyNotifiableTransmission(r);
    if (before.transmitted && !RESUBMITTABLE_STATUSES.includes(r.status)) {
      throw new BadRequestException(`이미 ${KCDC_CHANNEL.name}에 접수된 신고입니다 — 재제출 불가`);
    }

    const at = new Date();
    const result = await this.transmitNotifiable({ id: r.id, diseaseName: r.diseaseName });

    if (result.outcome === 'SENT') {
      const sent = await this.prisma.notifiableDiseaseReport.update({
        where: { id },
        data: {
          status: NOTIFIABLE_STATUS.SUBMITTED,
          submittedAt: result.at ?? at,
          reportRef: result.externalRef ?? null,
          errorLog: null,
        },
      });
      return { ...sent, transmission: classifyNotifiableTransmission(sent) };
    }

    const failed = result.outcome === 'FAILED';
    // 종전 접수번호(예: 시뮬레이션 시절 'KCDC-DEMO01')는 지우지 않고 errorLog 에 보존한다.
    const priorRef = r.reportRef && !r.reportRef.startsWith('LOCAL-') ? ` · 이전 기록 접수번호 보존: ${r.reportRef}` : '';
    this.logger.warn(
      `[법정감염병] 신고 ${id}(${r.diseaseName}) ${failed ? '전송 실패' : '미전송'} — ${result.reason ?? ''} · ${KCDC_CHANNEL.manualFallback}`,
    );
    const updated = await this.prisma.notifiableDiseaseReport.update({
      where: { id },
      data: {
        status: failed ? NOTIFIABLE_STATUS.SEND_FAILED : NOTIFIABLE_STATUS.LOCAL_RECORDED,
        submittedAt: null, // 나가지 않았으므로 '전송 시각'은 없다
        reportRef: localReportRef('KCDC', at),
        errorLog: notTransmittedLog(KCDC_CHANNEL, at, { attemptedBy: userId, reason: result.reason }) + priorRef,
      },
    });
    return { ...updated, transmission: classifyNotifiableTransmission(updated) };
  }

}
