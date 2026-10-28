'use client';

import { Fragment, isValidElement, useCallback, type ReactNode } from 'react';
import { AI_ORIGIN_TEXT, tOf, tfOf } from '@hospital-run/shared';
import { useUiLocale } from '@/stores/ui-locale-store';

/**
 * UI 크롬 텍스트 렌더 정본 — 기획 ui-locale-i18n.plan.md §2.2 (3상태).
 *
 * - 미등록(missing): 한국어 원문 + 가시 티(EN×/JA×/AR× — term-display EN× 패턴 준용).
 * - AI 초안(draft): 번역 표시 + **툴팁 티**(시각 소음 없이 title 로 — AI 표기 병기·AI기본법 §31)
 *   + `data-i18n-draft`(검수 관제·가드 훅).
 * - ko/검수됨: 그대로.
 *
 * 🔴 이 부품 밖에서 tOf 의 missing/draft 를 버리고 text 만 쓰지 않는다(조용한 폴백 재발).
 *    티를 그릴 수 없는 자리(속성·placeholder)는 tAttr() 로 — 원문 유지가 기본이다.
 *
 * 🔴 **`dir="auto"`** — 문자열의 첫 강한 방향 문자로 **그 문자열의 base direction 만** 정한다
 *    (주변 레이아웃 불변). 현재 활성 축(ko/en/ja)은 전부 LTR 이라 사실상 no-op 이지만,
 *    번역문에 라틴 약어·숫자가 섞이는 자리(PACU·CPOE·QR…)에서 괄호가 뒤집히는 것을 막는
 *    안전망이고, 아랍어 별도 트랙(§8)이 붙을 때 그대로 쓰인다. **비용이 0 이라 미리 둔다.**
 *    ko 경로는 DOM 동일성 규약이 있어 속성을 붙이지 않는다(ko 는 방향이 자명하다).
 */
/** 한글이 없는 키 = 번역 대상이 아니다(코드값·고유명사·숫자) — 티를 달지 않는다 */
const HAS_KO = /[가-힣]/;

export function T({ k, className }: { k: string; className?: string }) {
  const locale = useUiLocale();
  // 🔴 빈 키 방어 — 동적 키(`{x?.label ?? ''}`)가 빈 값이면 종전엔 **내용 없이 티만** 떴다
  //    (2026-09-07 P2 합류 검토에서 clinic-queue 1건 실측). 빈 값은 아무것도 그리지 않는다.
  // 🔴 이 방어는 반드시 `tOf()` **앞에** 있어야 한다 — 종전엔 뒤에 있어 아무것도 막지 못했다.
  //    동적 키가 `undefined` 면 `tOf` 안 `displayOf` 의 `key.lastIndexOf('@')` 가 먼저 터져 **화면 전체가 죽는다**
  //    (`/admin/organizations` 가 FE↔서버 키 불일치 `org.type`/`orgType` 로 그렇게 죽어 있었다 · 2026-09-13 외부 실측 S18).
  //    `k` 의 타입은 `string` 이지만 런타임은 계약 불일치로 `undefined` 가 온다 — 타입을 믿지 않는다.
  //    이 방어는 한 라벨의 배선 누락이 페이지를 통째로 지우지 않게 할 뿐 **누락을 숨기지 않는다**
  //    (그리지 않는 것은 키가 빈 자리뿐이고, 미등록 키는 그대로 원문+티로 간다).
  //    가드: `test/architecture/ui-locale-p0.spec.ts`(순서) · `test/ui/organization-field-contract.spec.tsx`(런타임 재현).
  if (typeof k !== 'string' || !k.trim()) return null;
  const r = tOf(k, locale);
  if (locale === 'ko') return <span className={className}>{r.text}</span>;
  // 🔴 코드값·영문 고유명사가 동적으로 들어온 자리 — 번역 대상이 아니므로 티 없이 그대로
  if (!HAS_KO.test(k)) return <span className={className} dir="auto">{r.text}</span>;
  if (r.missing) {
    return (
      <span className={className} dir="auto" title="번역 미등록 — 한국어 원문을 표시합니다">
        {r.text}
        <sup className="ml-0.5 text-[9px] font-semibold text-gray-400">{locale.toUpperCase()}×</sup>
      </span>
    );
  }
  if (r.draft) {
    return (
      <span className={className} dir="auto" data-i18n-draft title={`${AI_ORIGIN_TEXT} 초안 번역(사람 검수 전) — 원문: ${k.split('@')[0]}`}>
        {r.text}
      </span>
    );
  }
  return <span className={className} dir="auto">{r.text}</span>;
}

/**
 * **데이터 문자열** — 서버가 만든 문장(사유·의미·라벨)을 번역 조회 없이 그대로 그린다.
 *
 * 🔴 이것을 `<T>` 에 넘기면 카탈로그에 없다는 이유로 `EN×`("번역 미등록") 티가 붙는다.
 *    그 티는 **거짓말이다** — 그 문장은 UI 크롬 키가 아니라 그 순간의 사실이고, 등재할 대상도
 *    아니다(서버가 상황마다 다르게 만든다). 2026-09-12 실측으로 `EmptyState`/`Ratio` 가
 *    `list.unavailableReason`·`report?.reason`·`zeroMeaning` 같은 **정직성 문구**에
 *    "번역이 빠졌다"는 티를 달고 있었다 — 하필 그 문구들이 "왜 셀 수 없는지"를 말하려고
 *    서버가 만든 것이었다.
 *
 * 🔴 **번역되지 않았다는 사실을 숨기는 도구가 아니다.** 화면 크롬 문구를 여기에 넣으면 조용한
 *    폴백이 된다 — 크롬은 `<T>`/`<Tf>` 로 간다. 여기 오는 것은 서버 데이터뿐이다.
 */
export function Data({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={className} dir="auto">{children}</span>;
}

/**
 * 속성 자리(placeholder·aria-label 등 — 티를 그릴 수 없는 곳)용 문자열.
 * missing 이면 한국어 원문(티는 못 달지만 지어내지도 않는다).
 */
export function useTAttr(): (k: string) => string {
  const locale = useUiLocale();
  // 🔴 정체성을 locale 에 묶는다(2026-09-11). 렌더마다 새 함수를 돌려주면 `useCallback(load, [tAttr])` +
  //    `useEffect([load])` 인 화면(22곳)이 조회→setState→재렌더→새 함수→재조회로 **API 를 무한히 두드린다**.
  //    가드 `test/ui/tattr-identity-loop.spec.tsx`.
  return useCallback((k: string) => (k ? tOf(k, locale).text : ''), [locale]);
}

/**
 * 자리표시자가 든 문장 — `<Tf k="{서명} 전 · 확정 아님" params={{ 서명: signLabel }} />`
 *
 * 🔴 조각 배선(`<T k="전 · 확정 아님" />` + 변수)을 **대신하는 자리**다. 조각은 어순이 언어마다
 *    달라 영어에서 문장이 깨진다(운영 화면에서 `1750people`·`12 of 0` 로 실제 관측됐다).
 * 🔴 값이 안 온 자리표시자는 지우지 않고 `{이름}` 을 그대로 보여준다 — 조용히 뜻을 잃지 않게.
 *    그 사실은 `data-i18n-unfilled` 로도 남겨 가드가 본다.
 */
/**
 * 🔴 (2026-09-11 §12-H) **노드 자리표시자** — 문장 한가운데 `<b>`·`<Unit>` 이 걸린 문장은 문자열 보간으로는
 *    한 키로 옮길 수 없었다(옮기면 강조가 사라지고, 쪼개면 어순이 깨진다). 그래서 정직성 문구 둘
 *    (`조회 실패 — …<b>확인 불가</b>입니다`·`…모드는 <b>표시 전용</b>입니다`)이 모든 언어에서 한국어로 남았다.
 *    params 값이 React 노드면 **번역문을 자리표시자에서 잘라 노드를 끼운다** — 어순은 번역문이 정한다.
 *    노드 안의 한국어는 노드 쪽에서 따로 `<T>` 로 번역한다(`{ 강조: <b><T k="확인 불가" /></b> }`).
 */
const PARAM_SPLIT = /\{([^{}\s]+)\}/g;
function interleave(text: string, params: Record<string, ReactNode>): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(PARAM_SPLIT)) {
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    const v = params[m[1]];
    // 🔴 값이 안 온 자리표시자는 지우지 않는다 — `{이름}` 을 그대로 보인다(문자열 보간과 같은 규약)
    out.push(v === undefined || v === null ? m[0] : <Fragment key={`p${i++}`}>{v}</Fragment>);
    last = at + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Tf({ k, params, className }: { k: string; params: Record<string, ReactNode>; className?: string }) {
  const locale = useUiLocale();
  if (typeof k !== 'string' || !k.trim()) return null;
  const hasNode = Object.values(params).some((v) => isValidElement(v));
  let r: { text: string; missing: boolean; draft: boolean; unfilled: string[] };
  let body: ReactNode;
  if (hasNode) {
    const base = tOf(k, locale); // 자리표시자가 살아 있는 번역문
    const unfilledNames = [...base.text.matchAll(PARAM_SPLIT)].map((m) => m[1]).filter((n) => params[n] === undefined || params[n] === null);
    r = { ...base, unfilled: unfilledNames };
    body = interleave(base.text, params);
  } else {
    r = tfOf(k, locale, params as Record<string, string | number>);
    body = r.text;
  }
  const unfilled = r.unfilled.length ? r.unfilled.join(',') : undefined;
  if (locale === 'ko') return <span className={className} data-i18n-unfilled={unfilled}>{body}</span>;
  if (!HAS_KO.test(k)) return <span className={className} dir="auto" data-i18n-unfilled={unfilled}>{body}</span>;
  if (r.missing) {
    return (
      <span className={className} dir="auto" data-i18n-unfilled={unfilled} title="번역 미등록 — 한국어 원문을 표시합니다">
        {body}
        <sup className="ml-0.5 text-[9px] font-semibold text-gray-400">{locale.toUpperCase()}×</sup>
      </span>
    );
  }
  if (r.draft) {
    return (
      <span className={className} dir="auto" data-i18n-draft data-i18n-unfilled={unfilled}
        title={`${AI_ORIGIN_TEXT} 초안 번역(사람 검수 전) — 원문: ${k.split('@')[0]}`}>
        {body}
      </span>
    );
  }
  return <span className={className} dir="auto" data-i18n-unfilled={unfilled}>{body}</span>;
}

/** 속성 자리용 보간 문자열 — 티를 그릴 수 없는 곳(placeholder·aria-label·title) */
export function useTfAttr(): (k: string, params: Record<string, string | number>) => string {
  const locale = useUiLocale();
  // 🔴 useTAttr 와 같은 이유로 locale 에만 묶는다(렌더마다 새 함수 = 의존한 effect 무한 재실행)
  return useCallback((k: string, params: Record<string, string | number>) => (k ? tfOf(k, locale, params).text : ''), [locale]);
}
