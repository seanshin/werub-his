/**
 * 퇴원약 한 줄 표시 — 2026-09-30 퇴원약 오더화.
 *
 * 퇴원요약의 `dischargeMedications` 는 옛 자유 기재(문자열)와 객체(`{name, dosage, …}` — 프리필·서명 스냅샷)가 섞여 있다.
 * 🔴 화면이 이것을 `string[]` 으로 믿고 `{med}` 로 그려 객체가 들어오면 React 가 죽었고(퇴원 워크스테이션),
 *    AI 프롬프트엔 `.join(', ')` 이 `[object Object]` 를 넣었다. 두 모양을 여기 하나에서 읽는다.
 */
export type DischargeMedEntry =
  | string
  | {
      name?: string | null; drugName?: string | null; drug?: string | null; code?: string | null;
      dosage?: string | null; frequency?: string | null; duration?: number | null; quantity?: number | null;
      prescriptionId?: string | null;
    };

export function dischargeMedName(m: DischargeMedEntry): string {
  if (typeof m === 'string') return m;
  return (m?.name ?? m?.drugName ?? m?.drug ?? m?.code ?? '').toString();
}

/** 약 이름 · 용량 · 횟수 · 일수 — `days` 는 호출부가 번역한 단위 문구를 만든다 */
export function dischargeMedLabel(m: DischargeMedEntry, days: (n: number) => string): string {
  if (typeof m === 'string') return m;
  return [dischargeMedName(m), m?.dosage, m?.frequency, m?.duration != null ? days(m.duration) : null].filter(Boolean).join(' · ');
}

export function asDischargeMedList(v: unknown): DischargeMedEntry[] {
  return Array.isArray(v) ? (v.filter((x) => x != null && (typeof x === 'string' || typeof x === 'object')) as DischargeMedEntry[]) : [];
}
