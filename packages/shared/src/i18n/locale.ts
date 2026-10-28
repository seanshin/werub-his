/**
 * UI 표기 언어(크롬 언어) 정본 — 기획 ui-locale-i18n.plan.md §2.1·§9
 *
 * 🔴 이 축은 **화면 크롬**(메뉴·버튼·상태 라벨·안내문)의 표시 언어다.
 *    의료용어 한/영(term-display)·기록 언어·인쇄(법정 서식)·저장·검색·집계는 **불변**.
 * 🔴 미번역을 지어내지 않는다 — 미등록 키는 한국어 원문 + 티(§2.2 3상태).
 *
 * 🔴 **언어 목록의 정본은 이제 언어 팩이다**(§9). 종전엔 여기 `UI_LOCALES` 배열과
 *    label/dir/tag Record 를 하드코딩해, 언어를 늘리려면 이 파일 4곳 + 영역 카탈로그
 *    11개를 고쳐야 했다. 지금은 `packs/<code>.ts` 하나를 넣으면 선택지·포맷·방향이
 *    따라온다(`activeLocaleOptions`·`localeTagOf`·`localeDirOf` — pack.ts).
 *    이 파일에는 **팩으로 대체할 수 없는 것**만 남긴다: 기본 언어(원문)와 조립 대상 목록.
 */

/** 기본 언어 — 카탈로그가 없다(한국어 원문이 곧 키이자 정본) */
export const UI_LOCALE_DEFAULT = 'ko';

/**
 * 언어 코드. 팩으로 동적 확장되므로 리터럴 유니온이 아니다 —
 * 유효성은 런타임 검증(`isActiveLocale`)이 맡는다.
 */
export type UiLocale = string;

/**
 * 빌트인 카탈로그(`messages/*.ts`)가 담는 언어 — 이 목록으로 빌트인 팩을 조립한다.
 * 🔴 새 언어는 여기 넣지 않는다(팩 파일로 추가한다). 이 목록은 **기존 영역 카탈로그 구조**
 *    (`{en,ja,ar}`)를 그대로 살리기 위한 것이다.
 */
export const CATALOG_LOCALES = ['en', 'ja', 'ar'] as const;
export type CatalogLocale = (typeof CATALOG_LOCALES)[number];

/** 자산은 보존하되 선택지에서 제외되는 빌트인 언어 — 사유는 팩의 note 에(§8 아랍어) */
export const DEFERRED_LOCALES = ['ar'] as const;

/** 빌트인 팩 조립용 표기 */
export const CATALOG_LOCALE_LABEL: Record<CatalogLocale, string> = {
  en: 'English',
  ja: '日本語',
  ar: 'العربية',
};
