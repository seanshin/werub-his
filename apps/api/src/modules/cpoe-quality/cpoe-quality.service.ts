import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { cpoeQiDef, joinPatientName, pChart, qiSettingOf, type CpoeQiKey } from '@hospital-run/shared';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { dayRange, monthRangeLocal, localDateKey } from '../../common/day-range';
import { QualityService } from '../quality/quality.service';
import {
  computeMeasurementValue, evaluateMeetTarget, normalizeIndicatorKey, resolveIndicatorPolicy, resolveRegistryDirection,
} from '../quality/indicator-policy';
import {
  bucketCounts, computeAckTimes, computeAlertBurden, computeByPrescriber, computeIndicators, computeTat, countIndicator,
  type QiCdss, type QiCritical, type QiData, type QiIntervention, type QiOrder, type QiRx,
} from './cpoe-quality.compute';

const DAY = 86_400_000;
/** 원장별 행 상한 — 넘으면 truncated 로 말한다(조용히 일부만 세지 않는다) */
const ROW_CAP = 20_000;
const MAX_RANGE_DAYS = 366;

export interface CpoeQualityScope {
  /** 책임 처방의 한정(의사 본인 조회 · 관리자 필터) — 없으면 병원 전체 */
  prescriberId?: string | null;
}

const prescriberOf = (rx: { prescriberId: string | null; createdBy: string } | null | undefined) =>
  rx ? rx.prescriberId ?? rx.createdBy : null;

@Injectable()
export class CpoeQualityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly quality: QualityService,
  ) {}

  /** 기간 해석 — 기본 최근 30일(오늘 포함) · 최대 366일 · 시작>종료 400 */
  resolvePeriod(from?: string, to?: string, now = new Date()): { from: Date; to: Date } {
    const r = dayRange(from, to);
    const end = r?.lt ?? (() => { const d = new Date(now); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + 1); return d; })();
    const start = r?.gte ?? new Date(end.getTime() - 30 * DAY);
    if (start >= end) throw new BadRequestException('조회 시작일이 종료일보다 늦습니다');
    if ((end.getTime() - start.getTime()) / DAY > MAX_RANGE_DAYS) {
      throw new BadRequestException({ code: 'CPOE_QI_RANGE_TOO_LONG', message: '조회 기간은 366일까지입니다', maxDays: MAX_RANGE_DAYS });
    }
    return { from: start, to: end };
  }

  private prescriberWhere(prescriberId: string): Prisma.PrescriptionWhereInput {
    // 책임 처방의 — 지정이 없으면 입력자(정본: prescriberId ?? createdBy)
    return { OR: [{ prescriberId }, { prescriberId: null, createdBy: prescriberId }] };
  }

  /** 원장 행 → 산출 입력 */
  private async load(period: { from: Date; to: Date }, scope: CpoeQualityScope) {
    const createdAt = { gte: period.from, lt: period.to };
    const rxScope = scope.prescriberId ? this.prescriberWhere(scope.prescriberId) : {};
    // 층화는 그 진료 기록의 유형으로(현재 위치가 아니다 — shared qiSettingOf)
    const enc = { select: { patientId: true, visitType: true, admissionId: true } } as const;
    const [rxRows, orderRows, piRows, cdssRows, critRows] = await Promise.all([
      this.prisma.prescription.findMany({
        where: { createdAt, ...rxScope },
        select: {
          id: true, type: true, status: true, priority: true, orderSource: true, durChecked: true, durWarnings: true,
          durOverridden: true, durOverrideReason: true, readBackConfirmedAt: true, prescriberCosignedAt: true,
          diagnosisCodeId: true, discontinueReason: true, createdAt: true, prescriberId: true, createdBy: true,
          encounter: enc,
          medicationCode: { select: { nameKo: true } }, procedureCode: { select: { nameKo: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: ROW_CAP + 1,
      }),
      this.prisma.order.findMany({
        where: { createdAt, ...(scope.prescriberId ? { prescription: this.prescriberWhere(scope.prescriberId) } : {}) },
        select: {
          id: true, department: true, status: true, priority: true, createdAt: true, completedAt: true,
          acknowledgedAt: true, specimenCollectedAt: true,
          prescription: {
            select: {
              prescriberId: true, createdBy: true, encounter: enc,
              medicationCode: { select: { nameKo: true } }, procedureCode: { select: { nameKo: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: ROW_CAP + 1,
      }),
      this.prisma.pharmacistIntervention.findMany({
        where: { createdAt },
        select: { id: true, status: true, createdAt: true, patientId: true, drugText: true, prescriptionId: true },
        orderBy: { createdAt: 'desc' },
        take: ROW_CAP + 1,
      }),
      this.prisma.cdssLog.findMany({
        where: { createdAt, ...(scope.prescriberId ? { doctorId: scope.prescriberId } : {}) },
        select: { id: true, overridden: true, overrideReason: true, createdAt: true, patientId: true, medicationCode: true, doctorId: true, encounterId: true, overallLevel: true },
        orderBy: { createdAt: 'desc' },
        take: ROW_CAP + 1,
      }),
      // 위급값 통보 — 통보 시각 기준 · 담당의(doctorId)가 처방의 자리
      this.prisma.criticalValueAlert.findMany({
        where: { notifiedAt: createdAt, ...(scope.prescriberId ? { doctorId: scope.prescriberId } : {}) },
        select: { id: true, patientId: true, doctorId: true, testName: true, notifiedAt: true, acknowledgedAt: true, readBackConfirmed: true },
        orderBy: { notifiedAt: 'desc' },
        take: ROW_CAP + 1,
      }),
    ]);

    // 약사 중재는 처방과 관계가 없어 처방의·진료를 따로 찾는다(처방이 지워졌으면 미상)
    const piRxIds = [...new Set(piRows.map((p) => p.prescriptionId).filter((x): x is string => !!x))];
    const cdssEncIds = [...new Set(cdssRows.map((c) => c.encounterId))];
    const [piRx, cdssEnc] = await Promise.all([
      piRxIds.length ? this.prisma.prescription.findMany({ where: { id: { in: piRxIds } }, select: { id: true, prescriberId: true, createdBy: true, encounter: enc } }) : [],
      cdssEncIds.length ? this.prisma.encounter.findMany({ where: { id: { in: cdssEncIds } }, select: { id: true, visitType: true, admissionId: true } }) : [],
    ]);
    const piById = new Map(piRx.map((r) => [r.id, r]));
    const cdssEncById = new Map(cdssEnc.map((e) => [e.id, e]));

    const rx: QiRx[] = rxRows.slice(0, ROW_CAP).map((r) => ({
      id: r.id, type: r.type, status: r.status, priority: r.priority, orderSource: r.orderSource,
      durChecked: r.durChecked, durWarnings: r.durWarnings, durOverridden: r.durOverridden, durOverrideReason: r.durOverrideReason,
      readBackConfirmedAt: r.readBackConfirmedAt, prescriberCosignedAt: r.prescriberCosignedAt, diagnosisCodeId: r.diagnosisCodeId,
      discontinueReason: r.discontinueReason, createdAt: r.createdAt, prescriber: prescriberOf(r),
      patientId: r.encounter?.patientId ?? null, name: r.medicationCode?.nameKo ?? r.procedureCode?.nameKo ?? null,
      setting: qiSettingOf(r.encounter),
    }));
    const orders: QiOrder[] = orderRows.slice(0, ROW_CAP).map((o) => ({
      id: o.id, department: o.department, status: o.status, priority: o.priority, createdAt: o.createdAt,
      completedAt: o.completedAt, acknowledgedAt: o.acknowledgedAt, specimenCollectedAt: o.specimenCollectedAt,
      prescriber: prescriberOf(o.prescription), patientId: o.prescription?.encounter?.patientId ?? null,
      name: o.prescription?.procedureCode?.nameKo ?? o.prescription?.medicationCode?.nameKo ?? null,
      setting: qiSettingOf(o.prescription?.encounter),
    }));
    let interventions: QiIntervention[] = piRows.slice(0, ROW_CAP).map((p) => {
      const r = p.prescriptionId ? piById.get(p.prescriptionId) : undefined;
      return {
        id: p.id, status: p.status, createdAt: p.createdAt, patientId: p.patientId, name: p.drugText,
        prescriber: prescriberOf(r), setting: qiSettingOf(r?.encounter),
      };
    });
    if (scope.prescriberId) interventions = interventions.filter((i) => i.prescriber === scope.prescriberId);
    const cdss: QiCdss[] = cdssRows.slice(0, ROW_CAP).map((c) => ({
      id: c.id, overridden: c.overridden, overrideReason: c.overrideReason, createdAt: c.createdAt,
      patientId: c.patientId, name: c.medicationCode, prescriber: c.doctorId, setting: qiSettingOf(cdssEncById.get(c.encounterId)), level: c.overallLevel,
    }));
    // 🔴 위급값은 검사 결과에서 진료까지 잇는 고리가 없어 진료 유형을 모른다 — UNKNOWN(외래로 짐작하지 않는다)
    const criticals: QiCritical[] = critRows.slice(0, ROW_CAP).map((c) => ({
      id: c.id, createdAt: c.notifiedAt, acknowledgedAt: c.acknowledgedAt, readBackConfirmed: c.readBackConfirmed,
      patientId: c.patientId, name: c.testName, prescriber: c.doctorId, setting: 'UNKNOWN',
    }));
    const truncated = {
      prescriptions: rxRows.length > ROW_CAP, orders: orderRows.length > ROW_CAP,
      interventions: piRows.length > ROW_CAP, cdss: cdssRows.length > ROW_CAP, criticals: critRows.length > ROW_CAP,
    };
    return { data: { rx, orders, interventions, cdss, criticals } satisfies QiData, truncated };
  }

  /** 책임 처방의 → 진료과(User.department) — 층화·이름 표시 공용 */
  private async usersOf(ids: Iterable<string>) {
    const list = [...new Set(ids)];
    const users = list.length
      ? await this.prisma.user.findMany({ where: { id: { in: list } }, select: { id: true, familyName: true, givenName: true, department: true } })
      : [];
    return new Map(users.map((u) => [u.id, { name: joinPatientName(u.familyName, u.givenName), department: u.department ?? null }]));
  }

  /** 질 지표 원장(QualityIndicator)과의 연결 — 같은 이름(공백 무시)으로 등재된 활성 지표만 */
  private async ledgerLinks() {
    const rows = await this.prisma.qualityIndicator.findMany({
      where: { isActive: true },
      select: {
        id: true, name: true, category: true, formula: true, targetValue: true, direction: true, unit: true, valueScale: true,
        measurements: { where: { voidedAt: null }, orderBy: { period: 'desc' }, take: 1, select: { period: true, value: true, meetTarget: true } },
      },
    });
    const byKey = new Map(rows.map((r) => [normalizeIndicatorKey(r.name), r]));
    return (qiName: string) => byKey.get(normalizeIndicatorKey(qiName)) ?? null;
  }

  async getQuality(q: { from?: string; to?: string; prescriberId?: string | null }, viewer: { id: string; role: string }, now = new Date()) {
    const period = this.resolvePeriod(q.from, q.to, now);
    // 🔴 의사는 본인 처방만 본다(다른 처방의 수치·이름을 보이지 않는다) · 관리자는 병원 전체 또는 처방의 한 명
    const prescriberId = viewer.role === 'ADMIN' ? q.prescriberId || null : viewer.id;
    const { data, truncated } = await this.load(period, { prescriberId });
    const link = await this.ledgerLinks();

    // 처방의 → 진료과(층화) — 기간 안 모든 처방의를 한 번에
    const prescribers = new Set<string>();
    for (const list of [data.rx, data.orders, data.interventions, data.cdss, data.criticals]) for (const x of list) if (x.prescriber) prescribers.add(x.prescriber);
    if (prescriberId) prescribers.add(prescriberId);
    const users = await this.usersOf(prescribers);
    const results = computeIndicators(data, period, (id) => (id ? users.get(id)?.department ?? null : null));
    const indicators = results.map((r) => {
      const def = cpoeQiDef(r.key)!;
      const ledger = link(def.qiName);
      const registry = resolveRegistryDirection(def.qiName);
      if (!ledger) {
        return { ...r, qi: { registered: false as const, name: def.qiName, direction: registry.direction, directionSource: registry.source } };
      }
      const policy = resolveIndicatorPolicy(ledger);
      const target = ledger.targetValue == null ? null : Number(ledger.targetValue);
      const scaled = computeMeasurementValue(r.numerator, r.denominator, policy.valueScale);
      const latest = ledger.measurements[0];
      return {
        ...r,
        qi: {
          registered: true as const, indicatorId: ledger.id, name: ledger.name, target, unit: policy.unit, valueScale: policy.valueScale,
          direction: policy.direction, directionSource: policy.directionSource,
          // 🔴 화면 기간 값의 목표 대비 — 판정은 원장 정본(evaluateMeetTarget)만 · 방향 미상이면 null
          current: { value: scaled, meetTarget: evaluateMeetTarget(scaled, target, policy.direction) },
          latest: latest ? { period: latest.period, value: Number(latest.value), meetTarget: latest.meetTarget } : null,
        },
      };
    });

    const byPrescriber = viewer.role === 'ADMIN' && !prescriberId ? computeByPrescriber(data) : null;

    // 이름 — 문제 건 환자·처방의
    const patientIds = new Set<string>();
    for (const r of results) for (const it of r.offenders?.items ?? []) if (it.patientId) patientIds.add(it.patientId);
    const patients = patientIds.size
      ? await this.prisma.patient.findMany({ where: { id: { in: [...patientIds] } }, select: { id: true, familyName: true, givenName: true, koreanName: true, mrn: true } })
      : [];

    return {
      period: { from: period.from.toISOString(), to: period.to.toISOString(), fromDate: localDateKey(period.from), toDate: localDateKey(new Date(period.to.getTime() - 1)) },
      scope: { prescriberId, hospitalWide: !prescriberId },
      truncated,
      totals: {
        prescriptions: data.rx.length, orders: data.orders.length,
        interventions: data.interventions.length, cdss: data.cdss.length, criticals: data.criticals.length,
      },
      indicators,
      tat: computeTat(data.orders),
      ackTimes: computeAckTimes(data),
      byPrescriber,
      names: {
        patients: Object.fromEntries(patients.map((p) => [p.id, { name: joinPatientName(p.familyName, p.givenName), koreanName: p.koreanName ?? null, mrn: p.mrn }])),
        users: Object.fromEntries(users),
      },
    };
  }

  /**
   * 월별 p 관리도 — 최근 N개월(이번 달 포함 · 진행 중인 달은 partial 로 중심선에서 뺀다).
   * 🔴 범위 규칙은 getQuality 와 같다(의사는 본인 · 관리자는 병원 전체/처방의). 원장 목표가 있으면 같은 p 단위로 함께 낸다.
   */
  async getSpc(q: { key: CpoeQiKey; months?: number; prescriberId?: string | null }, viewer: { id: string; role: string }, now = new Date()) {
    const def = cpoeQiDef(q.key);
    if (!def) throw new BadRequestException('알 수 없는 CPOE 지표입니다');
    const months = Math.min(24, Math.max(3, Math.trunc(q.months ?? 12)));
    const prescriberId = viewer.role === 'ADMIN' ? q.prescriberId || null : viewer.id;
    const buckets: { period: string; start: Date; end: Date; partial: boolean }[] = [];
    for (let i = months - 1; i >= 0; i--) {
      const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
      buckets.push({ period: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}`, start, end, partial: end > now });
    }
    const { data, truncated } = await this.load({ from: buckets[0].start, to: buckets[buckets.length - 1].end }, { prescriberId });
    const counts = bucketCounts(q.key, data, buckets);
    const chart = pChart(buckets.map((b, i) => ({ period: b.period, partial: b.partial, ...counts[i] })));
    const ledger = (await this.ledgerLinks())(def.qiName);
    let target: { value: number; direction: string | null } | null = null;
    if (ledger && ledger.targetValue != null) {
      const policy = resolveIndicatorPolicy(ledger);
      // 원장 목표는 배율 단위(예: %)다 — 관리도의 p(0~1)와 같은 단위로 바꿔 함께 그린다
      target = { value: Number(ledger.targetValue) / policy.valueScale, direction: policy.direction };
    }
    return { key: q.key, months, scope: { prescriberId, hospitalWide: !prescriberId }, truncated, chart, target };
  }

  /**
   * 경고 부담 — DUR 경고 유형별·잦은 약·CDSS 수준별. 범위 규칙은 지표 조회와 같다(의사 본인 · 관리자 전체/처방의).
   */
  async getAlertBurden(q: { from?: string; to?: string; prescriberId?: string | null }, viewer: { id: string; role: string }, now = new Date()) {
    const period = this.resolvePeriod(q.from, q.to, now);
    const prescriberId = viewer.role === 'ADMIN' ? q.prescriberId || null : viewer.id;
    const { data, truncated } = await this.load(period, { prescriberId });
    return {
      period: { fromDate: localDateKey(period.from), toDate: localDateKey(new Date(period.to.getTime() - 1)) },
      scope: { prescriberId, hospitalWide: !prescriberId },
      truncated,
      ...computeAlertBurden(data),
    };
  }

  /**
   * 한 지표를 한 기간에서 병원 전체로 센다 — 개선 활동의 기준선·효과 확인이 쓴다(화면이 보낸 수를 쓰지 않는다).
   * 🔴 행 상한을 넘으면 일부만 센 수를 내지 않고 거절한다.
   */
  async countPeriod(key: CpoeQiKey, period: { from: Date; to: Date }) {
    if (!cpoeQiDef(key)) throw new BadRequestException('알 수 없는 CPOE 지표입니다');
    const { data, truncated } = await this.load(period, {});
    if (Object.values(truncated).some(Boolean)) {
      throw new ConflictException({ code: 'CPOE_QI_TRUNCATED', message: '행이 상한을 넘어 일부만 셀 수 있습니다 — 기간을 줄이십시오', cap: ROW_CAP });
    }
    return countIndicator(key, data);
  }

  /**
   * 한 달 측정을 질 지표 원장에 기록 — **병원 전체 · 끝난 달만** · 원장에 등재된 지표만.
   * 🔴 값은 서버가 원장에서 다시 센다(화면이 보낸 수를 믿지 않는다). 중복·분모 0 은 원장 정본(addMeasurement)이 거절한다.
   */
  async recordMonth(key: CpoeQiKey, month: string, now = new Date(), actorId?: string) {
    const def = cpoeQiDef(key);
    if (!def) throw new BadRequestException('알 수 없는 CPOE 지표입니다');
    const { start, end } = monthRangeLocal(month);
    if (end > now) throw new BadRequestException({ code: 'CPOE_QI_MONTH_OPEN', message: '아직 끝나지 않은 달입니다 — 끝난 달만 측정으로 기록합니다', period: month });
    const ledger = (await this.ledgerLinks())(def.qiName);
    if (!ledger) {
      throw new NotFoundException({
        code: 'CPOE_QI_NOT_REGISTERED',
        message: '질 지표 원장에 이 지표가 없습니다 — 질 지표 관리에서 같은 이름으로 등록(목표는 위원회 결정)한 뒤 기록하십시오',
        qiName: def.qiName,
      });
    }
    const { data, truncated } = await this.load({ from: start, to: end }, {});
    if (Object.values(truncated).some(Boolean)) {
      throw new ConflictException({ code: 'CPOE_QI_TRUNCATED', message: '행이 상한을 넘어 일부만 셀 수 있습니다 — 기록하지 않습니다', period: month, cap: ROW_CAP });
    }
    const { numerator, denominator } = countIndicator(key, data);
    // 출처 CPOE(자동 칸) — 같은 달 수기 행과 나란히 남는다(결정 qi.autoManual.precedence)
    const measurement = await this.quality.addMeasurement({
      indicatorId: ledger.id, period: month, numerator, denominator,
      source: 'CPOE', computedBy: `cpoe-quality:${key}`, createdBy: actorId,
      evidence: { window: { from: start.toISOString(), to: end.toISOString() }, key, ledgers: 'prescriptions·orders' },
    });
    return { key, period: month, numerator, denominator, indicatorId: ledger.id, measurement };
  }

}
