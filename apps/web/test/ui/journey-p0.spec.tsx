/**
 * 환자 여정 P0 화면(2026-10-01).
 *  · 지표: 서버가 null 이면 "산출 불가" + 이유(응급 체류 = 퇴실 시각 정본 없음) + 대상 수 — 0 으로 그리지 않는다
 *  · 여정 대시보드 타임라인: 서버 필드(eventAt·title)를 읽는다(종전 없는 timestamp·summary 라 제목이 늘 '-') · 잘림을 말한다 · 실패 ≠ 없음
 *  · 환자 여정 탭: 최신 N건 + "이전 기록 더 보기"(커서) · 실패는 실패로
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const get = vi.fn();
vi.mock('@/lib/api-client', async (orig) => ({ ...(await orig<object>()), apiClient: { get: (...a: unknown[]) => get(...a), getToken: () => 'x' } }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => '/journey', useSearchParams: () => new URLSearchParams() }));

const wrap = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>;
beforeEach(() => { cleanup(); get.mockReset(); });

const METRICS = {
  period: { from: 'x', to: 'y' },
  avgOutpatientWaitMinutes: null, outpatientWaitSampleN: 0,
  avgErStayHours: null, erStayUnavailableReason: 'NO_DEPARTURE_RECORDED', erVisitSampleN: 0, erStayExcluded: 7,
  avgLengthOfStayDays: 4, admissionSampleN: 2,
  readmissionRate30Days: null, dischargeSampleN: 0,
  sampleCounts: { outpatientWaits: 0 },
};

describe('여정 대시보드', () => {
  it('🔴 응급 체류는 "산출 불가" + 이유 + 대상 수 · 표본 수 각주 · 근거 필드를 타일로 그리지 않는다', async () => {
    get.mockImplementation(async (url: string) => (url.includes('metrics') ? { data: METRICS } : { data: [] }));
    const { default: Page } = await import('@/app/(main)/journey/page');
    const { container } = render(<Page />, { wrapper: wrap });
    await waitFor(() => expect(container.textContent).toContain('기간 안 퇴실 시각이 기록된 방문이 없어 계산하지 않음'));
    // 2026-10-03 결정 D9 — 퇴실 시각 없는 방문은 표본에서 빼고 그 수를 말한다
    expect(container.textContent).toContain('진행 중이거나 퇴실 시각이 없는 7건 제외');
    expect(container.textContent).not.toContain('대상 0건');
    expect(container.textContent).toContain('표본 2건 기준');
    expect(container.textContent).not.toContain('erVisitSampleN');
    expect(container.textContent).not.toContain('erStayUnavailableReason');
    expect(container.textContent).not.toMatch(/(^|\D)0시간/);
  });
});

describe('환자 여정 탭', () => {
  const evs = (ids: string[]) => ids.map((id, i) => ({ id, eventType: 'LAB_RESULT', title: `결과 ${id}`, eventAt: `2026-09-30T0${i}:00:00Z` }));
  it('🔴 잘렸으면 말하고, "이전 기록 더 보기"로 커서를 넘겨 앞에 붙인다', async () => {
    get.mockImplementation(async (url: string, params?: Record<string, string>) => {
      if (url.includes('/report')) return { data: null };
      if (url.includes('/episodes')) return { data: [] }; // 방문 묶음(2026-10-01) — 이 스펙은 타임라인만 본다
      if (params?.before) return { data: evs(['a']), meta: { olderCursor: null } };
      return { data: evs(['b', 'c']), meta: { truncated: true, olderCursor: '2026-09-30T00:00:00.000Z|b' } };
    });
    const { JourneyTab } = await import('@/app/(main)/patients/[id]/components/JourneyTab');
    const { container } = render(<JourneyTab patientId="p1" />, { wrapper: wrap });
    await waitFor(() => expect(container.textContent).toContain('이전 기록이 더 있습니다'));
    fireEvent.click(screen.getByText('이전 기록 더 보기'));
    await waitFor(() => expect(container.textContent).toContain('결과 a'));
    expect(get).toHaveBeenCalledWith('/api/v1/journey/p1/timeline', { before: '2026-09-30T00:00:00.000Z|b' });
    // (2026-10-01 P3 UX) 최신순 — 이어 받은 이전 기록은 **아래**로 간다
    const text = container.textContent ?? '';
    expect(text.indexOf('결과 c')).toBeLessThan(text.indexOf('결과 b'));
    expect(text.indexOf('결과 b')).toBeLessThan(text.indexOf('결과 a'));
    expect(text).not.toContain('이전 기록이 더 있습니다');
  });
  it('이전 기록 조회 실패는 실패로 말한다', async () => {
    get.mockImplementation(async (url: string, params?: Record<string, string>) => {
      if (url.includes('/report')) return { data: null };
      if (url.includes('/episodes')) return { data: [] }; // 방문 묶음(2026-10-01) — 이 스펙은 타임라인만 본다
      if (params?.before) throw new Error('500');
      return { data: evs(['b']), meta: { truncated: true, olderCursor: 'x|b' } };
    });
    const { JourneyTab } = await import('@/app/(main)/patients/[id]/components/JourneyTab');
    const { container } = render(<JourneyTab patientId="p1" />, { wrapper: wrap });
    await waitFor(() => screen.getByText('이전 기록 더 보기'));
    fireEvent.click(screen.getByText('이전 기록 더 보기'));
    await waitFor(() => expect(container.textContent).toContain('이전 기록을 불러오지 못했습니다'));
  });
});
