/**
 * 환자 여정 표시 UX(2026-10-01 여정 P3 · 화면 검토 반영).
 *  · 유형은 shared 표시 정본의 라벨로(원 코드 `RECEPTION_CHECKIN` 을 그리지 않는다) · 어휘 밖은 '기록 종류 미등록'
 *  · 최신순·날짜 묶음 · 발생 시각을 모르면 "발생 미상"(기록 시각인 척하지 않는다) · 늦은 기록은 기록 시각(createdAt) 병기
 *  · 정정 표식·데모/시드 표식·예정 시각 · 방문 칩 → 그 방문 기록만 **서버에서**(2026-10-01 방문 묶음 — 종전엔 불러온 범위 안에서만 걸렀다)
 *  · 트랙 필터는 서버 types 로 · 로딩 중은 "없음"이 아니다
 *  · 여정 대시보드는 같은 부품을 쓴다(로컬 표 회수) · 지표 실패가 타임라인을 가리지 않는다
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const get = vi.fn();
vi.mock('@/lib/api-client', async (orig) => ({ ...(await orig<object>()), apiClient: { get: (...a: unknown[]) => get(...a), getToken: () => 'x' } }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => '/journey', useSearchParams: () => new URLSearchParams() }));

const wrap = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>;
beforeEach(() => { cleanup(); get.mockReset(); });

const V = '11111111-1111-4111-8111-111111111111';
const ROWS = [
  { id: 'e1', eventType: 'RECEPTION_CHECKIN', title: '내과 접수 (대기 #3)', eventAt: '2026-09-29T00:00:00Z', occurredAt: null, dataOrigin: 'UNKNOWN', objects: [] },
  { id: 'e2', eventType: 'ER_ARRIVAL', title: '응급실 도착', eventAt: '2026-10-01T03:00:00Z', createdAt: '2026-10-01T03:00:00Z',
    occurredAt: '2026-10-01T01:00:00Z', occurredAtSource: 'USER_CLAIMED', dataOrigin: 'LIVE', objects: [{ objectType: 'EmergencyVisit', objectId: V }] },
  { id: 'e3', eventType: 'ER_DISPOSITION', title: '응급 처분 변경', eventAt: '2026-10-01T04:00:00Z', createdAt: '2026-10-01T04:00:00Z',
    occurredAt: '2026-10-01T04:00:00Z', occurredAtSource: 'DOMAIN_FIELD', transition: 'REVISED', supersedesId: 'gone', dataOrigin: 'DEMO',
    objects: [{ objectType: 'EmergencyVisit', objectId: V }] },
  { id: 'e4', eventType: 'ROUND', title: '옛 회진', eventAt: '2026-09-28T00:00:00Z', occurredAt: null, objects: [] },
  { id: 'e5', eventType: 'CHECKUP_RESERVED', title: '종합검진 예약', eventAt: '2026-09-30T00:00:00Z', createdAt: '2026-09-30T00:00:00Z',
    occurredAt: '2026-09-30T00:00:00Z', occurredAtSource: 'SAME_AS_RECORDED', plannedAt: '2026-10-10T00:00:00Z', objects: [] },
];

const EPISODES = [
  { type: 'EmergencyVisit', id: V, title: null, startAt: '2026-10-01T01:00:00Z', endAt: null, state: 'END_UNDEFINED',
    endUnavailableReason: 'DEPARTURE_NOT_RECORDED', milestone: { kind: 'DISPOSITION', at: '2026-10-01T04:00:00Z' }, domainStatus: 'COMPLETED' },
];

async function renderTab(rows = ROWS) {
  get.mockImplementation(async (url: string, q?: Record<string, string>) => {
    if (url.includes('/report')) return { data: null };
    if (url.includes('/episodes')) return { data: EPISODES, meta: { truncatedTypes: [] } };
    // 서버 방문 거르기 흉내 — episodeId 가 오면 그 방문 행만
    const data = q?.episodeId ? rows.filter((r) => r.objects?.some((o) => o.objectId === q.episodeId)) : rows;
    return { data, meta: { truncated: false } };
  });
  const { JourneyTab } = await import('@/app/(main)/patients/[id]/components/JourneyTab');
  const r = render(<JourneyTab patientId="p1" />, { wrapper: wrap });
  await waitFor(() => expect(r.container.textContent).toContain('응급실 도착'));
  return r;
}

describe('환자 여정 탭 — 표시', () => {
  it('🔴 유형은 정본 라벨로(원 코드 아님) · 어휘 밖은 미등록이라고 말한다', async () => {
    const { container } = await renderTab();
    const text = container.textContent ?? '';
    expect(text).toContain('외래 접수');
    expect(text).not.toContain('RECEPTION_CHECKIN');
    expect(text).toContain('기록 종류 미등록');
    expect(text).not.toMatch(/(^|[^A-Z_])ROUND([^A-Z_]|$)/);
  });

  it('🔴 최신순 · 발생 시각을 모르면 "발생 미상" · 입력 시각 표식 · 늦은 기록은 기록 시각 병기', async () => {
    const { container } = await renderTab();
    const text = container.textContent ?? '';
    expect(text.indexOf('응급 처분 변경')).toBeLessThan(text.indexOf('응급실 도착'));
    expect(text.indexOf('응급실 도착')).toBeLessThan(text.indexOf('내과 접수'));
    // 발생 시각 미상 — 행마다 두 줄을 쓰지 않고 ◌ + 범례 한 줄(정직성 유지·소음 감소)
    expect(container.querySelector('[data-journey-unknown-legend]')).not.toBeNull();
    expect(container.querySelector('[aria-label="발생 미상"]')).not.toBeNull();
    expect(text).toContain('입력된 시각');
    expect(text).toMatch(/기록\s*\S+/); // 도착(01시 발생)·03시 기록 — 2시간 늦은 기록
    expect(text).toContain('최신순 · 발생 시각 기준(모르면 표시 시각)');
  });

  it('정정·데모 표식 · 예정 시각 · 정정 대상이 불러온 범위 밖이면 그렇다고', async () => {
    const { container } = await renderTab();
    const text = container.textContent ?? '';
    expect(text).toContain('정정');
    expect(text).toContain('데모');
    expect(text).toContain('앞 기록 정정 — 대상 기록은 불러온 범위 밖');
    expect(text).toContain('예정');
    // 대조군 — 과거 행(UNKNOWN 출처)에는 출처 표식이 없다
    const row = container.querySelector('[data-journey-event="RECEPTION_CHECKIN"]')!;
    expect(row.textContent).not.toContain('데모');
    expect(row.textContent).not.toContain('시드');
  });

  it('🔴 방문 칩 → 그 방문 기록만 서버에서(episodeType·episodeId) · 방문 요약 · 전체 보기로 돌아간다', async () => {
    const { container } = await renderTab();
    await waitFor(() => expect(container.querySelector('[data-journey-visit]')).not.toBeNull());
    fireEvent.click(screen.getAllByTitle('이 방문의 기록만 보기')[0]);
    await waitFor(() => expect(container.querySelector('[data-journey-episode-filter]')).not.toBeNull());
    expect(get).toHaveBeenCalledWith('/api/v1/journey/p1/timeline', expect.objectContaining({ episodeType: 'EmergencyVisit', episodeId: V }));
    expect(container.textContent).not.toContain('불러온 기록 안에서');
    await waitFor(() => expect(container.textContent).not.toContain('내과 접수'));
    // 행 칩으로 골라도 방문 묶음이 받아 둔 요약을 보인다 — 끝 시각 대신 이유
    expect(container.querySelector('[data-journey-episode-summary]')?.textContent).toContain('응급실 퇴실 시각이 기록되지 않았습니다');
    expect(container.textContent).toContain('응급실 도착');
    fireEvent.click(screen.getByText('전체 보기'));
    await waitFor(() => expect(container.textContent).toContain('내과 접수'));
  });

  it('트랙 필터는 서버 types 로 부른다 · 로딩 중은 "없음"이 아니다', async () => {
    let resolve: (v: unknown) => void = () => {};
    get.mockImplementation((url: string) => (url.includes('/report') ? Promise.resolve({ data: null }) : new Promise((r) => { resolve = r; })));
    const { JourneyTab } = await import('@/app/(main)/patients/[id]/components/JourneyTab');
    const { container } = render(<JourneyTab patientId="p1" />, { wrapper: wrap });
    await waitFor(() => expect(container.querySelector('[aria-busy="true"]')).not.toBeNull());
    expect(container.textContent).not.toContain('기록된 이벤트가 없습니다');
    resolve({ data: ROWS, meta: {} });
    await waitFor(() => expect(container.textContent).toContain('응급실 도착'));
    get.mockImplementation(async (url: string) => (url.includes('/report') ? { data: null } : { data: [], meta: {} }));
    fireEvent.click(screen.getByRole('button', { name: '응급' }));
    await waitFor(() => expect(get.mock.calls.some((c) => c[1]?.types?.includes('ER_ARRIVAL'))).toBe(true));
    const call = get.mock.calls.find((c) => c[1]?.types)!;
    expect(call[1].types).not.toContain('RECEPTION_CHECKIN');
  });
});

describe('여정 대시보드', () => {
  it('🔴 같은 부품을 쓴다 — 로컬 유형 표(어휘에 없는 10개)를 두지 않는다 · 지표 실패가 페이지를 가리지 않는다', async () => {
    const src = readFileSync(join(__dirname, '../../src/app/(main)/journey/page.tsx'), 'utf8');
    expect(src).not.toMatch(/EVENT_TYPE_LABEL/);
    expect(src).toMatch(/<JourneyTab patientId=/);
    get.mockImplementation(async (url: string) => { if (url.includes('metrics')) throw new Error('500'); return { data: [] }; });
    const { default: Page } = await import('@/app/(main)/journey/page');
    const { container } = render(<Page />, { wrapper: wrap });
    await waitFor(() => expect(container.textContent).toContain('환자를 선택하면 여정 타임라인이 표시됩니다'));
    expect(container.textContent).toContain('환자 검색');
  });
});
