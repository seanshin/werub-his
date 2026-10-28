/**
 * 포털 첫 안내 — 계정 단위(2026-10-20).
 *  · 🔴 종전: 기기 localStorage 만 봤다 — 계정이 이미 봤어도 새 기기에서 다시 떴다
 *  · 계정 기록이 있으면 안 띄운다 · 없으면 띄우고 닫을 때 계정에 남긴다 · 등록번호 세션(DEVICE)은 서버를 부르지 않는다
 *  · 능력표가 오는 중이면 띄우지 않는다 · 능력표 실패면 기기 기준
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup, act, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { shouldShowOnboarding } from '@/app/portal/_home/onboarding-state';

const api = vi.hoisted(() => ({ get: vi.fn(async (_url: string): Promise<unknown> => ({ data: [] })), post: vi.fn(async () => ({ data: {} })), put: vi.fn(), getToken: () => 't', setToken: vi.fn() }));
vi.mock('@/lib/api-client', async (orig) => ({ ...(await orig<object>()), apiClient: api }));

describe('판정표', () => {
  const acc = (completedAt: string | null) => ({ scope: 'ACCOUNT' as const, completedAt });
  it.each([
    [{ pending: true, error: false, onboarding: undefined, deviceDone: false }, false],
    [{ pending: false, error: false, onboarding: acc('2026-10-01T00:00:00Z'), deviceDone: false }, false],
    [{ pending: false, error: false, onboarding: acc(null), deviceDone: false }, true],
    [{ pending: false, error: false, onboarding: acc(null), deviceDone: true }, false],
    [{ pending: false, error: false, onboarding: { scope: 'DEVICE' as const, completedAt: null }, deviceDone: false }, true],
    [{ pending: false, error: false, onboarding: { scope: 'DEVICE' as const, completedAt: null }, deviceDone: true }, false],
    [{ pending: false, error: true, onboarding: undefined, deviceDone: false }, true],
  ])('%j → %s', (s, want) => expect(shouldShowOnboarding(s)).toBe(want));
});

async function home(onboarding: unknown) {
  api.get.mockImplementation(async (url: string) => {
    if (url === '/api/v1/portal/session') return { data: { kind: onboarding && (onboarding as any).scope === 'DEVICE' ? 'MRN' : 'ACCOUNT', features: {}, expiresAt: null, services: { inpatientLife: false }, onboarding } };
    if (url === '/api/v1/portal/er-status') return { data: null };
    return { data: [] };
  });
  const { default: HomeTab } = await import('@/app/portal/_home/HomeTab');
  const data = { appointments: [], encounters: [], labResults: [], diagnosticTests: [], billings: [], allergies: [], medications: [], questionnaires: [] };
  let v!: ReturnType<typeof render>;
  await act(async () => {
    v = render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><HomeTab patient={{ id: 'p1', mrn: 'M' } as never} data={data as never} onNavigate={() => {}} /></QueryClientProvider>);
  });
  return v;
}
beforeEach(() => { cleanup(); localStorage.clear(); api.get.mockReset(); api.post.mockClear(); });

describe('🔴 홈 — 계정 기록을 본다', () => {
  it('계정이 이미 봤으면(다른 기기) 이 기기에서도 띄우지 않는다', async () => {
    const v = await home({ scope: 'ACCOUNT', completedAt: '2026-10-01T00:00:00Z' });
    await new Promise((r) => setTimeout(r, 50));
    expect(v.container.textContent).not.toContain('환영합니다');
  });
  it('계정이 아직이면 띄우고, 건너뛰면 계정에 남긴다', async () => {
    const v = await home({ scope: 'ACCOUNT', completedAt: null });
    await waitFor(() => expect(v.container.textContent).toContain('환영합니다'));
    fireEvent.click([...v.container.querySelectorAll('button')].find((b) => b.textContent?.includes('건너뛰기'))!);
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/api/v1/portal/onboarding/complete', {}));
    expect(localStorage.getItem('portal-onboarding-done')).toBe('true');
    expect(v.container.textContent).not.toContain('환영합니다');
  });
  it('대조군 — 등록번호 세션(DEVICE)은 띄우되 서버를 부르지 않는다', async () => {
    const v = await home({ scope: 'DEVICE', completedAt: null });
    await waitFor(() => expect(v.container.textContent).toContain('환영합니다'));
    fireEvent.click([...v.container.querySelectorAll('button')].find((b) => b.textContent?.includes('건너뛰기'))!);
    await new Promise((r) => setTimeout(r, 20));
    expect(api.post).not.toHaveBeenCalled();
    expect(localStorage.getItem('portal-onboarding-done')).toBe('true');
  });
});
