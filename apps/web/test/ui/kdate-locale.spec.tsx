import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { useUiLocaleStore } from '../../src/stores/ui-locale-store';

/**
 * 날짜·시각 **문자열 경로**가 UI 언어를 따르는가 — 2026-09-12.
 *
 * 🔴 `<KDate>`(JSX)는 `localeTagOf(useUiLocale())` 를 넘겨 UI 언어를 따랐는데, 문자열 헬퍼 `kdate()` 는
 *    로케일 태그를 안 넘겨 'ko-KR' 고정이었다(`durationText` 와 같은 구조 결함 · 호출부 233곳/109파일).
 *    운영 정책이 `dateStyle=dash`·`time24h=true` 라 출력이 로케일 중립이어서 화면에서는 드러나지 않았고,
 *    관리자가 12시간제로 바꾸는 순간 영어 화면에 `오전 9:05` 가 나갈 자리였다.
 *
 * 지키는 것: ① ko 는 글자 단위로 종전과 같다 ② 12시간제·비-ko 에서 한글(오전/오후)이 나가지 않는다
 *            ③ `useKdate()` 가 언어 전환에 따라 바뀐다 ④ 대조군 — ko·12시간제는 여전히 `오전`/`오후` 를 쓴다
 *               (표본이 없으면 ②는 아무것도 보증하지 않는다).
 */
vi.mock('../../src/lib/api-client', () => ({ apiClient: { get: vi.fn(async () => ({ data: [] })), put: vi.fn(async () => ({})) } }));
vi.mock('@tanstack/react-query', async (orig) => ({
  ...(await orig<typeof import('@tanstack/react-query')>()),
  useQuery: () => ({ data: { data: [] } }),
}));

const { kdate, useKdate, formatKDate, UI_DEFAULTS } = await import('../../src/lib/ui-settings');

const T = new Date(2026, 8, 12, 9, 5); // 2026-09-12 09:05 (로컬)
const TWELVE = { ...UI_DEFAULTS, time24h: false } as typeof UI_DEFAULTS;

function Probe() {
  const f = useKdate();
  return <span data-testid="s">{f(T, 'datetime')}</span>;
}

beforeEach(() => useUiLocaleStore.setState({ locale: 'ko' }));
afterEach(() => cleanup());

describe('kdate — 문자열 경로도 UI 언어를 따른다', () => {
  it('① ko · 운영 기본(dash·24h) — 종전 출력 그대로', () => {
    expect(kdate(T, 'date')).toBe('2026-09-12');
    expect(kdate(T, 'time')).toBe('09:05');
    expect(kdate(T, 'datetime')).toBe('2026-09-12 09:05');
    expect(kdate(null)).toBe('-');
  });

  it('④ 대조군 — ko·12시간제는 오전/오후를 쓴다(이 표본이 없으면 ②는 빈 검사다)', () => {
    expect(formatKDate(T, TWELVE, 'time', '-', 'ko-KR')).toMatch(/오전|오후/);
  });

  it('② en·12시간제 — 한글이 나가지 않는다(정본 함수에 로케일 태그를 넘긴다)', () => {
    const s = formatKDate(T, TWELVE, 'time', '-', 'en-US');
    expect(s).not.toMatch(/[가-힣]/);
    expect(s).toMatch(/AM|PM/i);
  });

  it('③ useKdate() — 언어를 바꾸면 같은 값이 그 언어로 그려진다(ko 경로는 불변)', () => {
    const a = render(<Probe />).getByTestId('s').textContent;
    expect(a).toBe('2026-09-12 09:05');
    cleanup();
    useUiLocaleStore.setState({ locale: 'en' });
    const b = render(<Probe />).getByTestId('s').textContent;
    // 운영 기본(dash·24h)에서는 로케일 중립이라 같아야 한다 — 다르면 정본이 언어에 따라 갈라진 것이다
    expect(b).toBe('2026-09-12 09:05');
  });

  it('🔴 kdate() 가 로케일 태그를 스토어에서 읽는다 — 고정 문자열로 되돌리면 걸린다', () => {
    // 12시간제 스냅샷을 흉내낼 수 없어(스냅샷은 useUiSettings 가 채운다) 구조로 확인한다 — 렌더 검사는 ③이 한다
    const src = require('node:fs').readFileSync(require('node:path').resolve(__dirname, '../../src/lib/ui-settings.tsx'), 'utf-8');
    const body = src.slice(src.indexOf('export function kdate('), src.indexOf('export function useKdate('));
    expect(body).toMatch(/localeTagOf\(useUiLocaleStore\.getState\(\)\.locale\)/);
  });
});

describe('kdate — 신설 모드(monthDay·monthDayWeekday·dateWeekday·datetimeShort·timeSec)', () => {
  // 화면들이 정본 밖에서 `{ month:'long', weekday:'short' }` 등으로 직접 그리던 다섯 모양(37곳)을 흡수한 자리
  const DEF = UI_DEFAULTS; // 운영 정책(dash·24h — 2026-09-12 실측 source default)
  it('ko · 운영 기본 — dash 조각·24h 로 그린다(요일은 한국어)', () => {
    expect(formatKDate(T, DEF, 'monthDay', '-', 'ko-KR')).toBe('09-12');
    expect(formatKDate(T, DEF, 'monthDayWeekday', '-', 'ko-KR')).toBe('09-12 (토)');
    expect(formatKDate(T, DEF, 'dateWeekday', '-', 'ko-KR')).toBe('2026-09-12 (토요일)');
    expect(formatKDate(T, DEF, 'datetimeShort', '-', 'ko-KR')).toBe('09-12 09:05');
    expect(formatKDate(T, DEF, 'timeSec', '-', 'ko-KR')).toBe('09:05:00');
  });
  it('ko · ko 표기 정책 — `9월 12일` 식(관리자가 dateStyle=ko 로 바꿨을 때)', () => {
    const KO = { ...DEF, dateStyle: 'ko' } as typeof DEF;
    expect(formatKDate(T, KO, 'monthDay', '-', 'ko-KR')).toBe('9월 12일');
    expect(formatKDate(T, KO, 'monthDayWeekday', '-', 'ko-KR')).toBe('9월 12일 (토)');
    expect(formatKDate(T, KO, 'datetimeShort', '-', 'ko-KR')).toBe('9월 12일 09:05');
  });
  it('🔴 en — 어느 모드에서도 한글(월·요일 이름·오전/오후)이 나가지 않는다', () => {
    for (const m of ['monthDay', 'monthDayWeekday', 'dateWeekday', 'datetimeShort', 'timeSec'] as const) {
      const s = formatKDate(T, DEF, m, '-', 'en-US');
      expect(s, m).not.toMatch(/[가-힣]/);
    }
    expect(formatKDate(T, DEF, 'monthDayWeekday', '-', 'en-US')).toMatch(/Sep 12 Sat/);
    expect(formatKDate(T, DEF, 'dateWeekday', '-', 'en-US')).toBe('2026-09-12 Saturday');
    expect(formatKDate(T, TWELVE, 'timeSec', '-', 'en-US')).toMatch(/AM|PM/i);
  });
  it('대조군 — ko 에서 요일이 실제로 한국어로 나온다(이 표본이 없으면 위 검사는 빈 검사다)', () => {
    expect(formatKDate(T, DEF, 'monthDayWeekday', '-', 'ko-KR')).toMatch(/\(토\)/);
  });
  it('🔴 useKdate 가 새 모드를 받는다(타입·런타임)', () => {
    function P() { const f = useKdate(); return <span data-testid="s">{f(T, 'datetimeShort')}</span>; }
    expect(render(<P />).getByTestId('s').textContent).toBe('09-12 09:05');
  });
});

describe('kdate — 초 단위·두 자리 연도 모드(datetimeSec·dateShortYear · 2026-09-13 W6)', () => {
  // 옵션 없는 `new Date(…).toLocaleString('ko')` 가 초까지 찍던 서명·수납·동의 철회·오더 단계 시각 52곳을 흡수한 자리.
  // `datetime`(분)으로 옮기면 초가 사라진다 — 초는 그 기록의 일부라 모드를 따로 둔다.
  const DEF = UI_DEFAULTS;
  const S = new Date(2026, 8, 12, 9, 5, 7);
  it('ko · 운영 기본 — 날짜 dash · 시각 24h · 초까지', () => {
    expect(formatKDate(S, DEF, 'datetimeSec', '-', 'ko-KR')).toBe('2026-09-12 09:05:07');
    expect(formatKDate(S, DEF, 'dateShortYear', '-', 'ko-KR')).toBe('26-09-12');
    expect(kdate(S, 'datetimeSec')).toBe('2026-09-12 09:05:07');
  });
  it('🔴 초가 사라지지 않는다 — datetime(분)과 다르다', () => {
    expect(formatKDate(S, DEF, 'datetimeSec', '-', 'ko-KR')).not.toBe(formatKDate(S, DEF, 'datetime', '-', 'ko-KR'));
  });
  it('대조군 — ko 표기 정책·12시간제에서는 한국어 오전/오후가 실제로 나온다(표본 없으면 아래 en 검사는 빈 검사)', () => {
    const KO12 = { ...DEF, dateStyle: 'ko', time24h: false } as typeof DEF;
    expect(formatKDate(S, KO12, 'datetimeSec', '-', 'ko-KR')).toMatch(/오전|오후/);
    expect(formatKDate(S, { ...DEF, dateStyle: 'ko' } as typeof DEF, 'dateShortYear', '-', 'ko-KR')).toBe('26. 9. 12.');
  });
  it('🔴 en · 12시간제 — 초 단위 모드에서도 한글이 나가지 않는다', () => {
    const s = formatKDate(S, TWELVE, 'datetimeSec', '-', 'en-US');
    expect(s).not.toMatch(/[가-힣]/);
    expect(s).toMatch(/AM|PM/i);
    expect(formatKDate(S, { ...DEF, dateStyle: 'ko' } as typeof DEF, 'dateShortYear', '-', 'en-US')).toBe('26-09-12');
  });
  it('무효 값은 지어내지 않는다', () => {
    expect(formatKDate('not-a-date', DEF, 'datetimeSec', '-', 'ko-KR')).toBe('-');
  });
});
