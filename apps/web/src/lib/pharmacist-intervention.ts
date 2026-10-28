/**
 * 약사 중재 유형 라벨·색 — 약사 화면(/pharmacist-activity)과 의사 회신 화면(/pharmacist-replies)의 **정본 하나**.
 * 🔴 두 화면이 각자 표를 두면 같은 중재가 화면마다 다른 이름으로 읽힌다(P12). 서버 어휘는
 *    `pharmacist-activity.service.ts` `INTERVENTION_TYPES` — 키는 그 값 그대로다(미등록 코드는 원문으로 그린다).
 */
export const INTERVENTION_TYPE_LABEL: Record<string, string> = {
  DOSE: '용량', INTERACTION: '상호작용', DUPLICATE: '중복', ROUTE: '투여경로', OTHER: '기타',
};

export const INTERVENTION_TYPE_COLOR: Record<string, string> = {
  DOSE: 'bg-blue-100 text-blue-700', INTERACTION: 'bg-orange-100 text-orange-700',
  DUPLICATE: 'bg-purple-100 text-purple-700', ROUTE: 'bg-teal-100 text-teal-700', OTHER: 'bg-gray-100 text-gray-600',
};
