import { Injectable, Optional } from '@nestjs/common';
import {
  QI_SUPPLIERS, qiSupplierByName, rawTypeAliases, NURSING_INITIAL_ASSESSMENT_HOURS, QI_CONSULT_REPLY_HOURS, QI_ENCOUNTER_SIGN_DAYS,
  normalizeShiftBoundaries, shiftWindowAt, isAnalgesicMed, painReassessOutcomes, riskReassessOutcomes, morseRiskLevel, bradenRiskLevel,
  type AnalgesicEvent, type PainRecordEvent, type RiskAssessmentEvent,
  type QiSupplierKey, type IncidentType, type QiIncidentDenominator,
} from '@hospital-run/shared';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ConfigRuntimeService } from '../config/config-runtime.service';
import { dateOnlyValue, localDateKey, monthRangeLocal, parseLocalDate } from '../../common/day-range';
import { normalizeIndicatorKey } from './indicator-policy';
import { AdmissionVitalsReader } from '../vitals/admission-vitals.reader';
import { readPainReassessRule, readRiskReassessIntervals } from '../nursing-rules/nursing-rules.read';

export interface SupplyRange { from: Date; to: Date }

export type SupplyResult =
  | { available: true; supplierKey: QiSupplierKey; numerator: number; denominator: number; evidence: Record<string, unknown> }
  | { available: false; supplierKey: QiSupplierKey | null; reason: string; numerator: number | null; detail?: Record<string, unknown> };

/**
 * 지표 공급원(QI-FLOW-001 · 2026-10-08) — 질 지표의 분자·분모를 **원내 원장에서 다시 센다**.
 *
 * CPOE 지표에서만 돌던 고리(서버 재집계 → 원장 기록 → 관리도 → PDCA 효과 확인)를 일반 지표로 넓히는 공용 부품.
 *  · 🔴 분모가 원내 결정에 걸린 지표(사고율·기구 관련 감염률)는 결정 전엔 `available:false` + 이유 — 분자만 따로 준다(대조 근거)
 *  · 🔴 재원일수 스냅샷이 기간을 다 덮지 못하면 산출하지 않는다(부분 분모 = 부풀린 비율)
 *  · 🔴 셀 수 있는 것만 — 공급원 매핑은 shared `QI_SUPPLIERS`(운영 어휘 실측분) 하나
 *  · 쓰지 않는다 — 기록은 호출자(월 마감·화면)가 `QualityService.addMeasurement` 로
 */
@Injectable()
export class IndicatorSupplierService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly config?: ConfigRuntimeService,
  ) {}

  /** 지표 → 공급원 키(지표에 등재된 supplierKey 우선 · 없으면 이름 정규형으로 매칭) */
  supplierOf(indicator: { name: string; supplierKey?: string | null }): QiSupplierKey | null {
    if (indicator.supplierKey && indicator.supplierKey in QI_SUPPLIERS) return indicator.supplierKey as QiSupplierKey;
    return qiSupplierByName(normalizeIndicatorKey(indicator.name));
  }

  private async cfg(key: string): Promise<unknown> {
    try { return this.config ? await this.config.get(key) : null; } catch { return null; }
  }

  async incidentDenominatorBasis(): Promise<QiIncidentDenominator | null> {
    const v = await this.cfg('qi.autoMeasure.incidentDenominator');
    return v === 'PATIENT_DAYS' || v === 'ADMISSIONS' ? v : null;
  }

  /** 기간의 날짜 키(로컬 KST · from 포함 · to 제외) */
  dayKeys(range: SupplyRange): string[] {
    const out: string[] = [];
    const d = new Date(range.from.getFullYear(), range.from.getMonth(), range.from.getDate());
    while (d < range.to) { out.push(localDateKey(d)); d.setDate(d.getDate() + 1); }
    return out;
  }

  /** 기간 재원일수 합 — 스냅샷이 기간의 모든 날을 덮을 때만 의미가 있다(덮은 날 수를 함께 준다) */
  async patientDays(range: SupplyRange, wardKey?: string): Promise<{ total: number; coveredDays: number; days: number }> {
    const keys = this.dayKeys(range);
    if (!keys.length) return { total: 0, coveredDays: 0, days: 0 };
    const rows = await this.prisma.patientDaySnapshot.findMany({
      where: { date: { gte: dateOnlyValue(keys[0])!, lte: dateOnlyValue(keys[keys.length - 1])! }, ...(wardKey != null ? { wardKey } : {}) },
      select: { date: true, patientDays: true },
    });
    const covered = new Set(rows.map((r) => r.date.toISOString().slice(0, 10)));
    return { total: rows.reduce((s, r) => s + r.patientDays, 0), coveredDays: covered.size, days: keys.length };
  }

  /** 기간(월 단위)의 YYYY-MM 목록 */
  private periodsIn(range: SupplyRange): string[] {
    const out: string[] = [];
    const d = new Date(range.from.getFullYear(), range.from.getMonth(), 1);
    while (d < range.to) {
      out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
      d.setMonth(d.getMonth() + 1);
    }
    return out;
  }

  /** 월 하나의 기간 */
  monthRange(period: string): SupplyRange {
    const m = monthRangeLocal(period);
    return { from: m.start, to: m.end };
  }

  async supply(key: QiSupplierKey, range: SupplyRange): Promise<SupplyResult> {
    const def = QI_SUPPLIERS[key];
    const window = { from: range.from.toISOString(), to: range.to.toISOString() };
    if (def.kind === 'INCIDENT_RATE') {
      const types = rawTypeAliases(def.incidentType as IncidentType);
      // 🔴 (2026-10-10) 분모가 재원(재원일수·입원)이므로 분자도 재원 중 사고만 — 종전엔 외래·응급 사고까지 세어 재원 낙상률을 부풀렸다
      const inc = await this.inpatientIncidents(types, range);
      const numerator = inc.inpatient;
      const basis = await this.incidentDenominatorBasis();
      if (!basis) return { available: false, supplierKey: key, reason: 'DENOMINATOR_UNSET', numerator };
      if (basis === 'PATIENT_DAYS') {
        const pd = await this.patientDays(range);
        if (pd.coveredDays < pd.days) return { available: false, supplierKey: key, reason: 'PATIENT_DAYS_INCOMPLETE', numerator, detail: { coveredDays: pd.coveredDays, days: pd.days } };
        if (!(pd.total > 0)) return { available: false, supplierKey: key, reason: 'NO_SAMPLE', numerator };
        return { available: true, supplierKey: key, numerator, denominator: pd.total, evidence: { window, numeratorSource: 'safety_incidents(재원 중)', incidentTypes: types, denominatorBasis: basis, denominatorSource: 'patient_day_snapshots', coveredDays: pd.coveredDays, excluded: { outsideStay: inc.outsideStay, unattributed: inc.unattributed } } };
      }
      const denominator = await this.prisma.admission.count({ where: { admitDate: { gte: range.from, lt: range.to }, status: { not: 'CANCELLED' } } });
      if (!(denominator > 0)) return { available: false, supplierKey: key, reason: 'NO_SAMPLE', numerator };
      return { available: true, supplierKey: key, numerator, denominator, evidence: { window, numeratorSource: 'safety_incidents(재원 중)', incidentTypes: types, denominatorBasis: basis, denominatorSource: 'admissions(취소 제외)', excluded: { outsideStay: inc.outsideStay, unattributed: inc.unattributed } } };
    }
    if (def.kind === 'HAND_HYGIENE') {
      const [numerator, denominator] = await Promise.all([
        this.prisma.handHygieneObservation.count({ where: { action: 'PERFORMED', observedAt: { gte: range.from, lt: range.to } } }),
        this.prisma.handHygieneObservation.count({ where: { observedAt: { gte: range.from, lt: range.to } } }),
      ]);
      if (!(denominator > 0)) return { available: false, supplierKey: key, reason: 'NO_SAMPLE', numerator };
      return { available: true, supplierKey: key, numerator, denominator, evidence: { window, source: 'hand_hygiene_observations' } };
    }
    if (def.kind === 'DEVICE_RATE') {
      const numerator = await this.prisma.haiCase.count({ where: { haiType: def.haiType, onsetAt: { gte: range.from, lt: range.to } } });
      const src = await this.cfg('qi.deviceDays.source');
      if (src === 'NONE') return { available: false, supplierKey: key, reason: 'DEVICE_DAYS_NONE', numerator };
      if (src === 'DEVICE_LEDGER') return this.supplyFromLedger(key, def.deviceType, numerator, range, window, def.haiType);
      if (src !== 'MANUAL') return { available: false, supplierKey: key, reason: 'DEVICE_DAYS_SOURCE_UNSET', numerator };
      const periods = this.periodsIn(range);
      const rows = await this.prisma.deviceDayEntry.findMany({ where: { period: { in: periods }, deviceType: def.deviceType }, select: { period: true, days: true } });
      const have = new Set(rows.map((r) => r.period));
      const missing = periods.filter((p) => !have.has(p));
      if (missing.length) return { available: false, supplierKey: key, reason: 'DEVICE_DAYS_MISSING', numerator, detail: { missing } };
      const denominator = rows.reduce((s, r) => s + r.days, 0);
      if (!(denominator > 0)) return { available: false, supplierKey: key, reason: 'NO_SAMPLE', numerator };
      return { available: true, supplierKey: key, numerator, denominator, evidence: { window, numeratorSource: 'hai_cases', haiType: def.haiType, denominatorSource: 'device_day_entries(MANUAL)', deviceType: def.deviceType, periods } };
    }
    if (def.kind === 'NURSING_INITIAL') return this.supplyNursingInitial(key, range, window);
    if (def.kind === 'SHIFT_VITALS') return this.supplyShiftVitals(key, range, window);
    if (def.kind === 'CONSULT_REPLY') return this.supplyConsultReply(key, range, window);
    if (def.kind === 'CHART_SIGN') return this.supplyChartSign(key, range, window);
    if (def.kind === 'RADIATION_RECORDER') return this.supplyRadiationRecorder(key, range, window);
    if (def.kind === 'DOC_SLA') return this.supplyDocSla(key, range, window);
    if (def.kind === 'WIFI_OBSERVED') return this.supplyWifiObserved(key, range, window);
    if (def.kind === 'PAIN_REASSESS') return this.supplyPainReassess(key, range, window);
    if (def.kind === 'RISK_REASSESS') return this.supplyRiskReassess(key, range, window);
    // COUNT — 월 건수. 분모 1(측정 단위 = 한 기간) — 지표 배율이 1 이어야 값이 건수가 된다
    const numerator = await this.prisma.vocTicket.count({ where: { type: 'COMPLAINT', createdAt: { gte: range.from, lt: range.to } } });
    return { available: true, supplierKey: key, numerator, denominator: 1, evidence: { window, source: 'voc_tickets(COMPLAINT)', countIndicator: true } };
  }

  /**
   * 기구 원장 기구일수 — 자정 시점에 꽂혀 있는 기구 수의 합(재원일수와 같은 규약).
   * 🔴 원장 전수 기록 시작일(설정 qi.deviceLedger.coverageFrom) 전이거나 미설정이면 산출하지 않는다 — 일부만 기록된 원장은 분모를 줄여 감염률을 부풀린다.
   */
  private async supplyFromLedger(key: QiSupplierKey, deviceType: string, numerator: number, range: SupplyRange, window: { from: string; to: string }, haiType: string): Promise<SupplyResult> {
    const cov = await this.cfg('qi.deviceLedger.coverageFrom');
    const coverageFrom = typeof cov === 'string' ? parseLocalDate(cov) : null;
    if (!coverageFrom) return { available: false, supplierKey: key, reason: 'DEVICE_LEDGER_COVERAGE_UNSET', numerator };
    if (range.from < coverageFrom) return { available: false, supplierKey: key, reason: 'DEVICE_LEDGER_BEFORE_COVERAGE', numerator, detail: { coverageFrom: cov } };
    const rows = await this.prisma.deviceLine.findMany({
      where: { deviceType, voidedAt: null, insertedAt: { lt: range.to }, OR: [{ removedAt: null }, { removedAt: { gte: range.from } }] },
      select: { insertedAt: true, removedAt: true },
    });
    const denominator = ledgerDeviceDays(rows, range);
    if (!(denominator > 0)) return { available: false, supplierKey: key, reason: 'NO_SAMPLE', numerator };
    return { available: true, supplierKey: key, numerator, denominator, evidence: { window, numeratorSource: 'hai_cases', haiType, denominatorSource: 'device_lines(자정 기준)', deviceType, coverageFrom: cov, lines: rows.length } };
  }

  /**
   * 재원 중 사고 — 병동이 기록됐거나(병동 사고) 그 시각 환자가 재원 중이었던 사고만 분자(2026-10-10).
   * 환자·병동이 둘 다 없는 사고는 어디서 났는지 모른다 — 넣지도 버리지도 않고 수만 센다.
   */
  async inpatientIncidents(types: string[], range: SupplyRange): Promise<{ inpatient: number; outsideStay: number; unattributed: number }> {
    const rows = await this.prisma.safetyIncident.findMany({
      where: { type: { in: types }, occurredAt: { gte: range.from, lt: range.to } },
      select: { patientId: true, wardId: true, occurredAt: true },
    });
    const pids = [...new Set(rows.filter((r) => !r.wardId && r.patientId).map((r) => r.patientId as string))];
    const stays = pids.length
      ? await this.prisma.admission.findMany({
        where: { patientId: { in: pids }, status: { not: 'CANCELLED' }, admitDate: { lt: range.to }, OR: [{ dischargeDate: null }, { dischargeDate: { gte: range.from } }] },
        select: { patientId: true, admitDate: true, dischargeDate: true },
      })
      : [];
    let inpatient = 0, outsideStay = 0, unattributed = 0;
    for (const r of rows) {
      if (r.wardId) { inpatient++; continue; }
      if (!r.patientId) { unattributed++; continue; }
      const inStay = stays.some((a) => a.patientId === r.patientId && r.occurredAt >= a.admitDate && (!a.dischargeDate || r.occurredAt < a.dischargeDate));
      if (inStay) inpatient++; else outsideStay++;
    }
    return { inpatient, outsideStay, unattributed };
  }

  /**
   * 근무조 활력 기록 완결률(2026-10-10) — 재원 중 **온전히 지난** 근무조마다 활력이 1회 이상 있었는가.
   * 활력은 두 원장(플로시트 · 재원 기간 안 간호 스테이션 입력). 교대 경계 = 설정 nursing.shift.boundaries(병원 표준시).
   */
  private async supplyShiftVitals(key: QiSupplierKey, range: SupplyRange, window: { from: string; to: string }, now: Date = new Date()): Promise<SupplyResult> {
    const b = normalizeShiftBoundaries(await this.cfg('nursing.shift.boundaries'));
    const until = range.to < now ? range.to : now;
    const shifts: Array<{ start: Date; end: Date }> = [];
    let t = shiftWindowAt(range.from, b);
    // 기간 시작 시각이 근무조 중간이면 그 근무조는 기간 밖에서 시작했다 — 다음 근무조부터
    if (t.start < range.from) t = shiftWindowAt(t.end, b);
    while (t.end <= until) { shifts.push({ start: t.start, end: t.end }); t = shiftWindowAt(t.end, b); }
    if (!shifts.length) return { available: false, supplierKey: key, reason: 'NO_SAMPLE', numerator: 0 };
    const admissions = await this.prisma.admission.findMany({
      where: { status: { not: 'CANCELLED' }, admitDate: { lt: until }, OR: [{ dischargeDate: null }, { dischargeDate: { gt: range.from } }] },
      select: { id: true, patientId: true, admitDate: true, dischargeDate: true },
    });
    if (!admissions.length) return { available: false, supplierKey: key, reason: 'NO_SAMPLE', numerator: 0 };
    const [fs, pv] = await Promise.all([
      this.prisma.flowSheetEntry.findMany({ where: { admissionId: { in: admissions.map((a) => a.id) }, recordedAt: { gte: range.from, lt: until } }, select: { admissionId: true, recordedAt: true } }),
      this.prisma.preVisitVitals.findMany({ where: { patientId: { in: [...new Set(admissions.map((a) => a.patientId))] }, measuredAt: { gte: range.from, lt: until } }, select: { patientId: true, measuredAt: true } }),
    ]);
    const times = new Map<string, number[]>();
    const push = (id: string, at: Date) => { const arr = times.get(id) ?? []; arr.push(at.getTime()); times.set(id, arr); };
    for (const r of fs) push(r.admissionId, r.recordedAt);
    for (const r of pv) {
      const a = admissions.find((x) => x.patientId === r.patientId && r.measuredAt >= x.admitDate && (!x.dischargeDate || r.measuredAt < x.dischargeDate));
      if (a) push(a.id, r.measuredAt);
    }
    let denominator = 0, numerator = 0;
    for (const a of admissions) {
      const ts = times.get(a.id) ?? [];
      for (const w of shifts) {
        if (w.start < a.admitDate || (a.dischargeDate && w.end > a.dischargeDate)) continue;
        denominator++;
        if (ts.some((x) => x >= w.start.getTime() && x < w.end.getTime())) numerator++;
      }
    }
    if (!(denominator > 0)) return { available: false, supplierKey: key, reason: 'NO_SAMPLE', numerator: 0 };
    return { available: true, supplierKey: key, numerator, denominator, evidence: { window, numeratorSource: 'flow_sheet_entries + pre_visit_vitals(재원 기간)', denominatorSource: 'admissions × 근무조(온전히 재원)', shiftBoundaries: b, shifts: shifts.length } };
  }

  /** 협진 48시간 내 회신율 — 회신 없이 종결은 빼고 · 48시간이 아직 안 지난 미회신은 빼고(수를 근거에) */
  private async supplyConsultReply(key: QiSupplierKey, range: SupplyRange, window: { from: string; to: string }, now: Date = new Date()): Promise<SupplyResult> {
    const H = QI_CONSULT_REPLY_HOURS * 3_600_000;
    const rows = await this.prisma.consultation.findMany({ where: { createdAt: { gte: range.from, lt: range.to } }, select: { createdAt: true, repliedAt: true, status: true } });
    let denominator = 0, numerator = 0, cancelled = 0, pending = 0;
    for (const r of rows) {
      if (!r.repliedAt && r.status === 'CLOSED') { cancelled++; continue; }
      if (!r.repliedAt && now.getTime() < r.createdAt.getTime() + H) { pending++; continue; }
      denominator++;
      if (r.repliedAt && r.repliedAt.getTime() - r.createdAt.getTime() <= H) numerator++;
    }
    if (!(denominator > 0)) return { available: false, supplierKey: key, reason: 'NO_SAMPLE', numerator: 0, detail: { cancelled, pending } };
    return { available: true, supplierKey: key, numerator, denominator, evidence: { window, source: 'consultations', hours: QI_CONSULT_REPLY_HOURS, excluded: { closedWithoutReply: cancelled, pending } } };
  }

  /** 진료기록 7일 내 서명률 — 7일이 아직 안 지난 미서명은 빼고 */
  private async supplyChartSign(key: QiSupplierKey, range: SupplyRange, window: { from: string; to: string }, now: Date = new Date()): Promise<SupplyResult> {
    const D = QI_ENCOUNTER_SIGN_DAYS * 86_400_000;
    const rows = await this.prisma.encounter.findMany({ where: { createdAt: { gte: range.from, lt: range.to } }, select: { createdAt: true, signedAt: true } });
    let denominator = 0, numerator = 0, pending = 0;
    for (const r of rows) {
      if (!r.signedAt && now.getTime() < r.createdAt.getTime() + D) { pending++; continue; }
      denominator++;
      if (r.signedAt && r.signedAt.getTime() - r.createdAt.getTime() <= D) numerator++;
    }
    if (!(denominator > 0)) return { available: false, supplierKey: key, reason: 'NO_SAMPLE', numerator: 0, detail: { pending } };
    return { available: true, supplierKey: key, numerator, denominator, evidence: { window, source: 'encounters', days: QI_ENCOUNTER_SIGN_DAYS, excluded: { pending } } };
  }

  /** 방사선 조사 기록자 기재율 — 조사 완료(DELIVERED) 분할 중 치료사가 남은 것 */
  private async supplyRadiationRecorder(key: QiSupplierKey, range: SupplyRange, window: { from: string; to: string }): Promise<SupplyResult> {
    const where = { status: 'DELIVERED', deliveredAt: { gte: range.from, lt: range.to } };
    const [denominator, numerator] = await Promise.all([
      this.prisma.radiationFraction.count({ where }),
      this.prisma.radiationFraction.count({ where: { ...where, therapistId: { not: null } } }),
    ]);
    if (!(denominator > 0)) return { available: false, supplierKey: key, reason: 'NO_SAMPLE', numerator };
    return { available: true, supplierKey: key, numerator, denominator, evidence: { window, source: 'radiation_fractions(DELIVERED)' } };
  }

  /**
   * 서류 발급 처리 기한 준수율 — 🔴 기한은 원내 규정(설정 qi.docIssuance.slaHours · 1~720). 미설정이면 산출하지 않는다
   * (신청 행의 slaDueAt 은 코드 고정 3일이라 규정이 아니다). 반려는 빼고 · 기한이 아직 안 온 미발급은 빼고.
   */
  private async supplyDocSla(key: QiSupplierKey, range: SupplyRange, window: { from: string; to: string }, now: Date = new Date()): Promise<SupplyResult> {
    const raw = Number(await this.cfg('qi.docIssuance.slaHours'));
    const hours = Number.isInteger(raw) && raw >= 1 && raw <= 720 ? raw : null;
    const rows = await this.prisma.documentRequest.findMany({ where: { createdAt: { gte: range.from, lt: range.to } }, select: { createdAt: true, completedAt: true, status: true } });
    if (hours == null) return { available: false, supplierKey: key, reason: 'SLA_POLICY_UNSET', numerator: null, detail: { requests: rows.length } };
    const H = hours * 3_600_000;
    let denominator = 0, numerator = 0, rejected = 0, pending = 0;
    for (const r of rows) {
      if (r.status === 'REJECTED') { rejected++; continue; }
      if (!r.completedAt && now.getTime() < r.createdAt.getTime() + H) { pending++; continue; }
      denominator++;
      if (r.completedAt && r.completedAt.getTime() - r.createdAt.getTime() <= H) numerator++;
    }
    if (!(denominator > 0)) return { available: false, supplierKey: key, reason: 'NO_SAMPLE', numerator: 0, detail: { rejected, pending } };
    return { available: true, supplierKey: key, numerator, denominator, evidence: { window, source: 'document_requests(completed_at)', slaHours: hours, excluded: { rejected, pending } } };
  }

  /** 무선 측위 방 확정률 — 관측(OBSERVED_WIFI)만 · 🔴 수집 설정이 꺼져 있으면 산출 불가(시뮬레이션으로 채우지 않는다) */
  private async supplyWifiObserved(key: QiSupplierKey, range: SupplyRange, window: { from: string; to: string }): Promise<SupplyResult> {
    if ((await this.cfg('location.wifi.enabled')) !== true) return { available: false, supplierKey: key, reason: 'WIFI_COLLECTION_OFF', numerator: null };
    const where = { source: 'OBSERVED_WIFI', observedAt: { gte: range.from, lt: range.to } };
    const [denominator, numerator] = await Promise.all([
      this.prisma.wifiPositionFix.count({ where }),
      this.prisma.wifiPositionFix.count({ where: { ...where, granularity: 'ZONE' } }),
    ]);
    if (!(denominator > 0)) return { available: false, supplierKey: key, reason: 'NO_SAMPLE', numerator };
    return { available: true, supplierKey: key, numerator, denominator, evidence: { window, source: 'wifi_position_fixes(OBSERVED_WIFI)' } };
  }

  /**
   * 통증 재평가 기한 내 수행률(2026-10-27) — 판정은 shared `painReassessOutcomes`(사건마다 · 사건 뒤 첫 통증 기록이 기한 안인가).
   *  · 🔴 기준·기한은 원내 규정 `nursing.pain.reassessRule` — 미설정·조회 실패면 산출하지 않는다(기준을 지어내지 않는다)
   *  · 규정 출처(원내 설정/개발 시드)를 근거에 남긴다 — 개발 시드 규정으로 낸 값을 원내 규정 값처럼 읽지 않게
   *  · 통증 기록 = 입원 활력 두 원장 + 간호 초기평가 · 진통제 = 약품 효능 분류(분류 모르는 투약은 넣지 않고 센다)
   *  · 기간 뒤 재평가도 봐야 하므로 기록은 기간 끝 + 최대 기한까지 읽는다
   */
  private async supplyPainReassess(key: QiSupplierKey, range: SupplyRange, window: { from: string; to: string }, now: Date = new Date()): Promise<SupplyResult> {
    const { rule, source } = await readPainReassessRule(this.config);
    if (!rule) return { available: false, supplierKey: key, reason: source === 'UNKNOWN' ? 'PAIN_RULE_UNKNOWN' : 'PAIN_RULE_UNSET', numerator: null };
    const tail = Math.max(rule.withinMinutes, rule.afterAnalgesicMinutes ?? 0) * 60_000;
    const readTo = new Date(Math.min(range.to.getTime() + tail, now.getTime()));
    const admissions = await this.prisma.admission.findMany({
      where: { status: { not: 'CANCELLED' }, admitDate: { lt: range.to }, OR: [{ dischargeDate: null }, { dischargeDate: { gte: range.from } }] },
      select: { id: true, patientId: true, admitDate: true, dischargeDate: true },
    });
    if (!admissions.length) return { available: false, supplierKey: key, reason: 'NO_SAMPLE', numerator: 0 };
    const ids = admissions.map((a) => a.id);
    const [rows, assessments, mar] = await Promise.all([
      new AdmissionVitalsReader(this.prisma).rows(admissions, { gte: range.from, lt: readTo }, 50_000),
      this.prisma.nursingAssessment.findMany({ where: { admissionId: { in: ids }, assessedAt: { gte: range.from, lt: readTo } }, select: { admissionId: true, assessedAt: true, painScore: true } }),
      rule.afterAnalgesicMinutes == null
        ? Promise.resolve([])
        : this.prisma.medicationAdministration.findMany({
          where: { patientId: { in: admissions.map((a) => a.patientId) }, status: 'ADMINISTERED', administeredAt: { gte: range.from, lt: range.to } },
          select: { patientId: true, administeredAt: true, prescription: { select: { medicationCode: { select: { category: true, highAlertCategory: true } } } } },
        }),
    ]);
    const pain = new Map<string, PainRecordEvent[]>();
    const add = (id: string, e: PainRecordEvent) => pain.set(id, [...(pain.get(id) ?? []), e]);
    for (const r of rows) if (r.painScore != null) add(r.admissionId, { at: r.at, score: r.painScore });
    for (const a of assessments) add(a.admissionId, { at: a.assessedAt, score: a.painScore });
    const analgesics = new Map<string, AnalgesicEvent[]>();
    let unclassified = 0;
    for (const m of mar) {
      if (!m.administeredAt) continue;
      const adm = admissions.find((a) => a.patientId === m.patientId && m.administeredAt! >= a.admitDate && (!a.dischargeDate || m.administeredAt! < a.dischargeDate));
      if (!adm) continue;
      const yes = isAnalgesicMed(m.prescription?.medicationCode ?? null);
      if (yes == null) { unclassified++; continue; }
      if (yes) analgesics.set(adm.id, [...(analgesics.get(adm.id) ?? []), { at: m.administeredAt, name: null }]);
    }
    const sum = { onTime: 0, late: 0, never: 0, pending: 0, endedBeforeDue: 0 };
    for (const a of admissions) {
      const o = painReassessOutcomes(rule, pain.get(a.id) ?? [], analgesics.get(a.id) ?? [], range, now, a.dischargeDate);
      for (const k of Object.keys(sum) as Array<keyof typeof sum>) sum[k] += o[k];
    }
    const denominator = sum.onTime + sum.late + sum.never;
    const excluded = { pending: sum.pending, endedBeforeDue: sum.endedBeforeDue, unclassifiedAdministrations: unclassified };
    if (!(denominator > 0)) return { available: false, supplierKey: key, reason: 'NO_SAMPLE', numerator: 0, detail: excluded };
    return {
      available: true, supplierKey: key, numerator: sum.onTime, denominator,
      evidence: { window, source: 'flow_sheet_entries·pre_visit_vitals(재원 중)·nursing_assessments·medication_administrations', rule, ruleSource: source, excluded, missed: { late: sum.late, never: sum.never } },
    };
  }

  /**
   * 낙상·욕창 위험 재평가 기한 내 수행률(2026-10-27) — 판정 shared `riskReassessOutcomes`(평가마다 · 그 등급 주기 안에 같은 유형 다음 평가).
   *  · 주기 = 원내 규정(비면 코드 기본값) — 🔴 **지금 규정**으로 지난 달을 잰다(규정 이력이 없다) · 근거에 표·출처를 남긴다
   *  · 낙상 = 낙상 평가 원장 · 욕창 = 간호 초기평가 Braden + 임상 도구 Braden 결과(초기평가가 남긴 같은 결과는 한 번만)
   *  · 점수 범위 밖 평가는 등급을 지어내지 않고 뺀다(수는 근거에)
   */
  private async supplyRiskReassess(key: QiSupplierKey, range: SupplyRange, window: { from: string; to: string }, now: Date = new Date()): Promise<SupplyResult> {
    const { table, source } = await readRiskReassessIntervals(this.config);
    const maxH = Math.max(...Object.values(table).flatMap((r) => Object.values(r)));
    const readTo = new Date(Math.min(range.to.getTime() + maxH * 3_600_000, now.getTime()));
    const admissions = await this.prisma.admission.findMany({
      where: { status: { not: 'CANCELLED' }, admitDate: { lt: range.to }, OR: [{ dischargeDate: null }, { dischargeDate: { gte: range.from } }] },
      select: { id: true, patientId: true, admitDate: true, dischargeDate: true },
    });
    if (!admissions.length) return { available: false, supplierKey: key, reason: 'NO_SAMPLE', numerator: 0 };
    const pids = admissions.map((a) => a.patientId);
    const [falls, initials, bradenTool] = await Promise.all([
      this.prisma.fallRiskAssessment.findMany({ where: { patientId: { in: pids }, assessedAt: { gte: range.from, lt: readTo } }, select: { patientId: true, assessedAt: true, score: true } }),
      this.prisma.nursingAssessment.findMany({ where: { admissionId: { in: admissions.map((a) => a.id) }, bradenScore: { not: null }, assessedAt: { gte: range.from, lt: readTo } }, select: { admissionId: true, assessedAt: true, bradenScore: true } }),
      this.prisma.clinicalChartResult.findMany({ where: { patientId: { in: pids }, chartId: 'BRADEN', performedAt: { gte: range.from, lt: readTo } }, select: { patientId: true, performedAt: true, resultValue: true, inputs: true } }),
    ]);
    const stayOf = (patientId: string, at: Date) => admissions.find((a) => a.patientId === patientId && at >= a.admitDate && (!a.dischargeDate || at < a.dischargeDate));
    const ev = new Map<string, RiskAssessmentEvent[]>();
    const push = (k: string, e: RiskAssessmentEvent) => ev.set(k, [...(ev.get(k) ?? []), e]);
    let outOfRange = 0;
    for (const f of falls) {
      const a = stayOf(f.patientId, f.assessedAt); if (!a) continue;
      const level = morseRiskLevel(f.score); if (!level) { outOfRange++; continue; }
      push(`${a.id}|FALL_RISK`, { at: f.assessedAt, level });
    }
    for (const n of initials) {
      const level = bradenRiskLevel(n.bradenScore); if (!level) { outOfRange++; continue; }
      push(`${n.admissionId}|PRESSURE_ULCER`, { at: n.assessedAt, level });
    }
    for (const c of bradenTool) {
      // 간호 초기평가가 함께 남긴 결과는 같은 평가다 — 두 번 세지 않는다
      if ((c.inputs as { nursingAssessmentId?: unknown } | null)?.nursingAssessmentId) continue;
      const a = stayOf(c.patientId, c.performedAt); if (!a) continue;
      const level = bradenRiskLevel(c.resultValue == null ? null : Number(c.resultValue)); if (!level) { outOfRange++; continue; }
      push(`${a.id}|PRESSURE_ULCER`, { at: c.performedAt, level });
    }
    const sum = { onTime: 0, late: 0, never: 0, pending: 0, endedBeforeDue: 0 };
    const byType = { FALL_RISK: { onTime: 0, denominator: 0 }, PRESSURE_ULCER: { onTime: 0, denominator: 0 } };
    for (const [k, list] of ev) {
      const [admissionId, type] = k.split('|') as [string, 'FALL_RISK' | 'PRESSURE_ULCER'];
      const a = admissions.find((x) => x.id === admissionId)!;
      const o = riskReassessOutcomes(table[type], list, range, now, a.dischargeDate);
      for (const f of Object.keys(sum) as Array<keyof typeof sum>) sum[f] += o[f];
      byType[type].onTime += o.onTime; byType[type].denominator += o.onTime + o.late + o.never;
    }
    const denominator = sum.onTime + sum.late + sum.never;
    const excluded = { pending: sum.pending, endedBeforeDue: sum.endedBeforeDue, outOfRangeScore: outOfRange };
    if (!(denominator > 0)) return { available: false, supplierKey: key, reason: 'NO_SAMPLE', numerator: 0, detail: excluded };
    return {
      available: true, supplierKey: key, numerator: sum.onTime, denominator,
      evidence: { window, source: 'fall_risk_assessments·nursing_assessments(braden)·clinical_chart_results(BRADEN)', intervals: table, intervalSource: source, intervalsAsOf: 'NOW', byType, excluded, missed: { late: sum.late, never: sum.never } },
    };
  }

  /**
   * 간호초기평가 24시간 내 완료율(2026-10-10) — 입원 원장 × 간호초기평가 원장.
   *  · 분모: 입원 시각이 기간 안 · 취소 제외 · **24시간 이상 머문 입원**(퇴원 시각 − 입원 ≥ 24h, 재원 중이면 지금이 입원+24h 이후)
   *  · 분자: 그중 [입원 시각, +24h] 안에 평가가 하나라도 있는 입원 — 늦은 평가·입원 전 평가는 넣지 않는다
   *  · 24시간이 아직 안 지난 재원·24시간 미만 퇴원은 분모에서 빼고 수를 근거에 남긴다(평가 기회가 끝나지 않았거나 없었다)
   */
  private async supplyNursingInitial(key: QiSupplierKey, range: SupplyRange, window: { from: string; to: string }, now: Date = new Date()): Promise<SupplyResult> {
    const H = NURSING_INITIAL_ASSESSMENT_HOURS * 3_600_000;
    const admissions = await this.prisma.admission.findMany({
      where: { admitDate: { gte: range.from, lt: range.to }, status: { not: 'CANCELLED' } },
      select: { id: true, admitDate: true, dischargeDate: true, nursingAssessments: { select: { assessedAt: true } } },
    });
    let pending = 0; let shortStay = 0; let late = 0; let never = 0;
    const eligible = admissions.filter((a) => {
      const due = a.admitDate.getTime() + H;
      if (a.dischargeDate) { if (a.dischargeDate.getTime() < due) { shortStay++; return false; } } // 기한 시각과 비교(재원일수 계산 아님)
      else if (now.getTime() < due) { pending++; return false; }
      return true;
    });
    let numerator = 0;
    for (const a of eligible) {
      const t0 = a.admitDate.getTime();
      const times = a.nursingAssessments.map((x) => x.assessedAt.getTime());
      if (times.some((t) => t >= t0 && t <= t0 + H)) numerator++;
      else if (times.some((t) => t > t0 + H)) late++;
      else never++;
    }
    if (!(eligible.length > 0)) return { available: false, supplierKey: key, reason: 'NO_SAMPLE', numerator: 0, detail: { pending, shortStay } };
    return {
      available: true, supplierKey: key, numerator, denominator: eligible.length,
      evidence: { window, numeratorSource: 'nursing_assessments', denominatorSource: 'admissions(취소 제외 · 24시간 이상)', hours: NURSING_INITIAL_ASSESSMENT_HOURS, excluded: { pending, shortStay }, missed: { late, never } },
    };
  }

  /**
   * 병동 층(QI 흐름 2026-10-09) — 사고율을 병동별로. 분모는 그 병동의 재원일수 스냅샷, 분자는 **병동이 기록된** 사고만.
   * 🔴 분모 기준이 재원일수(PATIENT_DAYS)이고 그 기간 스냅샷이 다 찼을 때만 낸다(입원 건수 기준은 병동 귀속 규칙이 없다).
   * 🔴 병동이 비어 있는 사고는 어느 병동에도 넣지 않는다 — 수만 따로 센다(지어 배정하지 않는다).
   */
  async supplyWardStrata(key: QiSupplierKey, range: SupplyRange): Promise<{ strata: Array<{ wardKey: string; numerator: number; denominator: number }>; unassignedIncidents: number; reason: string | null }> {
    const def = QI_SUPPLIERS[key];
    if (def.kind !== 'INCIDENT_RATE') return { strata: [], unassignedIncidents: 0, reason: 'NOT_STRATIFIABLE' };
    if ((await this.incidentDenominatorBasis()) !== 'PATIENT_DAYS') return { strata: [], unassignedIncidents: 0, reason: 'DENOMINATOR_UNSET' };
    const pd = await this.patientDays(range);
    if (pd.coveredDays < pd.days) return { strata: [], unassignedIncidents: 0, reason: 'PATIENT_DAYS_INCOMPLETE' };
    const types = rawTypeAliases(def.incidentType as IncidentType);
    const keys = this.dayKeys(range);
    const [days, incidents] = await Promise.all([
      this.prisma.patientDaySnapshot.groupBy({
        by: ['wardKey'], _sum: { patientDays: true },
        where: { date: { gte: dateOnlyValue(keys[0])!, lte: dateOnlyValue(keys[keys.length - 1])! }, wardKey: { not: '' } },
      }),
      this.prisma.safetyIncident.groupBy({
        by: ['wardId'], _count: { _all: true },
        where: { type: { in: types }, occurredAt: { gte: range.from, lt: range.to } },
      }),
    ]);
    const byWard = new Map(incidents.filter((x) => x.wardId).map((x) => [x.wardId as string, x._count._all]));
    const unassignedIncidents = incidents.filter((x) => !x.wardId).reduce((n, x) => n + x._count._all, 0);
    const strata = days
      .map((d) => ({ wardKey: d.wardKey, numerator: byWard.get(d.wardKey) ?? 0, denominator: d._sum.patientDays ?? 0 }))
      .filter((x) => x.denominator > 0);
    return { strata, unassignedIncidents, reason: null };
  }

  /** 지표 단위 호출 — 공급원이 없으면 NO_SUPPLIER */
  async supplyForIndicator(indicator: { name: string; supplierKey?: string | null }, range: SupplyRange): Promise<SupplyResult> {
    const key = this.supplierOf(indicator);
    if (!key) return { available: false, supplierKey: null, reason: 'NO_SUPPLIER', numerator: null };
    return this.supply(key, range);
  }
}

/**
 * 원장 행 → 기간 기구일수. 기간의 각 날(로컬)마다 **다음 날 0시**에 꽂혀 있는 기구를 센다
 * (삽입 < 그 시각 ≤ 제거 · 제거 없음은 아직 꽂혀 있음) — 재원일수 스냅샷과 같은 자정 규약.
 */
export function ledgerDeviceDays(rows: Array<{ insertedAt: Date; removedAt: Date | null }>, range: SupplyRange): number {
  let total = 0;
  const d = new Date(range.from.getFullYear(), range.from.getMonth(), range.from.getDate());
  while (d < range.to) {
    const instant = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
    for (const r of rows) if (r.insertedAt < instant && (r.removedAt == null || r.removedAt >= instant)) total++;
    d.setDate(d.getDate() + 1);
  }
  return total;
}
