/**
 * 전문과 차트 템플릿 프리셋 확충 (Track 1) — 프리셋 갭 10과
 * 안과·이비인후과·피부과·신경외과·비뇨의학과·치과·재활의학과·성형외과·가정의학과·신장내과
 *
 * - 순수 데이터(Nest 의존 없음) → chart-template.service PRESETS 병합 + 시드에서 재사용.
 * - 'clinical-chart' 필드로 임상도구(lib/clinical-charts 78종)를 임베드(GCS·NIHSS·PI-RADS·Barthel·BMI·CKD 등).
 * - 제외: 방사선종양·혈액은행(플랜/오더 중심 워크플로 모듈 — SOAP 차트 템플릿 부적합).
 */

export interface SpecialtyPresetSection {
  id: string;
  title: string;
  icon?: string;
  columns?: number;
  collapsible?: boolean;
  defaultOpen?: boolean;
  fields: Array<Record<string, unknown>>;
}

export interface SpecialtyPreset {
  name: string;
  department: string;
  role: string;
  category: string;
  layout: string;
  sections: SpecialtyPresetSection[];
}

const assessPlan = (idPrefix: string): SpecialtyPresetSection => ({
  id: `${idPrefix}-ap`, title: '평가/계획', fields: [
    { id: `${idPrefix}-dx`, type: 'diagnosis-search', label: '진단코드', codeSystem: 'KCD', multiple: true, mappedTo: 'assessment' },
    { id: `${idPrefix}-plan`, type: 'textarea', label: '치료계획', rows: 3, mappedTo: 'plan' },
  ],
});

export const SPECIALTY_PRESETS: Record<string, SpecialtyPreset> = {
  'ophthalmology-outpatient': {
    name: '안과 외래 진료', department: '안과', role: 'DOCTOR', category: 'OUTPATIENT', layout: 'tabs',
    sections: [
      { id: 's1', title: '주관적 (S)', fields: [
        { id: 'f1', type: 'textarea', label: '주호소', rows: 3, required: true, mappedTo: 'subjective' },
      ]},
      { id: 's2', title: '안과 검사 (O)', columns: 2, fields: [
        { id: 'f2', type: 'text', label: '시력 우안 (나안/교정)', placeholder: '0.5 / 1.0' },
        { id: 'f3', type: 'text', label: '시력 좌안 (나안/교정)', placeholder: '0.5 / 1.0' },
        { id: 'f4', type: 'number', label: '안압 우안 (mmHg)', min: 0, max: 80 },
        { id: 'f5', type: 'number', label: '안압 좌안 (mmHg)', min: 0, max: 80 },
        { id: 'f6', type: 'textarea', label: '세극등 소견', rows: 3, mappedTo: 'objective' },
        { id: 'f7', type: 'textarea', label: '안저 소견', rows: 3 },
      ]},
      assessPlan('oph'),
    ],
  },
  'ent-outpatient': {
    name: '이비인후과 외래 진료', department: '이비인후과', role: 'DOCTOR', category: 'OUTPATIENT', layout: 'tabs',
    sections: [
      { id: 's1', title: '주관적 (S)', fields: [
        { id: 'f1', type: 'textarea', label: '주호소', rows: 3, required: true, mappedTo: 'subjective' },
      ]},
      { id: 's2', title: '이학적 검사 (O)', columns: 2, fields: [
        { id: 'f2', type: 'select', label: '고막 (우)', options: ['정상', '발적', '천공', '삼출', '함몰'] },
        { id: 'f3', type: 'select', label: '고막 (좌)', options: ['정상', '발적', '천공', '삼출', '함몰'] },
        { id: 'f4', type: 'number', label: 'PTA 우 (dB)', min: 0, max: 120 },
        { id: 'f5', type: 'number', label: 'PTA 좌 (dB)', min: 0, max: 120 },
        { id: 'f6', type: 'textarea', label: '비강/인후 소견', rows: 3, mappedTo: 'objective' },
      ]},
      assessPlan('ent'),
    ],
  },
  'dermatology-outpatient': {
    name: '피부과 외래 진료', department: '피부과', role: 'DOCTOR', category: 'OUTPATIENT', layout: 'tabs',
    sections: [
      { id: 's1', title: '주관적 (S)', fields: [
        { id: 'f1', type: 'textarea', label: '주호소·경과', rows: 3, required: true, mappedTo: 'subjective' },
      ]},
      { id: 's2', title: '병변 평가 (O)', fields: [
        { id: 'f2', type: 'text', label: '병변 부위' },
        { id: 'f3', type: 'multiselect', label: '병변 형태', options: ['반점', '구진', '판', '결절', '수포', '농포', '인설', '미란', '궤양', '태선화'] },
        { id: 'f4', type: 'select', label: 'Fitzpatrick 피부형', options: ['I', 'II', 'III', 'IV', 'V', 'VI'] },
        { id: 'f5', type: 'textarea', label: '병변 기술', rows: 3, mappedTo: 'objective' },
        { id: 'f6', type: 'photo-capture', label: '병변 사진' },
      ]},
      assessPlan('derm'),
    ],
  },
  'neurosurgery-outpatient': {
    name: '신경외과 외래 진료', department: '신경외과', role: 'DOCTOR', category: 'OUTPATIENT', layout: 'tabs',
    sections: [
      { id: 's1', title: '주관적 (S)', fields: [
        { id: 'f1', type: 'textarea', label: '주호소·신경학적 증상', rows: 3, required: true, mappedTo: 'subjective' },
      ]},
      { id: 's2', title: '신경학적 평가 (O)', fields: [
        { id: 'f2', type: 'clinical-chart', label: 'GCS (의식수준)', clinicalChartId: 'GCS' },
        { id: 'f3', type: 'clinical-chart', label: 'NIHSS (뇌졸중 의심 시)', clinicalChartId: 'NIHSS' },
        { id: 'f4', type: 'text', label: '동공 (우/좌, 크기·반응)' },
        { id: 'f5', type: 'textarea', label: '운동/감각 소견', rows: 3, mappedTo: 'objective' },
      ]},
      assessPlan('ns'),
    ],
  },
  'urology-outpatient': {
    name: '비뇨의학과 외래 진료', department: '비뇨의학과', role: 'DOCTOR', category: 'OUTPATIENT', layout: 'tabs',
    sections: [
      { id: 's1', title: '주관적 (S)', fields: [
        { id: 'f1', type: 'textarea', label: '주호소·배뇨 증상', rows: 3, required: true, mappedTo: 'subjective' },
      ]},
      { id: 's2', title: '평가 (O)', columns: 2, fields: [
        { id: 'f2', type: 'number', label: 'PSA (ng/mL)', min: 0, max: 1000 },
        { id: 'f3', type: 'number', label: 'IPSS 총점 (0-35)', min: 0, max: 35 },
        { id: 'f4', type: 'number', label: '전립선 용적 (cc)', min: 0, max: 300 },
        { id: 'f5', type: 'textarea', label: '이학적 소견', rows: 3, mappedTo: 'objective' },
        { id: 'f6', type: 'clinical-chart', label: 'PI-RADS (MRI 판독 시)', clinicalChartId: 'PIRADS' },
      ]},
      assessPlan('uro'),
    ],
  },
  'dental-outpatient': {
    name: '치과 외래 진료', department: '치과', role: 'DOCTOR', category: 'OUTPATIENT', layout: 'tabs',
    sections: [
      { id: 's1', title: '주관적 (S)', fields: [
        { id: 'f1', type: 'textarea', label: '주호소', rows: 3, required: true, mappedTo: 'subjective' },
        { id: 'f2', type: 'text', label: '치식 (FDI)', placeholder: '예: 36, 37' },
      ]},
      { id: 's2', title: '검사 (O)', fields: [
        { id: 'f3', type: 'multiselect', label: '소견', options: ['우식', '치수염', '치주염', '파절', '농양', '매복', '결손', '보철물 이상'] },
        { id: 'f4', type: 'textarea', label: '구강 검사 소견', rows: 3, mappedTo: 'objective' },
      ]},
      { id: 's3', title: '치료계획 (P)', fields: [
        { id: 'f5', type: 'diagnosis-search', label: '진단코드', codeSystem: 'KCD', multiple: true, mappedTo: 'assessment' },
        { id: 'f6', type: 'textarea', label: '치료계획', rows: 3, mappedTo: 'plan' },
        { id: 'f7', type: 'checkbox', label: '국소마취 시행' },
      ]},
    ],
  },
  'rehab-outpatient': {
    name: '재활의학과 외래 진료', department: '재활의학과', role: 'DOCTOR', category: 'OUTPATIENT', layout: 'tabs',
    sections: [
      { id: 's1', title: '주관적 (S)', fields: [
        { id: 'f1', type: 'textarea', label: '주호소·기능 저하 경과', rows: 3, required: true, mappedTo: 'subjective' },
      ]},
      { id: 's2', title: '기능 평가 (O)', fields: [
        { id: 'f2', type: 'clinical-chart', label: 'Barthel Index (ADL)', clinicalChartId: 'BARTHEL' },
        { id: 'f3', type: 'clinical-chart', label: 'Lawton IADL', clinicalChartId: 'LAWTON' },
        { id: 'f4', type: 'textarea', label: 'ROM/근력 평가', rows: 3, mappedTo: 'objective' },
      ]},
      { id: 's3', title: '평가/치료처방 (P)', fields: [
        { id: 'f5', type: 'diagnosis-search', label: '진단코드', codeSystem: 'KCD', multiple: true, mappedTo: 'assessment' },
        { id: 'f6', type: 'multiselect', label: '치료 처방', options: ['물리치료', '작업치료', '연하치료', '언어치료', '통증치료'] },
        { id: 'f7', type: 'textarea', label: '치료계획', rows: 3, mappedTo: 'plan' },
      ]},
    ],
  },
  'plastic-outpatient': {
    name: '성형외과 외래 진료', department: '성형외과', role: 'DOCTOR', category: 'OUTPATIENT', layout: 'tabs',
    sections: [
      { id: 's1', title: '상담/주호소 (S)', fields: [
        { id: 'f1', type: 'textarea', label: '주호소·상담 내용', rows: 3, required: true, mappedTo: 'subjective' },
      ]},
      { id: 's2', title: '평가 (O)', fields: [
        { id: 'f2', type: 'text', label: '부위' },
        { id: 'f3', type: 'select', label: 'Fitzpatrick 피부형', options: ['I', 'II', 'III', 'IV', 'V', 'VI'] },
        { id: 'f4', type: 'textarea', label: '진찰 소견', rows: 3, mappedTo: 'objective' },
        { id: 'f5', type: 'photo-capture', label: '수술 전 사진' },
      ]},
      { id: 's3', title: '수술/시술 계획 (P)', fields: [
        { id: 'f6', type: 'text', label: '예정 술식' },
        { id: 'f7', type: 'textarea', label: '계획·동의 설명', rows: 3, mappedTo: 'plan' },
      ]},
    ],
  },
  'family-medicine-outpatient': {
    name: '가정의학과 외래 진료', department: '가정의학과', role: 'DOCTOR', category: 'OUTPATIENT', layout: 'tabs',
    sections: [
      { id: 's1', title: '주관적/생활습관 (S)', fields: [
        { id: 'f1', type: 'textarea', label: '주호소', rows: 3, required: true, mappedTo: 'subjective' },
        { id: 'f2', type: 'select', label: '흡연', options: ['비흡연', '과거 흡연', '현재 흡연'] },
        { id: 'f3', type: 'select', label: '음주', options: ['비음주', '월 1-2회', '주 1-2회', '주 3회 이상'] },
      ]},
      { id: 's2', title: '평가 (O)', fields: [
        { id: 'f4', type: 'vitals', label: '활력징후' },
        { id: 'f5', type: 'clinical-chart', label: 'BMI', clinicalChartId: 'BMI' },
        { id: 'f6', type: 'clinical-chart', label: 'PHQ-9 (우울 선별, 필요 시)', clinicalChartId: 'PHQ9' },
      ]},
      assessPlan('fm'),
    ],
  },
  'nephrology-outpatient': {
    name: '신장내과 외래 진료', department: '신장내과', role: 'DOCTOR', category: 'OUTPATIENT', layout: 'tabs',
    sections: [
      { id: 's1', title: '주관적 (S)', fields: [
        { id: 'f1', type: 'textarea', label: '주호소·기저질환', rows: 3, required: true, mappedTo: 'subjective' },
      ]},
      { id: 's2', title: '신기능 평가 (O)', fields: [
        { id: 'f2', type: 'clinical-chart', label: 'KDIGO CKD GFR 범주', clinicalChartId: 'CKD_GFR' },
        { id: 'f3', type: 'clinical-chart', label: 'Cockcroft-Gault (CrCl)', clinicalChartId: 'COCKCROFT' },
        { id: 'f4', type: 'number', label: 'ACR (mg/g)', min: 0, max: 10000 },
        { id: 'f5', type: 'textarea', label: '부종/요검사 소견', rows: 3, mappedTo: 'objective' },
      ]},
      assessPlan('neph'),
    ],
  },
};
