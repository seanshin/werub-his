import React from 'react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import fs from 'node:fs';
import path from 'node:path';
import { usePortalLocale } from '../../src/lib/i18n/portal-i18n';
import { portalDateText, usePortalDate, type PortalDateMode } from '../../src/app/portal/_shared/portal-date';

/**
 * 🔴 환자 포털 날짜·시각이 **포털 언어 축**을 따르는가 — 2026-09-13.
 *
 * 포털에 날짜 정본이 없어 `app/portal/**` 24곳이 로케일을 `'ko'`/`'ko-KR'` 로 박고 있었다 —
 * 영어·중국어·일본어를 고른 환자에게도 `2026. 9. 12.`·`9월 12일 오전 09:05` 가 나갔다.
 *
 * 지키는 것:
 *   ① ko — 종전 호출(`toLocaleDateString('ko')` 등)과 **글자 단위로 같다**(모드마다 원 호출과 대조)
 *   ② en/zh/ja — 한글(오전·오후·월·일·요일 한글) 0
 *   ③ 🔴 대조군 — ko 는 실제로 한국어 표기를 낸다(이 표본이 없으면 ②는 빈 검사다)
 *   ④ 🔴 `app/portal/**` 에 로케일 리터럴 날짜 호출 0 동결 — 남긴 자리는 사유와 함께 **줄 내용 단위** 허용
 *   ⑤ 포털은 직원 정본 `kdate`/`useKdate`(직원 UI 언어 스토어)를 import 하지 않는다
 *   + 시간대 옵션을 넘기면 그대로 적용된다 · 무효 값은 fallback(지어내지 않는다) · 훅이 언어 전환을 따른다
 */
const D = new Date(2026, 8, 12, 9, 5); // 로컬 2026-09-12 09:05
const MODES: PortalDateMode[] = ['date', 'time', 'monthDayTime', 'monthDayTimeShort', 'monthDayTime2', 'monthDayWeekday'];
/** 각 모드가 대체한 **원 호출** — ① 이 글자 단위로 대조한다 */
const ORIGINAL: Record<PortalDateMode, () => string> = {
  date: () => D.toLocaleDateString('ko'),
  time: () => D.toLocaleTimeString('ko', { hour: '2-digit', minute: '2-digit' }),
  monthDayTime: () => D.toLocaleString('ko', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
  monthDayTimeShort: () => D.toLocaleString('ko', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
  monthDayTime2: () => D.toLocaleString('ko', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }),
  monthDayWeekday: () => D.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' }),
};
const HANGUL = /[가-힣]/;

beforeEach(() => usePortalLocale.setState({ locale: 'ko' }));
afterEach(() => cleanup());

describe('포털 날짜 정본 — 포털 언어를 따른다', () => {
  it('① ko — 모드마다 종전 원 호출과 글자 단위로 같다', () => {
    for (const m of MODES) expect(portalDateText(D, m), m).toBe(ORIGINAL[m]());
  });

  it('③ 🔴 대조군 — ko 는 한국어 표기를 낸다(없으면 ②는 아무것도 보증하지 않는다)', () => {
    expect(portalDateText(D, 'time')).toMatch(/오전|오후/);
    expect(portalDateText(D, 'monthDayWeekday')).toMatch(/월.*일/);
  });

  it('② en·zh·ja — 어떤 모드에서도 한글이 나가지 않는다', () => {
    for (const locale of ['en', 'zh', 'ja'] as const) {
      for (const m of MODES) {
        const s = portalDateText(D, m, { locale });
        expect(HANGUL.test(s), `${locale}/${m}: ${s}`).toBe(false);
        expect(s.length, `${locale}/${m} 빈 문자열`).toBeGreaterThan(0);
      }
    }
  });

  it('스토어 언어를 읽는다 — 명시하지 않으면 현재 포털 언어', () => {
    usePortalLocale.setState({ locale: 'en' });
    expect(HANGUL.test(portalDateText(D, 'monthDayTime'))).toBe(false);
  });

  it('무효·빈 값은 fallback — 지어내지 않는다(`Invalid Date` 도 그리지 않는다)', () => {
    expect(portalDateText(null)).toBe('-');
    expect(portalDateText('')).toBe('-');
    expect(portalDateText('not-a-date')).toBe('-');
    expect(portalDateText(undefined, 'date', { fallback: '' })).toBe('');
  });

  it('시간대 옵션은 그대로 적용된다(병원 시간대 고정 자리)', () => {
    const utc = new Date(Date.UTC(2026, 8, 12, 0, 5)); // KST 09:05
    expect(portalDateText(utc, 'time', { timeZone: 'Asia/Seoul' })).toBe(
      utc.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Seoul' }),
    );
  });

  it('usePortalDate() — 언어를 바꾸면 같은 값이 그 언어로 그려진다', () => {
    function Probe() { const f = usePortalDate(); return <span data-testid="s">{f(D, 'monthDayWeekday')}</span>; }
    const a = render(<Probe />).getByTestId('s').textContent ?? '';
    cleanup();
    usePortalLocale.setState({ locale: 'ja' });
    const b = render(<Probe />).getByTestId('s').textContent ?? '';
    expect(HANGUL.test(a)).toBe(true);
    expect(HANGUL.test(b)).toBe(false);
  });
});

const PORTAL = path.resolve(__dirname, '../../src/app/portal');
function walk(d: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}
/** 🔴 주석을 먼저 걷는다 — 주석이 문자열 검사에 걸려 가드가 헛돈 적이 있다 */
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/**
 * 남긴 자리 — **줄에 반드시 들어 있어야 할 조각**으로 가리킨다(줄 번호는 편집으로 밀린다 · 파일 통째 허용 금지).
 * 사유가 비면 실패한다.
 */
const ALLOW: Array<{ file: string; mustContain: string; why: string }> = [
  {
    file: '_services/ServicesTab.tsx',
    mustContain: '[영수증 ${rr.receiptNo}]',
    why: '영수증 텍스트는 머리·항목명이 전부 한국어 템플릿 — 날짜만 환자 언어로 바꾸면 한 문서 안에서 언어가 섞인다(영수증 번역은 별도 결정)',
  },
];

describe('포털 날짜 호출 — 구조', () => {
  it('④ 🔴 app/portal/** 에 로케일 리터럴 날짜 호출 0 동결(허용 목록 제외)', () => {
    const files = walk(PORTAL);
    expect(files.length, '대조군 — 스캔 대상이 사라졌다').toBeGreaterThan(20);
    const bad: string[] = [];
    for (const f of files) {
      const rel = path.relative(PORTAL, f);
      stripComments(fs.readFileSync(f, 'utf-8')).split('\n').forEach((line, i) => {
        if (!/\.toLocale(Date|Time)?String\(\s*['"][a-z]{2}(-[A-Z]{2})?['"]/.test(line)) return;
        // `sv-SE` 는 **표시가 아니라 날짜 키**(`YYYY-MM-DD`)를 만드는 관용구다(ISO 모양을 주는 로케일) — 환자에게 보이지 않는다
        if (/\.toLocaleDateString\(\s*['"]sv-SE['"]/.test(line)) return;
        // 숫자 천단위(`n.toLocaleString('ko')`)는 날짜가 아니다 — 날짜 옵션도 Date 수신자도 없는 줄만 제외
        if (/toLocaleString\(\s*['"][a-z-]+['"]\s*\)/.test(line) && !/new Date|Date\(|At\b|date/i.test(line)) return;
        if (ALLOW.some((a) => a.file === rel && line.includes(a.mustContain))) return;
        bad.push(`${rel}:${i + 1}  ${line.trim().slice(0, 120)}`);
      });
    }
    expect(bad, `로케일을 박은 날짜 호출 ${bad.length}건 — \`portalDateText\`/\`usePortalDate\` 를 쓰세요:\n${bad.join('\n')}`).toEqual([]);
  });

  it('대조군 — 허용 목록이 살아 있는 자리를 가리키고 사유가 있다(죽은 예외 금지)', () => {
    for (const a of ALLOW) {
      const src = fs.readFileSync(path.join(PORTAL, a.file), 'utf-8');
      expect(src, `${a.file}: 허용 대상이 사라졌다 — 예외를 지운다`).toContain(a.mustContain);
      expect(a.why.length, `${a.file}: 사유가 비었다`).toBeGreaterThan(20);
    }
  });

  it('⑤ 포털은 직원 날짜 정본(kdate·useKdate·KDate)을 import 하지 않는다', () => {
    const bad: string[] = [];
    for (const f of walk(PORTAL)) {
      const src = stripComments(fs.readFileSync(f, 'utf-8'));
      for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*'([^']+)'/g)) {
        const names = m[1].split(',').map((x) => x.trim().split(/\s+as\s+/)[0]);
        if ((m[2].endsWith('/ui-settings') && names.some((n) => n === 'kdate' || n === 'useKdate')) ||
            (m[2].endsWith('/components/ui/display') && names.includes('KDate'))) {
          bad.push(`${path.relative(PORTAL, f)}: ${m[0].slice(0, 90)}`);
        }
      }
    }
    expect(bad, `포털이 직원 UI 언어 스토어 기준 날짜 정본을 쓴다(환자 언어를 무시한다):\n${bad.join('\n')}`).toEqual([]);
  });
});
