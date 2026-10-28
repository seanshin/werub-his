import { UiLocale, CatalogLocale, UI_LOCALE_DEFAULT } from './locale';
import { packLookup } from './pack';
import { COMMON_MESSAGES } from './messages/common';

/**
 * 메시지 카탈로그 t() — 키는 **한국어 원문**(동음이의는 `원문@문맥`).
 *
 * 🔴 조용한 폴백 금지 — 미등록 키는 한국어 원문을 돌려주되 `missing: true` 를 함께 돌려준다.
 *    (포털 CATALOG 가 미번역을 한국어로 조용히 반환해 누락이 영원히 안 보였던 함정의 재발 방지.)
 * ko 는 카탈로그가 없다 — 원문이 정본이다.
 */
/**
 * 카탈로그는 **보류 언어(ar)까지** 담는다 — 별도 트랙(§8)의 자산이라 지우지 않는다.
 * 조회(`tOf`)는 활성 로케일만 본다(선택지에 없는 언어는 애초에 인자로 오지 않는다).
 */
export type MessageCatalog = Partial<Record<CatalogLocale, Record<string, string>>>;

interface CatalogEntry {
  catalog: MessageCatalog;
  /** 사람 검수 완료 키(언어 공통) — 비등재 = AI_DRAFT(미검수 초안·티 표시). 검수는 커밋으로 남는 사람 행위 */
  verified: ReadonlySet<string>;
}

/** 영역별 카탈로그 등록부 — P1/P2 에서 messages/<area>.ts 가 여기 등록된다(append-only) */
const CATALOGS: CatalogEntry[] = [];

export function registerCatalog(c: MessageCatalog, verified: ReadonlySet<string> = new Set()): void {
  CATALOGS.push({ catalog: c, verified });
}
registerCatalog(COMMON_MESSAGES);

export interface TResult {
  text: string;
  /** true = 이 언어에 미등록(한국어 원문 그대로) — 렌더 부품이 티(JA× 등)를 그린다 */
  missing: boolean;
  /** true = 등재됐으나 사람 검수 전(AI 초안) — 렌더 부품이 미검수 표시(툴팁·AI 표기)를 단다 */
  draft: boolean;
}

/** `원문@문맥` 키에서 표시용 원문만 — @ 뒤는 표시하지 않는다 */
const displayOf = (key: string): string => {
  const i = key.lastIndexOf('@');
  return i > 0 ? key.slice(0, i) : key;
};

export function tOf(key: string, locale: UiLocale | string): TResult {
  if (locale === UI_LOCALE_DEFAULT) return { text: displayOf(key), missing: false, draft: false };
  // ① 언어 팩 — 새 언어는 팩 하나로 들어온다(코드 수정 없이 확장)
  const fromPack = packLookup(locale, key);
  if (fromPack) return { text: fromPack.text, missing: false, draft: fromPack.draft };
  // ② 빌트인 영역 카탈로그 — 등록 순서가 우선순위(먼저 등록된 것이 이긴다).
  //    🔴 빌트인도 조립돼 팩으로 등록되지만, 조립 전(테스트 등)에도 동작하도록 남긴다.
  const lang = locale as CatalogLocale;
  for (const c of CATALOGS) {
    const hit = c.catalog[lang]?.[key];
    if (hit != null && hit !== '') return { text: hit, missing: false, draft: !c.verified.has(key) };
  }
  return { text: displayOf(key), missing: true, draft: false };
}

/** 문자열만 필요한 자리(티를 그릴 수 없는 속성 등) — missing 여부는 tOf 로 */
export function t(key: string, locale: UiLocale | string): string {
  return tOf(key, locale).text;
}

/* ── 파라미터 보간 ────────────────────────────────────────────────────────────
 * 🔴 이 기능이 **없어서** 문장이 조각으로 쪼개져 왔다(2026-09-10 실측).
 *    `{활성}명 중 {등재}명` 을 `'명 중'`·`'명'` 조각으로 배선하면 영어에서 분자·분모가 뒤집히고
 *    (`12 of 0`), `1,750명` 은 `1750people` 이 된다. 운영 화면에서 실제로 그렇게 보였다.
 *    조각은 **어순이 언어마다 다르다는 사실**을 카탈로그가 표현하지 못해서 생긴 우회였다.
 *
 * 규약
 *   · 키는 여전히 **한국어 원문**이고, 그 안에 `{이름}` 자리표시자를 둔다: `'{서명} 전 · 확정 아님'`.
 *   · 번역문은 자리표시자를 **그 언어의 어순대로** 옮긴다: `'not final — before {서명}'`.
 *   · 🔴 값이 안 온 자리표시자는 **지우지 않는다** — `{이름}` 을 그대로 남겨 눈에 보이게 한다.
 *     빈 문자열로 접으면 문장이 조용히 뜻을 잃는다(이 저장소가 반복해 겪은 "실패를 없음으로").
 *   · 미등록 키는 `t()` 와 같다 — 한국어 원문에 보간해서 돌려준다(원문+티는 소비처가 그린다).
 */
const PARAM = /\{([^{}\s]+)\}/g;

export interface TfResult extends TResult {
  /** 값이 오지 않아 그대로 남은 자리표시자 이름 — 가드·관제가 본다(조용히 지우지 않는다) */
  unfilled: string[];
}

/** `원문@문맥` 키의 자리표시자에 값을 넣는다. 값이 없으면 자리표시자를 남긴다. */
export function tfOf(key: string, locale: UiLocale | string, params: Record<string, string | number>): TfResult {
  const base = tOf(key, locale);
  const unfilled: string[] = [];
  const text = base.text.replace(PARAM, (whole, name: string) => {
    const v = params[name];
    if (v === undefined || v === null) { unfilled.push(name); return whole; }
    return String(v);
  });
  return { ...base, text, unfilled };
}

/** 문자열만 필요한 자리 — `missing`/`unfilled` 는 `tfOf` 로 */
export function tf(key: string, locale: UiLocale | string, params: Record<string, string | number>): string {
  return tfOf(key, locale, params).text;
}

/** 키에 자리표시자가 들어 있는가(가드가 "보간 키인데 t() 로 부른다"를 잡는다) */
export function hasParams(key: string): boolean {
  PARAM.lastIndex = 0;
  return PARAM.test(key);
}
