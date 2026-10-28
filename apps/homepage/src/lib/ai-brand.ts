/**
 * AI 표기 정본(홈페이지 사본) — 정본은 `packages/shared/src/ai-brand.ts` 다.
 * 공개 홈페이지 앱은 shared 워크스페이스에 의존하지 않아 값을 여기 복제한다. **값이 갈라지지 않도록**
 * web 구조 가드(`apps/web/test/architecture/ai-origin-label.spec.ts`)가 이 파일의 값을 shared 와 대조한다.
 *
 * 🔴 2026-08-19 정책: 브랜드가 "AI" 를 대체하지 않는다(AI기본법 §31). 공개 사이트는 "AI" 단독이었고
 *    포털은 브랜드 단독이라 **같은 환자가 앱을 바꾸면 다른 이름을 봤다.**
 */
export const AI_BRAND = 'WeRU.B';
export const AI_ORIGIN_TEXT = `AI(${AI_BRAND})`;
