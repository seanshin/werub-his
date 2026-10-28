/**
 * 접수 데스크 대기 현황(2026-09-29 보강) — 지키는 것:
 *  1. 🔴 조회 실패는 실패로 — 종전엔 isError 를 보지 않아 "대기 중인 환자가 없습니다"가 그려졌다(한산함으로 읽힌다)
 *  2. 검색(이름·등록번호·#순번)·상태 칩(수는 오늘 전체 기준)
 *  3. 잘못 누른 취소·미방문은 되돌릴 수 있다(PATCH /queue/:id/restore) · 접수 취소는 확인을 거친다
 *  4. 접수 시각 미도래 예약은 "예약(미도래)" — 지금 기다리는 사람과 섞어 읽지 않게, 대기시간도 그리지 않는다
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const get = vi.fn();
const patch = vi.fn();
vi.mock('@/lib/api-client', async (orig) => ({ ...(await orig<object>()), apiClient: { get: (...a: unknown[]) => get(...a), patch: (...a: unknown[]) => patch(...a) } }));
vi.mock('@/lib/use-departments', () => ({ useDepartments: () => ({ names: ['내과', '정형외과'], isError: false, refetch: vi.fn() }), DeptLoadError: () => null }));
vi.mock('@/lib/sse-signal', () => ({ subscribeSseSignal: () => () => {} }));
vi.mock('@/stores/toast-store', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const now = Date.now();
const ROWS = [
  { id: 'a', queueNumber: 3, status: 'WAITING', departmentName: '내과', visitType: 'FOLLOW_UP', type: 'WALK_IN', checkedInAt: new Date(now - 42 * 60000).toISOString(), patient: { familyName: '김', givenName: '영수', mrn: 'M001' } },
  { id: 'b', queueNumber: 4, status: 'CALLED', departmentName: '내과', visitType: 'INITIAL', type: 'WALK_IN', checkedInAt: new Date(now - 12 * 60000).toISOString(), patient: { familyName: '박', givenName: '민지', mrn: 'M002' } },
  { id: 'c', queueNumber: 5, status: 'WAITING', isScheduled: true, departmentName: '정형외과', visitType: 'FOLLOW_UP', type: 'APPOINTMENT', checkedInAt: new Date(now + 60 * 60000).toISOString(), patient: { familyName: '최', givenName: '수아', mrn: 'M003' } },
  { id: 'd', queueNumber: 2, status: 'CANCELLED', departmentName: '내과', visitType: 'INITIAL', type: 'WALK_IN', checkedInAt: new Date(now - 90 * 60000).toISOString(), patient: { familyName: '한', givenName: '지우', mrn: 'M004' } },
];

function route(url: string) {
  if (url === '/api/v1/queue/stats') return Promise.resolve({ data: { data: { avgWaitMinutes: {}, hourly: [] } } });
  if (url === '/api/v1/queue') return Promise.resolve({ data: { data: ROWS } });
  return Promise.resolve({ data: [] });
}

async function mount() {
  const { QueueTab } = await import('@/app/(main)/reception/components/QueueTab');
  const utils = render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><QueueTab /></QueryClientProvider>);
  return utils;
}
const rows = () => screen.queryAllByRole('row').slice(1); // 머리 행 제외

beforeEach(() => { cleanup(); get.mockReset(); patch.mockReset(); get.mockImplementation(route); patch.mockResolvedValue({ data: {} }); });

describe('접수 대기 현황', () => {
  it('🔴 조회 실패는 "대기 없음"이 아니다', async () => {
    get.mockImplementation((url: string) => (url === '/api/v1/queue' ? Promise.reject(new Error('500')) : route(url)));
    const { container } = await mount();
    // 실패 폴백(재시도 버튼)이 실제로 그려져야 한다 — "없음" 문구가 없다는 것만으로는 로딩과 구분이 안 된다
    expect(await screen.findByText('다시 시도', {}, { timeout: 3000 })).toBeTruthy();
    expect(container.textContent).not.toContain('대기 중인 환자가 없습니다');
  });

  it('상태 칩 수는 오늘 전체 기준 · 누르면 그 상태만', async () => {
    const { container } = await mount();
    await screen.findByText('영수', { exact: false });
    const chip = (k: string) => container.querySelector(`[data-queue-status-chip="${k}"]`) as HTMLElement;
    expect(chip('ALL').textContent).toContain('4');
    expect(chip('WAITING').textContent).toContain('2');
    expect(chip('CANCELLED').textContent).toContain('1');
    fireEvent.click(chip('CANCELLED'));
    expect(rows()).toHaveLength(1);
    // 걸러도 칩 수는 오늘 전체 기준 그대로(거른 뒤 수로 바뀌면 "전체 1"이 된다)
    expect(chip('ALL').textContent).toContain('4');
    expect(rows()[0].textContent).toContain('지우');
  });

  it('검색 — 이름·등록번호·#순번', async () => {
    const { container } = await mount();
    await screen.findByText('영수', { exact: false });
    const box = container.querySelector('[data-queue-search]') as HTMLInputElement;
    fireEvent.change(box, { target: { value: 'M002' } });
    expect(rows().map((r) => r.textContent)).toEqual([expect.stringContaining('민지')]);
    fireEvent.change(box, { target: { value: '#5' } });
    expect(rows().map((r) => r.textContent)).toEqual([expect.stringContaining('수아')]);
    fireEvent.change(box, { target: { value: '없는사람' } });
    expect(await screen.findByText(/조건에 맞는 접수가 없습니다/)).toBeTruthy();
  });

  it('예약(미도래)는 표식이 붙고 대기시간을 그리지 않는다', async () => {
    await mount();
    await screen.findByText('수아', { exact: false });
    const r = rows().find((x) => x.textContent?.includes('수아'))!;
    expect(r.textContent).toContain('예약(미도래)');
    // 대기시간 칸(8번째)이 비어 있어야 한다 — 대조군: 지금 기다리는 김영수 행은 칸이 차 있다
    const waitCell = (row: HTMLElement) => row.querySelectorAll('td')[7].textContent?.trim();
    expect(waitCell(r)).toBe('');
    expect(waitCell(rows().find((x) => x.textContent?.includes('영수'))!)).not.toBe('');
  });

  it('취소된 행은 되돌리기 → PATCH restore · 접수 취소는 확인을 거친다', async () => {
    const confirm = vi.spyOn(window, 'confirm');
    const { container } = await mount();
    await screen.findByText('지우', { exact: false });
    confirm.mockReturnValue(true);
    fireEvent.click(container.querySelector('[data-queue-restore]') as HTMLElement);
    await vi.waitFor(() => expect(patch).toHaveBeenCalledWith('/api/v1/queue/d/restore'));

    patch.mockClear();
    confirm.mockClear();
    confirm.mockReturnValue(false);
    const r = rows().find((x) => x.textContent?.includes('영수'))!;
    fireEvent.click(within(r).getByText('접수 취소'));
    expect(confirm).toHaveBeenCalledTimes(1);
    await new Promise((res) => setTimeout(res, 30)); // 뮤테이션은 비동기 — 기다린 뒤에도 호출이 없어야 한다
    expect(patch).not.toHaveBeenCalled();
    // 대조군: 확인하면 취소가 나간다
    confirm.mockReturnValue(true);
    fireEvent.click(within(rows().find((x) => x.textContent?.includes('영수'))!).getByText('접수 취소'));
    await vi.waitFor(() => expect(patch).toHaveBeenCalledWith('/api/v1/queue/a/cancel'));
    confirm.mockRestore();
  });
});
