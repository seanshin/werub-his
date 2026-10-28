/**
 * 임상경로 마일스톤 ↔ 약속처방 세트 연결(2026-10-07).
 *  · 처방 도우미: 연결된 ACTIVE 세트만 "세트 담기"(→ 약속처방 미리보기) · 사용 중 아님/없음은 상태만 · 연결 없는 항목은 아무것도(제목을 오더로 풀지 않는다)
 *  · 간호사는 세트 담기 버튼 없음(약속처방 탭 권한과 같은 판정)
 *  · 편집 저장 본문: 바뀐 경우만 detail · 해제는 null · 오더/투약 밖 카테고리는 연결 해제
 * 재주입: 위 규칙 하나를 되돌리면 실패한다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuthStore } from '@/stores/auth-store';
import { orderSetDetailPatch } from '@/app/(main)/clinical-pathway/milestone-order-set';

const get = vi.fn();
vi.mock('@/lib/api-client', async (orig) => ({ ...(await orig<object>()), apiClient: { get: (...a: unknown[]) => get(...a), patch: vi.fn(), post: vi.fn(), getToken: () => 'x' } }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => '/orders', useSearchParams: () => new URLSearchParams() }));
const wrap = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>;

const assignment = { id: 'as1', status: 'ACTIVE', startDate: '2026-10-06', pathway: { name: '폐렴', code: 'CP-PNA', totalDays: 7 } };
const detail = {
  ...assignment,
  pathway: { ...assignment.pathway, milestones: [
    { id: 'm1', day: 1, category: 'ORDER', title: '기본 검사 오더 (CBC, BMP, 심전도)', isRequired: true, orderSet: { id: 'set-a', name: '폐렴 입원 기본', status: 'ACTIVE' } },
    { id: 'm2', day: 1, category: 'MEDICATION', title: '항생제', isRequired: true, orderSet: { id: 'set-off', name: '옛 세트', status: 'INACTIVE' } },
    { id: 'm3', day: 1, category: 'ORDER', title: '흉부 X선', isRequired: false, orderSet: null },
  ] },
  outcomes: [],
};
beforeEach(() => {
  cleanup(); get.mockReset();
  get.mockImplementation((url: string) => {
    if (url.endsWith('/pathways/assignments')) return Promise.resolve({ data: [assignment] });
    if (url.includes('/pathways/assignments/')) return Promise.resolve({ data: detail });
    if (url.includes('/pre-orders/patient/')) return Promise.resolve({ data: { data: [] } });
    return Promise.resolve({ data: [] });
  });
});
async function bar(role: string) {
  useAuthStore.setState({ user: { id: 'u1', role } as never, isAuthenticated: true });
  const onOpenOrderSet = vi.fn();
  const { OrderAssistBar } = await import('@/app/(main)/orders/OrderAssistBar');
  const u = render(<OrderAssistBar patientId="p1" encounterId="e1" diagnosisCodes={[]} primaryCode={null} today="2026-10-07" onOpenOrderSet={onOpenOrderSet} onPrescriptionsAdded={vi.fn()} />, { wrapper: wrap });
  await waitFor(() => expect(u.container.querySelector('[data-assist-chip="PATHWAY"]')!.textContent).toContain('1'));
  fireEvent.click(u.container.querySelector('[data-assist-chip="PATHWAY"]')!);
  await waitFor(() => expect(u.container.querySelector('[data-assist-ms="today"]')).toBeTruthy());
  return { ...u, onOpenOrderSet };
}

describe('처방 도우미 — 경로 항목의 세트 담기', () => {
  it('🔴 ACTIVE 연결만 담기 버튼 → 그 세트 미리보기 · 사용 중 아님은 상태만 · 연결 없음은 아무것도', async () => {
    const { container, onOpenOrderSet } = await bar('DOCTOR');
    const btns = container.querySelectorAll('[data-assist-ms-set]');
    expect(btns.length).toBe(1);
    fireEvent.click(btns[0]);
    expect(onOpenOrderSet).toHaveBeenCalledWith('set-a');
    expect(container.querySelector('[data-assist-ms-set-stale="INACTIVE"]')).toBeTruthy();
    expect(container.querySelectorAll('[data-assist-ms-set-stale]').length).toBe(1);
  });
  it('간호사는 담기 버튼이 없다(약속처방 권한과 같은 판정)', async () => {
    const { container } = await bar('NURSE');
    expect(container.querySelector('[data-assist-ms-set]')).toBeNull();
  });
});

describe('편집 저장 본문 — orderSetDetailPatch', () => {
  it('🔴 바뀐 경우만 보낸다 · 해제는 null · 오더/투약 밖이면 해제', () => {
    expect(orderSetDetailPatch('ORDER', 'set-a', 'set-a')).toEqual({});
    expect(orderSetDetailPatch('ORDER', '', null)).toEqual({});
    expect(orderSetDetailPatch('ORDER', 'set-b', 'set-a')).toEqual({ detail: { orderSetId: 'set-b' } });
    expect(orderSetDetailPatch('MEDICATION', '', 'set-a')).toEqual({ detail: { orderSetId: null } });
    expect(orderSetDetailPatch('EDUCATION', 'set-a', 'set-a')).toEqual({ detail: { orderSetId: null } });
    expect(orderSetDetailPatch('EDUCATION', 'set-a', null)).toEqual({});
  });
});
