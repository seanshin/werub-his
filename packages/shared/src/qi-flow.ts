/**
 * 의료질관리 흐름 정본(QI-FLOW-001 · 2026-10-08) — 측정 출처·지표 공급원·기구·인증 판정 어휘.
 *
 * 🔴 공급원(supplier) = "이 지표의 분자·분모를 원내 원장에서 다시 셀 수 있는가". 매핑은 **운영 어휘를 실측해 확정한 것만**.
 *    셀 수 없는 지표는 등재하지 않는다(수기 지표로 남는다) — 추정한 원장은 거짓 경보가 된다.
 * 🔴 분모가 원내 결정에 걸린 공급원(사고율·기구 관련 감염률)은 결정 전엔 `available:false` 와 이유를 낸다(지어내지 않는다).
 */

import { pChart, P_CHART_RUN_LENGTH, type PChart, type PChartPointInput } from './cpoe-quality';

/** 측정 행이 어떻게 만들어졌는가(사실 기록) */
export const QI_MEASUREMENT_SOURCES = ['MANUAL', 'AUTO', 'CPOE', 'SEED', 'EXTERNAL'] as const;
export type QiMeasurementSource = (typeof QI_MEASUREMENT_SOURCES)[number];

export const QI_MEASUREMENT_SOURCE_LABEL: Record<QiMeasurementSource, string> = {
  MANUAL: '수기 입력', AUTO: '자동 산출', CPOE: '자동 산출(처방 원장)', SEED: '시드(가상)', EXTERNAL: '외부 결과',
};

/** 유일성 칸 — 같은 달에 수기 칸 하나·자동 칸 하나가 나란히 있을 수 있다 */
export type QiSourceKey = 'MANUAL' | 'AUTO';
export function qiSourceKeyOf(source: string | null | undefined): QiSourceKey {
  return source === 'AUTO' || source === 'CPOE' ? 'AUTO' : 'MANUAL';
}

/** 같은 달 수기·자동 값이 다를 때 정본(결정 qi.autoManual.precedence · 설정 qi.autoManual.precedence) */
export const QI_PRECEDENCES = ['BOTH', 'AUTO', 'MANUAL'] as const;
export type QiPrecedence = (typeof QI_PRECEDENCES)[number];
export function normalizeQiPrecedence(v: unknown): QiPrecedence {
  return v === 'AUTO' || v === 'MANUAL' ? v : 'BOTH';
}

/**
 * 같은 기간의 행 둘(수기·자동) 중 판정·보고서 정본. BOTH 는 수기를 정본으로 두고 자동은 병기한다.
 * 정본 칸이 비어 있으면 다른 칸을 쓴다(값이 하나뿐이면 그 값).
 */
export function pickPrimaryMeasurement<T extends { sourceKey?: string | null }>(rows: T[], precedence: QiPrecedence): { primary: T | null; alternate: T | null } {
  const manual = rows.find((r) => (r.sourceKey ?? 'MANUAL') === 'MANUAL') ?? null;
  const auto = rows.find((r) => r.sourceKey === 'AUTO') ?? null;
  const first = precedence === 'AUTO' ? auto : manual;
  const second = precedence === 'AUTO' ? manual : auto;
  const primary = first ?? second;
  return { primary, alternate: primary === first ? second : null };
}

/** 지표 공급원 — 원내 원장에서 분자·분모를 다시 셀 수 있는 지표(지표 이름은 공백 제거 정규형) */
export const QI_SUPPLIERS = {
  FALL_RATE: { qiName: '낙상발생률', label: '환자안전사고(낙상) ÷ 분모(결정)', kind: 'INCIDENT_RATE', incidentType: 'FALL' },
  MED_ERROR_RATE: { qiName: '투약오류발생률', label: '환자안전사고(투약오류) ÷ 분모(결정)', kind: 'INCIDENT_RATE', incidentType: 'MEDICATION_ERROR' },
  PRESSURE_ULCER_RATE: { qiName: '욕창발생률', label: '환자안전사고(욕창) ÷ 분모(결정)', kind: 'INCIDENT_RATE', incidentType: 'PRESSURE_ULCER' },
  HAND_HYGIENE: { qiName: '손위생수행률', label: '손위생 관찰 수행 ÷ 관찰 기회', kind: 'HAND_HYGIENE' },
  CAUTI_RATE: { qiName: '요로감염발생률(도뇨관)', label: 'CAUTI 건 ÷ 도뇨관 일수(결정)', kind: 'DEVICE_RATE', haiType: 'CAUTI', deviceType: 'URINARY_CATHETER' },
  CLABSI_RATE: { qiName: '중심정맥관관련혈류감염률', label: 'CLABSI 건 ÷ 중심정맥관 일수(결정)', kind: 'DEVICE_RATE', haiType: 'CLABSI', deviceType: 'CENTRAL_LINE' },
  VAP_RATE: { qiName: '인공호흡기관련폐렴발생률', label: 'VAP 건 ÷ 인공호흡기 일수(결정)', kind: 'DEVICE_RATE', haiType: 'VAP', deviceType: 'VENTILATOR' },
  COMPLAINTS: { qiName: '환자불만건수', label: 'VoC 불만 접수 건수(월)', kind: 'COUNT' },
  /**
   * 간호초기평가 24시간 내 완료율(2026-10-10) — 간호 과정 지표. 분모 = 기간 안 입원(취소 제외) 중 24시간 이상 머문 입원,
   * 분자 = 그중 입원 시각부터 24시간 안에 간호초기평가(`nursing_assessments`)가 있는 입원. 24시간 미만 퇴원은 분모에서 뺀다(평가 기회 없음).
   */
  NURSING_INITIAL_24H: { qiName: '간호초기평가24시간내완료율', label: '입원 24시간 안 간호초기평가 ÷ 24시간 이상 머문 입원', kind: 'NURSING_INITIAL' },
  /* ── 2026-10-10 과정 지표(오늘 정비한 흐름의 원장에서 셀 수 있는 것만) ── */
  SHIFT_VITALS_COMPLETE: { qiName: '근무조활력기록완결률', label: '활력이 1회 이상 기록된 재원 근무조 ÷ 재원 중 온전히 지난 근무조', kind: 'SHIFT_VITALS' },
  CONSULT_REPLY_48H: { qiName: '협진48시간내회신율', label: '48시간 안 회신된 협진 ÷ 그 달 의뢰된 협진(회신 없이 종결 제외)', kind: 'CONSULT_REPLY' },
  ENCOUNTER_SIGN_7D: { qiName: '진료기록7일내서명률', label: '7일 안 서명된 진료기록 ÷ 그 달 작성 시작된 진료기록', kind: 'CHART_SIGN' },
  RADIATION_RECORDER: { qiName: '방사선조사기록자기재율', label: '조사 기록자가 남은 조사 완료 분할 ÷ 그 달 조사 완료 분할', kind: 'RADIATION_RECORDER' },
  DOC_ISSUE_SLA: { qiName: '서류발급처리기한준수율', label: '처리 기한 안 발급된 서류 ÷ 그 달 신청된 서류(반려·기한 미도래 제외)', kind: 'DOC_SLA' },
  WIFI_ZONE_RESOLVED: { qiName: '무선측위방확정률', label: '방까지 확정된 관측 측위 ÷ 그 달 관측 측위(시뮬레이션 제외)', kind: 'WIFI_OBSERVED' },
  /** 통증 재평가 기한 내 수행률(2026-10-27) — 기준·기한은 원내 규정 `nursing.pain.reassessRule`(미설정이면 산출 불가) */
  PAIN_REASSESS_ON_TIME: { qiName: '통증재평가기한내수행률', label: '기한 안 재평가된 통증 사건 ÷ 기한이 지난 통증 사건(원내 규정)', kind: 'PAIN_REASSESS' },
  /** 낙상·욕창 위험 재평가 기한 내 수행률(2026-10-27) — 주기는 원내 규정 `nursing.riskReassess.intervalHours`(비면 코드 기본값 · 근거에 출처) */
  RISK_REASSESS_ON_TIME: { qiName: '낙상·욕창위험재평가기한내수행률', label: '기한 안 다음 평가가 있는 낙상·욕창 평가 ÷ 기한이 지난 평가(등급별 주기)', kind: 'RISK_REASSESS' },
} as const;
/** 과정 지표 기한(시간·일) — 지표 정의의 일부(이름에 들어 있다) · 원내 규정이 다르면 다른 지표로 등재한다 */
export const QI_CONSULT_REPLY_HOURS = 48;
export const QI_ENCOUNTER_SIGN_DAYS = 7;

/**
 * 공급원 정의(등재를 돕는 설명 · 2026-10-10) — 무엇을 세는가·모집단·제외·결정 의존.
 * 🔴 등재는 사람이 한다(지표 등록부 · 위원회 의결) — 이 표는 고르는 사람이 읽을 근거다.
 */
export interface QiSupplierDefinition { name: string; population: string; numerator: string; exclusions: string; dependsOn: string | null }
export const QI_SUPPLIER_DEFINITION: Record<string, QiSupplierDefinition> = {
  FALL_RATE: { name: '낙상 발생률', population: '재원 중 일어난 낙상(병동 기록 또는 그 시각 재원)', numerator: '환자안전사고 낙상', exclusions: '재원 밖(외래·응급) 사고 · 환자·병동 둘 다 없는 사고(수만 셈)', dependsOn: 'qi.autoMeasure.incidentDenominator' },
  MED_ERROR_RATE: { name: '투약오류 발생률', population: '재원 중 일어난 투약오류', numerator: '환자안전사고 투약오류', exclusions: '재원 밖 사고 · 환자·병동 둘 다 없는 사고', dependsOn: 'qi.autoMeasure.incidentDenominator' },
  PRESSURE_ULCER_RATE: { name: '욕창 발생률', population: '재원 중 발생한 욕창', numerator: '환자안전사고 욕창', exclusions: '재원 밖 사고 · 환자·병동 둘 다 없는 사고', dependsOn: 'qi.autoMeasure.incidentDenominator' },
  HAND_HYGIENE: { name: '손위생 수행률', population: '그 달 손위생 관찰 기회', numerator: '수행', exclusions: '없음', dependsOn: null },
  CAUTI_RATE: { name: '요로감염 발생률 (도뇨관)', population: '도뇨관 일수', numerator: 'CAUTI 사례', exclusions: '없음', dependsOn: 'qi.deviceDays.source' },
  CLABSI_RATE: { name: '중심정맥관 관련 혈류감염률', population: '중심정맥관 일수', numerator: 'CLABSI 사례', exclusions: '없음', dependsOn: 'qi.deviceDays.source' },
  VAP_RATE: { name: '인공호흡기 관련 폐렴 발생률', population: '인공호흡기 일수', numerator: 'VAP 사례', exclusions: '없음', dependsOn: 'qi.deviceDays.source' },
  COMPLAINTS: { name: '환자 불만 건수', population: '그 달', numerator: 'VoC 불만 접수', exclusions: '없음', dependsOn: null },
  NURSING_INITIAL_24H: { name: '간호초기평가 24시간 내 완료율', population: '그 달 입원(취소 제외) 중 24시간 이상 머문 입원', numerator: '입원 시각부터 24시간 안 간호초기평가', exclusions: '24시간 미만 퇴원 · 24시간이 아직 안 지난 재원', dependsOn: null },
  SHIFT_VITALS_COMPLETE: { name: '근무조 활력 기록 완결률', population: '그 달 재원 중 처음부터 끝까지 재원이었던 근무조(교대 경계 설정)', numerator: '그 근무조에 활력이 1회 이상(플로시트·간호 스테이션 입력 두 원장)', exclusions: '입원·퇴원이 걸친 근무조 · 끝나지 않은 근무조', dependsOn: null },
  CONSULT_REPLY_48H: { name: '협진 48시간 내 회신율', population: '그 달 의뢰된 협진', numerator: '의뢰 시각부터 48시간 안 회신', exclusions: '회신 없이 종결(취소) · 48시간이 아직 안 지난 미회신', dependsOn: null },
  ENCOUNTER_SIGN_7D: { name: '진료기록 7일 내 서명률', population: '그 달 작성 시작된 진료기록', numerator: '작성 시작부터 7일 안 서명', exclusions: '7일이 아직 안 지난 미서명', dependsOn: null },
  RADIATION_RECORDER: { name: '방사선 조사 기록자 기재율', population: '그 달 조사 완료 분할', numerator: '조사 기록자(치료사)가 남은 분할', exclusions: '없음', dependsOn: null },
  DOC_ISSUE_SLA: { name: '서류 발급 처리 기한 준수율', population: '그 달 신청된 서류', numerator: '원내 처리 기한 안 발급', exclusions: '반려 · 기한이 아직 안 온 미발급', dependsOn: 'qi.docIssuance.slaHours(원내 처리 기한 · 미설정이면 산출 불가)' },
  WIFI_ZONE_RESOLVED: { name: '무선 측위 방 확정률', population: '그 달 관측 측위(수집기)', numerator: '방까지 확정(오차 반경·층 판정 통과)', exclusions: '시뮬레이션 측위', dependsOn: 'location.wifi.collect(수집 결정 · 꺼져 있으면 산출 불가)' },
  RISK_REASSESS_ON_TIME: { name: '낙상·욕창 위험 재평가 기한 내 수행률', population: '그 달 재원 중 낙상(Morse)·욕창(Braden) 평가', numerator: '그 평가 등급의 주기 안에 같은 유형 다음 평가', exclusions: '기한이 아직 안 온 평가 · 기한 전에 재원이 끝난 평가 · 점수 범위 밖', dependsOn: 'nursing.riskReassess.intervalHours(원내 규정 · 비면 코드 기본값 — 근거에 출처)' },
  PAIN_REASSESS_ON_TIME: { name: '통증 재평가 기한 내 수행률', population: '그 달 재원 중 통증 사건(기준 이상 통증 기록 · 규정이 켜면 진통제 투여)', numerator: '사건 뒤 기한 안 통증 재기록', exclusions: '기한이 아직 안 온 사건 · 기한 전에 재원이 끝난 사건 · 약품 분류를 모르는 투약(수만 셈)', dependsOn: 'nursing.pain.reassessRule(원내 규정 · 미설정이면 산출 불가)' },
};

/** 비율(분자 ⊂ 분모)인 공급원 종류 — p 관리도 */
export const QI_PROPORTION_KINDS: ReadonlySet<string> = new Set(['HAND_HYGIENE', 'NURSING_INITIAL', 'SHIFT_VITALS', 'CONSULT_REPLY', 'CHART_SIGN', 'RADIATION_RECORDER', 'DOC_SLA', 'WIFI_OBSERVED', 'PAIN_REASSESS', 'RISK_REASSESS']);
/** 간호초기평가 기한(시간) — 지표 정의의 일부(이름에 들어 있다) · 원내 규정이 다르면 다른 지표로 등재한다 */
export const NURSING_INITIAL_ASSESSMENT_HOURS = 24;
export type QiSupplierKey = keyof typeof QI_SUPPLIERS;

export function qiSupplierByName(normalizedName: string): QiSupplierKey | null {
  const hit = (Object.keys(QI_SUPPLIERS) as QiSupplierKey[]).find((k) => QI_SUPPLIERS[k].qiName === normalizedName);
  return hit ?? null;
}

/** 공급원이 값을 못 낸 이유 — 화면이 그대로 말한다(0 으로 접지 않는다) */
export const QI_SUPPLY_UNAVAILABLE_TEXT: Record<string, string> = {
  NO_SUPPLIER: '자동 산출 공급원이 없는 지표(수기 지표)',
  DENOMINATOR_UNSET: '분모가 정해지지 않았습니다(결정 qi.autoMeasure.denominator)',
  PATIENT_DAYS_INCOMPLETE: '이 기간 재원일수 스냅샷이 다 차지 않았습니다',
  DEVICE_DAYS_SOURCE_UNSET: '기구일수 원천이 정해지지 않았습니다(결정 qi.deviceDays.source)',
  DEVICE_DAYS_NONE: '기구일수를 산출하지 않기로 했습니다(건수만)',
  DEVICE_DAYS_MISSING: '이 기간 기구일수 입력이 없습니다',
  DEVICE_LEDGER_COVERAGE_UNSET: '기구 원장 전수 기록 시작일이 정해지지 않았습니다(설정 qi.deviceLedger.coverageFrom)',
  DEVICE_LEDGER_BEFORE_COVERAGE: '기구 원장 전수 기록 시작일 이전 기간입니다',
  NO_SAMPLE: '분모 0 — 표본이 없습니다',
  SLA_POLICY_UNSET: '서류 처리 기한(원내 규정)이 정해지지 않았습니다(설정 qi.docIssuance.slaHours)',
  WIFI_COLLECTION_OFF: '무선 위치 수집이 꺼져 있습니다(결정 location.wifi.collect · 설정 location.wifi.enabled)',
  PAIN_RULE_UNSET: '통증 재평가 원내 규정이 정해지지 않았습니다(설정 nursing.pain.reassessRule · 간호 원내 규정 화면)',
  PAIN_RULE_UNKNOWN: '통증 재평가 원내 규정을 조회하지 못했습니다',
};

/** 사고율 분모(설정 qi.autoMeasure.incidentDenominator) */
export const QI_INCIDENT_DENOMINATORS = ['PATIENT_DAYS', 'ADMISSIONS'] as const;
export type QiIncidentDenominator = (typeof QI_INCIDENT_DENOMINATORS)[number];

/** 기구일수 기구 종류 */
export const QI_DEVICE_TYPES = ['CENTRAL_LINE', 'URINARY_CATHETER', 'VENTILATOR'] as const;
export type QiDeviceType = (typeof QI_DEVICE_TYPES)[number];
export const QI_DEVICE_TYPE_LABEL: Record<QiDeviceType, string> = {
  CENTRAL_LINE: '중심정맥관', URINARY_CATHETER: '유치도뇨관', VENTILATOR: '인공호흡기',
};

/** 사고 위해 정도 척도(결정 safety.harmLevelScale) — 단계 문구는 원내 확정 전까지 코드만(지어내지 않는다) */
export const SAFETY_HARM_SCALES = {
  KOPS: ['NEAR_MISS', 'NO_HARM', 'MILD', 'MODERATE', 'SEVERE', 'DEATH'],
  NCC_MERP: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'],
  INTERNAL4: ['LEVEL1', 'LEVEL2', 'LEVEL3', 'LEVEL4'],
} as const;
export type SafetyHarmScale = keyof typeof SAFETY_HARM_SCALES;
export function harmLevelsOf(scale: unknown): readonly string[] | null {
  return typeof scale === 'string' && scale in SAFETY_HARM_SCALES ? SAFETY_HARM_SCALES[scale as SafetyHarmScale] : null;
}

/** 인증 자체 평가 판정 */
export const ACCREDITATION_JUDGMENTS = ['MET', 'PARTIAL', 'NOT_MET', 'NA'] as const;
export type AccreditationJudgment = (typeof ACCREDITATION_JUDGMENTS)[number];
export const ACCREDITATION_JUDGMENT_LABEL: Record<AccreditationJudgment, string> = {
  MET: '충족', PARTIAL: '부분 충족', NOT_MET: '미충족', NA: '해당 없음',
};
export const ACCREDITATION_FRAMEWORKS = ['KOIHA', 'JCI'] as const;
export type AccreditationFramework = (typeof ACCREDITATION_FRAMEWORKS)[number];
/** 설정 accreditation.framework 값 → 허용 체계 목록(미설정 = 빈 목록) */
export function allowedAccreditationFrameworks(setting: unknown): AccreditationFramework[] {
  if (setting === 'KOIHA') return ['KOIHA'];
  if (setting === 'JCI') return ['JCI'];
  if (setting === 'BOTH') return ['KOIHA', 'JCI'];
  return [];
}

/* ── 관리도 선택(QI 흐름) ─────────────────────────────────────────────────────
 * p 관리도 = 비율(분자 ≤ 분모 · 손위생 수행률·CPOE). u 관리도 = 노출 단위당 발생(사고·감염 ÷ 재원일수·기구일수 · 분자가 분모를 넘을 수 있다).
 * 🔴 노출당 비율에 p 관리도를 쓰면 한계가 [0,1]로 잘려 신호가 틀린다 — 종류대로 고른다.
 */

export type QiChartKind = 'P' | 'U';

/** u 관리도 — 중심 ū = Σc/Σn · 한계 ū ± 3√(ū/n) (하한 0) · 진행 중 달은 중심선에서 뺀다 · 8점 연속 같은 쪽 = RUN */
export function uChart(input: PChartPointInput[]): PChart {
  const basisPts = input.filter((x) => !x.partial && x.denominator > 0);
  const num = basisPts.reduce((a, x) => a + x.numerator, 0);
  const den = basisPts.reduce((a, x) => a + x.denominator, 0);
  const center = den > 0 ? num / den : null;
  const degenerate = center == null || center === 0;
  const points = input.map((x) => {
    const p = x.denominator > 0 ? x.numerator / x.denominator : null;
    if (p == null || center == null || degenerate) return { ...x, p, ucl: null, lcl: null, signal: null as 'OUTSIDE' | 'RUN' | null };
    const sigma = Math.sqrt(center / x.denominator);
    const ucl = center + 3 * sigma;
    const lcl = Math.max(0, center - 3 * sigma);
    return { ...x, p, ucl, lcl, signal: (!x.partial && (p > ucl || p < lcl) ? 'OUTSIDE' : null) as 'OUTSIDE' | 'RUN' | null };
  });
  if (!degenerate && center != null) {
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

/** 지표에 맞는 관리도 — 공급원 종류가 우선, 없으면 분자 ≤ 분모가 전 기간 성립하고 배율이 100 이면 p, 아니면 u */
export function qiChartKindFor(supplierKey: QiSupplierKey | null, points: PChartPointInput[], valueScale: number | null): QiChartKind {
  if (supplierKey) {
    return QI_PROPORTION_KINDS.has(QI_SUPPLIERS[supplierKey].kind) ? 'P' : 'U';
  }
  const allProportion = points.every((x) => x.numerator <= x.denominator);
  return allProportion && valueScale === 100 ? 'P' : 'U';
}

export function qiControlChart(kind: QiChartKind, input: PChartPointInput[]): PChart {
  return kind === 'P' ? pChart(input) : uChart(input);
}

/* ── 사람 결정 ↔ 설정 키(QI 흐름) ──────────────────────────────────────────────
 * 결정 등록부(batch-2026-10-d)의 선택지가 집행 엔진을 거쳐 이 설정 키를 바꾼다. 화면은 값을 읽기만 한다.
 */
export const QI_FLOW_SETTING_KEYS = [
  { key: 'qi.autoMeasure.enabled', decisionKey: 'qi.autoMeasure.enable', label: '자동 월 마감(크론)' },
  { key: 'qi.autoMeasure.incidentDenominator', decisionKey: 'qi.autoMeasure.denominator', label: '사고율 분모' },
  { key: 'qi.deviceDays.source', decisionKey: 'qi.deviceDays.source', label: '기구일수 원천' },
  { key: 'qi.autoManual.precedence', decisionKey: 'qi.autoManual.precedence', label: '수기·자동 값 정본' },
  { key: 'qi.indicator.directEdit', decisionKey: 'qi.indicator.directEdit', label: '지표 정의 직접 수정' },
  { key: 'safety.incident.anonymous', decisionKey: 'safety.anonymousReport', label: '익명 사고 보고' },
  { key: 'safety.harmLevelScale', decisionKey: 'safety.harmLevelScale', label: '위해 정도 척도' },
  { key: 'accreditation.framework', decisionKey: 'accreditation.framework', label: '인증 체계' },
  { key: 'safety.poa.required', decisionKey: 'safety.poaFlag', label: 'POA 입력 필수' },
] as const;
export type QiFlowSettingKey = (typeof QI_FLOW_SETTING_KEYS)[number]['key'];

/**
 * QI 흐름 설정 값 규칙(2026-10-09) — 범용 설정 저장(관리자)과 집행 엔진이 **같은 규칙**으로 거른다.
 * 🔴 기능이 알아듣지 못하는 값은 저장되면 "정해짐"으로 보이는데 동작은 미설정과 같다(안 먹는 다이얼) — 저장 단계에서 막는다.
 * null = 미설정(되돌리기)으로 허용한다.
 */
export const QI_FLOW_SETTING_ALLOWED: Record<string, readonly (string | boolean)[] | 'DATE'> = {
  'qi.autoMeasure.enabled': [true, false],
  'qi.autoMeasure.incidentDenominator': QI_INCIDENT_DENOMINATORS,
  'qi.deviceDays.source': ['MANUAL', 'NONE', 'DEVICE_LEDGER'],
  'qi.autoManual.precedence': QI_PRECEDENCES,
  'qi.indicator.directEdit': ['ALLOW_WITH_REASON', 'AGENDA_ONLY'],
  'safety.incident.anonymous': [true, false],
  'safety.harmLevelScale': Object.keys(SAFETY_HARM_SCALES),
  'accreditation.framework': [...ACCREDITATION_FRAMEWORKS, 'BOTH'],
  'qi.deviceLedger.coverageFrom': 'DATE',
  'safety.poa.required': [true, false],
};

/**
 * 진단별 입원 시 존재(POA · 2026-10-09) — 입원 기간 진단마다 하나.
 * 🔴 원내 코딩 지침이 정해지기 전이라 세 값만 둔다(외부 체계의 세부 값을 지어 넣지 않는다).
 */
export const POA_VALUES = ['Y', 'N', 'U'] as const;
export type PoaValue = (typeof POA_VALUES)[number];
export const POA_LABEL: Record<PoaValue, string> = {
  Y: '입원 시 있었음', N: '입원 후 발생', U: '기록으로 판단 불가',
};

/** 규칙이 있는 키면 값 검사 결과, 규칙 밖 키면 null(판정하지 않음) */
export function qiFlowSettingInvalidReason(key: string, value: unknown, today: Date = new Date()): string | null | undefined {
  const rule = QI_FLOW_SETTING_ALLOWED[key];
  if (!rule) return undefined;
  if (value === null) return null;
  if (rule === 'DATE') {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return 'YYYY-MM-DD 형식이어야 합니다';
    const [y, m, d] = value.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return '없는 날짜입니다';
    if (dt > today) return '미래 날짜는 선언할 수 없습니다';
    return null;
  }
  return (rule as readonly unknown[]).includes(value) ? null : `허용 값: ${rule.map(String).join(' · ')}`;
}
