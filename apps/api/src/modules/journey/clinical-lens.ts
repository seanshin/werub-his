/**
 * 의료진 관점 여정(2026-10-01 사람 요청) — 오더·처방·위급값의 **단계 이력**과 질관리 점검을 한 화면 분량으로 조립한다(순수 함수).
 *
 * 원칙
 *  · 근거는 여정 원장이 아니라 **도메인 원장의 단계 시각 필드**다(Order·LabResult·ImagingResult·Dispensing·MAR·CriticalValueAlert).
 *    단계 시각이 없으면 `null` — 추정해 채우지 않는다(예: 처방 취소는 시각 필드가 없다).
 *  · 소요 시간은 **양 끝 시각이 모두 있을 때만** 잰다. 요약은 중앙값과 표본 수를 함께 낸다(표본 0 → null).
 *  · 질관리 점검은 **수와 분모**만 낸다 — "지연"이라 판정하는 임계(원내 정책)는 지어내지 않는다.
 *  · 🔴 검체 채취 시각은 검사실 접수 순간과 같은 값으로 찍힌다(lab.service 접수 경로) — 화면이 그 사실을 밝힌다(`collectedSameAsReceived`).
 */
import { isAbnormalFlag, isCriticalFlag, dosingWindow, type DosingWindow } from '@hospital-run/shared';

export type LensDept = 'LAB' | 'IMAGING' | 'PHARMACY' | 'THERAPY';
export type StageKey =
  | 'ORDERED' | 'RECEIVED' | 'COLLECTED' | 'STARTED' | 'ACQUIRED' | 'RESULTED' | 'REPORTED' | 'VERIFIED'
  | 'DISPENSED' | 'ISSUED' | 'COMPLETED' | 'ACKNOWLEDGED' | 'CANCELLED';

export interface LensStage { key: StageKey; at: string | null }

export interface LensOrderInput {
  id: string;
  department: string;
  status: string;
  priority: string;
  createdAt: Date;
  receivedAt: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
  acknowledgedAt: Date | null;
  /** (2026-10-01) 오더에 기록된 검체 채취 — 정본 */
  specimenCollectedAt?: Date | null;
  specimenCollectionSource?: string | null;
  prescription: { type: string; medicationCode?: { nameKo: string } | null; procedureCode?: { nameKo: string } | null } | null;
  labResult?: { status: string; collectedAt: Date | null; completedAt: Date | null; verifiedAt: Date | null; items: { flag: string | null }[] } | null;
  imagingResult?: { status: string; acquiredAt: Date | null; reportedAt: Date | null } | null;
  dispensing?: { status: string; dispensedAt: Date | null; verifiedAt: Date | null; issuedAt: Date | null } | null;
}

export interface LensPrescriptionInput {
  id: string;
  type: string;
  status: string;
  priority: string;
  createdAt: Date;
  duration: number | null;
  dosage: string | null;
  frequency: string | null;
  orderSource: string;
  readBackConfirmedAt: Date | null;
  prescriberCosignedAt: Date | null;
  durChecked: boolean;
  durOverridden: boolean;
  durWarnings: unknown;
  discontinuedAt: Date | null;
  discontinueReason: string | null;
  renewedFromId: string | null;
  dischargeMed?: boolean | null;
  medicationCode?: { nameKo: string } | null;
  procedureCode?: { nameKo: string } | null;
  medAdmins: { status: string; scheduledAt: Date; administeredAt: Date | null }[];
}

export interface LensCriticalInput {
  id: string;
  testName: string;
  value: string;
  unit: string;
  status: string;
  notifiedAt: Date;
  escalatedAt: Date | null;
  acknowledgedAt: Date | null;
  actedAt: Date | null;
  closedAt: Date | null;
}

/** 표본이 있는 값 — 표본 0 이면 value=null */
export interface Sampled { value: number | null; n: number }
/** 분자·분모 — 분모 0 이면 화면이 산출 불가로 그린다 */
export interface Ratio { numerator: number; denominator: number }

const iso = (d: Date | null | undefined) => (d instanceof Date && !Number.isNaN(d.getTime()) ? d.toISOString() : null);
const minutesBetween = (a: Date | null | undefined, b: Date | null | undefined): number | null =>
  a instanceof Date && b instanceof Date && !Number.isNaN(a.getTime()) && !Number.isNaN(b.getTime()) ? (b.getTime() - a.getTime()) / 60_000 : null;

/** 중앙값(분, 정수 반올림 없이 그대로 — 표시 쪽이 Duration 으로 그린다) · 표본 0 → null */
export function medianOf(values: (number | null)[]): Sampled {
  const xs = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v)).sort((a, b) => a - b);
  if (!xs.length) return { value: null, n: 0 };
  const m = xs.length >> 1;
  return { value: xs.length % 2 ? xs[m] : (xs[m - 1] + xs[m]) / 2, n: xs.length };
}

function orderName(o: LensOrderInput): string | null {
  return o.prescription?.procedureCode?.nameKo ?? o.prescription?.medicationCode?.nameKo ?? null;
}

/** 오더 한 건의 단계 — 부서마다 단계가 다르다. 시각이 없으면 null(그 단계에 도달하지 않았거나 기록이 없다) */
export function orderStages(o: LensOrderInput): LensStage[] {
  const s = (key: StageKey, at: Date | null | undefined): LensStage => ({ key, at: iso(at) });
  const head = [s('ORDERED', o.createdAt), s('RECEIVED', o.receivedAt)];
  let mid: LensStage[];
  switch (o.department) {
    case 'LAB':
      mid = [
        // 정본은 오더의 채취 기록 — 없으면 과거 경로가 남긴 결과 행 값(접수 순간일 수 있다 · `collectedSameAsReceived` 가 밝힌다)
        s('COLLECTED', o.specimenCollectedAt ?? o.labResult?.collectedAt),
        s('RESULTED', o.labResult?.completedAt ?? o.completedAt),
        s('VERIFIED', o.labResult?.verifiedAt),
        s('ACKNOWLEDGED', o.acknowledgedAt),
      ];
      break;
    case 'IMAGING':
      mid = [s('ACQUIRED', o.imagingResult?.acquiredAt), s('REPORTED', o.imagingResult?.reportedAt ?? o.completedAt), s('ACKNOWLEDGED', o.acknowledgedAt)];
      break;
    case 'PHARMACY':
      mid = [s('DISPENSED', o.dispensing?.dispensedAt), s('VERIFIED', o.dispensing?.verifiedAt), s('ISSUED', o.dispensing?.issuedAt)];
      break;
    default:
      mid = [s('STARTED', o.startedAt), s('COMPLETED', o.completedAt)];
  }
  const out = [...head, ...mid];
  if (o.cancelledAt || o.status === 'CANCELLED') out.push(s('CANCELLED', o.cancelledAt));
  return out;
}

/** 결과 시각 — 검사는 결과(예비) 시각, 영상은 판독 시각 */
function resultAt(o: LensOrderInput): Date | null {
  if (o.department === 'LAB') return o.labResult?.completedAt ?? o.completedAt ?? null;
  if (o.department === 'IMAGING') return o.imagingResult?.reportedAt ?? o.completedAt ?? null;
  return o.completedAt ?? null;
}

export interface LensOrder {
  id: string;
  department: string;
  name: string | null;
  status: string;
  priority: string;
  stages: LensStage[];
  /** 오더 → 결과(분) · 결과 → 의사 확인(분) — 양 끝이 있을 때만 */
  orderToResultMin: number | null;
  resultToAckMin: number | null;
  critical: boolean;
  abnormal: boolean;
  /** 결과가 나왔는데 의사가 확인하지 않음(검사·영상 · 결과 확인함과 같은 조건) */
  unacknowledged: boolean;
  /** 접수 전(ORDERED) — 경과 분 */
  waitingSinceMin: number | null;
  /** 채취 기록이 없고 결과 행의 채취 값이 접수 순간과 같다(과거 경로 — 접수를 채취로 찍었다) */
  collectedSameAsReceived: boolean;
  /** 검사 오더의 채취 기록 출처 — 없으면 null(기록 없음) */
  collectionSource: string | null;
  /** 채취 → 검사실 접수(분) — 둘 다 있을 때만 */
  collectionToReceiptMin: number | null;
}

export interface LensPrescription {
  id: string;
  type: string;
  name: string | null;
  status: string;
  priority: string;
  createdAt: string;
  dosage: string | null;
  frequency: string | null;
  dosing: DosingWindow;
  orderSource: string;
  /** 구두·전화 처방 — 복창·처방의 사후 확인 */
  verbal: { readBackAt: string | null; cosignedAt: string | null } | null;
  dur: { checked: boolean; overridden: boolean; warnings: number };
  discontinuedAt: string | null;
  discontinueReason: string | null;
  renewedFromId: string | null;
  dischargeMed: boolean;
  mar: {
    total: number;
    administered: number;
    held: number;
    refused: number;
    missed: number;
    /** 예정 시각이 지났는데 아직 기록 없음(SCHEDULED) */
    pastDueUnrecorded: number;
    /** 투약 기록 시각 − 예정 시각(분) 중앙값 — 음수는 이른 투약 */
    delayMedianMin: Sampled;
  };
}

export interface LensCritical {
  id: string;
  testName: string;
  value: string;
  unit: string;
  status: string;
  notifiedAt: string;
  acknowledgedAt: string | null;
  actedAt: string | null;
  escalatedAt: string | null;
  closedAt: string | null;
  toAckMin: number | null;
}

export interface ClinicalLens {
  period: { from: string; to: string };
  orders: LensOrder[];
  prescriptions: LensPrescription[];
  criticals: LensCritical[];
  truncated: { orders: boolean; prescriptions: boolean; criticals: boolean };
  quality: {
    /** 결과 확인 — 결과가 나온 검사·영상 중 의사 확인 */
    resultAck: Ratio;
    resultToAckMin: Sampled;
    /** 오더 → 결과 중앙값(부서별) */
    orderToResultMin: { LAB: Sampled; IMAGING: Sampled };
    /** 검체 채취 기록 — 검사실에 접수된 검사 오더 중 채취가 따로 기록된 것 · 채취→접수 중앙값 */
    specimenCollection: Ratio;
    collectionToReceiptMin: Sampled;
    /** 접수 대기(ORDERED) 건수와 가장 오래 기다린 분 */
    awaitingReceipt: { n: number; oldestMin: number | null };
    critical: { total: number; unacknowledged: number; toAckMin: Sampled };
    verbal: { total: number; uncosigned: number };
    dur: { medications: number; checked: number; overridden: number };
    mar: { scheduledPast: number; recorded: number; pastDueUnrecorded: number; delayMin: Sampled };
    discontinued: number;
    renewed: number;
  };
}

export function buildClinicalLens(input: {
  orders: LensOrderInput[];
  prescriptions: LensPrescriptionInput[];
  criticals: LensCriticalInput[];
  period: { from: Date; to: Date };
  truncated: ClinicalLens['truncated'];
  now?: Date;
}): ClinicalLens {
  const now = input.now ?? new Date();

  const orders: LensOrder[] = input.orders.map((o) => {
    const flags = o.labResult?.items.map((i) => i.flag) ?? [];
    const rAt = resultAt(o);
    const cancelled = o.status === 'CANCELLED' || !!o.cancelledAt;
    const resultReady = (o.department === 'LAB' || o.department === 'IMAGING') && o.status === 'COMPLETED' && !cancelled;
    return {
      id: o.id,
      department: o.department,
      name: orderName(o),
      status: o.status,
      priority: o.priority,
      stages: orderStages(o),
      orderToResultMin: cancelled ? null : minutesBetween(o.createdAt, rAt),
      resultToAckMin: cancelled ? null : minutesBetween(rAt, o.acknowledgedAt),
      critical: flags.some((f) => isCriticalFlag(f)),
      abnormal: flags.some((f) => isAbnormalFlag(f)),
      unacknowledged: resultReady && !o.acknowledgedAt,
      waitingSinceMin: o.status === 'ORDERED' && !cancelled ? minutesBetween(o.createdAt, now) : null,
      collectedSameAsReceived:
        o.department === 'LAB' && !o.specimenCollectedAt && !!o.labResult?.collectedAt && !!o.receivedAt && o.labResult.collectedAt.getTime() === o.receivedAt.getTime(),
      collectionSource: o.department === 'LAB' ? (o.specimenCollectionSource ?? null) : null,
      collectionToReceiptMin: o.department === 'LAB' && o.specimenCollectedAt ? minutesBetween(o.specimenCollectedAt, o.receivedAt) : null,
    };
  });

  const prescriptions: LensPrescription[] = input.prescriptions.map((p) => {
    const marPast = p.medAdmins.filter((m) => m.scheduledAt.getTime() <= now.getTime());
    const warnings = Array.isArray(p.durWarnings) ? p.durWarnings.length : 0;
    const verbal = p.orderSource === 'VERBAL' || p.orderSource === 'TELEPHONE';
    return {
      id: p.id,
      type: p.type,
      name: p.medicationCode?.nameKo ?? p.procedureCode?.nameKo ?? null,
      status: p.status,
      priority: p.priority,
      createdAt: p.createdAt.toISOString(),
      dosage: p.dosage,
      frequency: p.frequency,
      dosing: dosingWindow({ createdAt: p.createdAt, duration: p.duration, discontinuedAt: p.discontinuedAt }, now),
      orderSource: p.orderSource,
      verbal: verbal ? { readBackAt: iso(p.readBackConfirmedAt), cosignedAt: iso(p.prescriberCosignedAt) } : null,
      dur: { checked: p.durChecked, overridden: p.durOverridden, warnings },
      discontinuedAt: iso(p.discontinuedAt),
      discontinueReason: p.discontinueReason,
      renewedFromId: p.renewedFromId,
      dischargeMed: !!p.dischargeMed,
      mar: {
        total: p.medAdmins.length,
        administered: p.medAdmins.filter((m) => m.status === 'ADMINISTERED').length,
        held: p.medAdmins.filter((m) => m.status === 'HELD').length,
        refused: p.medAdmins.filter((m) => m.status === 'REFUSED').length,
        missed: p.medAdmins.filter((m) => m.status === 'MISSED').length,
        pastDueUnrecorded: marPast.filter((m) => m.status === 'SCHEDULED').length,
        delayMedianMin: medianOf(p.medAdmins.filter((m) => m.status === 'ADMINISTERED').map((m) => minutesBetween(m.scheduledAt, m.administeredAt))),
      },
    };
  });

  const criticals: LensCritical[] = input.criticals.map((c) => ({
    id: c.id, testName: c.testName, value: c.value, unit: c.unit, status: c.status,
    notifiedAt: c.notifiedAt.toISOString(), acknowledgedAt: iso(c.acknowledgedAt), actedAt: iso(c.actedAt),
    escalatedAt: iso(c.escalatedAt), closedAt: iso(c.closedAt), toAckMin: minutesBetween(c.notifiedAt, c.acknowledgedAt),
  }));

  const resultable = orders.filter((o) => (o.department === 'LAB' || o.department === 'IMAGING') && o.status === 'COMPLETED');
  const awaiting = orders.filter((o) => o.waitingSinceMin != null);
  const meds = input.prescriptions.filter((p) => p.type === 'MEDICATION');
  const allMar = input.prescriptions.flatMap((p) => p.medAdmins);
  const marPast = allMar.filter((m) => m.scheduledAt.getTime() <= now.getTime());

  return {
    period: { from: input.period.from.toISOString(), to: input.period.to.toISOString() },
    orders,
    prescriptions,
    criticals,
    truncated: input.truncated,
    quality: {
      resultAck: { numerator: resultable.filter((o) => !o.unacknowledged).length, denominator: resultable.length },
      resultToAckMin: medianOf(resultable.map((o) => o.resultToAckMin)),
      orderToResultMin: {
        LAB: medianOf(orders.filter((o) => o.department === 'LAB').map((o) => o.orderToResultMin)),
        IMAGING: medianOf(orders.filter((o) => o.department === 'IMAGING').map((o) => o.orderToResultMin)),
      },
      specimenCollection: (() => {
        const rec = input.orders.filter((o) => o.department === 'LAB' && o.receivedAt && o.status !== 'CANCELLED');
        return { numerator: rec.filter((o) => o.specimenCollectedAt).length, denominator: rec.length };
      })(),
      collectionToReceiptMin: medianOf(orders.map((o) => o.collectionToReceiptMin)),
      awaitingReceipt: { n: awaiting.length, oldestMin: awaiting.length ? Math.max(...awaiting.map((o) => o.waitingSinceMin!)) : null },
      critical: {
        total: criticals.length,
        unacknowledged: criticals.filter((c) => !c.acknowledgedAt).length,
        toAckMin: medianOf(criticals.map((c) => c.toAckMin)),
      },
      verbal: {
        total: prescriptions.filter((p) => p.verbal).length,
        uncosigned: prescriptions.filter((p) => p.verbal && !p.verbal.cosignedAt && p.status !== 'CANCELLED').length,
      },
      dur: { medications: meds.length, checked: meds.filter((p) => p.durChecked).length, overridden: meds.filter((p) => p.durOverridden).length },
      mar: {
        scheduledPast: marPast.length,
        recorded: marPast.filter((m) => m.status !== 'SCHEDULED').length,
        pastDueUnrecorded: marPast.filter((m) => m.status === 'SCHEDULED').length,
        delayMin: medianOf(allMar.filter((m) => m.status === 'ADMINISTERED').map((m) => minutesBetween(m.scheduledAt, m.administeredAt))),
      },
      discontinued: prescriptions.filter((p) => p.status === 'DISCONTINUED').length,
      renewed: prescriptions.filter((p) => p.renewedFromId).length,
    },
  };
}
