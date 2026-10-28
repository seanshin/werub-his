/**
 * 화면 2419 사람 몫 할 일(2026-10-26).
 *  · 🔴 체크박스가 없다 — 상태는 서버가 정본에서 파생(화면이 "했다"를 적지 않는다)
 *  · 🔴 개발 시드는 선택지를 보이되 "결정 아님" · 확인 불가는 그대로 · 서버 응답에 없는 항목은 확인 불가(끝남 아님)
 *  · 자동 판정 없는 일은 그렇다고 · 사람이 할 마지막 단계 · 하러 가는 링크 · 이름 잘림 · 상태별 수
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HUMAN_ACTION_IDS } from '@hospital-run/shared';

const api = vi.hoisted(() => ({ get: vi.fn(), getToken: () => 't' }));
vi.mock('@/lib/api-client', async (orig) => ({ ...(await orig<object>()), apiClient: api }));
vi.mock('next/link', () => ({ default: ({ href, children, ...p }: { href: string; children: React.ReactNode }) => <a href={href} {...p}>{children}</a> }));
beforeEach(() => { cleanup(); api.get.mockReset(); });

const ITEMS = [
  { id: 'H1', state: 'PENDING', checks: [{ code: 'DECISION_REAL', state: 'UNMET', target: 'ops.rehearsalOutboxAtCutover', decision: 'SEED', choice: 'DISCARD_WITH_RECORD' }, { code: 'OUTBOX_PENDING', state: 'INFO', count: 0 }] },
  { id: 'H2', state: 'UNKNOWN', checks: [{ code: 'DECISION_REAL', state: 'UNKNOWN', target: 'billing.institutionType' }] },
  { id: 'H3', state: 'DONE', checks: [{ code: 'STAY_PRICE_CONFIGURED', state: 'MET', target: 'inpatient.bedRateCodes · inpatient.bedRates' }] },
  { id: 'H5', state: 'PARTIAL', checks: [{ code: 'ORDER_SETS_UNAPPROVED', state: 'UNMET', count: 26 }, { code: 'TEMPLATES_UNAPPROVED', state: 'MET', count: 0 }] },
  { id: 'H7', state: 'PENDING', checks: [{ code: 'CLINIC_ROOMS_LINKED', state: 'UNMET', count: 33, names: ['내과 3진료실', '안과 1진료실'], truncated: true }] },
  { id: 'H8', state: 'MANUAL', checks: [] },
];

async function mount(opts: { items?: unknown[]; reject?: boolean } = {}) {
  api.get.mockImplementation(async () => { if (opts.reject) throw new Error('500'); return { data: { items: opts.items ?? ITEMS, generatedAt: '2026-10-26T03:00:00Z' } }; });
  const { default: Page } = await import('@/app/(main)/admin/human-actions/page');
  let v!: ReturnType<typeof render>;
  await act(async () => { v = render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><Page /></QueryClientProvider>); });
  await waitFor(() => expect(api.get).toHaveBeenCalledWith('/api/v1/admin/human-actions'));
  return v;
}
const card = (v: ReturnType<typeof render>, id: string) => v.container.querySelector(`[data-human-action="${id}"]`)!;

describe('🔴 사람 몫 할 일', () => {
  it('H1~H11 순서 · 서버 상태 그대로 · 응답에 없는 항목은 확인 불가 · 체크박스·입력 없음', async () => {
    const v = await mount();
    await waitFor(() => expect(v.container.querySelectorAll('[data-human-action]').length).toBe(HUMAN_ACTION_IDS.length));
    expect([...v.container.querySelectorAll('[data-human-action]')].map((e) => e.getAttribute('data-human-action'))).toEqual([...HUMAN_ACTION_IDS]);
    expect(card(v, 'H3').getAttribute('data-human-state')).toBe('DONE');
    expect(card(v, 'H4').getAttribute('data-human-state')).toBe('MISSING');
    expect(card(v, 'H4').textContent).toContain('확인 불가');
    expect(v.container.querySelectorAll('input, textarea, select').length).toBe(0);
  });
  it('🔴 개발 시드는 "결정 아님"(선택지는 보인다) · 확인 불가 확인 항목은 그렇게 말한다', async () => {
    const v = await mount();
    await waitFor(() => expect(card(v, 'H1')).not.toBeNull());
    expect(card(v, 'H1').querySelector('[data-human-seed]')!.textContent).toContain('DISCARD_WITH_RECORD');
    expect(card(v, 'H1').querySelector('[data-human-seed]')!.textContent).toContain('결정 아님');
    expect(card(v, 'H2').querySelector('[data-human-check-state="UNKNOWN"]')!.textContent).toContain('확인할 수 없습니다');
  });
  it('수·이름·잘림 · 자동 판정 없음 · 사람이 할 마지막 단계 · 하러 가는 링크', async () => {
    const v = await mount();
    await waitFor(() => expect(card(v, 'H5')).not.toBeNull());
    expect(card(v, 'H5').querySelector('[data-human-count="26"]')).not.toBeNull();
    expect(card(v, 'H7').querySelector('[data-human-names]')!.textContent).toContain('잘림');
    expect(card(v, 'H8').querySelector('[data-human-manual]')).not.toBeNull();
    expect(card(v, 'H1').querySelector('[data-human-manual-tail]')!.textContent).toContain('ERP');
    expect(card(v, 'H2').querySelector('a[href="/admin/billing-calc"]')).not.toBeNull();
  });
  it('상태별 수 — 응답에 있는 항목만 센다', async () => {
    const v = await mount();
    await waitFor(() => expect(v.container.querySelector('[data-human-summary]')).not.toBeNull());
    const n = (s: string) => v.container.querySelector(`[data-human-summary-state="${s}"]`)!.textContent!.replace(/\D/g, '');
    expect([n('PENDING'), n('PARTIAL'), n('UNKNOWN'), n('DONE'), n('MANUAL')]).toEqual(['2', '1', '1', '1', '1']);
  });
  it('🔴 조회 실패 → 카드를 그리지 않는다(빈 할 일·끝남으로 그리지 않음)', async () => {
    const v = await mount({ reject: true });
    await waitFor(() => expect(v.container.textContent).toMatch(/다시|오류|실패/));
    expect(v.container.querySelectorAll('[data-human-action]').length).toBe(0);
  });
});
