/**
 * 사람이 화면에서 처리할 일(2026-10-10).
 *  · 방사선 '조사 중' 고착 정리 — 결과 미선택 시작 · 조사됨이면 선량·시각 없이는 못 보냄(지금 시각으로 채우지 않는다) · 사유 필수
 *  · /admin/him — 작성자가 의사가 아닌 미서명 진료: 알림 대상 없음 고지·거르기·처방의 이름·빈 초안 표식 · 서명 대행 없음
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const get = vi.fn();
const patch = vi.fn();
vi.mock('@/lib/api-client', async (orig) => ({ ...(await orig<object>()), apiClient: { get: (...a: unknown[]) => get(...a), post: vi.fn(), patch: (...a: unknown[]) => patch(...a), getToken: () => 'x' } }));
const wrap = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>;
beforeEach(() => { cleanup(); get.mockReset(); patch.mockReset(); });

describe('방사선 조사 중 정리', () => {
  async function open() {
    const { StuckFractionResolver } = await import('@/app/(main)/radiation/radiation-dose');
    const v = render(<StuckFractionResolver fractionId="f9" planId="p1" />, { wrapper: wrap });
    fireEvent.click(v.container.querySelector('[data-fraction-stuck-open]')!);
    const q = (s: string) => v.container.querySelector(s) as HTMLInputElement;
    return { v, q };
  }

  it('결과 미선택으로 시작 · 사유만으로는 못 보낸다', async () => {
    const { q } = await open();
    expect(q('[data-fraction-stuck-outcome]').value).toBe('');
    fireEvent.change(q('[data-fraction-stuck-reason]'), { target: { value: '확인' } });
    expect((q('[data-fraction-stuck-submit="f9"]') as unknown as HTMLButtonElement).disabled).toBe(true);
  });

  it('🔴 조사됨 — 선량·시각을 넣어야 보낸다 · 넣은 그대로 보낸다', async () => {
    patch.mockResolvedValue({ data: {}, meta: { warnings: [] } });
    const { q } = await open();
    fireEvent.change(q('[data-fraction-stuck-outcome]'), { target: { value: 'DELIVERED' } });
    fireEvent.change(q('[data-fraction-stuck-reason]'), { target: { value: '치료기 로그' } });
    const submit = () => q('[data-fraction-stuck-submit="f9"]') as unknown as HTMLButtonElement;
    expect(submit().disabled).toBe(true);
    fireEvent.change(q('[data-fraction-stuck-dose]'), { target: { value: '2' } });
    expect(submit().disabled).toBe(true); // 시각 없음
    fireEvent.change(q('[data-fraction-stuck-at]'), { target: { value: '2026-05-27T10:00' } });
    expect(submit().disabled).toBe(false);
    fireEvent.click(submit());
    await waitFor(() => expect(patch).toHaveBeenCalled());
    const [url, body] = patch.mock.calls[0] as [string, Record<string, unknown>];
    expect(url).toBe('/api/v1/radiation/fractions/f9/resolve-stuck');
    expect(body).toMatchObject({ outcome: 'DELIVERED', reason: '치료기 로그', deliveredDose: 2, deliveredAt: new Date('2026-05-27T10:00').toISOString() });
  });

  it('조사 안 됨 — 선량·시각을 보내지 않는다', async () => {
    patch.mockResolvedValue({ data: {} });
    const { q } = await open();
    fireEvent.change(q('[data-fraction-stuck-outcome]'), { target: { value: 'NOT_DELIVERED' } });
    fireEvent.change(q('[data-fraction-stuck-reason]'), { target: { value: '기록 없음' } });
    fireEvent.click(q('[data-fraction-stuck-submit="f9"]'));
    await waitFor(() => expect(patch).toHaveBeenCalled());
    expect(patch.mock.calls[0][1]).toEqual({ outcome: 'NOT_DELIVERED', reason: '기록 없음' });
  });
});

describe('/admin/him 작성자 의사 아님', () => {
  const item = (o: Record<string, unknown>) => ({ type: 'UNSIGNED_ENCOUNTER', patient: { mrn: 'P', name: '김환자' }, responsibleName: '관리', since: '2026-10-01T00:00:00Z', overdueDays: 2, detail: '진료기록 미서명(DRAFT)', ...o });
  const report = { items: [
    item({ refId: 'e1', responsibleId: null, authorIsDoctor: false, prescribers: [{ id: 'd9', name: '오처방' }], empty: false }),
    item({ refId: 'e2', responsibleId: null, authorIsDoctor: false, prescribers: [], empty: true }),
    item({ refId: 'e3', responsibleId: 'd1', authorIsDoctor: true, prescribers: [], empty: false, responsibleName: '이의사' }),
  ], counts: { total: 3, overdue: 3, byType: { UNSIGNED_ENCOUNTER: 3 } }, policy: { summaryDueDays: 7, encounterDueDays: 3, noteDueDays: 1, lookbackDays: 90 } };

  it('🔴 알림 대상 없음 고지 · 처방의 · 빈 초안 · 거르기', async () => {
    get.mockResolvedValue({ data: report });
    const { default: Page } = await import('@/app/(main)/admin/him/page');
    const v = render(<Page />, { wrapper: wrap });
    await waitFor(() => expect(v.container.querySelector('[data-him-orphan-drafts="2"]')).toBeTruthy());
    expect(v.container.querySelector('[data-him-author-not-doctor="e1"]')).toBeTruthy();
    expect(v.container.querySelector('[data-him-author-not-doctor="e3"]')).toBeNull();
    expect(v.container.querySelector('[data-him-prescribers="e1"]')?.textContent).toContain('오처방');
    expect(v.container.querySelector('[data-him-empty-draft="e2"]')).toBeTruthy();
    expect(v.container.querySelectorAll('tbody tr').length).toBe(3);
    fireEvent.click(v.container.querySelector('[data-him-filter-no-doctor]')!);
    expect(v.container.querySelectorAll('tbody tr').length).toBe(2);
    // 서명을 대신하는 버튼은 없다
    expect(v.container.textContent).not.toMatch(/대신 서명|서명 대행/);
  });
});
