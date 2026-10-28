import React from 'react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import fs from 'node:fs';
import path from 'node:path';
import { useUiLocaleStore } from '../../src/stores/ui-locale-store';
import { Duration, durationText, useDurationText } from '../../src/components/ui/display';

/**
 * 경과 시간의 **단위 낱말**이 UI 언어를 따르는가 — 2026-09-12.
 *
 * 🔴 실측: `<Duration>` 은 `<Unit>` → `useUnitWord()` 를 지나 번역됐지만 **문자열 경로
 *    `durationText()` 는 그 길을 안 지났다.** 그래서 영어·일본어 화면에서도 `5시간 52분`·
 *    `Arrived 5분` 이 그대로 남았다(호출부 38곳/24파일 — ER 베드보드·PACU·분만보드·
 *    환자흐름·전광판 포함). 같은 값을 **두 부품이 다르게** 그리고 있었다.
 *
 * 이 가드가 지키는 것은 셋이다.
 *   ① 문자열 경로가 번역된다(en/ja).
 *   ② ko 는 한 글자도 바뀌지 않는다(기존 동결분 보존).
 *   ③ 🔴 `app/**` 이 번역 안 되는 `durationText()` 를 **다시 부르지 않는다**(0 동결).
 */

const APP = path.resolve(__dirname, '../../src/app');

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.tsx') || e.name.endsWith('.ts')) out.push(p);
  }
  return out;
}

function Probe({ minutes, dense = false }: { minutes: number; dense?: boolean }) {
  const fmtDur = useDurationText();
  return <span data-testid="s">{fmtDur(minutes, '-', dense)}</span>;
}

beforeEach(() => useUiLocaleStore.setState({ locale: 'ko' }));
afterEach(() => cleanup());

describe('경과 시간 단위어 — UI 언어를 따른다', () => {
  it('① ko 는 종전 문자열과 글자 단위로 같다(동결분 보존)', () => {
    for (const m of [0, 59, 60, 352, 508, 1440, 1500, 1815 * 60 + 1]) {
      const { getByTestId } = render(<Probe minutes={m} />);
      expect(getByTestId('s').textContent).toBe(durationText(m));
      cleanup();
    }
  });

  it('② en — 단위 낱말이 영어로 나오고 한글이 남지 않는다', () => {
    useUiLocaleStore.setState({ locale: 'en' });
    const { getByTestId } = render(<Probe minutes={352} />);
    const s = getByTestId('s').textContent ?? '';
    expect(s).not.toMatch(/[가-힣]/);
    expect(s).toMatch(/5\s*hours\s+52\s*min/);
  });

  it('② ja — 단위 낱말이 일본어로 나온다', () => {
    useUiLocaleStore.setState({ locale: 'ja' });
    const { getByTestId } = render(<Probe minutes={1500} />);
    const s = getByTestId('s').textContent ?? '';
    expect(s).not.toMatch(/[가-힣]/);
    expect(s).toContain('日');
    expect(s).toContain('時間');
  });

  it('② `<Duration>`(JSX)과 훅(문자열)이 같은 낱말을 쓴다 — 정본이 둘로 갈리지 않는다', () => {
    useUiLocaleStore.setState({ locale: 'en' });
    const a = render(<Probe minutes={352} />).getByTestId('s').textContent ?? '';
    cleanup();
    const b = render(<Duration minutes={352} />).container.textContent ?? '';
    // `<Unit>` 은 0.5em 보조 글자로 감싸지만 낱말 자체는 같아야 한다(공백만 정규화해 비교)
    expect(b.replace(/\s+/g, ' ').trim()).toBe(a.replace(/\s+/g, ' ').trim());
  });

  it('③ 🔴 app/** 은 번역되지 않는 `durationText()` 를 부르지 않는다(0 동결)', () => {
    const offenders: string[] = [];
    for (const file of walk(APP)) {
      const src = fs.readFileSync(file, 'utf-8');
      src.split('\n').forEach((line, i) => {
        /**
         * 🔴 **주석을 먼저 걷어낸다.** 이 저장소는 "주석이 문자열 검사에 걸려" 가드가 엉뚱한 곳을
         *    가리킨 적이 있다(v4.11.0 9건). 여기서도 정본을 설명하는 주석 3줄이 위반으로 잡혔다.
         *    다만 **걷어내는 것은 주석뿐**이고 코드는 그대로 본다 — 넓게 지우면 결함이 숨는다.
         */
        const code = line.replace(/\/\/.*$/, '').replace(/^\s*\*.*$/, '');
        // `useDurationText` 는 훅이라 제외 — 맨 `durationText` 만 본다(`orDash(x, durationText)` 참조형 포함)
        if (!/(?<![A-Za-z])durationText\s*[(),]/.test(code)) return;
        if (/useDurationText/.test(code.replace(/(?<![A-Za-z])durationText\b/g, ''))) return;
        offenders.push(`${path.relative(APP, file).replace(/\\/g, '/')}:${i + 1}  ${line.trim().slice(0, 120)}`);
      });
    }
    expect(
      offenders,
      `단위어가 한국어로 굳는 \`durationText()\` 직접 호출 ${offenders.length}건 — \`useDurationText()\` 를 쓰세요:\n` +
        offenders.join('\n'),
    ).toEqual([]);
  });
});
