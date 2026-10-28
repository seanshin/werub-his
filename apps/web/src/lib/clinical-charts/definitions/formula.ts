/**
 * Formula 아키타입 콘텐츠 (변수 입력 → 화이트리스트 수식 계산)
 * 출처: clinical-charts 01·04·08·11 문서.
 * ⚠️ verified=false — 공식 원문 대조 필수. GFR 캡 등 기관 정책 확인. 보조도구·최종판단 의사 귀속.
 */
import type { FormulaDef } from '../types';

export const FORMULA_DEFS: FormulaDef[] = [
  {
    chartId: 'BSA_MOSTELLER', name: '체표면적 BSA (Mosteller)', category: '종양/약물', archetype: 'formula',
    sourceGuideline: 'Mosteller', sourceVersion: '1987', verified: false,
    variables: [
      { key: 'height', label: '신장', unit: 'cm', min: 30, max: 250 },
      { key: 'weight', label: '체중', unit: 'kg', min: 1, max: 400 },
    ],
    expr: 'sqrt(height*weight/3600)', resultUnit: 'm²', resultLabel: 'BSA',
  },
  {
    chartId: 'COCKCROFT', name: 'Cockcroft-Gault (크레아티닌 청소율)', category: '약물/신장', archetype: 'formula',
    sourceGuideline: 'Cockcroft & Gault', sourceVersion: '1976', verified: false,
    note: '여성은 성별계수 0.85 선택. 비만/부종 시 보정 체중 고려. 기관 GFR 캡 정책 확인.',
    variables: [
      { key: 'age', label: '나이', unit: '세', min: 1, max: 120 },
      { key: 'weight', label: '체중', unit: 'kg', min: 1, max: 400 },
      { key: 'scr', label: '혈청 크레아티닌', unit: 'mg/dL', min: 0.1, max: 25 },
      { key: 'sexFactor', label: '성별계수(남1.0 / 여0.85)', unit: '', min: 0.85, max: 1 },
    ],
    expr: '((140-age)*weight)/(72*scr)*sexFactor', resultUnit: 'mL/min', resultLabel: 'CrCl',
    bands: [
      { min: 0, max: 14.999, label: '말기(<15)', level: 'critical' },
      { min: 15, max: 29.999, label: '중증 저하', level: 'high' },
      { min: 30, max: 59.999, label: '중등도 저하', level: 'moderate' },
      { min: 60, max: 89.999, label: '경도 저하', level: 'low' },
      { min: 90, max: 9999, label: '정상', level: 'normal' },
    ],
  },
  {
    chartId: 'CALVERT', name: 'Carboplatin 용량 (Calvert)', category: '종양', archetype: 'formula',
    sourceGuideline: 'Calvert', sourceVersion: '1989', verified: false,
    note: 'GFR은 통상 Cockcroft-Gault CrCl 대입. 기관별 GFR 상한 캡 적용 여부 확인. target AUC는 레지멘별 상이.',
    variables: [
      { key: 'auc', label: 'target AUC', unit: '', min: 1, max: 10 },
      { key: 'gfr', label: 'GFR', unit: 'mL/min', min: 1, max: 200 },
    ],
    expr: 'auc*(gfr+25)', resultUnit: 'mg', resultLabel: 'Carboplatin 용량',
  },
  {
    chartId: 'BMI', name: '체질량지수 BMI', category: '대사', archetype: 'formula',
    sourceGuideline: '대한비만학회', sourceVersion: '2022', verified: false,
    note: '국내(아시아-태평양) 기준 적용 — ≥25 비만. WHO 기준과 다름.',
    variables: [
      { key: 'height', label: '신장', unit: 'cm', min: 30, max: 250 },
      { key: 'weight', label: '체중', unit: 'kg', min: 1, max: 400 },
    ],
    expr: 'weight/((height/100)*(height/100))', resultUnit: 'kg/m²', resultLabel: 'BMI',
    bands: [
      { min: 0, max: 18.499, label: '저체중', level: 'low' },
      { min: 18.5, max: 22.999, label: '정상', level: 'normal' },
      { min: 23, max: 24.999, label: '과체중', level: 'low' },
      { min: 25, max: 29.999, label: '비만 1단계', level: 'moderate' },
      { min: 30, max: 34.999, label: '비만 2단계', level: 'high' },
      { min: 35, max: 999, label: '비만 3단계', level: 'critical' },
    ],
  },
  {
    chartId: 'MELD_NA', name: 'MELD-Na (간이식 우선순위)', category: '소화기', archetype: 'formula',
    sourceGuideline: 'UNOS', sourceVersion: '2016', verified: false,
    note: '실제 적용 시 각 변수 하한 1.0 클램프·상한·투석 보정 규칙이 있음. 본 식은 단순화 — 운영 전 공식 산식 확정 필수.',
    variables: [
      { key: 'bili', label: '빌리루빈', unit: 'mg/dL', min: 1, max: 50 },
      { key: 'inr', label: 'INR', unit: '', min: 1, max: 20 },
      { key: 'cr', label: '크레아티닌', unit: 'mg/dL', min: 1, max: 12 },
      { key: 'na', label: '나트륨', unit: 'mmol/L', min: 125, max: 137 },
    ],
    expr: 'round(3.78*ln(bili)+11.2*ln(inr)+9.57*ln(cr)+6.43+1.32*(137-na)-0.033*(137-na)*(137-na)/10)',
    resultUnit: '점', resultLabel: 'MELD-Na',
    bands: [
      { min: 0, max: 9, label: '낮음', level: 'low' },
      { min: 10, max: 19, label: '중등도', level: 'moderate' },
      { min: 20, max: 29, label: '높음', level: 'high' },
      { min: 30, max: 99, label: '매우 높음', level: 'critical' },
    ],
  },

  /* ── 측정값 → 밴드 (passthrough) ── */
  {
    chartId: 'AGATSTON', name: '관상동맥 석회 점수 (Agatston)', category: '영상', archetype: 'formula',
    sourceGuideline: 'Agatston', sourceVersion: '1990', verified: false,
    note: '측정된 총 석회 점수를 입력하면 죽상경화 부담을 분류.',
    variables: [ { key: 'score', label: '석회 점수', unit: 'AU', min: 0, max: 10000 } ],
    expr: 'score', resultUnit: 'AU', resultLabel: 'Agatston',
    bands: [
      { min: 0, max: 0, label: '없음', level: 'normal' },
      { min: 1, max: 10, label: '최소', level: 'low' },
      { min: 11, max: 100, label: '경증', level: 'low' },
      { min: 101, max: 400, label: '중등도', level: 'moderate' },
      { min: 401, max: 100000, label: '광범위', level: 'high' },
    ],
  },
  {
    chartId: 'T_SCORE', name: '골밀도 T-score (골다공증, WHO)', category: '영상', archetype: 'formula',
    sourceGuideline: 'WHO', sourceVersion: '', verified: false,
    note: 'DEXA T-score(음수 가능) 입력. 폐경 전·50세 미만·소아는 Z-score 사용. 밴드 매칭은 ≤-2.5 골다공증 우선.',
    variables: [ { key: 'tscore', label: 'T-score', unit: 'SD', min: -6, max: 3 } ],
    expr: 'tscore', resultUnit: 'SD', resultLabel: 'T-score',
    // 매칭 순서 주의: 골다공증(≤-2.5) → 정상(≥-1.0) → 골감소증(그 사이). bandFor는 첫 일치 반환.
    bands: [
      { min: -99, max: -2.5, label: '골다공증', level: 'high' },
      { min: -1.0, max: 99, label: '정상', level: 'normal' },
      { min: -2.5, max: -1.0, label: '골감소증', level: 'moderate' },
    ],
  },
  {
    chartId: 'DAS28_ESR', name: 'DAS28-ESR (류마티스 질병 활성도)', category: '류마티스', archetype: 'formula',
    sourceGuideline: 'EULAR', sourceVersion: '', verified: false,
    note: '28관절 기준. ESR 기반 식. GH=환자 전반건강 VAS(0–100).',
    variables: [
      { key: 'tjc', label: '압통 관절 수(28)', unit: '개', min: 0, max: 28 },
      { key: 'sjc', label: '종창 관절 수(28)', unit: '개', min: 0, max: 28 },
      { key: 'esr', label: 'ESR', unit: 'mm/hr', min: 1, max: 150 },
      { key: 'gh', label: '환자 전반건강(VAS)', unit: '0-100', min: 0, max: 100 },
    ],
    expr: '0.56*sqrt(tjc)+0.28*sqrt(sjc)+0.70*ln(esr)+0.014*gh',
    resultUnit: '', resultLabel: 'DAS28-ESR',
    bands: [
      { min: 0, max: 2.59, label: '관해', level: 'normal' },
      { min: 2.6, max: 3.2, label: '낮음', level: 'low' },
      { min: 3.21, max: 5.1, label: '중등도', level: 'moderate' },
      { min: 5.11, max: 99, label: '높음', level: 'high' },
    ],
  },
];
