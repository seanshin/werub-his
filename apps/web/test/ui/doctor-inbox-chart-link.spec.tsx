/**
 * 의사 할 일함 ↔ 의료차트 연계(2026-10-07 검토).
 *  · 🔴 할 일함의 "차트에서 승인"이 가는 차트 사전처방 탭에 승인이 없었다(막다른 길) → 진행 중 진료(order-encounter)에 승인 · 없으면 이유 · 의사·관리자만
 *  · 목록 → 차트는 그 항목의 탭으로(결과→검사결과/영상 · 구두 약→투약/그 밖→오더 · 갱신→투약 · 약사 중재→투약) · 탭 키는 차트 정본에 있는 것
 *  · 차트 → 할 일함: 헤더 "이 환자의 내 할 일"(의사·관리자) → 환자별 보기가 그 환자만
 * 재주입: 위 규칙 하나를 되돌리면 실패한다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuthStore } from '@/stores/auth-store';

const get = vi.fn();
const patch = vi.fn();
vi.mock('@/lib/api-client', async (orig) => ({ ...(await orig<object>()), apiClient: { get: (...a: unknown[]) => get(...a), patch: (...a: unknown[]) => patch(...a), post: vi.fn(), getToken: () => 'x' } }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), usePathname: () => '/patients/p1', useSearchParams: () => new URLSearchParams() }));
const wrap = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>;

const pending = { id: 'po1', type: 'LAB', status: 'PENDING', createdAt: '2026-10-06T00:00:00Z', procedureCode: { nameKo: 'CBC' } };
function route(encounter: unknown) {
  get.mockImplementation((url: string) => {
    if (url.endsWith('/pre-orders')) return Promise.resolve({ data: { data: [pending] } });
    if (url.includes('/order-encounter')) return Promise.resolve({ data: encounter });
    return Promise.resolve({ data: [] });
  });
}
async function tab(role: string) {
  useAuthStore.setState({ user: { id: 'u1', role } as never, isAuthenticated: true });
  const { PreOrderTab } = await import('@/app/(main)/patients/[id]/components/PreOrderTab');
  return render(<PreOrderTab patientId="p1" />, { wrapper: wrap });
}
beforeEach(() => { cleanup(); get.mockReset(); patch.mockReset(); });

describe('차트 사전처방 탭 — 승인', () => {
  it('🔴 진행 중 진료가 있으면 그 진료에 승인(어디에 붙는지 말한다)', async () => {
    route({ encounterId: 'e9', context: 'ADMISSION', doctorName: '박내과' });
    patch.mockResolvedValue({ data: { data: { durCheck: { status: 'PASSED' } } } });
    const { container } = await tab('DOCTOR');
    await waitFor(() => expect(container.querySelector('[data-preorder-approve-target="ADMISSION"]')).toBeTruthy());
    const btn = container.querySelector('[data-preorder-approve="po1"]') as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    fireEvent.click(btn);
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/api/v1/pre-orders/po1/approve', { encounterId: 'e9' }));
  });
  it('🔴 진행 중 진료가 없으면 승인 버튼은 막히고 이유를 말한다', async () => {
    route({ encounterId: null, context: null, doctorName: null });
    const { container } = await tab('DOCTOR');
    await waitFor(() => expect(container.querySelector('[data-preorder-approve-target="NONE"]')).toBeTruthy());
    expect((container.querySelector('[data-preorder-approve="po1"]') as HTMLButtonElement).disabled).toBe(true);
  });
  it('간호사에게는 승인 버튼이 없고 진행 중 진료도 부르지 않는다', async () => {
    route({ encounterId: 'e9', context: 'TODAY', doctorName: null });
    const { container } = await tab('NURSE');
    await waitFor(() => expect(container.textContent).toContain('CBC'));
    expect(container.querySelector('[data-preorder-approve]')).toBeNull();
    expect(get.mock.calls.some((c) => String(c[0]).includes('order-encounter'))).toBe(false);
  });
});

describe('목록 → 차트 탭 · 차트 → 할 일함', () => {
  const read = (p: string) => readFileSync(resolve(__dirname, '../../src', p), 'utf8');
  const chart = read('app/(main)/patients/[id]/page.tsx');
  const tabKeys = new Set([...chart.matchAll(/key: '([a-z-]+)', label:/g)].map((m) => m[1]));
  it('🔴 각 목록의 차트 링크는 그 항목의 탭으로 — 탭 키는 차트 정본에 있다', () => {
    const cases: [string, RegExp, string[]][] = [
      ['app/(main)/results-inbox/page.tsx', /\?tab=\$\{it\.department === 'IMAGING' \? 'imaging' : 'labresults'\}/, ['imaging', 'labresults']],
      ['app/(main)/verbal-orders/page.tsx', /\?tab=\$\{it\.type === 'MEDICATION' \? 'medications' : 'orders'\}/, ['medications', 'orders']],
      ['app/(main)/renewals/page.tsx', /\?tab=medications/, ['medications']],
      ['app/(main)/pharmacist-replies/page.tsx', /\$\{i\.patientId\}\?tab=medications/, ['medications']],
      ['app/(main)/doctor-inbox/PreOrderPendingPanel.tsx', /\?tab=pre-orders/, ['pre-orders']],
    ];
    for (const [f, re, keys] of cases) {
      expect(read(f), f).toMatch(re);
      for (const k of keys) expect(tabKeys.has(k), `${f} → ${k}`).toBe(true);
    }
  });
  it('🔴 차트 헤더에 "이 환자의 내 할 일"(의사·관리자) → 환자별 보기 그 환자', () => {
    expect(chart).toMatch(/\(user\?\.role === 'DOCTOR' \|\| user\?\.role === 'ADMIN'\) && \(\s*<Link href=\{`\/doctor-inbox\?view=patients&patient=\$\{id\}`\}/);
  });
});
