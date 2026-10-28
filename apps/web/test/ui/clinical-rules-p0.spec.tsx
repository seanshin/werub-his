/**
 * 임상 규칙·템플릿 교차검증 P0(2026-10-21 · `clinical-rules-templates-review-2026-10.plan.md` R1·R3·R3-b·R4·R7).
 *  · 🔴 CDSS 규칙 화면: 이 목록은 판정에 쓰이지 않는다고 먼저 말한다 · 서버가 보내지 않는 "이번달 적용 0"을 그리지 않는다 · 적중 "계측 없음"
 *  · 🔴 CDSS 배너: 점검 실패를 "경고 없음"(빈 화면)으로 접지 않는다 · 진료 작성은 기록 전용 진료 id 만 보낸다(판정 범위 그대로)
 *  · 🔴 트리아지 관리: 쓰는 곳(원무 AI 접수 상담)과 안 쓰는 곳(응급 KTAS)을 말한다 · "온라인 예약에서 사용" 문구 없음
 *  · 🔴 사용 중인데 승인 기록이 없는 세트·템플릿 수 · 목록을 못 받았으면 말하지 않는다
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const get = vi.fn();
const post = vi.fn();
vi.mock('@/lib/api-client', async (orig) => ({ ...(await orig<object>()), apiClient: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a), patch: vi.fn(), put: vi.fn(), del: vi.fn(), getToken: () => 'x' } }));
vi.mock('@/stores/toast-store', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => '/admin', useSearchParams: () => new URLSearchParams() }));
vi.mock('@/stores/auth-store', () => {
  const useAuthStore = (sel?: (s: unknown) => unknown) => { const st = { user: { id: 'u', role: 'ADMIN' } }; return sel ? sel(st) : st; };
  (useAuthStore as unknown as { getState: () => unknown }).getState = () => ({ user: { role: 'ADMIN' } });
  return { useAuthStore };
});
const wrap = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>;
const SRC = join(__dirname, '../../src');
beforeEach(() => { cleanup(); get.mockReset(); post.mockReset(); });

describe('🔴 CDSS 규칙 화면 — 판정에 쓰이지 않는 표라고 말한다', () => {
  async function mount(engine: unknown) {
    get.mockImplementation(async (url: string) => {
      if (url === '/api/v1/cdss/rules/stats') return { data: { totalRules: 17, activeRules: 17, byCategory: { AGE: 3 }, topHits: [], ...(engine ? { engine } : {}) } };
      if (url === '/api/v1/cdss/rules') return { data: [{ id: 'r1', name: '규칙1', category: 'AGE', level: 'WARNING', message: 'm', isActive: true, hitCount: 0 }] };
      return { data: {} };
    });
    const { default: Page } = await import('@/app/(main)/admin/cdss-rules/page');
    const v = render(<Page />, { wrapper: wrap });
    // P1(2026-10-21): 옛 목록은 「옛 목록(판정 미사용)」 탭으로 옮겨졌다(첫 탭은 판정 규칙 DUR 룰)
    fireEvent.click(v.container.querySelector('[data-cdss-tab="LEGACY"]')!);
    return v;
  }
  it('엔진이 읽지 않으면 고지 · DUR 룰 수 · 적중 "계측 없음" · "이번달 적용 횟수" 카드 없음', async () => {
    const v = await mount({ readsThisTable: false, hitsMeasured: false, durRulesActive: 55, codeRules: ['ALLERGY', 'RENAL'] });
    await waitFor(() => expect(v.container.querySelector('[data-cdss-engine-notice]')).toBeTruthy());
    expect(v.container.querySelector('[data-cdss-engine-notice]')!.textContent).toMatch(/55/);
    expect(v.container.textContent).not.toMatch(/이번달 적용 횟수/);
    await waitFor(() => expect(v.container.querySelector('[data-hit-unmeasured]')).toBeTruthy());
  });
  it('엔진 사실을 못 받았으면(옛 서버) 판정 사용을 "확인 불가"로 — 아니오/0 으로 단정하지 않는다', async () => {
    const v = await mount(null);
    await waitFor(() => expect(v.container.textContent).toMatch(/확인 불가/));
    expect(v.container.querySelector('[data-cdss-engine-notice]')).toBeNull();
  });
});

describe('🔴 CDSS 배너 — 실패는 실패로 · 기록 전용 진료 id', () => {
  it('점검 실패면 "점검 못 함" + 다시 점검(빈 화면 아님)', async () => {
    post.mockRejectedValue(new Error('500'));
    const { CdssAlertBanner } = await import('@/components/cdss/CdssAlertBanner');
    const v = render(<CdssAlertBanner patientId="p" medicationCodeId="m" />, { wrapper: wrap });
    await waitFor(() => expect(v.container.querySelector('[data-cdss-failed]')).toBeTruthy());
  });
  it('logEncounterId 는 encounterId 가 없을 때만 실린다(판정 범위를 넓히지 않는다)', async () => {
    post.mockResolvedValue({ data: { level: 'PASS', passedChecks: 1, totalChecks: 1, checks: [] } });
    const { CdssAlertBanner } = await import('@/components/cdss/CdssAlertBanner');
    render(<CdssAlertBanner patientId="p" medicationCodeId="m" logEncounterId="enc-1" />, { wrapper: wrap });
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post.mock.calls[0][1]).toEqual({ patientId: 'p', medicationCodeId: 'm', encounterId: undefined, logEncounterId: 'enc-1' });
    cleanup(); post.mockClear();
    render(<CdssAlertBanner patientId="p" medicationCodeId="m2" encounterId="enc-2" logEncounterId="enc-1" />, { wrapper: wrap });
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect('logEncounterId' in post.mock.calls[0][1]).toBe(false);
  });
  it('🔴 구조 가드 — 진료 작성 배너는 기록 전용 진료 id 를 싣고 encounterId 는 싣지 않는다 · 오더 화면 점검 실패는 실패 상태로', () => {
    const enc = readFileSync(join(SRC, 'app/(main)/patients/[id]/encounter/new/page.tsx'), 'utf8');
    const line = enc.split('\n').find((l) => l.includes('<CdssAlertBanner'))!;
    expect(line).toMatch(/logEncounterId=\{encounterId\}/);
    expect(line).not.toMatch(/\sencounterId=/);
    const orders = readFileSync(join(SRC, 'app/(main)/orders/page.tsx'), 'utf8');
    expect(orders).toMatch(/catch \{ setCdssResult\(null\); setCdssFailed\(true\); \}/);
    expect(orders).toMatch(/data-cdss-failed/);
  });
});

describe('🔴 트리아지 관리 — 쓰는 곳·안 쓰는 곳', () => {
  it('원무 AI 접수 상담 · 응급 KTAS 아님 · 온라인 예약 문구 없음', async () => {
    get.mockResolvedValue({ data: [] });
    const { default: Page } = await import('@/app/(main)/admin/triage/page');
    const v = render(<Page />, { wrapper: wrap });
    const box = v.container.querySelector('[data-triage-scope]')!;
    expect(box.textContent).toMatch(/원무 창구 AI 접수 상담/);
    expect(box.textContent).toMatch(/KTAS/);
    expect(v.container.textContent).not.toMatch(/온라인 예약에서 사용/);
  });
});

describe('🔴 사용 중인데 승인 기록 없음', () => {
  it('ACTIVE 중 승인자 없는 수 · 다른 상태는 세지 않는다 · 없으면 침묵 · 목록 모름이면 침묵', async () => {
    const { ApprovalRecordNotice } = await import('@/components/governance/ApprovalRecordNotice');
    const v = render(<ApprovalRecordNotice what="약속처방" items={[{ status: 'ACTIVE' }, { status: 'ACTIVE', approvedBy: 'u1' }, { status: 'DRAFT' }]} />, { wrapper: wrap });
    expect(v.container.querySelector('[data-approval-missing]')!.getAttribute('data-approval-missing')).toBe('1');
    expect(v.container.textContent).toMatch(/2건 중 1건/);
    cleanup();
    expect(render(<ApprovalRecordNotice what="x" items={[{ status: 'ACTIVE', approvedBy: 'u' }]} />, { wrapper: wrap }).container.innerHTML).toBe('');
    cleanup();
    expect(render(<ApprovalRecordNotice what="x" items={undefined} />, { wrapper: wrap }).container.innerHTML).toBe('');
  });
  it('구조 가드 — 약속처방·치료일정 화면이 고지를 그리고 목록을 못 받았으면 undefined 를 넘긴다', () => {
    for (const f of ['app/(main)/admin/order-sets/page.tsx', 'app/(main)/admin/treatment-templates/page.tsx']) {
      expect(readFileSync(join(SRC, f), 'utf8'), f).toMatch(/<ApprovalRecordNotice items=\{data \? \w+ : undefined\}/);
    }
  });
});
