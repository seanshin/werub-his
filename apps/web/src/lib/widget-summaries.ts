/**
 * 대시보드 위젯 응답 파서 정본 (2026-08-14 · 화면 점검 W8 · R8 · P11/P12)
 *
 * 🔴 배경 — `ApiStatsWidget` 은 `data[key]` 로 서버 응답에서 값을 꺼내고 없으면 `val ?? '-'` 로 그린다.
 *    그래서 **키 이름이 틀리면 화면은 조용히 영구 `-`** 가 되고, 아무도 그것이 결함인 줄 모른다
 *    (조회는 200 OK, 로그도 깨끗하다). W3 에서 `claims` 위젯 하나만 `lib/claims-summary.ts` 로
 *    수렴시켰고 나머지는 그대로 갈라져 있었다 — 여기서 한 벌로 모은다.
 *
 * 규약
 *  1. **없는 값을 0 으로 만들지 않는다.** 서버가 주지 않는 사실(예: 혈액 Rh, ADR 이번달)은
 *     칸을 없애거나 `null`(→ '-')로 둔다. 0 은 "관측했는데 없었다"는 뜻이다(P1).
 *  2. **비율의 분모가 0 이면 `null`(산출 불가)**. `/executive` 서버 규약과 같다.
 *  3. **서버가 이미 계산한 값을 FE 가 다시 만들지 않는다.** 이름만 다르면 이름만 잇는다(P12).
 *  4. 라벨은 **기간·집합**을 밝힌다. 같은 '미수납'이라도 EP 마다 집합이 다르다.
 */

/** 안전한 배열 캐스팅 — 서버가 groupBy 배열을 주는 EP 들이 있다 */
function rows<T>(raw: unknown): T[] {
  return Array.isArray(raw) ? (raw as T[]) : [];
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// ────────────────────────────────────────────────────────────────
// 1. 병상 현황 — GET /api/v1/beds/status
//    서버: { total, byStatus: [{ status, _count }] }
//    🔴 위젯은 occupied·available·occupancyRate 를 읽었으나 **셋 다 응답에 없어** 영구 '-' 였다.
// ────────────────────────────────────────────────────────────────
export interface BedStatusSummary {
  total: number;
  occupied: number;
  available: number;
  /** 등록 병상이 0 이면 0% 가 아니라 산출 불가(null) — /executive `bedOccupancyPct` 와 같은 규약 */
  occupancyRate: number | null;
}

export function bedStatusSummary(raw: unknown): BedStatusSummary {
  const src = (raw ?? {}) as { total?: unknown; byStatus?: unknown };
  const by = rows<{ status?: string; _count?: unknown }>(src.byStatus);
  const of = (s: string) => num(by.find(b => b.status === s)?._count);
  const total = num(src.total);
  const occupied = of('OCCUPIED');
  return {
    total,
    occupied,
    available: of('AVAILABLE'),
    occupancyRate: total > 0 ? Math.round((occupied / total) * 100) : null,
  };
}

// ────────────────────────────────────────────────────────────────
// 2. 오늘 수납 — GET /api/v1/billing/cashier-stats
//    서버: { pendingCount, completedCount, deferredCount, totalRevenue }
//    🔴 위젯은 todayRevenue·todayCount·unpaidAmount·unpaidCount 를 읽어 **4칸 전부** 영구 '-' 였다.
//    🔴 이 EP 에는 **미수납 금액이 없다**. 0 원으로 지어내지 않고, 금액 정본
//       (/api/v1/executive/overview `unpaid.amount` = PENDING+PARTIAL+DEFERRED 잔액)에 맡긴다.
//       여기 `pendingCount` 는 PENDING **만** 세므로 라벨에 그 집합을 적는다.
// ────────────────────────────────────────────────────────────────
export interface CashierTodaySummary {
  todayRevenue: number;
  todayCount: number;
  pendingCount: number;
  deferredCount: number;
}

export function cashierTodaySummary(raw: unknown): CashierTodaySummary {
  const s = (raw ?? {}) as Record<string, unknown>;
  return {
    todayRevenue: num(s.totalRevenue),
    todayCount: num(s.completedCount),
    pendingCount: num(s.pendingCount),
    deferredCount: num(s.deferredCount),
  };
}

// ────────────────────────────────────────────────────────────────
// 3. 환자 흐름 — GET /api/v1/operational-stats/patient-flow
//    서버: { newAdmissions, dischargedToday, activePatients, netFlow }
//    🔴 위젯은 admitted·discharged 를 읽어 2칸 다 영구 '-' 였다.
//    🔴 `dischargedToday` 는 이름과 달리 **기본 조회창(최근 30일)** 의 퇴원 수다 — 라벨은 30일이라 말한다.
// ────────────────────────────────────────────────────────────────
export interface PatientFlowSummary {
  admitted: number;
  discharged: number;
  active: number;
  netFlow: number;
}

export function patientFlowSummary(raw: unknown): PatientFlowSummary {
  const s = (raw ?? {}) as Record<string, unknown>;
  return {
    admitted: num(s.newAdmissions),
    // 🔴 W9: 서버가 `dischargedToday` 를 **진짜 오늘**로 고치고, 창(기본 30일) 값은
    //    `dischargedInWindow` 로 분리했다. 종전에는 이름이 '오늘'인데 값이 창이라
    //    라벨을 "퇴원(30일)"로 우회하고 있었다 — 이제 창 값을 직접 읽어 라벨이 그대로 참이 된다.
    //    구버전 서버 호환을 위해 `dischargedToday` 폴백을 남긴다.
    discharged: num(s.dischargedInWindow ?? s.dischargedToday),
    active: num(s.activePatients),
    netFlow: num(s.netFlow),
  };
}

// ────────────────────────────────────────────────────────────────
// 4. 혈액 재고 — GET /api/v1/blood-bank/inventory/stats
//    서버: [{ productType, bloodType, status, count }]  ← groupBy 배열
//    🔴 위젯은 totalUnits·aPositive·bPositive·oPositive 를 평면 키로 읽어 4칸 전부 '-' 였다.
//    🔴 그리고 **A+/B+/O+ 는 이 응답으로 만들 수 없다** — groupBy 에 `rhFactor` 가 없어서
//       bloodType 은 ABO(`A`·`B`·`O`·`AB`)뿐이다. A(POS 5·NEG 1)를 "A+ 6"이라 적으면
//       수혈 적합성을 잘못 말하는 것이다 → Rh 를 참칭하지 않고 **상태별 재고**로 답한다.
// ────────────────────────────────────────────────────────────────
export interface BloodInventorySummary {
  totalUnits: number;
  availableUnits: number;
  reservedUnits: number;
  issuedUnits: number;
}

export function bloodInventorySummary(raw: unknown): BloodInventorySummary {
  const list = rows<{ status?: string; count?: unknown }>(raw);
  const sum = (pred: (s: string) => boolean) =>
    list.reduce((acc, r) => (pred(String(r.status ?? '')) ? acc + num(r.count) : acc), 0);
  return {
    totalUnits: sum(() => true),
    availableUnits: sum(s => s === 'AVAILABLE'),
    reservedUnits: sum(s => s === 'RESERVED'),
    issuedUnits: sum(s => s === 'ISSUED'),
  };
}

// ────────────────────────────────────────────────────────────────
// 5. ADR(약물이상반응) — GET /api/v1/pharmacy/adr/stats
//    서버: [{ suspectedDrugCode, severity, _count: { id } }]  ← groupBy 배열
//    🔴 위젯은 total·thisMonth·serious·resolved 를 읽어 4칸 전부 '-' 였다.
//    🔴 `thisMonth`(발생월)·`resolved`(outcome) 는 이 groupBy 에 **원천적으로 없다** —
//       0 으로 채우면 "이번달 ADR 없음"이라는 없는 사실을 만든다. 칸을 파생 가능한 것으로 바꾼다.
//       (severity 는 스키마상 MILD·MODERATE·SEVERE·FATAL 문자열)
// ────────────────────────────────────────────────────────────────
export interface AdrSummary {
  total: number;
  severe: number;
  moderate: number;
  drugs: number;
}

export function adrSummary(raw: unknown): AdrSummary {
  const list = rows<{ suspectedDrugCode?: string | null; severity?: string; _count?: { id?: unknown } | unknown }>(raw);
  const cnt = (r: (typeof list)[number]) => {
    const c = r._count as { id?: unknown } | number | undefined;
    return typeof c === 'number' ? c : num((c as { id?: unknown })?.id);
  };
  const drugs = new Set<string>();
  let total = 0, severe = 0, moderate = 0;
  for (const r of list) {
    const n = cnt(r);
    total += n;
    const sev = String(r.severity ?? '').toUpperCase();
    if (sev === 'SEVERE' || sev === 'FATAL') severe += n;
    else if (sev === 'MODERATE') moderate += n;
    if (r.suspectedDrugCode) drugs.add(String(r.suspectedDrugCode));
  }
  return { total, severe, moderate, drugs: drugs.size };
}

// ────────────────────────────────────────────────────────────────
// 6. 환자 만족도 — GET /api/v1/satisfaction/stats/department
//    서버: [{ department, nps, responseCount, itemScores[] }]  ← 배열(표본 없으면 빈 배열)
//    🔴 위젯은 averageNps·responses·promoters·detractors 를 평면 키로 읽어 4칸 전부 '-' 였다.
//    🔴 추천/비추천 원수는 응답에 없다(서버가 이미 NPS 로 집계) — 재계산하지 않는다(P12).
//    🔴 응답이 0건이면 평균 NPS 는 0 이 아니라 **산출 불가**(null).
// ────────────────────────────────────────────────────────────────
export interface SatisfactionSummary {
  /** 응답 가중 평균 NPS. 응답 0건이면 null(산출 불가) */
  avgNps: number | null;
  responses: number;
  departments: number;
  /** 최저 NPS 부서의 점수 — 표본이 없으면 null */
  worstNps: number | null;
}

export function satisfactionSummary(raw: unknown): SatisfactionSummary {
  const list = rows<{ department?: string; nps?: unknown; responseCount?: unknown }>(raw);
  const responses = list.reduce((s, r) => s + num(r.responseCount), 0);
  // 🔴 2026-10-08 — 서버가 점수 응답 0 인 부서에 nps:null 을 준다. 그 부서를 0 으로 가중 평균에 넣지 않는다.
  const scored = list.filter(r => num(r.responseCount) > 0 && r.nps != null && Number.isFinite(Number(r.nps)));
  const scoredResponses = scored.reduce((s, r) => s + num(r.responseCount), 0);
  const weighted = scored.reduce((s, r) => s + num(r.nps) * num(r.responseCount), 0);
  return {
    avgNps: scoredResponses > 0 ? Math.round(weighted / scoredResponses) : null,
    responses,
    departments: list.length,
    worstNps: scored.length > 0 ? Math.min(...scored.map(r => num(r.nps))) : null,
  };
}

// ────────────────────────────────────────────────────────────────
// 접수 대기 — GET /api/v1/queue/stats
//    서버: { waitingNow, waitingScheduled, statusCounts:[{departmentName,status,_count}], avgWaitMinutes:{과:분}, waitSampleN, waitUnmeasuredN }
//    🔴 (2026-10-02) 간호사 패널이 `waiting`·`totalWaiting`·`departments` 를 읽어 **개통 이래 "외래 대기 0"**·과별 목록 미표시였다
//       (실측 지금 대기 260). 응답을 해석하는 곳은 여기 하나다.
// ────────────────────────────────────────────────────────────────
export interface QueueWaitingSummary {
  /** 지금 실제로 기다리는 인원 — 응답에 없으면 null(0 이 아니다) */
  waitingNow: number | null;
  waitingScheduled: number | null;
  /** 과별 WAITING 인원 많은 순 · 평균 대기는 표본 있는 과만(없으면 null) */
  byDept: Array<{ dept: string; waiting: number; avgWaitMin: number | null }>;
  waitSampleN: number;
  /** 오늘 접수 전체 = 표본 + 산출 불가 */
  todayTotal: number;
}

export function queueWaitingSummary(raw: unknown): QueueWaitingSummary {
  const src = (raw ?? {}) as Record<string, unknown>;
  const by = new Map<string, number>();
  for (const r of rows<{ departmentName?: string | null; status?: string; _count?: unknown }>(src.statusCounts)) {
    if (r.status !== 'WAITING') continue;
    const k = r.departmentName ?? '';
    by.set(k, (by.get(k) ?? 0) + num(r._count));
  }
  const avg = (src.avgWaitMinutes ?? {}) as Record<string, unknown>;
  const optNum = (v: unknown) => (v == null || !Number.isFinite(Number(v)) ? null : Number(v));
  const sample = num(src.waitSampleN);
  return {
    waitingNow: optNum(src.waitingNow),
    waitingScheduled: optNum(src.waitingScheduled),
    byDept: [...by.entries()].sort((a, b) => b[1] - a[1]).map(([dept, waiting]) => ({ dept, waiting, avgWaitMin: optNum(avg[dept]) })),
    waitSampleN: sample,
    todayTotal: sample + num(src.waitUnmeasuredN),
  };
}

// ────────────────────────────────────────────────────────────────
// 약국 대기열 단계 — GET /api/v1/pharmacy/queue
//    🔴 조제가 끝나면 **오더는 COMPLETED** 로 닫히고, 검수 대기·불출 대기는 조제 상태(dispensing.status)에 있다.
//       약사 대시보드 패널은 `order.status === 'DISPENSED'` 로 검수 대기를 세어 **개통 이래 0**이었다
//       (2026-10-02 실측 검수 대기 5건). 약국 화면(`/pharmacy`)과 대시보드가 이 함수 하나로 판정한다.
// ────────────────────────────────────────────────────────────────
export type PharmacyStage = 'ORDERED' | 'RECEIVED' | 'IN_PROGRESS' | 'VERIFY_WAIT' | 'ISSUE_WAIT' | 'OTHER';

export const PHARMACY_STAGE_LABEL: Record<PharmacyStage, string> = {
  ORDERED: '접수 대기',
  RECEIVED: '접수됨',
  IN_PROGRESS: '조제 중',
  VERIFY_WAIT: '검수 대기',
  ISSUE_WAIT: '불출 대기',
  OTHER: '기타',
};

export function pharmacyStageOf(o: { status?: string | null; dispensing?: { status?: string | null } | null }): PharmacyStage {
  if (o.dispensing?.status === 'DISPENSED') return 'VERIFY_WAIT';
  if (o.dispensing?.status === 'VERIFIED') return 'ISSUE_WAIT';
  if (o.status === 'ORDERED' || o.status === 'RECEIVED' || o.status === 'IN_PROGRESS') return o.status;
  return 'OTHER';
}
