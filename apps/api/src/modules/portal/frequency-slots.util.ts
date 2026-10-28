/** F-2 복약 슬롯 정본 4종 — MedicationCheckLog.slot·리마인더 config 키와 동일 문자열 */
export const MEDICATION_SLOTS = ['아침 식후', '점심 식후', '저녁 식후', '취침 전'] as const;

/** 복약 빈도 문자열 → 시간대 슬롯 (portal.service·medication-reminder.cron 공용) */
export function parseFrequencySlots(frequency?: string | null): string[] {
  if (!frequency) return ['아침 식후'];
  const lower = frequency.toLowerCase();
  if (frequency.includes('3회') || lower.includes('tid')) {
    return ['아침 식후', '점심 식후', '저녁 식후'];
  }
  if (frequency.includes('2회') || lower.includes('bid')) {
    return ['아침 식후', '저녁 식후'];
  }
  if (frequency.includes('4회') || lower.includes('qid')) {
    return ['아침 식후', '점심 식후', '저녁 식후', '취침 전'];
  }
  if (frequency.includes('취침') || lower.includes('hs')) {
    return ['취침 전'];
  }
  return ['아침 식후'];
}
