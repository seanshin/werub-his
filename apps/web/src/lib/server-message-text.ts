import { isServerMessage, tOf, tfOf, type ServerMessage } from '@hospital-run/shared';

/**
 * 서버 표시 문장 `{ k, params }` → 지정 언어의 **문자열**. 티(EN×)를 그릴 수 없는 자리(속성·토스트·훅 밖 오류 문장)용.
 * 규칙은 `<ServerText>` 와 같다 — 낱말 조각 `{ k }` 는 번역, 중첩 문장은 재귀, 숫자·코드는 그대로.
 * 정본 하나 — `components/ui/server-text.tsx` 의 `useServerTextAttr` 와 `lib/error-utils.ts` 가 이것을 쓴다.
 */
export function serverMessageText(m: ServerMessage, locale: string): string {
  if (!m.params) return tOf(m.k, locale).text;
  const params: Record<string, string | number> = {};
  for (const [name, v] of Object.entries(m.params)) {
    if (typeof v === 'string' || typeof v === 'number') params[name] = v;
    else params[name] = isServerMessage(v) && v.params ? serverMessageText(v, locale) : tOf(v.k, locale).text;
  }
  return tfOf(m.k, locale, params).text;
}
