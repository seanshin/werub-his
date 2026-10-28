/**
 * 병상 공간 연결(관리 · 2026-10-02) — 병실 단위로 묶어 보이고 · 후보는 하나뿐일 때만(서버 판정) · 누를 때 미연결 병상만 잇는다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, cleanup, waitFor, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const get = vi.fn(); const put = vi.fn(); const post = vi.fn();
vi.mock('@/lib/api-client', async (orig) => ({ ...(await orig<object>()), apiClient: { get: (...a: unknown[]) => get(...a), put: (...a: unknown[]) => put(...a), post: (...a: unknown[]) => post(...a), getToken: () => 'x' } }));
vi.mock('@/stores/toast-store', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));
const wrap = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>;
beforeEach(() => { cleanup(); get.mockReset(); put.mockReset(); post.mockReset(); });

const W3 = { id: 'w3', name: '3층 내과병동', floor: 3, type: 'GENERAL' };
const ROWS = [
  { bedId: 'b1', ward: W3, roomNumber: '301', bedNumber: 'A', space: null, suggestion: { spaceNodeId: 'z301', name: '301호', floor: 3 } },
  { bedId: 'b2', ward: W3, roomNumber: '301', bedNumber: 'B', space: { id: 'z301', name: '301호', floor: 3 }, suggestion: null },
  { bedId: 'b3', ward: W3, roomNumber: '302', bedNumber: 'A', space: null, suggestion: null },
];

describe('병상 공간 연결', () => {
  it('병실 단위 묶음 · 미연결 수 · 후보는 미연결 병상만 잇는다 · 일괄 버튼', async () => {
    get.mockResolvedValue({ data: ROWS });
    put.mockResolvedValue({ data: { updated: 1 } });
    post.mockResolvedValue({ data: { linked: 1, noSuggestion: 1 } });
    const { BedLinkPanel } = await import('@/app/(main)/admin/space-assets/BedLinkPanel');
    const { container } = render(<BedLinkPanel floors={[{ id: 'f3', name: '3층', zones: [{ id: 'z301', name: '301호' }, { id: 'z302', name: '302호' }] }]} />, { wrapper: wrap });
    await waitFor(() => expect(container.querySelectorAll('[data-bed-room]').length).toBe(2));
    expect(container.textContent).toContain('미연결 2/3');
    fireEvent.click(screen.getByText('이 후보로 연결', { exact: false }));
    await waitFor(() => expect(put).toHaveBeenCalledWith('/api/v1/space-assets/bed-links', { bedIds: ['b1'], spaceNodeId: 'z301' }));
    fireEvent.click(screen.getByText('후보가 하나뿐인 병상 일괄 연결', { exact: false }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/v1/space-assets/bed-links/link-suggested', {}));
  });

  it('조회 실패는 실패로(빈 목록이 아니다)', async () => {
    get.mockRejectedValue(new Error('500'));
    const { BedLinkPanel } = await import('@/app/(main)/admin/space-assets/BedLinkPanel');
    const { container } = render(<BedLinkPanel floors={[]} />, { wrapper: wrap });
    await waitFor(() => expect(container.textContent).not.toContain('불러오는 중'));
    expect(container.textContent).not.toContain('등록된 병상이 없습니다');
  });
});
