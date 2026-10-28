/**
 * 통합 상황판 디자인 C(3단 관제 배치)·F(추세선) — 2026-10-02.
 *  · F 🔴 서버 이력(5분 칸)만 그린다 — 실패 칸(null)·누락 칸은 **잇지 않고 끊는다** · 점 2개 미만이면 "추세 기록 중"
 *    · 이 역할에게 서버가 주지 않은 지표는 그리지 않는다 · 조회 실패는 실패라고
 *  · C 넓은 화면 3단(왼쪽 조치 · 가운데 부서 · 오른쪽 여정·공간 부하) — DOM 순서 = 좁은 화면에서 읽는 순서
 *    · 공간 부하 요약은 3D 보기와 같은 응답 · 못 놓은 대기를 센다 · 기준 출처를 말한다
 * 재주입: 끊긴 칸을 이으면 · 점 1개로 선을 그리면 · 3단 열 순서를 바꾸면 · 못 놓은 대기를 빼면 실패한다.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { seriesOf, valueAt, type TrendResponse } from '@/app/(main)/command-center/trend-view';

const get = vi.fn();
vi.mock('@/lib/api-client', async (orig) => ({ ...(await orig<object>()), apiClient: { get: (...a: unknown[]) => get(...a), getToken: () => null } }));
const wrap = (ui: React.ReactElement) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);

const at = (m: number) => new Date(Date.UTC(2026, 9, 2, 5, m)).toISOString();
const trend = (values: Array<number | null>, opts: { skipIdx?: number[]; metrics?: string[] } = {}): TrendResponse => ({
  bucketMinutes: 5, from: at(0), to: at(60), recordingSince: at(0), metrics: opts.metrics ?? ['kpi.census'],
  points: values.map((v, i) => ({ at: at(i * 5), values: { 'kpi.census': v } })).filter((_, i) => !(opts.skipIdx ?? []).includes(i)),
});

beforeEach(() => get.mockReset());
afterEach(() => cleanup());

describe('F 추세선 — 계산', () => {
  it('🔴 null 칸에서 끊는다(잇지 않는다)', () => {
    const s = seriesOf(trend([1, 2, null, 4, 5]).points, { key: 'kpi.census' }, 5);
    expect(s.segments.map((g) => g.map((p) => p.v))).toEqual([[1, 2], [4, 5]]);
    expect(s.n).toBe(4);
  });

  it('🔴 칸이 비어도(기록 실패·서버 정지) 끊는다', () => {
    const s = seriesOf(trend([1, 2, 3, 4], { skipIdx: [2] }).points, { key: 'kpi.census' }, 5);
    expect(s.segments.length).toBe(2);
  });

  it('병상 가동률은 분자/분모 이력으로 — 분모 0·null 이면 그 칸은 값 없음', () => {
    expect(valueAt({ at: at(0), values: { n: 5, d: 50 } }, { ratio: ['n', 'd'] })).toBe(10);
    expect(valueAt({ at: at(0), values: { n: 5, d: 0 } }, { ratio: ['n', 'd'] })).toBeNull();
    expect(valueAt({ at: at(0), values: { n: 5, d: null } }, { ratio: ['n', 'd'] })).toBeNull();
  });
});

describe('F 추세선 — 그림', () => {
  it('점이 2개 이상이면 선 · 끊긴 구간 수만큼 polyline', async () => {
    const { KpiSparkline } = await import('@/app/(main)/command-center/KpiSparkline');
    const { container } = render(<KpiSparkline trend={trend([1, 2, null, 4, 5])} src={{ key: 'kpi.census' }} />);
    expect(container.querySelector('[data-trend="line"]')?.getAttribute('data-trend-n')).toBe('4');
    expect(container.querySelectorAll('polyline').length).toBe(2);
  });

  it('🔴 점이 2개 미만이면 선을 그리지 않고 "추세 기록 중"', async () => {
    const { KpiSparkline } = await import('@/app/(main)/command-center/KpiSparkline');
    const { container } = render(<KpiSparkline trend={trend([3])} src={{ key: 'kpi.census' }} />);
    expect(container.querySelector('polyline')).toBeNull();
    expect(container.querySelector('[data-trend="recording"]')?.textContent).toContain('추세 기록 중');
  });

  it('서버가 이 역할에게 주지 않은 지표는 아무것도 그리지 않는다 · 조회 실패는 실패라고', async () => {
    const { KpiSparkline } = await import('@/app/(main)/command-center/KpiSparkline');
    const r1 = render(<KpiSparkline trend={trend([1, 2, 3], { metrics: ['pharmacy.pending'] })} src={{ key: 'kpi.census' }} />);
    expect(r1.container.innerHTML).toBe('');
    cleanup();
    const r2 = render(<KpiSparkline src={{ key: 'kpi.census' }} failed />);
    expect(r2.container.textContent).toContain('추세 조회 실패');
  });
});

describe('C 3단 관제 배치', () => {
  const page = readFileSync(join(process.cwd(), 'src/app/(main)/command-center/page.tsx'), 'utf8');

  it('🔴 넓은 화면 3단 — 왼쪽 조치(세로 고정) · 가운데 부서 · 오른쪽 여정 — DOM 순서가 좁은 화면 읽는 순서', () => {
    expect(page).toMatch(/2xl:grid 2xl:grid-cols-\[minmax\(280px,340px\)_minmax\(0,1fr\)_minmax\(320px,420px\)\]/);
    const a = page.indexOf('data-cc-col="actions"'), b = page.indexOf('data-cc-col="boards"'), j = page.indexOf('data-cc-col="journey"');
    expect(a).toBeGreaterThan(-1);
    expect(a).toBeLessThan(b);
    expect(b).toBeLessThan(j);
    // 왼쪽 조치 열은 넓은 화면에서 세로 고정(스크롤해도 조치 목록이 남는다)
    expect(page).toMatch(/<aside className="2xl:sticky 2xl:top-4[^"]*" data-cc-col="actions">/);
    // 3D 보기는 3단 밖(전폭) — 좁은 열에 캔버스를 넣지 않는다
    expect(page.indexOf('<Building3DSection />')).toBeGreaterThan(j);
  });

  it('추세 조회는 서버 이력 EP 를 5분 주기로', () => {
    expect(page).toMatch(/\/api\/v1\/command-center\/trend\?hours=24/);
    expect(page).toMatch(/refetchInterval: 5 \* 60_000/);
  });

  it('🔴 공간 부하 요약 — 3D 와 같은 응답 · 못 놓은 대기를 센다 · 기준 출처', async () => {
    get.mockResolvedValue({ data: {
      asOf: at(0), target: { opdWaitMin: 30, source: 'FALLBACK' }, queueTotal: 260,
      rooms: [
        { spaceNodeId: 'a', name: '내과 1진료실', waiting: 5, called: 0, inConsultation: 1, longestWaitMin: 42, level: 'OVER_TARGET' },
        { spaceNodeId: 'b', name: '외과 1진료실', waiting: 1, called: 0, inConsultation: 0, longestWaitMin: 3, level: 'WITHIN_TARGET' },
      ],
      stations: [], unplaced: { queueWithoutRoom: 100, queueRoomNotLinked: [{ roomName: 'x', count: 153 }], stationsNotLinked: 0, stationLogsNotPlaced: 0 },
    } });
    const { SpaceLoadMini } = await import('@/app/(main)/command-center/SpaceLoadMini');
    const { container } = wrap(<SpaceLoadMini />);
    await waitFor(() => expect(container.textContent).toContain('내과 1진료실'));
    expect(get.mock.calls[0][0]).toBe('/api/v1/command-center/space-load');
    expect(container.textContent).toMatch(/7\s*\/\s*260/);
    expect(container.textContent).toMatch(/253/); // 100 + 153
    expect(container.textContent).toContain('기본값(미설정)');
  });

  it('🔴 3D 섹션 격자가 캔버스 폭에 밀려 화면 밖으로 넘치지 않는다(minmax(0,1fr))', () => {
    const src = readFileSync(join(process.cwd(), 'src/app/(main)/command-center/Building3DSection.tsx'), 'utf8');
    expect(src).toMatch(/xl:grid-cols-\[minmax\(0,1fr\)_300px\]/);
    expect(src).not.toMatch(/xl:grid-cols-\[1fr_300px\]/);
  });
});
