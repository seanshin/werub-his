/** 재활 치료유형 → EDI 수가코드 매핑(순수). */
export const THERAPY_BILLING_CODE: Record<string, string> = {
  PT: 'MM301', GAIT: 'MM301', HEAT: 'MM301', OT: 'MM111', ST: 'MM241', 운동치료: 'MM301',
};
export function therapyBillingCode(therapyType: string): string {
  return THERAPY_BILLING_CODE[therapyType] ?? 'MM301';
}
