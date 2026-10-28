import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const get = vi.fn();
vi.mock('@/lib/api-client', () => ({ apiClient: { get: (...a: unknown[]) => get(...a), patch: vi.fn() } }));

import { useAuthStore } from '@/stores/auth-store';
import { CriticalValueAlertBanner } from '../../src/components/CriticalValueAlertBanner';

/**
 * 위급값 배너 — 허용시간(상향 보고 기준)·상향 표시 (agent-emr-alignment 2-1).
 *
 * 🔴 지키는 것:
 *   ① 허용시간 미설정이면 "상향 보고를 하지 않는다"고 말한다 — 화면이 30분 같은 기준을 지어내지 않는다.
 *   ② 기준 조회 실패는 "미설정"이 아니라 "기준을 모른다"로 말한다.
 *   ③ 크론이 상향 표시한(ESCALATED) 경보는 배지로 구분된다.
 *   ④ 대조군 — 설정돼 있으면 그 값을 표시 정본(durationText)으로 말한다.
 */
const wrap = (ui: React.ReactElement) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
};
const ALERT = { id: 'a1', testName: 'K', value: '7.2', unit: 'mEq/L', reason: 'HH', notifiedAt: new Date().toISOString(), isMine: true, patient: { familyName: '홍', givenName: '길동', mrn: 'M1' } };

function route(policy: unknown, alerts: unknown[] = [ALERT]) {
  get.mockImplementation((url: string) => {
    if (url.endsWith('/pending')) return Promise.resolve({ data: alerts });
    if (url.endsWith('/escalation-policy')) return policy instanceof Error ? Promise.reject(policy) : Promise.resolve({ data: policy });
    return Promise.reject(new Error(`unexpected ${url}`));
  });
}

describe('위급값 배너 — 허용시간·상향 표시', () => {
  beforeEach(() => {
    get.mockReset();
    useAuthStore.setState({ user: { id: 'u1', role: 'DOCTOR', email: 'x@y', name: 'x' } as never });
  });

  it('🔴 ① 허용시간 미설정 — 상향 보고를 하지 않는다고 말하고 분 값을 지어내지 않는다', async () => {
    route({ afterMinutes: null, invalid: false });
    const { container } = wrap(<CriticalValueAlertBanner />);
    await screen.findByText(/설정되지 않아 상향 보고를 하지 않습니다/);
    expect(container.textContent ?? '').not.toMatch(/허용시간 \d/);
  });

  it('🔴 ② 기준 조회 실패는 미설정이라 말하지 않는다', async () => {
    route(new Error('boom'));
    const { container } = wrap(<CriticalValueAlertBanner />);
    await screen.findByText(/불러오지 못했습니다 — 기준을 모르는 상태/);
    expect(container.textContent ?? '').not.toMatch(/설정되지 않아/);
  });

  it('③ ESCALATED 경보는 상향 표시 배지로 구분된다 · ④ 대조군 — 설정값을 표시 정본으로 말한다', async () => {
    route({ afterMinutes: 45, invalid: false }, [{ ...ALERT, status: 'ESCALATED', escalatedAt: new Date().toISOString() }]);
    const { container } = wrap(<CriticalValueAlertBanner />);
    await screen.findByText(/허용시간 초과 · 상향 표시/);
    await screen.findByText(/허용시간 45/);
    expect(container.textContent ?? '').not.toMatch(/설정되지 않아/);
  });
});
