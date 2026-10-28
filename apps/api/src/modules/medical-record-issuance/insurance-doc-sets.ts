// F-4 실손보험 청구 서류 세트 상수 (patient-portal-enhancement 설계 §4.3)
// - AUTO          : 자동발급 분기 — 신청 즉시 snapshot→issue→READY (직원 개입 없음)
// - STAFF         : 기존 직원/의사 작성 흐름(REQUESTED → 의료진 처리) — 흐름 불변
// - RECEIPT_ATTACH: DocumentRequest 미생성 — 번들 zip 다운로드 시 영수증 PDF 동봉(설계 §4.3)
// 진단서(DIAGNOSIS_CERT)는 유료·의사 작성이므로 세트 제외 — 별도 신청 안내(notice).

export type BundleComponentMode = 'AUTO' | 'STAFF' | 'RECEIPT_ATTACH';

export interface InsuranceDocSetComponent {
  type: string; // DocumentRequest.type (RECEIPT_ATTACH 는 요청 미생성 — 표시용)
  label: string;
  mode: BundleComponentMode;
}

export interface InsuranceDocSet {
  label: string;
  purpose: string; // DocumentRequest.purpose 기입값(번들 구분·직원 화면 표기)
  inpatient: boolean; // 대상 진료 구분(외래/입원) — 데이터 소스 필터
  components: InsuranceDocSetComponent[];
  notice: string; // 신청 전 고지(진단서 별도 신청 안내)
}

export const INSURANCE_DOC_SET_TYPES = ['INSURANCE_OUTPATIENT', 'INSURANCE_INPATIENT'] as const;
export type InsuranceDocSetType = (typeof INSURANCE_DOC_SET_TYPES)[number];

export const INSURANCE_DOC_SETS: Record<InsuranceDocSetType, InsuranceDocSet> = {
  INSURANCE_OUTPATIENT: {
    label: '실손보험 청구 세트(외래)',
    purpose: '실손보험 청구(외래)',
    inpatient: false,
    components: [
      { type: 'DETAILED_BILL', label: '진료비 세부산정내역서', mode: 'AUTO' },
      { type: 'RECEIPT', label: '진료비 영수증', mode: 'RECEIPT_ATTACH' },
      { type: 'ATTENDANCE_CERT', label: '통원확인서', mode: 'AUTO' },
    ],
    notice: '진단서는 의사가 직접 작성하는 유료 서류로 세트에 포함되지 않습니다. 필요한 경우 서류발급에서 별도로 신청해 주세요.',
  },
  INSURANCE_INPATIENT: {
    label: '실손보험 청구 세트(입원)',
    purpose: '실손보험 청구(입원)',
    inpatient: true,
    components: [
      { type: 'DETAILED_BILL', label: '진료비 세부산정내역서', mode: 'AUTO' },
      { type: 'RECEIPT', label: '진료비 영수증', mode: 'RECEIPT_ATTACH' },
      { type: 'ADMISSION_CERT', label: '입퇴원확인서', mode: 'STAFF' },
    ],
    notice: '입퇴원확인서는 의료진 확인 후 발급됩니다(자동발급분은 먼저 내려받을 수 있습니다). 진단서는 세트에 포함되지 않으니 필요 시 별도 신청해 주세요.',
  },
};

export function resolveInsuranceDocSet(setType: string): InsuranceDocSet | null {
  return (INSURANCE_DOC_SETS as Record<string, InsuranceDocSet>)[setType] ?? null;
}
