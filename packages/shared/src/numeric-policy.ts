/**
 * 수치 표시·반올림 정책 정본 (numeric-format-policy.plan.md P0).
 *
 * 화면·저장·청구·FHIR 출력이 **같은 정책**을 공유한다. 도메인별로 자릿수(또는 유효숫자)·
 * 반올림 모드·단위(표시/UCUM)·정상범위·표준·잠금을 한 곳에서 정의한다.
 * "체온은 소수 2자리 반올림" 같은 규칙은 이 파일(또는 config 오버라이드) 한 줄로 전역 반영된다.
 *
 * 🔴 표준 정렬: 단위는 UCUM, 측정은 LOINC(FHIR Vital Signs), 정밀도는 openEHR precision,
 *    검사수치는 CLSI 유효숫자. 임의 규칙이 아니라 표준 정책이다.
 */

export type RoundMode = 'round' | 'floor' | 'ceil' | 'bankers';

export interface NumericPolicy {
  key: string;
  label: string;
  /** 고정 소수 자릿수 (sigFigs 와 택일) */
  decimals?: number;
  /** 유효숫자 (검사수치 등 — CLSI 정합·decimals 와 택일) */
  sigFigs?: number;
  mode: RoundMode;
  /** 반올림 단위 (예: 본인부담 원단위 절사=10, mode=floor) */
  step?: number;
  displayUnit?: string;
  ucumUnit?: string;
  loincCode?: string;
  min?: number;
  max?: number;
  /** 법정·안전 제약 — 관리 화면에서 변경 금지(위원회 의결로만) */
  locked?: boolean;
  standard?: string;
  note?: string;
}

/** 도메인 정책 정본. 관리 화면·config 오버라이드가 이 기본을 덮는다(잠금 제외). */
export const NUMERIC_POLICIES: Record<string, NumericPolicy> = {
  temperature: { key: 'temperature', label: '체온', decimals: 1, mode: 'round', displayUnit: '℃', ucumUnit: 'Cel', loincCode: '8310-5', min: 36.0, max: 37.5, standard: 'FHIR/UCUM' },
  heartRate: { key: 'heartRate', label: '심박수', decimals: 0, mode: 'round', displayUnit: 'bpm', ucumUnit: '/min', loincCode: '8867-4', min: 60, max: 100, standard: 'FHIR/UCUM' },
  systolicBp: { key: 'systolicBp', label: '수축기혈압', decimals: 0, mode: 'round', displayUnit: 'mmHg', ucumUnit: 'mm[Hg]', loincCode: '8480-6', min: 90, max: 140, standard: 'FHIR/UCUM' },
  diastolicBp: { key: 'diastolicBp', label: '이완기혈압', decimals: 0, mode: 'round', displayUnit: 'mmHg', ucumUnit: 'mm[Hg]', loincCode: '8462-4', min: 60, max: 90, standard: 'FHIR/UCUM' },
  spo2: { key: 'spo2', label: 'SpO₂', decimals: 0, mode: 'round', displayUnit: '%', ucumUnit: '%', loincCode: '59408-5', min: 95, max: 100, standard: 'FHIR/UCUM' },
  respiratoryRate: { key: 'respiratoryRate', label: '호흡수', decimals: 0, mode: 'round', displayUnit: '/min', ucumUnit: '/min', loincCode: '9279-1', min: 12, max: 20, standard: 'FHIR/UCUM' },
  weight: { key: 'weight', label: '체중', decimals: 1, mode: 'round', displayUnit: 'kg', ucumUnit: 'kg', loincCode: '29463-7', standard: 'FHIR/UCUM' },
  height: { key: 'height', label: '신장', decimals: 1, mode: 'round', displayUnit: 'cm', ucumUnit: 'cm', loincCode: '8302-2', standard: 'FHIR/UCUM' },
  bmi: { key: 'bmi', label: 'BMI', decimals: 1, mode: 'round', displayUnit: 'kg/m²', ucumUnit: 'kg/m2', loincCode: '39156-5', standard: 'FHIR/UCUM' },
  bsa: { key: 'bsa', label: '체표면적', decimals: 2, mode: 'round', displayUnit: 'm²', ucumUnit: 'm2', locked: true, standard: 'Mosteller', note: '항암 용량=BSA×용량/m²' },
  percent: { key: 'percent', label: '백분율', decimals: 1, mode: 'round', displayUnit: '%', ucumUnit: '%' },
  // 경영성과 동급 편차(2026-09-28) — 비율의 차는 %가 아니라 %p 다(같은 단위로 그리면 '15%' 가 '15% 증가'로 읽힌다)
  percentPoint: { key: 'percentPoint', label: '퍼센트포인트', decimals: 1, mode: 'round', displayUnit: '%p' },
  // 손익 금액 — 병원 손익은 수백억 원대라 원 단위로 쓰면 읽히지 않는다(표시 전용 · 계산은 원)
  // 병상 수 중앙값(2026-09-28 경영성과 종별 개관) — 짝수 표본의 중앙값은 .5 가 된다 · 표시 전용
  bedCount: { key: 'bedCount', label: '병상 수', decimals: 0, mode: 'round', displayUnit: '병상', note: '병상 중앙값 표시 전용' },
  // 지도 확대 배율 표시(2026-09-28) — 임상 수치 아님
  zoomFactor: { key: 'zoomFactor', label: '확대 배율', decimals: 1, mode: 'round', note: '지도 확대 배율(×) 표시 전용' },
  moneyEok: { key: 'moneyEok', label: '금액(억원)', decimals: 1, mode: 'round', displayUnit: '억원', note: '표시 전용 — 값은 원 ÷ 1억' },
  seconds: { key: 'seconds', label: '초(지연·소요)', decimals: 1, mode: 'round', displayUnit: 's', ucumUnit: 's', note: 'AI 스킬 지연 등 시간 표시 — 임상 수치 아님' },
  labValue: { key: 'labValue', label: '검사수치(기본)', sigFigs: 3, mode: 'round', locked: true, standard: 'CLSI', note: '파생값 3 유효숫자·항목별 reference-range override' },
  // 🔴 의료질지표 측정값 — 저장 컬럼이 `Decimal(5,2)` 라 소수 2자리가 계약이다.
  //    2026-08-18: 이 키가 **미등재인 채로 `roundBy(v,'qiValue')` 가 호출되고 있었다** —
  //    `roundBy` 는 미등재 키에 원값을 그대로 돌려주므로 **반올림이 한 번도 일어나지 않았다**
  //    (정본을 부르는 모양만 갖춘 코드). 등재해서 계약을 실제로 지키게 한다.
  qiValue: { key: 'qiValue', label: '의료질지표 측정값', decimals: 2, mode: 'round', note: 'QiMeasurement.value = Decimal(5,2)' },
  // 🔴 진단 피폭 유효선량 — 저장 컬럼이 `RadiationExposure.effective_dose_msv = Decimal(8,3)` 라
  //    소수 3자리가 계약이다. 흉부 X선 0.02 mSv 처럼 **작은 값이 실제 임상값**이라 자리를 줄이면
  //    개별 촬영이 전부 `0.00` 으로 보인다(= 재서 0인 것처럼 보이는 다른 사실이 된다).
  //    2026-08-27 등재: 종전 화면이 `toFixed(2)`/`toFixed(3)` 을 직접 불러 정본 밖에 있었다.
  //    ⚠ 방사선**치료** 선량(Gy)은 다른 개념·다른 단위다 — 이 키를 쓰지 않는다.
  radiationDoseMsv: { key: 'radiationDoseMsv', label: '진단 피폭 유효선량', decimals: 3, mode: 'round', displayUnit: 'mSv', ucumUnit: 'mSv', standard: 'ICRP/UCUM', note: 'RadiationExposure.effectiveDoseMsv = Decimal(8,3) · 치료선량(Gy) 아님' },
  money: { key: 'money', label: '금액', decimals: 0, mode: 'round', displayUnit: '원', locked: true, standard: '통화', note: '통화 최소단위=원' },
  copay: { key: 'copay', label: '본인부담금', decimals: 0, mode: 'floor', step: 10, displayUnit: '원', locked: true, standard: '건보법', note: '10원 미만 절사(국민건강보험법 시행령)' },
  stayDays: { key: 'stayDays', label: '재원일수', decimals: 0, mode: 'ceil', min: 1, locked: true, standard: '입원료청구', note: 'max(1,ceil)' },
  stayDaysMean: { key: 'stayDaysMean', label: '평균 재원일수', decimals: 1, mode: 'round', displayUnit: '일', note: '개별 값은 stayDays(max(1,ceil)) — 그 평균의 표시 자릿수 · summarizeStayDays 정본' },
  outpatientStayMinutesMean: { key: 'outpatientStayMinutesMean', label: '평균 외래 체류', decimals: 1, mode: 'round', displayUnit: '분', note: '접수 → 수납 완료(결정 D8) · journey getMetrics 정본' },
  intraopVolumeMl: { key: 'intraopVolumeMl', label: '수술 중 수액·배출 합계', decimals: 1, mode: 'round', displayUnit: 'mL', ucumUnit: 'mL', note: '수술방 차트 요약 — 기록된 mL 의 합(합산 부동소수 잡음 제거용)' },
  intraopDoseSum: { key: 'intraopDoseSum', label: '수술 중 약물 용량 합계', decimals: 3, mode: 'round', note: '같은 약·같은 단위끼리만 더한다(단위 환산 없음)' },
  patientsPerNurse: { key: 'patientsPerNurse', label: '간호사 1인당 환자', decimals: 1, mode: 'round', displayUnit: '명', note: '간호 스테이션 보드 — 재원 환자 ÷ 간호사(배정·근무표) · 분모 0 이면 산출 불가(표시 전용)' },
  reviewLagHours: { key: 'reviewLagHours', label: '사고 검토 소요', decimals: 1, mode: 'round', displayUnit: '시간', note: '보고 → 첫 검토(REPORTED 를 벗어난 시각) · 중앙값·p90 표시 전용 · 표본 0 = 산출 불가' },
  positionMeters: { key: 'positionMeters', label: '원내 위치 좌표·측위 오차', decimals: 1, mode: 'round', displayUnit: 'm', ucumUnit: 'm', note: '무선 AP 측위 — 층 도면 좌표계(m) · 오차 반경 표시 · 임상 수치 아님(wifi-location 정본)' },
  psaDensity: { key: 'psaDensity', label: 'PSA 밀도', decimals: 2, mode: 'round', displayUnit: 'ng/mL/mL', note: 'PSA ÷ 전립선 용적(같은 검사 행의 두 값 · 서버 계산 urology psaDensity) · 판정 기준선은 원내 정책(코드에 두지 않음)' },
  wifiRssi: { key: 'wifiRssi', label: '무선 수신 세기', decimals: 0, mode: 'round', displayUnit: 'dBm', note: '수집기가 보고한 RSSI 원값 — 재반올림 없이 정수로만 표시' },
  erStayHoursMean: { key: 'erStayHoursMean', label: '평균 응급 체류', decimals: 1, mode: 'round', displayUnit: '시간', note: '도착 → 퇴실 시각(결정 D9 departedAt) · journey getMetrics 정본' },
  age: { key: 'age', label: '만나이', decimals: 0, mode: 'floor', displayUnit: '세', locked: true, standard: '만나이', note: '연·월·일 비교(ageOf)' },
};

/** 정책 조회 — 없으면 undefined(호출부가 폴백 결정) */
export function policyOf(key: string): NumericPolicy | undefined {
  return NUMERIC_POLICIES[key];
}

/** 반올림 모드 적용 (step 단위 지원) */
function applyMode(value: number, mode: RoundMode): number {
  switch (mode) {
    case 'floor': return Math.floor(value);
    case 'ceil': return Math.ceil(value);
    case 'bankers': {
      // 은행가 반올림(round-half-to-even) — .5 는 가까운 짝수로
      const floor = Math.floor(value);
      const diff = value - floor;
      if (diff < 0.5) return floor;
      if (diff > 0.5) return floor + 1;
      return floor % 2 === 0 ? floor : floor + 1;
    }
    default: return Math.round(value);
  }
}

/** 유효숫자로 반올림 (CLSI) — 0 은 그대로 */
function roundSigFigs(value: number, sig: number): number {
  if (value === 0 || !Number.isFinite(value)) return value;
  const d = Math.ceil(Math.log10(Math.abs(value)));
  const power = sig - d;
  const mag = Math.pow(10, power);
  // 문자열 파싱으로 부동소수점 잔차 방지(date-serializer 교훈)
  return Number((Math.round(value * mag) / mag).toPrecision(sig));
}

/**
 * 정책대로 값 반올림 — 저장·청구·비교용. 정책이 없으면 입력을 그대로 반환.
 * override 로 config 값(자릿수·모드)을 주입할 수 있다(잠금 정책은 호출부가 무시).
 */
export function roundBy(
  value: number | null | undefined,
  key: string,
  override?: Partial<Pick<NumericPolicy, 'decimals' | 'sigFigs' | 'mode' | 'step'>>,
): number | null {
  if (value == null || !Number.isFinite(Number(value))) return null;
  const v = Number(value);
  const p = NUMERIC_POLICIES[key];
  if (!p) return v;
  const mode = override?.mode ?? p.mode;
  const step = override?.step ?? p.step;
  const sigFigs = override?.sigFigs ?? p.sigFigs;
  const decimals = override?.decimals ?? p.decimals ?? 0;

  if (sigFigs != null) return roundSigFigs(v, sigFigs);
  if (step && step > 1) return applyMode(v / step, mode) * step;
  const mag = Math.pow(10, decimals);
  // Number(문자열) 로 마무리해 곱셈 부동소수점 잔차 제거
  return Number((applyMode(v * mag, mode) / mag).toFixed(decimals));
}

/**
 * 정책대로 표시 문자열 — null 안전·단위 포함(opts.unit 기본 true).
 * "38.2℃" 처럼 표시 단위를 붙인다. 값 계산은 roundBy 와 동일 정책.
 */
export function formatNum(
  value: number | null | undefined,
  key: string,
  opts?: { unit?: boolean; fallback?: string; override?: Partial<NumericPolicy> },
): string {
  const fallback = opts?.fallback ?? '-';
  const rounded = roundBy(value, key, opts?.override);
  if (rounded == null) return fallback;
  const p = NUMERIC_POLICIES[key];
  const decimals = opts?.override?.decimals ?? p?.decimals;
  // 고정 자릿수면 trailing zero 유지(36.50), 유효숫자/정수면 자연 표기
  const text = decimals != null ? rounded.toFixed(decimals) : String(rounded);
  const unit = (opts?.unit ?? true) ? (opts?.override?.displayUnit ?? p?.displayUnit ?? '') : '';
  return unit ? `${text}${unit}` : text;
}
