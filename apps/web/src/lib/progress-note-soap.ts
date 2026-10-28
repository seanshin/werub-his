/**
 * 입원 일일 경과기록(SOAP) 본문 조립 — **일일 SOAP 의 정본 저장소는 `ProgressNote`(`POST /inpatient/:id/progress-note`)** 다.
 *
 * 🔴 (2026-09-30) 경과기록 쓰기 EP 는 있었는데 부르는 화면이 0이었다 — 「경과 기록」 탭은 읽기만 했고,
 *    회진 폼이 S/O 를 `Round.notes` 한 칸에 `[S] …` 로 납작하게 섞어 넣고 있었다. 같은 사실(오늘의 SOAP)이
 *    두 곳(회진 메모·경과기록)에 갈라져 쌓이면 어느 쪽이 기록인지 아무도 모른다.
 *    → 일일 SOAP 은 경과기록 하나로 모으고, 회진 폼은 회진 사건(유형·상태·활력·회진 소견)만 남긴다.
 *
 * `ProgressNote` 에는 S/O/A/P 칸이 없고 `content`(Text) 하나다 — 스키마를 바꾸지 않고 **구획 표지 `[S]`/`[O]`/`[A]`/`[P]`**
 * 로 한 본문에 담는다(회진 메모가 쓰던 표지와 같은 모양 — 읽는 사람이 한 가지 모양만 배운다).
 * 빈 구획은 적지 않는다(비어 있는 것을 "없음"으로 적지 않는다). 전부 비면 빈 문자열 → 저장하지 않는다.
 */
export interface SoapInput { subjective: string; objective: string; assessment: string; plan: string }

export const EMPTY_SOAP: SoapInput = { subjective: '', objective: '', assessment: '', plan: '' };

export function composeSoapNote(s: SoapInput): string {
  return [
    ['S', s.subjective],
    ['O', s.objective],
    ['A', s.assessment],
    ['P', s.plan],
  ]
    .map(([tag, v]) => [tag, (v ?? '').trim()] as const)
    .filter(([, v]) => v.length > 0)
    .map(([tag, v]) => `[${tag}] ${v}`)
    .join('\n');
}
