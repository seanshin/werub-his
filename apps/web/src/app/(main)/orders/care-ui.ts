/** 오더 진료 맥락 칩 — 처방 관리 목록·실시간 추적·환자별 매트릭스가 같은 표를 쓴다(서버 정본 `order/care-context.ts`) */
export const CARE_UI: Record<string, { label: string; icon: string; cls: string; hint: string }> = {
  OUTPATIENT: { label: '외래', icon: '🏥', cls: 'bg-gray-100 text-gray-600', hint: '진료시간 내 처리' },
  INPATIENT: { label: '입원', icon: '🛏️', cls: 'bg-blue-100 text-blue-700', hint: '병동 상시 처리' },
  ICU: { label: '중환자', icon: '🚨', cls: 'bg-rose-100 text-rose-700', hint: '중환자실 — 즉시 처리' },
  ER: { label: '응급', icon: '🚑', cls: 'bg-orange-100 text-orange-700', hint: '응급실 — 즉시 처리' },
};
export const CARE_ORDER = ['INPATIENT', 'ER', 'ICU', 'OUTPATIENT'];
