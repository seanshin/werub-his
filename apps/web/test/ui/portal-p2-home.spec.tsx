/**
 * 환자 포털 세련화 P2 — 홈 "오늘 할 일"(2026-10-19 · 기획 §4 A4).
 *  · 🔴 동의서 기록이 없으면 미완료를 **6건으로 지어냈다**(P15) → 건수를 모르면 "확인 필요"
 *  · 🔴 미수납 = `status !== 'PAID'` — 취소·환불 청구까지 셌고 금액은 감면을 빼지 않았다 → 남은 금액 정본(outstanding)
 *  · 대조군: 기록이 있으면 실제 미완료 건수 · 아직 오지 않았으면 말하지 않는다
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const api = vi.hoisted(() => ({ get: vi.fn(async (_url: string): Promise<unknown> => ({ data: [] })), post: vi.fn(), put: vi.fn(), getToken: () => 't', setToken: vi.fn() }));
vi.mock('@/lib/api-client', async (orig) => ({ ...(await orig<object>()), apiClient: api }));

const bill = (status: string, outstanding: number | null) => ({ id: status, billedAt: '2026-10-01', total: 10000, insuranceCovered: 5000, copay: 5000, paidAmount: 0, status, discount: 2000, outstanding, refundAmount: null });
const DATA = (billings: unknown[]) => ({ appointments: [], encounters: [], labResults: [], diagnosticTests: [], billings, allergies: [], medications: [], questionnaires: [] });

async function mount(consents: unknown, billings: unknown[] = [], waiting: unknown[] = []) {
  localStorage.setItem('portal-onboarding-done', 'true');
  api.get.mockImplementation(async (url: string) => {
    if (url === '/api/v1/portal/registration-consents') return { data: consents };
    if (url === '/api/v1/portal/er-status') return { data: null }; // 계약: 응급 재실 없으면 null
    if (url === '/api/v1/portal/waiting-status') return { data: waiting };
    return { data: url.includes('session') ? { kind: 'MRN', features: {}, expiresAt: null, services: { inpatientLife: false } } : [] };
  });
  const { default: HomeTab } = await import('@/app/portal/_home/HomeTab');
  let v!: ReturnType<typeof render>;
  await act(async () => {
    v = render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><HomeTab patient={{ id: 'p1', mrn: 'M' } as never} data={DATA(billings) as never} onNavigate={() => {}} /></QueryClientProvider>);
  });
  return v;
}
beforeEach(() => { cleanup(); api.get.mockReset(); });

describe('🔴 동의서 — 지어낸 6건 없음', () => {
  it('기록 없음 → "필수 동의서 확인 필요"(건수 없음) · 6 이라는 숫자 없음', async () => {
    const v = await mount({ requiredComplete: false, consents: [] });
    await waitFor(() => expect(v.container.querySelector('[data-portal-consent-banner]')).not.toBeNull());
    expect(v.container.querySelector('[data-portal-consent-banner]')!.textContent).toContain('확인 필요');
    expect(v.container.textContent).not.toMatch(/6\s*건/);
  });
  it('대조군 — 기록이 있으면 실제 미완료 건수 · 다 했으면 배너 없음', async () => {
    const v = await mount({ requiredComplete: false, consents: [{ type: 'A', required: true, agreed: false }, { type: 'B', required: true, agreed: true }, { type: 'C', required: true, agreed: false }] });
    await waitFor(() => expect(v.container.querySelector('[data-portal-consent-banner]')?.textContent).toMatch(/2\s*건/));
    cleanup();
    const done = await mount({ requiredComplete: true, consents: [{ type: 'A', required: true, agreed: true }] });
    await new Promise((r) => setTimeout(r, 50));
    expect(done.container.querySelector('[data-portal-consent-banner]')).toBeNull();
  });
});

describe('🔴 미수납 — 남은 금액 정본', () => {
  it('취소·환불·남은 금액 0 청구는 세지 않는다 · 합계 = outstanding 합(감면 차감)', async () => {
    const v = await mount({ requiredComplete: true, consents: [{ type: 'A', required: true, agreed: true }] },
      [bill('PENDING', 3000), bill('CANCELLED', 5000), bill('REFUNDED', 5000), bill('PAID', 0), bill('PARTIAL', 1000)]);
    await waitFor(() => expect(v.container.textContent).toContain('미수납 안내'));
    const t = v.container.textContent!;
    expect(t).toMatch(/2\s*건/);
    expect(t).toContain('4,000');
    expect(t).not.toContain('14,000');
  });
});

describe('B1 — 대기 현황에서 진료실 가는 길(대기표 길안내)', () => {
  it('진료실이 정해진 대기만 길안내 링크 · 링크 = 공개 길안내 화면', async () => {
    const v = await mount({ requiredComplete: true, consents: [{ type: 'A', required: true, agreed: true }] }, [], [
      { id: 'q1', queueNumber: 3, departmentName: '내과', status: 'WAITING', aheadCount: 2, estimatedMinutes: null, roomName: '내과 2진료실' },
      { id: 'q2', queueNumber: 7, departmentName: '안과', status: 'WAITING', aheadCount: 0, estimatedMinutes: null, roomName: null },
    ]);
    await waitFor(() => expect(v.container.textContent).toContain('실시간 대기 현황'));
    const links = [...v.container.querySelectorAll('a[data-portal-guide-link]')].map((a) => a.getAttribute('href'));
    expect(links).toEqual(['/guide/q1']);
  });
});
