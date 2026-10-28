export type FieldType =
  | 'text' | 'textarea' | 'number' | 'select' | 'multiselect' | 'checkbox' | 'date' | 'slider' | 'time'
  | 'vitals' | 'diagnosis-search' | 'medication-search' | 'procedure-search' | 'lab-reference' | 'body-diagram' | 'pain-scale' | 'growth-chart' | 'score-calculator' | 'clinical-chart'
  | 'prescription' | 'order' | 'timeline' | 'signature' | 'photo-capture' | 'checklist';

/** 조건부 표시 — 대상 필드 값이 조건을 충족할 때만 렌더 (ChartRenderer 평가) */
export type ShowWhenOp = 'eq' | 'ne' | 'gt' | 'lt' | 'notEmpty';
export interface ShowWhen {
  fieldId: string;
  op: ShowWhenOp;
  value?: string | number;
}

export type SoapMapping = 'subjective' | 'objective' | 'assessment' | 'plan' | 'vitals';
/** 진료 화면 렌더러/합성기가 실제로 읽는 매핑 값 — 이 밖의 값은 '지정 안 함'으로 취급된다. */
export const SOAP_SLOT_VALUES = ['subjective', 'objective', 'assessment', 'plan'] as const;
export type CalculatorType = 'MORSE' | 'BRADEN_SCALE' | 'GCS' | 'APACHE_II' | 'SOFA' | 'GAF';
export type CodeSystemType = 'KCD' | 'EDI' | '';

export interface FieldDef {
  id: string;
  type: FieldType;
  label: string;
  placeholder?: string;
  required?: boolean;
  rows?: number;
  options?: string[];
  /**
   * 저장 위치(SOAP 슬롯) — **정본**. 진료 화면 렌더러·SOAP 합성기가 읽는 유일한 키.
   * 값이 없거나 SOAP 슬롯이 아니면 '객관적 소견(O)' 의 `[차트: … · SOAP 미지정]` 블록에 라벨과 함께 저장된다.
   */
  mappedTo?: string;
  /**
   * @deprecated 🔴 E3 — 에디터만 쓰고 렌더러/저장은 읽지 않던 두 번째 매핑 키(프리셋 실측 0곳).
   * 서버가 저장 시점에 `mappedTo` 로 흡수하고 제거한다. 새 코드는 쓰지 말 것.
   */
  soapMapping?: SoapMapping | '';
  aiAssist?: boolean;
  codeSystem?: CodeSystemType;
  calculator?: CalculatorType | '';
  autoLoad?: boolean;
  durCheck?: boolean;
  min?: number;
  max?: number;
  multiple?: boolean;
  clinicalChartId?: string;
  showWhen?: ShowWhen;
}

export interface Section {
  id: string;
  title: string;
  fields: FieldDef[];
  columns?: 1 | 2 | 3;
  icon?: string;
  collapsible?: boolean;
  defaultOpen?: boolean;
  collapsed?: boolean;
}

export interface ChartTemplate {
  id: string;
  name: string;
  department: string;
  role: string;
  category: string;
  layout: 'tabs' | 'accordion' | 'single-page' | 'side-by-side';
  sections: Section[];
  isPersonal?: boolean;
  ownerId?: string | null;
  usageCount?: number;
  lastUsedAt?: string | null;
  createdAt: string;
  updatedAt?: string;
}

export interface Preset {
  key: string;
  name: string;
  department: string;
  role: string;
  sectionCount: number;
  fieldCount: number;
}

export const PALETTE: { category: string; fields: { type: FieldType; label: string }[] }[] = [
  {
    category: '기본',
    fields: [
      { type: 'text', label: '텍스트' }, { type: 'textarea', label: '텍스트 영역' },
      { type: 'number', label: '숫자' }, { type: 'select', label: '선택' },
      { type: 'multiselect', label: '다중 선택' }, { type: 'checkbox', label: '체크박스' },
      { type: 'date', label: '날짜' }, { type: 'time', label: '시간' }, { type: 'slider', label: '슬라이더' },
      { type: 'checklist', label: '체크리스트' },
    ],
  },
  {
    category: '의료',
    fields: [
      { type: 'vitals', label: '활력징후' }, { type: 'diagnosis-search', label: '진단 검색' },
      { type: 'medication-search', label: '약물 검색' }, { type: 'procedure-search', label: '처치 검색' },
      { type: 'lab-reference', label: '검사 참조' },
      { type: 'body-diagram', label: '신체 도식' }, { type: 'pain-scale', label: '통증 척도' },
      { type: 'growth-chart', label: '성장 차트' }, { type: 'score-calculator', label: '점수 계산기' },
      { type: 'clinical-chart', label: '임상도구(점수·계산·분류)' },
    ],
  },
  {
    category: '고급',
    fields: [
      { type: 'prescription', label: '처방전' }, { type: 'order', label: '오더' },
      { type: 'timeline', label: '타임라인' }, { type: 'signature', label: '서명' },
      { type: 'photo-capture', label: '사진 촬영' },
    ],
  },
];

export const uid = () => Math.random().toString(36).slice(2, 9);

// DEPT_OPTIONS 제거(2026-08-24 P1) — 진료과 목록 정본은 useDepartments(마스터). '소아과'·'신경과' 이표기가 여기서 갈라지고 있었다

/**
 * 🔴 E10 — 종전 ROLE/CATEGORY 는 **한글 문자열을 그대로 저장**했다(`role:'의사'`·`category:'초진'`).
 *    진료 화면 목록(`GET /chart-templates/for-me`)은 영문 역할 enum 으로 조회하므로, 이 화면에서 만든
 *    템플릿은 관리자 목록에만 보이고 **진료 화면에는 영원히 안 떴다**(운영 한글 role 0건 = 잠재 결함).
 *    화면은 한글로 보여주되 저장·조회는 계약값(영문 코드)으로 한다.
 */
export interface OptionDef { value: string; label: string }

export const ROLE_OPTIONS: OptionDef[] = [
  { value: '', label: '전체' },
  { value: 'DOCTOR', label: '의사' },
  { value: 'NURSE', label: '간호사' },
  { value: 'RADIOLOGIST', label: '영상의학' },
  { value: 'LAB_TECH', label: '임상병리사' },
  { value: 'PHARMACIST', label: '약사' },
  { value: 'NUTRITION', label: '영양(급양)' },
  { value: 'MEDICAL_RECORDS', label: '의무기록' },
  { value: 'RECEPTIONIST', label: '원무' },
  { value: 'CHECKUP', label: '건강검진' },
  { value: 'ADMIN_STAFF', label: '행정' },
];

export const CATEGORY_OPTIONS: OptionDef[] = [
  { value: 'OUTPATIENT', label: '외래' },
  { value: 'INPATIENT', label: '입원' },
  { value: 'EMERGENCY', label: '응급' },
  { value: 'SURGERY', label: '수술' },
  { value: 'NURSING', label: '간호' },
  { value: 'LAB', label: '검사' },
  { value: 'CHECKUP', label: '건강검진' },
  { value: 'ICU', label: '중환자' },
  { value: 'REHAB', label: '재활' },
  { value: 'OTHER', label: '기타' },
];

export const roleLabel = (v: string) => ROLE_OPTIONS.find((o) => o.value === v)?.label ?? v;
export const categoryLabel = (v: string) => CATEGORY_OPTIONS.find((o) => o.value === v)?.label ?? v;
export const LAYOUT_OPTIONS: { value: ChartTemplate['layout']; label: string }[] = [
  { value: 'tabs', label: '탭' },
  { value: 'accordion', label: '아코디언' },
  { value: 'single-page', label: '단일 페이지' },
  { value: 'side-by-side', label: '좌우 분할' },
];

/**
 * 저장 위치 선택지 — `mappedTo` 에 쓴다.
 * 🔴 종전엔 'V - 활력징후'(vitals) 도 골라졌지만 SOAP 슬롯이 아니라 저장 경로가 없었다(고르면 값이 샜다).
 *    실제로 저장되는 4슬롯만 남기고, 미지정이 어디로 가는지도 라벨에 적는다.
 */
export const SOAP_OPTIONS: { value: '' | 'subjective' | 'objective' | 'assessment' | 'plan'; label: string }[] = [
  { value: '', label: '지정 안 함 — 객관적 소견(O)에 [SOAP 미지정] 블록으로 저장' },
  { value: 'subjective', label: 'S - 주관적' },
  { value: 'objective', label: 'O - 객관적' },
  { value: 'assessment', label: 'A - 평가' },
  { value: 'plan', label: 'P - 계획' },
];

export const CALCULATOR_OPTIONS: { value: CalculatorType | ''; label: string }[] = [
  { value: '', label: '없음' },
  { value: 'MORSE', label: 'Morse 낙상 척도' },
  { value: 'BRADEN_SCALE', label: 'Braden 욕창 척도' },
  { value: 'GCS', label: 'Glasgow 혼수 척도' },
  { value: 'APACHE_II', label: 'APACHE II' },
  { value: 'SOFA', label: 'SOFA 점수' },
  { value: 'GAF', label: 'GAF 기능평가' },
];

export const SECTION_ICON_OPTIONS = [
  '', 'clipboard', 'heart', 'stethoscope', 'pill', 'syringe', 'thermometer',
  'eye', 'brain', 'bone', 'lungs', 'activity', 'file-text', 'alert-triangle',
];

export const SECTION_ICON_MAP: Record<string, string> = {
  'clipboard': '\uD83D\uDCCB', 'heart': '\u2764\uFE0F', 'stethoscope': '\uD83E\uDE7A',
  'pill': '\uD83D\uDC8A', 'syringe': '\uD83D\uDC89', 'thermometer': '\uD83C\uDF21\uFE0F',
  'eye': '\uD83D\uDC41\uFE0F', 'brain': '\uD83E\uDDE0', 'bone': '\uD83E\uDDB4',
  'lungs': '\uD83E\uDEC1', 'activity': '\uD83D\uDCC8', 'file-text': '\uD83D\uDCC4',
  'alert-triangle': '\u26A0\uFE0F',
};
