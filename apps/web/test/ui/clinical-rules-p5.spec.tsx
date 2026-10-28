/**
 * 임상 규칙·템플릿 P5 화면(2026-10-21 · A6·A7·B4).
 *  · 임상도구 검수: 🔴 요약 조회 실패 = 확인 불가(89개 "미검증"으로 세지 않음·필터·미검증 배너 없음) · 처방 초안이 닫힌 레지멘 먼저 ·
 *    4-eyes 출처(설정 없음 = 서버 기본값)·결정 링크 · 정의 해시를 서버가 대조하지 않는다는 고지
 *  · 폼 판: 목록에 판 · 판 기록 창 — 🔴 판 기록 시작 전 제출은 "모름"으로 따로 · 원장에 없는 현재 판 · 편집 창 새 판 안내
 *  · 위원회 안건: 🔴 담당 없음 = 올릴 수 없다(단추 없음) · 담당 있으면 사용 중으로 갈 수 있는 세트만 단추 · 열린 안건은 진행 중 · 관리자 아니면 조회 안 함
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CLINICAL_CHARTS } from '@/lib/clinical-charts';

const get = vi.fn();
const post = vi.fn();
vi.mock('@/lib/api-client', async (orig) => ({ ...(await orig<object>()), apiClient: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a), put: vi.fn(), getToken: () => 'x' } }));
vi.mock('@/stores/toast-store', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock('next/link', () => ({ default: ({ href, children, ...p }: { href: string; children: React.ReactNode }) => <a href={href} {...p}>{children}</a> }));
let role = 'ADMIN';
vi.mock('@/stores/auth-store', () => {
  const useAuthStore = (sel?: (s: unknown) => unknown) => { const st = { user: { id: 'u', role } }; return sel ? sel(st) : st; };
  return { useAuthStore };
});
const wrap = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>;
beforeEach(() => { cleanup(); get.mockReset(); post.mockReset(); role = 'ADMIN'; });

describe('임상도구 검수(A6)', () => {
  async function mount() {
    const { default: Page } = await import('@/app/(main)/admin/clinical-chart-verification/page');
    return render(<Page />, { wrapper: wrap });
  }
  it('🔴 요약 조회 실패 — 상태 확인 불가 · 필터·미검증 배너·레지멘 요약 없음', async () => {
    get.mockRejectedValue(new Error('500'));
    const { container } = await mount();
    await waitFor(() => expect(container.querySelector('[data-verify-unknown]')).toBeTruthy());
    expect(container.querySelector('[data-testid="ccv-unverified-banner"]')).toBeNull();
    expect(container.querySelector('[data-regimen-blocked]')).toBeNull();
    const states = [...container.querySelectorAll('[data-verify-state]')].map((e) => e.getAttribute('data-verify-state'));
    expect(states.length).toBe(CLINICAL_CHARTS.length);
    expect(new Set(states)).toEqual(new Set(['UNKNOWN']));
    expect(container.textContent).not.toMatch(/미검증 참조용/);
  });
  it('성공 — 처방 초안이 닫힌 레지멘 먼저 · 닫힌 수 · 4-eyes 출처(설정 없음)·결정 링크 · 해시 한계 고지', async () => {
    get.mockResolvedValue({ data: { fourEyes: true, fourEyesSource: 'default', items: [] } });
    const { container } = await mount();
    await waitFor(() => expect(container.querySelector('[data-regimen-blocked]')).toBeTruthy());
    const regimens = CLINICAL_CHARTS.filter((d) => d.archetype === 'tree');
    expect(regimens.length).toBeGreaterThan(0);
    expect(container.querySelector('[data-regimen-blocked]')!.getAttribute('data-regimen-blocked')).toBe(String(regimens.length));
    const firstRows = [...container.querySelectorAll('tbody tr')].slice(0, regimens.length);
    for (const r of firstRows) expect(r.querySelector('[data-blocks-order-draft]')).toBeTruthy();
    expect(container.querySelector('tbody tr:nth-child(' + (regimens.length + 1) + ') [data-blocks-order-draft]')).toBeNull();
    const src = container.querySelector('[data-four-eyes-source]')!;
    expect(src.getAttribute('data-four-eyes-source')).toBe('default');
    expect(src.querySelector('a')!.getAttribute('href')).toBe('/admin/decisions/clinicalChart.verifyPolicy');
    expect(container.querySelector('[data-def-hash-limit]')!.textContent).toMatch(/대조하지 않습니다/);
  });
});

describe('폼 판(A7)', () => {
  const FORM = { id: 'f1', name: 'phq9', version: '1.0', revision: 3, category: 'SCORING', isActive: true, schema: { fields: [{ id: 'q1' }] } };
  it('목록에 판 · 🔴 판 기록 — 시작 전 제출은 모름으로 따로 · 원장에 없는 현재 판', async () => {
    get.mockImplementation(async (url: string) => {
      if (url === '/api/v1/forms') return { data: [FORM] };
      if (url === '/api/v1/forms/f1/revisions') return { data: { form: { id: 'f1', name: 'phq9', revision: 3, version: '1.0' }, currentRecorded: false, revisions: [], submissionsBeforeLedger: 5, submissionsOnUnrecordedCurrent: 2 } };
      return { data: [] };
    });
    const { default: Page } = await import('@/app/(main)/admin/forms/page');
    const { container } = render(<Page />, { wrapper: wrap });
    await waitFor(() => expect(container.querySelector('[data-form-revision="3"]')).toBeTruthy());
    fireEvent.click(container.querySelector('[data-form-history-open="f1"]')!);
    await waitFor(() => expect(container.querySelector('[data-form-before-ledger="5"]')).toBeTruthy());
    expect(container.querySelector('[data-form-before-ledger]')!.textContent).toMatch(/알 수 없습니다/);
    expect(container.querySelector('[data-form-current-unrecorded]')!.textContent).toMatch(/2/);
  });
  it('판 기록 행 — 지금 판 표시 · 시작 전 내용은 만든 시각 모름', async () => {
    get.mockImplementation(async (url: string) => {
      if (url === '/api/v1/forms') return { data: [FORM] };
      return { data: { form: { id: 'f1', name: 'phq9', revision: 3, version: '1.0' }, currentRecorded: true, submissionsBeforeLedger: 0, submissionsOnUnrecordedCurrent: 0,
        revisions: [{ id: 'r3', revision: 3, version: '1.0', origin: 'EDIT', createdAt: '2026-10-21T01:00:00Z', submissions: 1 }, { id: 'r2', revision: 2, version: '1.0', origin: 'BEFORE_LEDGER', createdAt: '2026-10-21T01:00:00Z', submissions: 4 }] } };
    });
    const { default: Page } = await import('@/app/(main)/admin/forms/page');
    const { container } = render(<Page />, { wrapper: wrap });
    await waitFor(() => expect(container.querySelector('[data-form-history-open="f1"]')).toBeTruthy());
    fireEvent.click(container.querySelector('[data-form-history-open="f1"]')!);
    await waitFor(() => expect(container.querySelector('[data-form-revision-row="2"]')).toBeTruthy());
    expect(container.querySelector('[data-form-revision-row="3"]')!.textContent).toMatch(/지금/);
    expect(container.querySelector('[data-form-revision-row="2"]')!.textContent).toMatch(/만든 시각 모름/);
    expect(container.querySelector('[data-form-before-ledger]')).toBeNull();
    expect(container.querySelector('[data-form-current-unrecorded]')).toBeNull();
  });
});

describe('🔴 약속처방 사용 중 전환 안건(B4)', () => {
  const SETS = [{ id: 'd1', name: '초안 세트', status: 'DRAFT' }, { id: 'a1', name: '사용 중 세트', status: 'ACTIVE' }, { id: 'p1', name: '승인 대기', status: 'PENDING_APPROVAL' }, { id: 'ap', name: '승인됨', status: 'APPROVED' }];
  async function mount() {
    const { CatalogAgendaPanel } = await import('@/components/governance/CatalogAgendaPanel');
    return render(<CatalogAgendaPanel items={SETS} />, { wrapper: wrap });
  }
  it('🔴 담당 위원회 없음 — 올릴 수 없다고 말하고 단추 없음 · 결정 링크', async () => {
    get.mockResolvedValue({ data: { owner: null, items: [] } });
    const { container } = await mount();
    await waitFor(() => expect(container.querySelector('[data-catalog-agenda-no-owner]')).toBeTruthy());
    expect(container.querySelector('[data-catalog-agenda-submit]')).toBeNull();
    expect(container.querySelector('[data-catalog-agenda-no-owner] a')!.getAttribute('href')).toBe('/admin/decisions/catalog.ownership');
  });
  it('담당 있음 — 사용 중으로 갈 수 있는 세트(초안·승인됨)만 · 열린 안건은 진행 중 · 올리기 = 안건 EP(세트 EP 아님)', async () => {
    get.mockResolvedValue({ data: { owner: { id: 'c', code: 'DTC', name: '약사위원회' }, items: [{ id: 'g', title: 't', status: 'SUBMITTED', key: 'ap' }] } });
    post.mockResolvedValue({ data: {} });
    const { container } = await mount();
    await waitFor(() => expect(container.querySelector('[data-catalog-agenda-owner="DTC"]')).toBeTruthy());
    expect([...container.querySelectorAll('[data-catalog-agenda-row]')].map((e) => e.getAttribute('data-catalog-agenda-row'))).toEqual(['d1', 'ap']);
    expect(container.querySelector('[data-catalog-agenda-row="ap"] [data-catalog-agenda-open="SUBMITTED"]')).toBeTruthy();
    expect(container.querySelector('[data-catalog-agenda-submit="ap"]')).toBeNull();
    fireEvent.click(container.querySelector('[data-catalog-agenda-submit="d1"]')!);
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/v1/admin/clinical-rules/order-sets/d1/agenda', {}));
  });
  it('🔴 조회 실패는 확인 불가(담당 없음으로 말하지 않음) · 관리자 아니면 조회도 표시도 없음', async () => {
    get.mockRejectedValue(new Error('500'));
    const { container } = await mount();
    await waitFor(() => expect(container.querySelector('[data-catalog-agenda-unknown]')).toBeTruthy());
    expect(container.querySelector('[data-catalog-agenda-no-owner]')).toBeNull();
    cleanup(); get.mockReset(); role = 'DOCTOR';
    const v = await mount();
    expect(v.container.innerHTML).toBe('');
    expect(get).not.toHaveBeenCalled();
  });
});
