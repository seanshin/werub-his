/**
 * 간호 결정 두 가지 — 화면(2026-10-10).
 *  · 초기평가 Braden 입력 방식(`nursing.initialAssessment.bradenInput`)
 *    - SUBSCORES: 6항목 미선택 시작 · 고르다 만 상태는 저장 불가(부분 합은 Braden 이 아니다) · 총점이 아니라 하위 항목을 보낸다
 *    - TOTAL(현행): 총점 칸 · 등급은 shared 정본(종전 이 화면만 4단 — ≥19 '정상')
 *    - 🔴 방식을 모르면(조회 실패) 총점 방식으로 접지 않는다 — Braden 칸을 닫고 Braden 없이 보낸다
 *  · 재평가 관리 — 자동 일정 결정 켜짐/꺼짐/모름 · 결정 화면 링크
 *  · 저장 결과 — 만든 일정·건너뛴 이유
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { render, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const get = vi.fn();
const post = vi.fn();
vi.mock('@/lib/api-client', async (orig) => ({ ...(await orig<object>()), apiClient: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a), patch: vi.fn(), getToken: () => 'x' } }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), usePathname: () => '/inpatient/a1/nursing/assessment', useSearchParams: () => new URLSearchParams(), useParams: () => ({ admissionId: 'a1' }) }));

const PARAMS = Object.assign(Promise.resolve({ admissionId: 'a1' }), { status: 'fulfilled', value: { admissionId: 'a1' } });
const wrap = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>;

/** mode: 설정 값 · 'FAIL' = 조회 실패 */
function routes(mode: unknown) {
  get.mockImplementation(async (url: string) => {
    if (url.includes('/api/v1/config/')) {
      if (mode === 'FAIL') throw new Error('500');
      return { data: mode };
    }
    if (url.endsWith('/nursing-assessment')) throw new Error('404 not found');
    return { data: null };
  });
}
beforeEach(() => { cleanup(); get.mockReset(); post.mockReset(); post.mockResolvedValue({ data: { id: 'na1', autoSchedules: { enabled: false, created: [], skipped: [] } } }); });

let Page: React.ComponentType<{ params: Promise<{ admissionId: string }> }>;
beforeAll(async () => { Page = (await import('@/app/(main)/inpatient/[admissionId]/nursing/assessment/page')).default as never; }, 30000);

/** 필수 항목을 채운다(의식·활동·영양·피부 + 통증 0 확인) */
function fillRequired(c: HTMLElement) {
  const selects = Array.from(c.querySelectorAll('select'));
  expect(selects.length).toBe(4);
  for (const s of selects) fireEvent.change(s, { target: { value: (s.querySelectorAll('option')[1] as HTMLOptionElement).value } });
  const pain = Array.from(c.querySelectorAll('button')).find((b) => b.textContent?.includes('통증 없음'));
  fireEvent.click(pain!);
}
const saveBtn = (c: HTMLElement) => Array.from(c.querySelectorAll('button')).find((b) => b.className.includes('bg-indigo-600') && /평가 저장|미평가/.test(b.textContent ?? '')) as HTMLButtonElement;

describe('초기평가 — Braden 입력 방식', () => {
  it('🔴 SUBSCORES — 6항목 미선택 시작 · 고르다 만 상태는 저장 불가 · 다 고르면 하위 항목만 보낸다', async () => {
    routes('SUBSCORES');
    const { container } = render(<Page params={PARAMS} />, { wrapper: wrap });
    await waitFor(() => expect(container.querySelector('[data-braden-mode="subscores"]')).toBeTruthy());
    expect(container.querySelectorAll('[data-braden-pick][aria-pressed="true"]').length).toBe(0);
    expect(container.querySelector('input[type="number"][max="23"]')).toBeNull(); // 총점 칸 없음
    fillRequired(container);
    fireEvent.click(container.querySelector('[data-braden-pick="sensory:3"]')!);
    await waitFor(() => expect(container.querySelector('[data-braden-partial]')).toBeTruthy());
    expect(saveBtn(container).disabled).toBe(true);
    for (const p of ['moisture:2', 'activity:2', 'mobility:2', 'nutrition:2', 'friction:1']) fireEvent.click(container.querySelector(`[data-braden-pick="${p}"]`)!);
    await waitFor(() => expect(container.querySelector('[data-braden-total]')?.textContent).toContain('12'));
    expect(saveBtn(container).disabled).toBe(false);
    fireEvent.click(saveBtn(container));
    await waitFor(() => expect(post).toHaveBeenCalled());
    const body = post.mock.calls[0][1];
    expect(body.bradenSubscores).toEqual({ sensory: 3, moisture: 2, activity: 2, mobility: 2, nutrition: 2, friction: 1 });
    expect(body).not.toHaveProperty('bradenScore');
  });

  it('TOTAL(현행) — 총점 칸 · 등급은 shared 정본(16 = 저위험 · 종전 4단은 "경미 위험")', async () => {
    routes('TOTAL');
    const { container } = render(<Page params={PARAMS} />, { wrapper: wrap });
    await waitFor(() => expect(container.querySelector('input[type="number"][max="23"]')).toBeTruthy());
    fireEvent.change(container.querySelector('input[type="number"][max="23"]')!, { target: { value: '16' } });
    await waitFor(() => expect(container.textContent).toContain('저위험'));
    expect(container.textContent).not.toContain('경미 위험');
    fillRequired(container);
    fireEvent.click(saveBtn(container));
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post.mock.calls[0][1]).toMatchObject({ bradenScore: 16 });
    expect(post.mock.calls[0][1]).not.toHaveProperty('bradenSubscores');
  });

  it('🔴 방식 조회 실패 — 총점 방식으로 접지 않는다(칸 닫힘 · 이유 · Braden 없이 저장)', async () => {
    routes('FAIL');
    const { container } = render(<Page params={PARAMS} />, { wrapper: wrap });
    await waitFor(() => expect(container.querySelector('[data-braden-mode="unknown"]')).toBeTruthy());
    expect(container.querySelector('input[type="number"][max="23"]')).toBeNull();
    expect(container.querySelector('[data-braden-mode="subscores"]')).toBeNull();
    fillRequired(container);
    fireEvent.click(saveBtn(container));
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post.mock.calls[0][1]).not.toHaveProperty('bradenScore');
    expect(post.mock.calls[0][1]).not.toHaveProperty('bradenSubscores');
  });

  it('저장 결과 — 자동 일정을 만든 유형과 건너뛴 이유를 보인다', async () => {
    routes('TOTAL');
    post.mockResolvedValue({ data: { id: 'na1', autoSchedules: { enabled: true, created: ['PRESSURE_ULCER'], skipped: [{ type: 'FALL_RISK', reason: 'EXISTS' }] } } });
    const { container } = render(<Page params={PARAMS} />, { wrapper: wrap });
    await waitFor(() => expect(container.querySelector('input[type="number"][max="23"]')).toBeTruthy());
    fillRequired(container);
    fireEvent.click(saveBtn(container));
    await waitFor(() => expect(container.querySelector('[data-auto-schedule-result]')).toBeTruthy());
    expect(container.querySelector('[data-auto-schedule-result]')!.textContent).toContain('욕창');
    expect(container.querySelector('[data-auto-schedule-skip="FALL_RISK:EXISTS"]')).toBeTruthy();
  });
});

describe('재평가 관리 — 자동 일정 결정 상태', () => {
  const src = readFileSync(join(__dirname, '../../src/app/(main)/admin/risk-reassessment/page.tsx'), 'utf8');
  it('켜짐/꺼짐/모름 세 갈래 · 결정 화면 링크 · 모름을 꺼짐으로 그리지 않는다', () => {
    expect(src).toContain('data-auto-schedule-policy');
    expect(src).toContain("const AUTO_SCHEDULE_DECISION_KEY = 'nursing.reassessment.autoScheduleOnAdmission'");
    expect(src).toContain('/admin/decisions/${encodeURIComponent(AUTO_SCHEDULE_DECISION_KEY)}');
    expect(src).toMatch(/if \(v === false\)[\s\S]{0,120}"off"[\s\S]{0,200}"unknown"/);
  });
});
