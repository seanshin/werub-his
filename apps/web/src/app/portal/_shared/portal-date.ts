'use client';

import { useCallback } from 'react';
import { usePortalLocale, type PortalLocale } from '@/lib/i18n/portal-i18n';
import { formatDateTimeLocale } from '@/lib/ko-day-period';

/**
 * 환자 포털 날짜·시각 표기 정본 — **포털 언어 축**(ko/en/zh/ja · `usePortalLocale`)을 따른다. 2026-09-13.
 *
 * 🔴 원 결함: 포털에 날짜 정본이 **없었다**. `app/portal/**` 24곳이 로케일을 `'ko'`/`'ko-KR'` 로 박은
 *    `toLocaleDateString`/`toLocaleString` 을 직접 불러, 영어·중국어·일본어를 고른 환자에게도
 *    `2026. 9. 12.`·`9월 12일 오전 09:05` 가 나갔다.
 *
 * 🔴 **직원 정본 `kdate`/`useKdate`(`lib/ui-settings.tsx`)를 쓰지 않는다.** 그것은 **직원 UI 언어 스토어**를 읽는다 —
 *    포털에 쓰면 환자가 고른 언어가 아니라 (같은 브라우저에 남은) 직원 언어로 그려진다. 두 축은 언어 집합도 다르다
 *    (포털 zh 있음/ar 없음 — `portal-i18n.ts` 헤더).
 *
 * 🔴 **표기는 로케일 자연 표기다 — 원내 표기 정책(`ui.dateStyle=dash`·`ui.time24h`)을 강요하지 않는다.**
 *    그 정책은 직원이 병원 안에서 같은 모양으로 읽기 위한 **업무 규약**이다. 환자는 자기 언어의 익숙한 날짜 모양
 *    (`9/12/2026`·`2026/9/12`)으로 읽을 때 오독이 적고, 원내 정책을 바꾸면 환자 화면까지 바뀌는 결합도 생긴다.
 *    ko 는 종전 호출(`toLocaleDateString('ko')` 등)과 **글자 단위로 같다**(가드가 동결한다).
 *
 * 🔴 **시간대는 바꾸지 않는다.** 종전 호출이 `timeZone` 을 지정한 자리(`Asia/Seoul` 고정)는 그 옵션을 그대로 넘기고,
 *    지정하지 않은 자리는 종전처럼 **브라우저 로컬**로 둔다 — 시간대를 바꾸면 표시 언어가 아니라 **시각이라는 사실**이 바뀐다.
 *
 * 모드는 실제 호출 모양에서만 도출했다(지어낸 모드 없음):
 *   date              `2026. 9. 12.`          (toLocaleDateString 기본)
 *   time              `오전 09:05`            ({hour:'2-digit', minute:'2-digit'})
 *   monthDayTime      `9월 12일 오전 09:05`    ({month:'long', day, hour, minute})
 *   monthDayTimeShort `9월 12일 오전 09:05`    ({month:'short', …} — ko 는 long 과 같지만 en 은 `Sep 12`)
 *   monthDayTime2     `09. 12. 오전 09:05`    ({month:'2-digit', day:'2-digit', hour, minute})
 *   monthDayWeekday   `9월 12일 (토)`         ({month:'long', day, weekday:'short'})
 *
 * 무효·빈 값은 `fallback`(기본 `-`) — 지어내지 않는다.
 */
export type PortalDateMode = 'date' | 'time' | 'monthDayTime' | 'monthDayTimeShort' | 'monthDayTime2' | 'monthDayWeekday';

export const PORTAL_LOCALE_TAG: Record<PortalLocale, string> = { ko: 'ko-KR', en: 'en-US', zh: 'zh-CN', ja: 'ja-JP' };

const MODE_OPTIONS: Record<PortalDateMode, Intl.DateTimeFormatOptions> = {
  date: { year: 'numeric', month: 'numeric', day: 'numeric' },
  time: { hour: '2-digit', minute: '2-digit' },
  monthDayTime: { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' },
  monthDayTimeShort: { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' },
  monthDayTime2: { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' },
  monthDayWeekday: { month: 'long', day: 'numeric', weekday: 'short' },
};

export interface PortalDateOptions {
  /** 무효·빈 값일 때 — 기본 `-` */
  fallback?: string;
  /** 종전 호출이 지정했던 시간대만 넘긴다(예: `Asia/Seoul`). 없으면 브라우저 로컬(종전 동작) */
  timeZone?: string;
  /** 명시 언어 — 없으면 포털 스토어 현재값 */
  locale?: PortalLocale;
}

function toDate(v: unknown): Date | null {
  if (v == null || v === '') return null;
  const d = v instanceof Date ? v : new Date(typeof v === 'number' ? v : String(v));
  return isNaN(d.getTime()) ? null : d;
}

/**
 * 순수 함수 — 모듈 레벨 헬퍼(`_helpers.ts fmt` 등)용. 언어는 호출 시점의 포털 스토어 값이다.
 * 렌더 중 언어 전환을 즉시 따라가야 하면 `usePortalDate()` 를 쓴다(포털 탭은 `usePortalTAttr` 로 이미 구독해 리렌더된다).
 */
export function portalDateText(v: unknown, mode: PortalDateMode = 'date', opts: PortalDateOptions = {}): string {
  const d = toDate(v);
  if (!d) return opts.fallback ?? '-';
  const locale = opts.locale ?? usePortalLocale.getState().locale;
  const o: Intl.DateTimeFormatOptions = opts.timeZone ? { ...MODE_OPTIONS[mode], timeZone: opts.timeZone } : MODE_OPTIONS[mode];
  return formatDateTimeLocale(d, PORTAL_LOCALE_TAG[locale] ?? 'ko-KR', o);
}

/** 렌더 바운드 포맷터 — 포털 언어를 구독하므로 언어를 바꾸면 리렌더된다 */
export function usePortalDate(): (v: unknown, mode?: PortalDateMode, opts?: Omit<PortalDateOptions, 'locale'>) => string {
  const locale = usePortalLocale((s) => s.locale);
  return useCallback(
    (v: unknown, mode: PortalDateMode = 'date', opts: Omit<PortalDateOptions, 'locale'> = {}) => portalDateText(v, mode, { ...opts, locale }),
    [locale],
  );
}
