import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { trOf, type PortalLocale } from '../../src/lib/i18n/portal-i18n';

/**
 * 🔴 환자 포털 알림 경과 표기 — 2026-09-13.
 * `NotificationCenter` 의 `방금 전`·`N분 전`·`N시간 전` 이 **어떤 포털 언어에서도 한국어**였다.
 * 포털 언어 축(`usePortalTAttr` · 포털 카탈로그)으로 옮겼다 — 직원 `<T>`/`useDurationText` 는 다른 축이다.
 * 지키는 것: ① en/zh/ja 에서 한글 0 ② 대조군(ko 는 한국어) ③ 미래 시각을 '방금'이라 말하지 않는다 ④ 직원 축을 import 하지 않는다.
 */
vi.mock('../../src/app/portal/_shared/portal-date', () => ({ portalDateText: (iso: string) => `DATE(${iso})` }));

const NOW = new Date('2026-09-13T09:00:00Z').getTime();
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); });
afterEach(() => vi.useRealTimers());

const t = (loc: PortalLocale) => (k: string) => trOf(k, loc).text;
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();

const { timeAgo } = await import('../../src/app/portal/_shared/NotificationCenter');

describe('포털 알림 경과 표기 — 포털 언어 축', () => {
  it('② 대조군 — ko 는 한국어로 나온다', () => {
    expect(timeAgo(iso(10_000), t('ko'))).toBe('방금 전');
    expect(timeAgo(iso(5 * 60_000), t('ko'))).toBe('5분 전');
    expect(timeAgo(iso(3 * 3_600_000), t('ko'))).toBe('3시간 전');
  });

  it('🔴 ① en/zh/ja — 한글이 나가지 않고 수가 제자리에 들어간다', () => {
    for (const loc of ['en', 'zh', 'ja'] as const) {
      for (const ms of [10_000, 5 * 60_000, 3 * 3_600_000]) {
        const s = timeAgo(iso(ms), t(loc));
        expect(s, `${loc} ${ms}`).not.toMatch(/[가-힣]/);
        expect(s, `${loc} ${ms} 자리표시자가 남았다`).not.toMatch(/\{수\}/);
      }
    }
    expect(timeAgo(iso(5 * 60_000), t('en'))).toBe('5 min ago');
  });

  it('🔴 ③ 미래 시각(시계 차)을 "방금"이라 말하지 않는다 · 무효는 -', () => {
    const future = new Date(NOW + 60_000).toISOString();
    expect(timeAgo(future, t('ko'))).toBe(`DATE(${future})`);
    expect(timeAgo('garbage', t('ko'))).toBe('-');
  });

  it('④ 포털은 직원 경과·번역 부품을 import 하지 않는다(다른 언어 축)', () => {
    // 🔴 주석을 걷는다 — 이유를 적어 둔 주석("직원 useDurationText 는 쓰지 않는다")이 문자열 검사에 걸렸다(첫 판 실측)
    const src = fs.readFileSync(path.resolve(__dirname, '../../src/app/portal/_shared/NotificationCenter.tsx'), 'utf-8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(src).not.toMatch(/from '@\/components\/ui\/i18n-text'/);
    expect(src).not.toMatch(/useDurationText|durationText/);
    expect(src).not.toMatch(/return '방금 전'|`\$\{min\}분 전`/);
  });
});
