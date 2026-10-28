/**
 * 임상 규칙·템플릿 P1 — CDSS 규칙 화면이 판정 규칙(DUR 룰)을 편집한다(2026-10-21 · A1).
 *  · 첫 탭 = 판정 규칙(DUR 룰) · 코드 규칙(편집 불가 · shared 정본) · 옛 목록(판정 미사용 · 읽기 전용)
 *  · 🔴 적중 null = "계측 전"(0 아님) · 활성 0 유형은 코드 기본값 고지 · 마지막 활성 룰 끄기 경고
 *  · 쓰기 폼 미선택 시작 · 유형별 필수 칸 전엔 저장 잠김 · 끄기는 전체 본문 + isActive false(삭제 없음)
 *  · 관리자만 편집 단추
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CLINICAL_CODE_RULES } from '@hospital-run/shared';

const get = vi.fn();
const post = vi.fn();
const patch = vi.fn();
vi.mock('@/lib/api-client', async (orig) => ({ ...(await orig<object>()), apiClient: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a), patch: (...a: unknown[]) => patch(...a), put: vi.fn(), del: vi.fn(), getToken: () => 'x' } }));
vi.mock('@/stores/toast-store', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
let role = 'ADMIN';
vi.mock('@/stores/auth-store', () => {
  const useAuthStore = (sel?: (s: unknown) => unknown) => { const st = { user: { id: 'u', role } }; return sel ? sel(st) : st; };
  (useAuthStore as unknown as { getState: () => unknown }).getState = () => ({ user: { role } });
  return { useAuthStore };
});
const wrap = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>;

const R = (o: Record<string, unknown>) => ({ ruleType: 'INTERACTION', severity: 'ERROR', drugA: 'warfarin', drugB: 'aspirin', keywords: null, minAge: null, maxAge: null, maxDailyDose: null, maxPerKgDay: null, maxAbsolute: null, unit: null, message: '출혈 위험', isActive: true, source: 'SEED', updatedAt: '2026-10-01', hits: null, ...o });
let overview: Record<string, unknown>;
beforeEach(() => {
  cleanup(); get.mockReset(); post.mockReset(); patch.mockReset(); role = 'ADMIN';
  overview = {
    rules: [R({ id: 'r1' }), R({ id: 'r2', drugA: 'a', drugB: 'b' }), R({ id: 'b1', ruleType: 'BEERS', severity: 'WARNING', drugA: null, drugB: null, keywords: ['diazepam'] })],
    window: { days: 90, from: '2026-07-23', effectiveFrom: null }, metering: { since: null },
    sourceByType: { interaction: 'TABLE', age: 'FALLBACK', maxDose: 'FALLBACK', beers: 'TABLE', pediatric: 'FALLBACK' },
    codeRules: CLINICAL_CODE_RULES,
  };
  get.mockImplementation(async (url: string) => (url === '/api/v1/dur/rules/overview' ? { data: overview } : { data: {} }));
  patch.mockResolvedValue({ data: {} });
  post.mockResolvedValue({ data: {} });
});
async function mountPage() {
  const { default: Page } = await import('@/app/(main)/admin/cdss-rules/page');
  const v = render(<Page />, { wrapper: wrap });
  await waitFor(() => expect(v.container.querySelector('[data-dur-panel]')).toBeTruthy());
  return v;
}
const q = (c: HTMLElement, s: string) => c.querySelector(s) as HTMLInputElement;

describe('판정 규칙(DUR 룰) 탭', () => {
  it('첫 탭이 DUR 룰 · 🔴 계측 전이면 적중 "계측 전"(0 아님) · 코드 기본값 유형 고지', async () => {
    const { container } = await mountPage();
    expect(container.querySelector('[data-dur-row="r1"] [data-dur-hits="unmeasured"]')!.textContent).toMatch(/계측 전/);
    expect(container.querySelector('[data-dur-metering="NONE"]')).toBeTruthy();
    expect(container.querySelector('[data-dur-fallback]')!.getAttribute('data-dur-fallback')).toBe('AGE,MAX_DOSE,PEDIATRIC_DOSE');
  });
  it('계측 뒤면 숫자(0 포함)', async () => {
    overview = { ...overview, metering: { since: '2026-10-21' }, window: { days: 90, from: '2026-07-23', effectiveFrom: '2026-10-21' }, rules: [R({ id: 'r1', hits: 3 }), R({ id: 'r2', hits: 0 })] };
    const { container } = await mountPage();
    expect(container.querySelector('[data-dur-row="r1"] [data-dur-hits]')!.textContent).toBe('3');
    expect(container.querySelector('[data-dur-row="r2"] [data-dur-hits]')!.textContent).toBe('0');
  });
  it('🔴 마지막 활성 룰 끄기 경고 · 끄기 = 전체 본문 + isActive false', async () => {
    const { container } = await mountPage();
    expect(container.querySelector('[data-dur-toggle="b1"]')!.getAttribute('data-dur-last-active')).toBe('true');
    expect(container.querySelector('[data-dur-toggle="r1"]')!.getAttribute('data-dur-last-active')).toBeNull();
    fireEvent.click(container.querySelector('[data-dur-toggle="r1"]')!);
    await waitFor(() => expect(patch).toHaveBeenCalled());
    expect(patch.mock.calls[0]).toEqual(['/api/v1/dur/rules/r1', { ruleType: 'INTERACTION', severity: 'ERROR', message: '출혈 위험', isActive: false, drugA: 'warfarin', drugB: 'aspirin', source: 'SEED' }]);
  });
  it('🔴 추가 폼은 비어서 시작 · 유형별 필수 칸 전엔 잠김 · 채우면 보낸 값 그대로', async () => {
    const { container } = await mountPage();
    fireEvent.click(q(container, '[data-dur-add]'));
    expect(q(container, '[data-dur-form-type]').value).toBe('');
    expect(q(container, '[data-dur-form-severity]').value).toBe('');
    expect(q(container, '[data-dur-save]').disabled).toBe(true);
    fireEvent.change(q(container, '[data-dur-form-type]'), { target: { value: 'AGE' } });
    fireEvent.change(q(container, '[data-dur-form-severity]'), { target: { value: 'WARNING' } });
    const inputs = container.querySelectorAll('[data-dur-form] input');
    fireEvent.change(inputs[0], { target: { value: 'codeine' } });
    fireEvent.change(container.querySelector('[data-dur-form] input[placeholder*="경고 문구"]')!, { target: { value: '소아 금기' } });
    expect(q(container, '[data-dur-save]').disabled).toBe(true); // 나이 없음
    expect(container.querySelector('[data-dur-missing]')!.textContent).toMatch(/나이/);
    fireEvent.change(inputs[2], { target: { value: '12' } }); // 이 나이 이하
    fireEvent.click(q(container, '[data-dur-save]'));
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post.mock.calls[0]).toEqual(['/api/v1/dur/rules', { ruleType: 'AGE', severity: 'WARNING', message: '소아 금기', drugA: 'codeine', maxAge: 12 }]);
  });
  it('관리자가 아니면 추가·편집·끄기 없음', async () => {
    role = 'PHARMACIST';
    const { container } = await mountPage();
    expect(container.querySelector('[data-dur-add]')).toBeNull();
    expect(container.querySelector('[data-dur-toggle]')).toBeNull();
  });
});

describe('코드 규칙·옛 목록 탭', () => {
  it('코드 규칙 = shared 정본 전부(편집 단추 없음)', async () => {
    const { container } = await mountPage();
    fireEvent.click(container.querySelector('[data-cdss-tab="CODE"]')!);
    expect(container.querySelectorAll('[data-code-rule]').length).toBe(CLINICAL_CODE_RULES.length);
    expect(container.querySelector('[data-code-rules] button')).toBeNull();
  });
  it('🔴 옛 목록은 읽기 전용 — 판정 미사용 고지 · 추가·편집·삭제 없음', async () => {
    get.mockImplementation(async (url: string) => {
      if (url === '/api/v1/dur/rules/overview') return { data: overview };
      if (url === '/api/v1/cdss/rules/stats') return { data: { totalRules: 1, activeRules: 1, byCategory: {}, topHits: [], engine: { readsThisTable: false, hitsMeasured: false, durRulesActive: 3, codeRules: [] } } };
      if (url === '/api/v1/cdss/rules') return { data: [{ id: 'c1', name: '옛 규칙', category: 'AGE', level: 'WARNING', message: 'm', isActive: true, hitCount: 0 }] };
      return { data: {} };
    });
    const { container } = await mountPage();
    fireEvent.click(container.querySelector('[data-cdss-tab="LEGACY"]')!);
    await waitFor(() => expect(container.querySelector('[data-cdss-engine-notice]')).toBeTruthy());
    expect(container.textContent).not.toMatch(/규칙 추가/);
    expect([...container.querySelectorAll('button')].some((b) => /^(편집|삭제)$/.test(b.textContent ?? ''))).toBe(false);
  });
});
