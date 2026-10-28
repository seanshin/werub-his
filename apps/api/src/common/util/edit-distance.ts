/**
 * 편집 거리(Levenshtein) 정본 — AI 초안 ↔ 사람이 확정한 최종본의 **수정량**을 재는 한 곳.
 *
 * 원래 `modules/nursing/nursing.service.ts` 안에만 있었다(간호기록 `aiEditDistance`). 진료 보조 초안의
 * 무수정 승인율(human_edit_ratio)도 같은 수를 써야 하는데, 서비스 안에 있으면 두 번째 소비처가
 * 자기 구현을 따로 쓰게 된다(같은 사실에 정본이 둘 = P12). 그래서 순수 함수만 여기로 옮기고
 * 간호는 재수출로 그대로 쓴다 — **동작은 한 글자도 바뀌지 않았다**.
 *
 * 🔴 캡: O(n·m) 폭주를 막으려 앞 `cap` 자만 비교한다. 그래서 입력이 캡보다 길면 **거리는 하한**이다
 *    (뒤쪽이 아무리 달라도 세지 않는다). 부르는 쪽은 `isEditDistanceCapped()` 로 그 사실을 함께 낸다.
 */

/** 기본 비교 상한(문자) — 이 길이를 넘으면 앞부분만 비교한다 */
export const EDIT_DISTANCE_CAP = 1500;

/** Levenshtein 거리(O(n·m)·길이 캡 1500자로 폭주 방지). AI 초안↔최종 서명본 수정량 측정. */
export function levenshteinCapped(a: string, b: string, cap = EDIT_DISTANCE_CAP): number {
  const s = (a ?? '').slice(0, cap);
  const t = (b ?? '').slice(0, cap);
  if (s === t) return 0;
  if (!s.length) return t.length;
  if (!t.length) return s.length;
  let prev = Array.from({ length: t.length + 1 }, (_, i) => i);
  let curr = new Array(t.length + 1).fill(0);
  for (let i = 1; i <= s.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= t.length; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[t.length];
}

/**
 * 잘라서 비교했는가 — true 면 `levenshteinCapped` 값은 **하한**이다(비율도 하한).
 * 🔴 이걸 안 밝히면 "2만 자 초안을 통째로 갈아엎었는데 수정량 0" 이 나올 수 있다.
 */
export function isEditDistanceCapped(a: string, b: string, cap = EDIT_DISTANCE_CAP): boolean {
  return (a ?? '').length > cap || (b ?? '').length > cap;
}
