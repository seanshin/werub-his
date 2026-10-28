/**
 * CPOE 질 지표 정본(2026-10-07) — 처방·오더 원장에서 **셀 수 있는 것만** 센다.
 *
 * 🔴 지표마다 분자·분모를 원장 필드로 정의한다(추정·보정 없음). 분모 0 이면 산출 불가(null) — 0% 가 아니다.
 * 🔴 **판정(달성/미달)은 여기서 하지 않는다.** 목표·방향은 질 지표 원장(`QualityIndicator` · `/quality`)이 정본이다.
 *    `qiName` 으로 원장 지표와 잇고, 원장에 등재된 지표만 목표 대비 판정·월별 측정 기록을 한다.
 *    방향이 임상적으로 분명한 지표만 api `indicator-policy.ts` `DIRECTION_BY_NAME` 에 등재한다(관찰 지표는 방향 없음).
 * 🔴 시간 지표(소요 시간)는 중앙값+표본 수(n) — 비율이 아니라 QI 측정 원장(분자/분모)에 기록하지 않는다.
 */

export const CPOE_QI_GROUPS = ['SAFETY', 'COMMUNICATION', 'DOCUMENTATION', 'RESULT', 'PHARMACY'] as const;
export type CpoeQiGroup = (typeof CPOE_QI_GROUPS)[number];
export const CPOE_QI_GROUP_LABEL: Record<CpoeQiGroup, string> = {
  SAFETY: '처방 안전 점검',
  COMMUNICATION: '구두·전화 처방',
  DOCUMENTATION: '처방 근거 기록',
  RESULT: '결과 확인·검체',
  PHARMACY: '약사 중재·CDSS',
};

export const CPOE_QI_KEYS = [
  'DUR_CHECK_RATE', 'DUR_ALERT_RATE', 'DUR_OVERRIDE_RATE', 'DUR_OVERRIDE_NO_REASON',
  'VERBAL_RATE', 'VERBAL_NO_READBACK', 'VERBAL_UNCOSIGNED',
  'NO_DIAGNOSIS', 'DISCONTINUE_NO_REASON', 'RX_CANCEL_RATE', 'STAT_RATE',
  'RESULT_UNACK', 'SPECIMEN_TIME_RECORDED', 'CRITICAL_UNACK', 'CRITICAL_NO_READBACK',
  'PI_UNANSWERED', 'PI_ACCEPT_RATE', 'CDSS_OVERRIDE_NO_REASON',
] as const;
export type CpoeQiKey = (typeof CPOE_QI_KEYS)[number];

/**
 * 문제 건(드릴다운 목록)이 분자인가(NUM) · 분모에서 분자를 뺀 것인가(REST) · 문제 건이 정해지지 않은 관찰 지표인가(null).
 * 예) DUR 검사 수행률은 "검사 안 한 처방"이 문제 건 → REST.
 */
export type CpoeQiOffender = 'NUM' | 'REST' | null;

export interface CpoeQiDef {
  key: CpoeQiKey;
  group: CpoeQiGroup;
  label: string;
  numerator: string;
  denominator: string;
  offender: CpoeQiOffender;
  /** 질 지표 원장(`QualityIndicator.name`)과 잇는 이름 — 원장에 같은 이름으로 등재돼야 목표 판정·측정 기록이 된다 */
  qiName: string;
  /**
   * 집계 시점 기준 상태 지표 — 아직 처리될 시간이 남은 최근 건도 분자에 든다(예: 방금 낸 구두 처방은 아직 서명 전).
   * 화면은 이것을 밝히고, 월 측정 기록은 끝난 달만 받는다.
   */
  asOf?: true;
}

export const CPOE_QI_DEFS: readonly CpoeQiDef[] = [
  { key: 'DUR_CHECK_RATE', group: 'SAFETY', label: 'DUR 점검 수행률', numerator: 'DUR 점검이 기록된 약 처방', denominator: '약 처방', offender: 'REST', qiName: 'CPOE DUR 점검 수행률' },
  { key: 'DUR_ALERT_RATE', group: 'SAFETY', label: 'DUR 경고 발생률', numerator: '경고가 1건 이상 나온 처방', denominator: 'DUR 점검이 기록된 약 처방', offender: null, qiName: 'CPOE DUR 경고 발생률' },
  { key: 'DUR_OVERRIDE_RATE', group: 'SAFETY', label: 'DUR 경고 무시율', numerator: '경고를 무시하고 낸 처방', denominator: '경고가 나온 처방', offender: 'NUM', qiName: 'CPOE DUR 경고 무시율' },
  { key: 'DUR_OVERRIDE_NO_REASON', group: 'SAFETY', label: 'DUR 무시 사유 미기록률', numerator: '무시 사유가 비어 있는 처방', denominator: '경고를 무시한 처방', offender: 'NUM', qiName: 'CPOE DUR 무시 사유 미기록률' },
  { key: 'VERBAL_RATE', group: 'COMMUNICATION', label: '구두·전화 처방 비율', numerator: '구두·전화 처방', denominator: '처방 전체', offender: null, qiName: 'CPOE 구두·전화 처방 비율' },
  { key: 'VERBAL_NO_READBACK', group: 'COMMUNICATION', label: '구두 처방 복창 확인 미기록률', numerator: '복창 확인이 기록되지 않은 구두·전화 처방', denominator: '구두·전화 처방', offender: 'NUM', qiName: 'CPOE 구두처방 복창확인 미기록률' },
  { key: 'VERBAL_UNCOSIGNED', group: 'COMMUNICATION', label: '구두 처방 처방의 서명 미완료율', numerator: '처방의 사후 서명이 없는 구두·전화 처방', denominator: '구두·전화 처방', offender: 'NUM', qiName: 'CPOE 구두처방 서명 미완료율', asOf: true },
  { key: 'NO_DIAGNOSIS', group: 'DOCUMENTATION', label: '관련 상병 미연결률', numerator: '관련 상병이 연결되지 않은 처방', denominator: '처방 전체', offender: 'NUM', qiName: 'CPOE 처방 상병 미연결률' },
  { key: 'DISCONTINUE_NO_REASON', group: 'DOCUMENTATION', label: '중단 사유 미기록률', numerator: '중단 사유가 비어 있는 중단 처방', denominator: '중단 처방', offender: 'NUM', qiName: 'CPOE 처방 중단 사유 미기록률' },
  { key: 'RX_CANCEL_RATE', group: 'DOCUMENTATION', label: '처방 취소율', numerator: '취소(무효)된 처방', denominator: '처방 전체', offender: null, qiName: 'CPOE 처방 취소율' },
  { key: 'STAT_RATE', group: 'DOCUMENTATION', label: 'STAT 처방 비율', numerator: 'STAT 처방', denominator: '처방 전체', offender: null, qiName: 'CPOE STAT 처방 비율' },
  { key: 'RESULT_UNACK', group: 'RESULT', label: '결과 미확인률', numerator: '의사 확인이 없는 결과', denominator: '결과가 나온 검사·영상 오더', offender: 'NUM', qiName: 'CPOE 검사결과 미확인률', asOf: true },
  { key: 'SPECIMEN_TIME_RECORDED', group: 'RESULT', label: '검체 채취 시각 기록률', numerator: '채취 시각이 기록된 검사', denominator: '결과가 나온 검사 오더', offender: 'REST', qiName: 'CPOE 검체채취시각 기록률' },
  { key: 'CRITICAL_UNACK', group: 'RESULT', label: '위급값 미확인률', numerator: '확인 기록이 없는 위급값 통보', denominator: '위급값 통보', offender: 'NUM', qiName: 'CPOE 위급값 미확인률', asOf: true },
  { key: 'CRITICAL_NO_READBACK', group: 'RESULT', label: '위급값 복창 확인 미기록률', numerator: '복창 확인이 기록되지 않은 확인', denominator: '확인된 위급값 통보', offender: 'NUM', qiName: 'CPOE 위급값 복창확인 미기록률' },
  { key: 'PI_UNANSWERED', group: 'PHARMACY', label: '약사 중재 미응답률', numerator: '처방의 응답이 없는 중재', denominator: '약사 중재', offender: 'NUM', qiName: 'CPOE 약사중재 미응답률', asOf: true },
  { key: 'PI_ACCEPT_RATE', group: 'PHARMACY', label: '약사 중재 수락률', numerator: '수락된 중재', denominator: '응답한 중재', offender: null, qiName: 'CPOE 약사중재 수락률' },
  { key: 'CDSS_OVERRIDE_NO_REASON', group: 'PHARMACY', label: 'CDSS 무시 사유 미기록률', numerator: '무시 사유가 비어 있는 CDSS 경고 무시', denominator: 'CDSS 경고를 무시한 건', offender: 'NUM', qiName: 'CPOE CDSS 무시 사유 미기록률' },
];

export function cpoeQiDef(key: string): CpoeQiDef | undefined {
  return CPOE_QI_DEFS.find((d) => d.key === key);
}

/** 소요 시간 지표 — 발행→결과(검사·영상)·발행→조제 완료(약국) · STAT/일반 따로 · 중앙값·90백분위·n */
export const CPOE_TAT_DEPTS = ['LAB', 'IMAGING', 'PHARMACY'] as const;
export type CpoeTatDept = (typeof CPOE_TAT_DEPTS)[number];
export const CPOE_TAT_PRIORITIES = ['STAT', 'ROUTINE'] as const;

/** 정렬된 값의 백분위(최근접 순위) — 표본 0 이면 null */
export function percentileOf(values: number[], p: number): number | null {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const rank = Math.ceil((p / 100) * v.length);
  return v[Math.min(v.length, Math.max(1, rank)) - 1];
}

/** 빈 문자열·공백만 있는 사유는 "기록 없음"이다 */
export function isBlankReason(s: string | null | undefined): boolean {
  return !s || !s.trim();
}

/**
 * 층화 — 처방이 난 **그 진료의 유형**(현재 위치가 아니다).
 * 🔴 오더 화면의 진료 맥락(`careContextOf`)은 "지금 환자가 어디 있는가"라 지난 처방을 나누면 틀린다 — 여기는 진료 기록만 본다.
 * 🔴 진료 유형이 기록되지 않았으면 UNKNOWN — 외래로 짐작하지 않는다.
 */
export const QI_SETTINGS = ['OUTPATIENT', 'INPATIENT', 'ER', 'UNKNOWN'] as const;
export type QiSetting = (typeof QI_SETTINGS)[number];
export const QI_SETTING_LABEL: Record<QiSetting, string> = { OUTPATIENT: '외래', INPATIENT: '입원', ER: '응급', UNKNOWN: '진료 유형 미기록' };
export function qiSettingOf(enc: { visitType?: string | null; admissionId?: string | null } | null | undefined): QiSetting {
  if (!enc) return 'UNKNOWN';
  const v = (enc.visitType ?? '').toUpperCase();
  if (v.startsWith('ER')) return 'ER';
  if (enc.admissionId || v.startsWith('INPATIENT')) return 'INPATIENT';
  if (v === 'OUTPATIENT') return 'OUTPATIENT';
  return 'UNKNOWN';
}

/**
 * p 관리도(비율 관리도) — 월별 점 · 중심선 p̄ = Σ분자/Σ분모(진행 중인 달 제외) · 한계 = p̄ ± 3√(p̄(1−p̄)/n)(0~1 로 자름).
 * 신호(특수원인 후보): ① 한계 밖 ② 중심선 한쪽에 8점 연속. 🔴 신호는 "원인을 찾아볼 자리"이지 결함 판정이 아니다.
 * 🔴 분모 0 인 달은 점이 없다(0 으로 그리지 않는다) · p̄ 가 0 이나 1 이면 한계가 의미 없어 신호를 내지 않는다(degenerate).
 */
export interface PChartPointInput { period: string; numerator: number; denominator: number; partial?: boolean }
export interface PChartPoint extends PChartPointInput { p: number | null; ucl: number | null; lcl: number | null; signal: 'OUTSIDE' | 'RUN' | null }
export interface PChart { center: number | null; degenerate: boolean; points: PChartPoint[]; basis: { months: number; numerator: number; denominator: number } }

export const P_CHART_RUN_LENGTH = 8;

export function pChart(input: PChartPointInput[]): PChart {
  const basisPts = input.filter((x) => !x.partial && x.denominator > 0);
  const num = basisPts.reduce((a, x) => a + x.numerator, 0);
  const den = basisPts.reduce((a, x) => a + x.denominator, 0);
  const center = den > 0 ? num / den : null;
  const degenerate = center == null || center === 0 || center === 1;
  const points: PChartPoint[] = input.map((x) => {
    const p = x.denominator > 0 ? x.numerator / x.denominator : null;
    if (p == null || center == null || degenerate) return { ...x, p, ucl: null, lcl: null, signal: null };
    const sigma = Math.sqrt((center * (1 - center)) / x.denominator);
    const ucl = Math.min(1, center + 3 * sigma);
    const lcl = Math.max(0, center - 3 * sigma);
    return { ...x, p, ucl, lcl, signal: !x.partial && (p > ucl || p < lcl) ? 'OUTSIDE' : null };
  });
  if (!degenerate && center != null) {
    // ② 같은 쪽 연속 — 점이 없는 달은 연속을 끊지 않고 건너뛴다(관측이 없을 뿐) · 진행 중인 달은 세지 않는다
    let side = 0; let run: number[] = [];
    points.forEach((pt, i) => {
      if (pt.p == null || pt.partial) return;
      const s = pt.p > center ? 1 : pt.p < center ? -1 : 0;
      if (s !== 0 && s === side) run.push(i); else { side = s; run = s !== 0 ? [i] : []; }
      if (run.length >= P_CHART_RUN_LENGTH) for (const j of run) if (!points[j].signal) points[j].signal = 'RUN';
    });
  }
  return { center, degenerate, points, basis: { months: basisPts.length, numerator: num, denominator: den } };
}

/**
 * DUR 경고 유형 — api `dur.service.ts` 가 내는 type 그대로(경고 부담 분석의 축).
 * 🔴 모르는 유형은 버리지 않고 그 코드로 센다(어휘 밖 값을 '기타'로 뭉개면 새 규칙이 안 보인다).
 */
export const DUR_WARNING_TYPES = [
  'INTERACTION', 'ALLERGY', 'PREGNANCY', 'AGE_CONTRAINDICATION', 'DUPLICATE', 'THERAPEUTIC_DUPLICATION',
  'MAX_DOSE', 'DOSE_EXCEEDED', 'BEERS', 'HIGH_ALERT', 'LASA',
] as const;
export const DUR_WARNING_TYPE_LABEL: Record<string, string> = {
  INTERACTION: '병용 상호작용', ALLERGY: '알레르기', PREGNANCY: '임부 금기', AGE_CONTRAINDICATION: '연령 금기',
  DUPLICATE: '동일 성분 중복', THERAPEUTIC_DUPLICATION: '효능군 중복', MAX_DOSE: '최대 용량 초과', DOSE_EXCEEDED: '용량 확인 필요',
  BEERS: '노인 주의(Beers)', HIGH_ALERT: '고위험 약물', LASA: '유사 명칭(LASA)',
};

/**
 * 개선 활동(PDCA) — 지표 신호 → 계획(PLAN) → 실행(DO) → 효과 확인(CHECK) → 표준화·후속(ACT) → 종결(CLOSED).
 * 🔴 ACT 에서 PLAN 으로 돌아가는 것이 정상 순환이다(한 번에 끝나지 않는다) · 취소는 열린 어느 단계에서나(사유 필수).
 * 🔴 CHECK → ACT 는 효과 확인 기록이 하나 이상 있어야 한다(재지 않고 "개선됐다"고 넘어가지 않는다 — 서버가 막는다).
 */
export const QI_ACTION_STATUSES = ['PLAN', 'DO', 'CHECK', 'ACT', 'CLOSED', 'CANCELLED'] as const;
export type QiActionStatus = (typeof QI_ACTION_STATUSES)[number];
export const QI_ACTION_STATUS_LABEL: Record<QiActionStatus, string> = {
  PLAN: '계획', DO: '실행', CHECK: '효과 확인', ACT: '표준화·후속', CLOSED: '종결', CANCELLED: '취소',
};
export const QI_ACTION_TRANSITIONS: Record<QiActionStatus, QiActionStatus[]> = {
  PLAN: ['DO', 'CANCELLED'],
  DO: ['CHECK', 'CANCELLED'],
  CHECK: ['ACT', 'DO', 'CANCELLED'],
  ACT: ['CLOSED', 'PLAN', 'CANCELLED'],
  CLOSED: [],
  CANCELLED: [],
};
export function canTransitQiAction(from: QiActionStatus, to: QiActionStatus): boolean {
  return QI_ACTION_TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * 전후 비율 비교 — 차이(후−전)와 95% 신뢰구간(Wald) · 표본이 작으면(어느 쪽이든 분모 < 30 또는 기대 건수 < 5) small=true.
 * 🔴 판정어를 내지 않는다 — 구간이 0 을 포함하면 "변화를 확인할 수 없다"는 사실만 · 방향(좋아짐/나빠짐)은 지표 방향을 아는 쪽이 말한다.
 * 분모 0 이면 null(비교 불가).
 */
export interface ProportionDiff { before: number; after: number; diff: number; low: number; high: number; includesZero: boolean; small: boolean }
export function proportionDiff(before: { numerator: number; denominator: number }, after: { numerator: number; denominator: number }): ProportionDiff | null {
  if (!(before.denominator > 0) || !(after.denominator > 0)) return null;
  const p1 = before.numerator / before.denominator;
  const p2 = after.numerator / after.denominator;
  const se = Math.sqrt((p1 * (1 - p1)) / before.denominator + (p2 * (1 - p2)) / after.denominator);
  const diff = p2 - p1;
  const low = diff - 1.96 * se;
  const high = diff + 1.96 * se;
  const small = [before, after].some((x) => x.denominator < 30 || x.numerator < 5 || x.denominator - x.numerator < 5);
  return { before: p1, after: p2, diff, low, high, includesZero: low <= 0 && high >= 0, small };
}
