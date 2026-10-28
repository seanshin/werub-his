/**
 * 임상 규칙·템플릿 P4 화면(2026-10-21 · B1·A8·B2·B5).
 *  · 대장(3417): 카드 = shared 정의 순서 · 🔴 null = 확인 불가(0 아님) · 실패 카드만 실패 문구 · 주의 지표 강조 · 소유 결정 시드 표기
 *  · 처방집 칩: 등재·사용중지·미등재(시행 모드) · 🔴 조회 실패 = 확인 불가 · 코드 없는 항목은 칩 없음
 *  · DUR 영향 미리보기: 보낸 초안(수정이면 id) · 결과 건수 · 지금 룰 비교 · 🔴 미리보기 불가는 이유(0 아님) · 경고 부담 링크
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CLINICAL_CHARTS } from '@/lib/clinical-charts';
import { CLINICAL_RULES_LEDGER, CLINICAL_CODE_RULES } from '@hospital-run/shared';

const get = vi.fn();
const post = vi.fn();
vi.mock('@/lib/api-client', async (orig) => ({ ...(await orig<object>()), apiClient: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a), patch: vi.fn(), getToken: () => 'x' } }));
vi.mock('@/stores/toast-store', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock('next/link', () => ({ default: ({ href, children, ...p }: { href: string; children: React.ReactNode }) => <a href={href} {...p}>{children}</a> }));
vi.mock('@/stores/auth-store', () => {
  const useAuthStore = (sel?: (s: unknown) => unknown) => { const st = { user: { id: 'u', role: 'ADMIN' } }; return sel ? sel(st) : st; };
  return { useAuthStore };
});
const wrap = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>;
beforeEach(() => { cleanup(); get.mockReset(); post.mockReset(); });

describe('임상 규칙 대장(3417)', () => {
  async function mount(cards: unknown[], ownership = { choice: 'UNASSIGNED', seeded: true, known: true }) {
    get.mockResolvedValue({ data: { cards, ownership, reviewDue: null } });
    const { default: Page } = await import('@/app/(main)/admin/clinical-rules/page');
    const v = render(<Page />, { wrapper: wrap });
    await waitFor(() => expect(v.container.querySelector('[data-ledger-cards]')).toBeTruthy());
    return v;
  }
  const full = CLINICAL_RULES_LEDGER.map((d) => ({ key: d.key, metrics: Object.fromEntries(d.metrics.map((m) => [m.code, m.kind === 'bool' ? false : 1])), lastChangedAt: '2026-10-01T00:00:00Z' }));
  it('카드 = shared 정의 순서 · 주의 지표 강조 · 소유 결정 개발 시드 표기 · 전체 도구 수는 웹 정의에서', async () => {
    const { container } = await mount(full);
    expect([...container.querySelectorAll('[data-ledger-card]')].map((e) => e.getAttribute('data-ledger-card'))).toEqual(CLINICAL_RULES_LEDGER.map((d) => d.key));
    expect(container.querySelector('[data-ledger-metric="ORDER_SET.activeNoApprover"]')!.getAttribute('data-ledger-warn')).toBe('true');
    expect(container.querySelector('[data-ledger-metric="ORDER_SET.active"]')!.getAttribute('data-ledger-warn')).toBeNull();
    expect(container.querySelector('[data-ledger-ownership]')!.textContent).toMatch(/개발 시드/);
    expect(container.querySelector('[data-ledger-metric="CHART_VERIFY.total"]')!.textContent).toMatch(String(CLINICAL_CHARTS.length));
  });
  it('🔴 null 은 확인 불가(0 아님) · 실패 카드만 실패 문구 · 다른 카드는 그대로', async () => {
    const cards = full.map((c) => (c.key === 'DUR' ? { ...c, metrics: { ...c.metrics, hits90d: null } } : c.key === 'TRIAGE' ? { ...c, metrics: null } : c));
    const { container } = await mount(cards as never);
    expect(container.querySelector('[data-ledger-metric="DUR.hits90d"]')!.textContent).toMatch(/확인 불가/);
    expect(container.querySelector('[data-ledger-card="TRIAGE"]')!.getAttribute('data-ledger-failed')).toBe('true');
    expect(container.querySelector('[data-ledger-card="ORDER_SET"]')!.getAttribute('data-ledger-failed')).toBeNull();
  });
});

describe('처방집 칩', () => {
  it('등재·사용중지·미등재(모드) · 🔴 확인 불가 · 코드 없으면 칩 없음', async () => {
    const { FormularyChip } = await import('@/components/formulary/FormularyChip');
    const r = (x: unknown) => render(<FormularyChip r={x as never} />);
    expect(r({ state: 'KNOWN', status: 'LISTED', mode: 'WARN' }).container.querySelector('[data-formulary="LISTED"]')).toBeTruthy(); cleanup();
    const nl = r({ state: 'KNOWN', status: 'NOT_LISTED', mode: 'BLOCK' }).container.querySelector('[data-formulary="NOT_LISTED"]')!;
    expect(nl.getAttribute('data-formulary-mode')).toBe('BLOCK'); expect(nl.textContent).toMatch(/차단/); cleanup();
    expect(r({ state: 'UNKNOWN' }).container.textContent).toMatch(/확인 불가/); cleanup();
    expect(r({ state: 'NONE' }).container.innerHTML).toBe('');
  });
});

describe('🔴 처방집 조회 훅 — 실패는 확인 불가 · 영역별 한 번 · 코드 없는 항목은 대조 안 함', () => {
  async function probe(entries: Array<{ domain: 'MEDICATION' | 'LAB' | 'IMAGING' | null; codeId?: string | null }>) {
    const { useFormularyStatus } = await import('@/components/formulary/FormularyChip');
    let out: ReturnType<typeof useFormularyStatus> | null = null;
    function C() { out = useFormularyStatus(entries); return null; }
    render(<C />, { wrapper: wrap });
    return () => out!;
  }
  it('조회 실패 → UNKNOWN(등재·미등재로 말하지 않음) · 확인 불가 수', async () => {
    post.mockRejectedValue(new Error('500'));
    const get = await probe([{ domain: 'MEDICATION', codeId: 'm1' }, { domain: null, codeId: 'x' }]);
    await waitFor(() => expect(get().lookup('MEDICATION', 'm1')).toEqual({ state: 'UNKNOWN' }));
    expect(get().lookup(null, 'x')).toEqual({ state: 'NONE' });
    expect(get().counts.unknown).toBe(1);
  });
  it('성공 → 상태·모드 · 미등재 수 · 영역별 요청 한 번', async () => {
    post.mockResolvedValue({ data: { domain: 'MEDICATION', mode: 'WARN', enforceable: true, statuses: { m1: 'NOT_LISTED', m2: 'LISTED' } } });
    const get = await probe([{ domain: 'MEDICATION', codeId: 'm1' }, { domain: 'MEDICATION', codeId: 'm2' }, { domain: 'MEDICATION', codeId: null }]);
    await waitFor(() => expect(get().lookup('MEDICATION', 'm1')).toEqual({ state: 'KNOWN', status: 'NOT_LISTED', mode: 'WARN' }));
    expect(get().counts).toEqual({ notListed: 1, suspended: 0, unknown: 0 });
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0]).toEqual(['/api/v1/formulary/status-of', { domain: 'MEDICATION', codeIds: ['m1', 'm2'] }]);
  });
});

describe('DUR 영향 미리보기 · 경고 부담 링크', () => {
  const OV = { rules: [{ id: 'r1', ruleType: 'AGE', severity: 'WARNING', drugA: 'codeine', drugB: null, keywords: null, minAge: null, maxAge: 12, maxDailyDose: null, maxPerKgDay: null, maxAbsolute: null, unit: null, message: '소아 금기', isActive: true, source: 'SEED', updatedAt: '', hits: null }],
    window: { days: 90, from: '', effectiveFrom: null }, metering: { since: null }, sourceByType: null, codeRules: CLINICAL_CODE_RULES };
  async function mountPanel() {
    get.mockResolvedValue({ data: OV });
    const { DurRulesPanel } = await import('@/app/(main)/admin/cdss-rules/dur-rules-panel');
    const v = render(<DurRulesPanel />, { wrapper: wrap });
    await waitFor(() => expect(v.container.querySelector('[data-dur-panel]')).toBeTruthy());
    return v;
  }
  it('수정 중 미리보기 — 초안 + id 전송 · 결과·지금 룰 비교 · 경고 부담 링크', async () => {
    post.mockResolvedValue({ data: { windowDays: 30, scanned: 120, truncated: false, draft: { supported: true, matchedRx: 4, matchedPatients: 3 }, current: { supported: true, matchedRx: 2, matchedPatients: 2 } } });
    const { container } = await mountPanel();
    expect(container.querySelector('[data-dur-burden-link] a')!.getAttribute('href')).toBe('/orders');
    fireEvent.click([...container.querySelectorAll('[data-dur-row="r1"] button')].find((b) => /편집/.test(b.textContent ?? ''))!);
    fireEvent.click(container.querySelector('[data-dur-preview]')!);
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post.mock.calls[0][0]).toBe('/api/v1/dur/rules/preview');
    expect(post.mock.calls[0][1]).toMatchObject({ ruleType: 'AGE', drugA: 'codeine', maxAge: 12, id: 'r1' });
    await waitFor(() => expect(container.querySelector('[data-dur-preview-draft="4"]')).toBeTruthy());
    expect(container.querySelector('[data-dur-preview-current="2"]')).toBeTruthy();
  });
  it('🔴 미리보기 불가는 이유(0 건으로 그리지 않는다)', async () => {
    post.mockResolvedValue({ data: { windowDays: 30, scanned: 10, truncated: true, draft: { supported: false, reason: 'WEIGHT_NOT_IN_HISTORY', matchedRx: 0, matchedPatients: 0 }, current: null } });
    const { container } = await mountPanel();
    fireEvent.click([...container.querySelectorAll('[data-dur-row="r1"] button')].find((b) => /편집/.test(b.textContent ?? ''))!);
    fireEvent.click(container.querySelector('[data-dur-preview]')!);
    await waitFor(() => expect(container.querySelector('[data-dur-preview-unsupported="WEIGHT_NOT_IN_HISTORY"]')).toBeTruthy());
    expect(container.querySelector('[data-dur-preview-draft]')).toBeNull();
    expect(container.querySelector('[data-dur-preview-result]')!.textContent).toMatch(/잘랐습니다/);
  });
});
