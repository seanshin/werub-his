/**
 * 활력 표시 표준 화면(3415 · 2026-10-07).
 *  · 표준표는 shared 정본 그대로(행 수·순서·LOINC) · 원장 적합성은 서버 수 그대로 · 잘림 고지
 *  · 기간 안 기록 0 = "산출 불가"(0건 정상 아님) · 조회 실패는 실패로
 * 재주입: 위 규칙 하나를 되돌리면 실패한다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { VITAL_SIGN_DEFS } from '@hospital-run/shared';

const get = vi.fn();
vi.mock('@/lib/api-client', async (orig) => ({ ...(await orig<object>()), apiClient: { get: (...a: unknown[]) => get(...a), getToken: () => 'x' } }));
const wrap = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>;
beforeEach(() => { cleanup(); get.mockReset(); });

const report = {
  days: 30, since: '2026-09-07T00:00:00Z', schemaAliases: [{ model: 'EarlyWarningScore', field: 'spO2', canonical: 'spo2' }],
  ledgers: [
    { source: 'PRE_VISIT', total: 9000, scanned: 5000, truncated: true, recordsWithErrors: 3, byCode: { IMPLAUSIBLE: 3 }, samples: [{ id: 'aaaaaaaa-1', at: '2026-10-01T00:00:00Z', code: 'IMPLAUSIBLE', key: 'temperature', value: 365 }] },
    { source: 'FLOWSHEET', total: 0, scanned: 0, truncated: false, recordsWithErrors: 0, byCode: {}, samples: [] },
    { source: 'ICU', total: 4, scanned: 4, truncated: false, recordsWithErrors: 0, byCode: {}, samples: [] },
    { source: 'EWS', total: 2, scanned: 2, truncated: false, recordsWithErrors: 0, byCode: {}, samples: [] },
  ],
};

describe('활력 표시 표준 화면', () => {
  it('🔴 표준표 = shared 정본 · 원장 수·잘림·산출 불가', async () => {
    get.mockImplementation((url: string) => url.includes('conformance') ? Promise.resolve({ data: report }) : new Promise(() => {}));
    const { default: Page } = await import('@/app/(main)/admin/vitals-standard/page');
    const { container } = render(<Page />, { wrapper: wrap });
    const rows = [...container.querySelectorAll('[data-vital-def]')].map((r) => r.getAttribute('data-vital-def'));
    expect(rows).toEqual(VITAL_SIGN_DEFS.map((d) => d.key));
    await waitFor(() => expect(container.querySelector('[data-ledger="PRE_VISIT"]')).toBeTruthy());
    const pv = container.querySelector('[data-ledger="PRE_VISIT"]')!;
    expect(pv.textContent).toContain('잘림');
    expect(pv.querySelector('[data-records-with-errors]')!.getAttribute('data-records-with-errors')).toBe('3');
    const fs = container.querySelector('[data-ledger="FLOWSHEET"]')!;
    expect(fs.textContent).toContain('셀 표본이 없습니다');
    expect(fs.querySelector('[data-records-with-errors]')).toBeNull();
    expect(container.textContent).toContain('EarlyWarningScore.spO2 → spo2');
  });
  it('조회 실패는 실패로', async () => {
    get.mockImplementation((url: string) => url.includes('conformance') ? Promise.reject(new Error('boom')) : new Promise(() => {}));
    const { default: Page } = await import('@/app/(main)/admin/vitals-standard/page');
    const { container } = render(<Page />, { wrapper: wrap });
    await waitFor(() => expect(container.querySelector('[data-vitals-conformance-report]')).toBeNull());
    await waitFor(() => expect(container.textContent).toMatch(/다시|오류|실패|boom/));
  });
});
