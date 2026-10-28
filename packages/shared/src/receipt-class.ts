/**
 * 진료비 계산서·영수증 **법정 항목 분류** 정본 (의료법 시행규칙 별지 제11호 서식의 항목).
 *
 * 🔴 (2026-10-14 수납·청구 결함 발굴 P2-1) 종전엔 화면 두 곳(영수증 인쇄·수납 상세)이 각자 표를 들고
 *    청구 라인의 `codeType` 만으로 칸을 정했다. 그런데 서버가 만드는 **진찰료 라인은 `PROCEDURE`**,
 *    입원료 라인도 `PROCEDURE` 라 둘 다 ⑨ 처치·수술료 칸에 들어갔고, ① 진찰료 칸이 늘 비자 영수증이
 *    **15,000원을 지어 넣었다**(공단·본인부담까지 비율로 지어냄). 칸 합이 합계 행과 맞지 않았다.
 *
 *    분류는 서버가 라인마다 `receiptClass` 로 정한다(진찰료·입원료 라인은 서버가 고른 코드로 안다).
 *    화면은 그 값을 쓰고, 없을 때(옛 응답)만 같은 함수로 `codeType` 에서 유도한다.
 *
 *    🔴 수가 코드의 분류 칸(`ProcedureCode.category`)은 대부분 비어 있다(운영 166,689건 중 미분류 거의 전부).
 *       이름이 서식 항목과 **정확히 같을 때만** 그 칸으로 보낸다 — 비슷한 이름을 짐작해 옮기지 않는다.
 */

export type ReceiptClassKey =
  | 'CONSULTATION' | 'ADMISSION' | 'MEAL' | 'MEDICATION' | 'INJECTION' | 'ANESTHESIA'
  | 'PHYSICAL_THERAPY' | 'PSYCHIATRIC_THERAPY' | 'PROCEDURE' | 'LAB' | 'IMAGING' | 'MATERIAL' | 'BLOOD';

export interface ReceiptClassDef {
  key: ReceiptClassKey;
  no: string;
  name: string;
  /** 청구 라인 `codeType` 중 이 칸으로 가는 것 */
  codeTypes: readonly string[];
  /** 수가 코드 분류 칸(`ProcedureCode.category`)이 정확히 이 이름이면 이 칸 */
  categoryNames: readonly string[];
}

export const RECEIPT_CLASSES: readonly ReceiptClassDef[] = [
  { key: 'CONSULTATION', no: '①', name: '진찰료', codeTypes: ['CONSULTATION'], categoryNames: ['진찰료'] },
  { key: 'ADMISSION', no: '②', name: '입원료', codeTypes: ['ADMISSION'], categoryNames: ['입원료'] },
  { key: 'MEAL', no: '③', name: '식대', codeTypes: ['MEAL', 'DIET'], categoryNames: ['식대'] },
  { key: 'MEDICATION', no: '④', name: '투약·조제료', codeTypes: ['MEDICATION'], categoryNames: ['투약·조제료', '투약 및 조제료'] },
  { key: 'INJECTION', no: '⑤', name: '주사료', codeTypes: ['INJECTION'], categoryNames: ['주사료'] },
  { key: 'ANESTHESIA', no: '⑥', name: '마취료', codeTypes: ['ANESTHESIA'], categoryNames: ['마취료'] },
  { key: 'PHYSICAL_THERAPY', no: '⑦', name: '이학요법료', codeTypes: ['PHYSICAL_THERAPY', 'REHAB'], categoryNames: ['이학요법료'] },
  { key: 'PSYCHIATRIC_THERAPY', no: '⑧', name: '정신요법료', codeTypes: ['PSYCHIATRIC_THERAPY'], categoryNames: ['정신요법료'] },
  { key: 'PROCEDURE', no: '⑨', name: '처치·수술료', codeTypes: ['THERAPY', 'SURGERY', 'PROCEDURE'], categoryNames: ['처치·수술료', '처치 및 수술료'] },
  { key: 'LAB', no: '⑩', name: '검사료', codeTypes: ['LAB'], categoryNames: ['검사료'] },
  { key: 'IMAGING', no: '⑪', name: '영상진단료', codeTypes: ['IMAGING'], categoryNames: ['영상진단료'] },
  { key: 'MATERIAL', no: '⑫', name: '치료재료대', codeTypes: ['MATERIAL'], categoryNames: ['치료재료대'] },
  { key: 'BLOOD', no: '⑬', name: '전혈·혈액대', codeTypes: ['BLOOD', 'TRANSFUSION'], categoryNames: ['전혈·혈액대'] },
];

/** 서버가 고른 코드로 아는 라인의 역할 — 진찰료(종별 코드 `CONSULTATION_FEE_CODES_BY_GRADE`)·입원료(병상 등급 코드) */
export type BillingLineRole = 'CONSULTATION_FEE' | 'STAY_FEE';

/**
 * 한 청구 라인의 법정 항목. 순서: 서버가 아는 역할 > 수가 분류 칸(정확히 같은 이름) > `codeType`.
 * 어디에도 맞지 않으면 `null`(분류 불가) — 칸을 지어내지 않고 영수증이 따로 밝힌다.
 */
export function receiptClassOf(input: { codeType?: string | null; procedureCategory?: string | null; role?: BillingLineRole | null }): ReceiptClassKey | null {
  if (input.role === 'CONSULTATION_FEE') return 'CONSULTATION';
  if (input.role === 'STAY_FEE') return 'ADMISSION';
  const cat = input.procedureCategory?.trim();
  if (cat) {
    const byCat = RECEIPT_CLASSES.find((c) => c.categoryNames.includes(cat));
    if (byCat) return byCat.key;
  }
  const t = input.codeType ?? '';
  return RECEIPT_CLASSES.find((c) => c.codeTypes.includes(t))?.key ?? null;
}

/**
 * 요양기관 종별 → 진찰료 코드(초진·재진) — 청구 생성·계산 패널·예상 진료비·원격진료·분류가 같은 표를 쓴다(2026-10-20).
 *
 * 🔴 종전: `{ initial: 'AA157', followUp: 'AA257' }` 고정 = **상급종합병원** 코드. 시스템의 나머지(의료급여 정액·ERP 종별가산·
 *    수가 단가 열)는 종별 정본 `billing.institution.grade`(미설정 = 의원)를 따르는데 진찰료만 상급종합으로 청구했다.
 *    운영 수가 마스터(2026-01-01 고시 반영)는 상급종합 초진 기본 코드 AA157 이 없고 재진 AA257 은 0원이라
 *    진찰료가 빠지거나 0원 라인이 됐다. 시드 이름표도 거꾸로였다(AA157 = "의원").
 * 코드 ↔ 종별은 운영 수가 마스터의 고시 명칭으로 확인했다(`AA154 초진진찰료-의원` · `AA155 …-병원, 정신병원, 요양병원·한방병원·치과병원 내 의과` ·
 *    `AA156 …-종합병원` · `AA257 재진진찰료-상급종합병원` 등). 치과·보건의료원 코드는 이 표 밖이다(의과 외래 진찰료만).
 */
export const INSTITUTION_GRADES = ['CLINIC', 'HOSPITAL', 'GENERAL', 'TERTIARY'] as const;
export type InstitutionGrade = (typeof INSTITUTION_GRADES)[number];

export const CONSULTATION_FEE_CODES_BY_GRADE: Readonly<Record<InstitutionGrade, { initial: string; followUp: string }>> = {
  CLINIC: { initial: 'AA154', followUp: 'AA254' },
  HOSPITAL: { initial: 'AA155', followUp: 'AA255' },
  GENERAL: { initial: 'AA156', followUp: 'AA256' },
  TERTIARY: { initial: 'AA157', followUp: 'AA257' },
};

/**
 * 종별 설정값 → 진찰료 코드. 미설정(null·undefined·빈 값)은 시스템 기본과 같은 의원(CLINIC) —
 * 🔴 그 기본값은 개시 점검(`/admin/go-live` billing.institutionGrade)·결정 `billing.institutionType` 이 "미설정"으로 드러낸다.
 * 알 수 없는 값(오타 등)은 null — 아무 종별로 짐작하지 않는다(호출부가 진찰료 미등재와 같게 소리 내어 다룬다).
 */
export function consultationFeeCodes(grade: unknown): { initial: string; followUp: string } | null {
  if (grade == null || (typeof grade === 'string' && grade.trim() === '')) return CONSULTATION_FEE_CODES_BY_GRADE.CLINIC;
  const g = String(grade).trim().toUpperCase();
  return (INSTITUTION_GRADES as readonly string[]).includes(g) ? CONSULTATION_FEE_CODES_BY_GRADE[g as InstitutionGrade] : null;
}

/** 서버가 만들 수 있는 진찰료 라인 코드 전부 — 영수증 분류는 종별과 무관하게 이 집합으로 ① 진찰료를 안다(옛 청구의 AA157·AA257 포함) */
export const ALL_CONSULTATION_FEE_CODES: ReadonlySet<string> = new Set(
  Object.values(CONSULTATION_FEE_CODES_BY_GRADE).flatMap((c) => [c.initial, c.followUp]),
);
