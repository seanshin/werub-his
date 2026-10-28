/**
 * 사람 확인 문서(2026-10-12 기획 `decision-print-remaining` P3).
 *  · 개시 전 필수 의사결정 순서 — 선행이 먼저 · 같은 차례는 층 순 · 필수 밖 선행은 따로 · 🔴 순환은 지어 끊지 않고 차례 없음
 *  · 인쇄는 고른 문서 하나만 · 점검 양식이라 QR 없음(발급 대상 아님) · 🔴 리드타임 칸은 비어 있다(지어내지 않는다)
 *  · 결정권한자 표 원내 채택 기록 — 🔴 근거 칸은 비어서 시작 · 근거 없으면 저장 불가 · 관리자만
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render as rtl, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuthStore } from '@/stores/auth-store';
import { goLiveDecisionOrder } from '@/app/(main)/admin/decisions/checks/model';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(async () => ({ data: {} })), getToken: () => 'x' }));
vi.mock('@/lib/api-client', async (orig) => ({ ...(await orig<object>()), apiClient: api }));
const render = (ui: React.ReactElement) => rtl(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
beforeEach(() => { cleanup(); document.body.querySelectorAll('.doc-print-root').forEach((e) => e.remove()); api.post.mockClear(); useAuthStore.setState({ user: { id: 'u', role: 'ADMIN' } as never, isAuthenticated: true }); });

const d = (key: string, layer: string, dependsOn: string[] = [], goLive = 'REQUIRED_BEFORE') =>
  ({ key, title: `결정 ${key}`, layer, track: 'GOVERNANCE', domain: 'FOUNDATION', goLive, dependsOn, decided: false, seeded: false, record: null, blockedBy: [], options: [], mechanism: 'DEV_APPLY' }) as never;

describe('개시 전 필수 의사결정 순서', () => {
  it('선행이 먼저 · 같은 차례는 허가권자 → 위원회 → 직원 · 필수 밖 선행은 따로', () => {
    const r = goLiveDecisionOrder([d('c.staff', 'STAFF'), d('b.comm', 'INTERNAL_COMMITTEE', ['a.lic']), d('a.lic', 'LICENSE_HOLDER', ['x.outside']), d('z.lic2', 'LICENSE_HOLDER'), d('x.outside', 'STAFF', [], 'CAN_FOLLOW')]);
    expect(r.map((o) => [o.item.key, o.step])).toEqual([['a.lic', 1], ['z.lic2', 1], ['c.staff', 1], ['b.comm', 2]]);
    expect(r.find((o) => o.item.key === 'a.lic')!.outsideDeps).toEqual(['x.outside']);
    expect(r.find((o) => o.item.key === 'b.comm')!.deps).toEqual(['a.lic']);
  });
  it('🔴 순환은 차례 없음(null) — 지어 끊지 않는다 · 대조군: 순환 없는 항목은 차례가 있다', () => {
    const r = goLiveDecisionOrder([d('p', 'STAFF', ['q']), d('q', 'STAFF', ['p']), d('ok', 'STAFF')]);
    expect(r.find((o) => o.item.key === 'p')!.step).toBeNull();
    expect(r.find((o) => o.item.key === 'q')!.step).toBeNull();
    expect(r.find((o) => o.item.key === 'ok')!.step).toBe(1);
  });
});

describe('사람 확인 문서 화면', () => {
  it('🔴 고른 문서 하나만 인쇄 문서로 · QR 없음(발급 대상 아님) · 리드타임 칸은 비어 있다', async () => {
    api.get.mockResolvedValue({ data: { items: [d('a.lic', 'LICENSE_HOLDER'), d('b.comm', 'INTERNAL_COMMITTEE', ['a.lic'])], summary: {}, measuredAt: 'x', caveat: '' } });
    const { default: Page } = await import('@/app/(main)/admin/decisions/checks/page');
    const v = render(<Page />);
    await waitFor(() => expect(document.querySelector('[data-print-doc="CHECKS-ORDER"]')).toBeTruthy());
    expect(document.querySelectorAll('.doc-print-root [data-print-doc]')).toHaveLength(1);
    expect(document.querySelector('style[data-print-page-qr]')!.getAttribute('data-print-page-qr')).toBe('none');
    for (const c of document.querySelectorAll('[data-print-leadtime]')) expect(c.textContent).toBe('');
    fireEvent.click(v.container.querySelector('[data-checks-tab="PRINT"]')!);
    await waitFor(() => expect(document.querySelector('[data-print-doc="CHECKS-PRINT"]')).toBeTruthy());
    expect(document.querySelector('[data-print-doc="CHECKS-ORDER"]')).toBeNull();
    expect(document.querySelectorAll('[data-print-checklist] [data-print-row]').length).toBeGreaterThanOrEqual(11);
  });
});

describe('결정권한자 표 원내 채택 기록', () => {
  const A = { chair: '진료부원장', secretary: '팀장', verifier: '팀', votingRule: '과반', exOfficio: ['원무팀장'] };
  it('🔴 근거 칸은 비어서 시작 · 근거 없으면 저장 불가 · 보낸 값 그대로', async () => {
    const { CommitteeAuthorityAdopt } = await import('@/app/(main)/admin/decisions/committee-authority-adopt');
    const v = render(<CommitteeAuthorityAdopt code="MRC" a={A} />);
    fireEvent.click(v.container.querySelector('[data-committee-adopt-open]')!);
    const basis = v.container.querySelector('[data-committee-adopt-field="basisRef"]') as HTMLInputElement;
    expect(basis.value).toBe('');
    const save = v.container.querySelector('[data-committee-adopt-save]') as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(basis, { target: { value: '의무기록위원회 규정 제3조' } });
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/api/v1/admin/decisions/committee-authority/MRC', { ...A, basisRef: '의무기록위원회 규정 제3조' }));
  });
  it('대조군 — 관리자 아니면 그리지 않는다', async () => {
    useAuthStore.setState({ user: { id: 'u', role: 'EXECUTIVE' } as never, isAuthenticated: true });
    const { CommitteeAuthorityAdopt } = await import('@/app/(main)/admin/decisions/committee-authority-adopt');
    expect(render(<CommitteeAuthorityAdopt code="MRC" a={A} />).container.textContent).toBe('');
  });
});
