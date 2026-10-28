/**
 * 의무기록 사본·환자 화면이 같이 쓰는 라벨(2026-10-13 결함 발굴 B5).
 * 🔴 종전 사본은 진단 확실도(의증·R/O)를 버려 확진처럼 나갔고, 만성질환 측정 코드 라벨은 포털 화면 한 곳에만 있었다.
 */

/** 진단 확실도 — 확진은 표기하지 않는다(기본) · 모르는 값은 코드 그대로(지어내지 않는다) */
export const DIAGNOSIS_CERTAINTY_LABEL: Readonly<Record<string, string>> = {
  CONFIRMED: '확진',
  PROVISIONAL: '의증',
  RULE_OUT: 'R/O',
  EXCLUDED: '배제',
};
/** 사본·인쇄에 붙이는 확실도 꼬리표 — 확진·미기재는 빈 문자열, 그 밖은 ` [의증]` 처럼 */
export function diagnosisCertaintySuffix(certainty: string | null | undefined): string {
  if (!certainty || certainty === 'CONFIRMED') return '';
  return ` [${DIAGNOSIS_CERTAINTY_LABEL[certainty] ?? certainty}]`;
}

/** 만성질환 측정 코드(ChronicObservation.code) — 모르는 코드는 코드 그대로 */
export const CHRONIC_OBSERVATION_LABEL: Readonly<Record<string, string>> = {
  HBA1C: '당화혈색소', FBS: '공복혈당', PPG: '식후혈당', SBP: '수축기혈압', DBP: '이완기혈압', WEIGHT: '체중', BMI: 'BMI', LDL: 'LDL', TG: '중성지방', CR: '크레아티닌', EGFR: 'eGFR',
};
