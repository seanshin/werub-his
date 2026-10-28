/**
 * 방문 묶음(2026-10-01 · 여정 P3 표시 잔여) — 환자의 방문 단위를 도메인 원장에서 요약해 타임라인 위에.
 *  · 끝 시각은 정본이 있는 방문만 — 응급 퇴실(D9)·외래 끝(D8)은 이유를 말하고 화살표(→ 끝)를 그리지 않는다
 *  · 처분은 끝이 아니라 결정 시각(milestone) · 예정 방문은 "예정" · 잘림은 말한다 · 실패≠없음
 *  · 누르면 onSelect · 다시 누르면 해제
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const get = vi.fn();
vi.mock('@/lib/api-client', async (orig) => ({ ...(await orig<object>()), apiClient: { get: (...a: unknown[]) => get(...a), getToken: () => 'x' } }));
const wrap = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>;
beforeEach(() => { cleanup(); get.mockReset(); });

const EPS = [
  { type: 'EmergencyVisit', id: 'er1', title: null, startAt: '2026-10-01T01:00:00Z', endAt: null, state: 'END_UNDEFINED',
    endUnavailableReason: 'DEPARTURE_NOT_RECORDED', milestone: { kind: 'DISPOSITION', at: '2026-10-01T04:00:00Z' }, domainStatus: 'COMPLETED' },
  { type: 'Admission', id: 'ad1', title: '5병동', startAt: '2026-09-20T01:00:00Z', endAt: '2026-09-25T01:00:00Z', state: 'ENDED',
    endUnavailableReason: null, milestone: null, domainStatus: 'DISCHARGED' },
  { type: 'Surgery', id: 'sg1', title: '복강경 담낭절제술', startAt: null, endAt: null, state: 'PLANNED',
    endUnavailableReason: null, milestone: { kind: 'SCHEDULED', at: '2026-10-05T00:00:00Z' }, domainStatus: 'SCHEDULED' },
];

async function renderStrip(resp: unknown, onSelect = vi.fn(), selected: { type: string; id: string } | null = null) {
  get.mockImplementation(async () => resp);
  const { JourneyVisitStrip } = await import('@/components/journey/journey-visit-strip');
  const r = render(<JourneyVisitStrip patientId="p1" selected={selected} onSelect={onSelect} />, { wrapper: wrap });
  return { ...r, onSelect };
}

describe('방문 묶음', () => {
  it('🔴 응급은 끝 대신 이유 · 처분은 결정 시각 · 입원은 시작→끝 · 수술 예정은 "예정"', async () => {
    const { container } = await renderStrip({ data: EPS, meta: { truncatedTypes: [] } });
    await waitFor(() => expect(container.querySelectorAll('[data-journey-visit]').length).toBe(3));
    const [er, adm, sg] = [...container.querySelectorAll('[data-journey-visit]')];
    expect(er.textContent).toContain('퇴실 시각 기록 없음');
    expect(er.textContent).toContain('처분 결정');
    expect(er.textContent).not.toContain('→');
    expect(er.textContent).toContain('끝 시각 없음');
    expect(adm.textContent).toContain('→');
    expect(adm.textContent).toContain('5병동');
    expect(adm.textContent).toContain('끝남');
    expect(sg.textContent).toContain('예정');
    expect(sg.textContent).not.toContain('진행 중');
    expect(get).toHaveBeenCalledWith('/api/v1/journey/p1/episodes');
  });

  it('누르면 고르고 · 고른 것을 다시 누르면 해제', async () => {
    const { container, onSelect } = await renderStrip({ data: EPS, meta: {} }, vi.fn(), { type: 'Admission', id: 'ad1' });
    await waitFor(() => expect(container.querySelectorAll('[data-journey-visit]').length).toBe(3));
    const btns = container.querySelectorAll('[data-journey-visit]');
    fireEvent.click(btns[0]);
    expect(onSelect).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'EmergencyVisit', id: 'er1' }));
    expect(btns[1].getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(btns[1]);
    expect(onSelect).toHaveBeenLastCalledWith(null);
  });

  it('잘림은 말한다 · 빈 목록은 빈 목록 · 실패는 실패', async () => {
    const a = await renderStrip({ data: EPS, meta: { truncatedTypes: ['WaitingQueue'], perTypeLimit: 30 } });
    await waitFor(() => expect(a.container.textContent).toContain('최근 30건만'));
    cleanup();
    const b = await renderStrip({ data: [], meta: {} });
    await waitFor(() => expect(b.container.textContent).toContain('기록된 방문이 없습니다'));
    cleanup();
    get.mockReset();
    get.mockRejectedValue(new Error('500'));
    const { JourneyVisitStrip } = await import('@/components/journey/journey-visit-strip');
    const c = render(<JourneyVisitStrip patientId="p1" selected={null} onSelect={vi.fn()} />, { wrapper: wrap });
    await waitFor(() => expect(c.container.querySelector('[aria-busy="true"]')).toBeNull());
    expect(c.container.textContent).not.toContain('기록된 방문이 없습니다');
  });
});
