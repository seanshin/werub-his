/**
 * 만성질환 지표 어휘 — 🔴 정본은 web `src/app/portal/_health/HealthTab.tsx` 의 CHRONIC_LABEL.
 * 모바일은 `@hospital-run/shared` 를 import 할 수 없어 **의도적 미러**로 둔다(lab-flags.ts 와 같은 관례).
 * web 가드(chronic-label-mirror)가 두 파일을 기계 대조한다 — 여기만 고치면 갈라진다.
 */
export const CHRONIC_LABEL: Record<string, string> = { HBA1C: '당화혈색소', FBS: '공복혈당', PPG: '식후혈당', SBP: '수축기혈압', DBP: '이완기혈압', WEIGHT: '체중', BMI: 'BMI', LDL: 'LDL', TG: '중성지방', CR: '크레아티닌', EGFR: 'eGFR' };

/** 서버 portal/chronic-observations 의 ALLOWED 와 같은 목록(자가측정 가능 지표) */
export const SMBG_CODES: { code: string; label: string; unit: string; placeholder: string }[] = [
  { code: 'SBP', label: '수축기혈압', unit: 'mmHg', placeholder: '120' },
  { code: 'DBP', label: '이완기혈압', unit: 'mmHg', placeholder: '80' },
  { code: 'FBS', label: '공복혈당', unit: 'mg/dL', placeholder: '95' },
  { code: 'PPG', label: '식후혈당', unit: 'mg/dL', placeholder: '140' },
  { code: 'WEIGHT', label: '체중', unit: 'kg', placeholder: '65' },
];

/** 서버 classifyTrend 의 어휘 — 판정은 서버가 하고 화면은 번역만 한다(로컬 재판정 금지) */
export const TREND_LABEL: Record<string, { text: string; color: string }> = {
  IMPROVING: { text: '개선', color: '#10B981' },
  WORSENING: { text: '악화', color: '#EF4444' },
  STABLE: { text: '안정', color: '#6B7280' },
};
