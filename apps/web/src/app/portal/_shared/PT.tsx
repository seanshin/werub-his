'use client';

import { useCallback } from 'react';
import { usePortalLocale, trOf, type PortalLocale } from '@/lib/i18n/portal-i18n';

/**
 * 포털 텍스트 렌더 부품 — **환자 축**(ko/en/zh/ja · `lib/i18n/portal-i18n.ts`).
 *
 * 🔴 직원 크롬의 `components/ui/i18n-text.tsx` `<T>` 와 **같은 규칙·다른 축**이다.
 *    합치지 않는다(portal-i18n.ts 헤더 — zh/ar 이 서로 없어 한쪽이 사라진다).
 *
 * 왜 만들었나: `useT()` 는 미등록 키를 **조용히 한국어로** 돌려준다. 그러면 환자는
 * "번역이 안 된 것"과 "원래 한국어인 것"을 구분할 수 없고, 번역 누락이 영원히 드러나지 않는다.
 * `trOf()` 가 이미 missing 을 함께 돌려주므로, 이 부품이 그것을 **화면에 얇게** 드러낸다.
 *
 * 규칙
 * - ko: 원문 그대로 · **DOM 도 종전과 동일**(래퍼 없이 텍스트 노드) — className 을 준 자리만 span.
 * - 등록된 번역: 번역문 그대로(티 없음).
 * - 미등록 + 한글 포함: 한국어 원문 + `EN×`/`ZH×`/`JA×` 티(작고 조용하게 · 환자 대면).
 * - 한글이 없는 키(코드값·고유명사·숫자·라틴 약어): 번역 대상이 아니므로 티를 달지 않는다.
 *   (직원 축 `<T>` 가 clinic-queue 에서 겪은 거짓 티를 여기서도 미리 막는다)
 * - 빈 키: 아무것도 그리지 않는다(내용 없이 티만 뜨는 사고 방지).
 *
 * 🔴 티는 **`currentColor` + opacity** 로 그린다 — 포털은 그라데이션 히어로(흰 글자) 위에도
 *    문구를 얹기 때문에 직원 축처럼 `text-gray-400` 을 박으면 배경에 따라 보이지 않거나
 *    거꾸로 튄다(있는 티가 안 보이면 없는 것과 같다).
 *
 * 🔴 스크린리더: 티는 `aria-hidden` 이다(모든 문구마다 "EN 곱하기"를 읽어 주면 소음이 된다).
 *    미번역 사실은 래퍼의 `title` 과 언어 선택 UI 고지(LocaleToggle)가 말한다 — **잔여 한계로 기록한다.**
 */

/** 한글이 없는 키 = 번역 대상이 아니다(코드값·고유명사·숫자) — 티를 달지 않는다 */
const HAS_KO = /[가-힣]/;

/** 미번역 고지 — 환자가 읽는 문구라 환자 언어로 말한다(ko 는 이 경로에 오지 않는다) */
const MISSING_NOTICE: Record<Exclude<PortalLocale, 'ko'>, string> = {
  en: 'Not translated yet — shown in Korean',
  zh: '尚未翻译 — 以韩语显示',
  ja: '未翻訳 — 韓国語で表示しています',
};

export function PT({ k, className }: { k: string; className?: string }) {
  const locale = usePortalLocale((s) => s.locale);
  if (!k || !k.trim()) return null;
  const { text, missing } = trOf(k, locale);
  const tie = missing && locale !== 'ko' && HAS_KO.test(k);
  if (!tie) {
    // 🔴 래퍼를 만들지 않는다 — 이 부품 도입만으로 기존 flex 배치가 흔들리면 안 된다.
    return className ? <span className={className}>{text}</span> : <>{text}</>;
  }
  const notice = MISSING_NOTICE[locale as Exclude<PortalLocale, 'ko'>];
  return (
    <span className={className} title={notice}>
      {text}
      <sup aria-hidden className="ml-0.5 select-none text-[9px] font-semibold opacity-50">
        {locale.toUpperCase()}×
      </sup>
    </span>
  );
}

/**
 * 속성 자리(aria-label·title·placeholder — 티를 그릴 수 없는 곳)용 문자열.
 * 미등록이면 한국어 원문(티는 못 달지만 지어내지도 않는다).
 */
export function usePortalTAttr(): (k: string) => string {
  const locale = usePortalLocale((s) => s.locale);
  // 🔴 정체성을 locale 에 묶는다 — 직원 축 useTAttr 와 같은 이유(렌더마다 새 함수면 의존한 effect 가 무한 재실행)
  return useCallback((k: string) => (k ? trOf(k, locale).text : ''), [locale]);
}
