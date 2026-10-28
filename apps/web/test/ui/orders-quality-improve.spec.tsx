/**
 * CPOE 질 관리 심화 화면(2026-10-07) — 경고 부담 · 개선 활동(PDCA).
 *  · 경고 부담: 유형 라벨 · 옛 형식은 '유형 미기록' · 표본 0 은 그렇다고
 *  · 효과 표시: 바람직/바람직하지 않음은 등재 방향일 때만 · 구간이 0 포함이면 "변화 확인 불가" · 작은 표본 표시 · 확인 전
 *  · 시작 폼: 기간·글만 보낸다(수는 서버가 센다) · 필수 비면 못 누름 · 관리도 신호에서 오면 그 달을 넘긴다
 *  · 상세: 정해진 다음 단계 버튼만 · 의사는 쓰기 버튼 없음 · 효과 확인은 실행 이후 단계만 · 기간만 보낸다
 *  · 의사에게는 '개선 활동 시작' 이 없다
 * 재주입: 위 규칙 하나를 되돌리면 실패한다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuthStore } from '@/stores/auth-store';

const get = vi.fn();
const post = vi.fn();
vi.mock('@/lib/api-client', async (orig) => ({ ...(await orig<object>()), apiClient: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a), patch: vi.fn(), getToken: () => 'x' } }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => '/orders', useSearchParams: () => new URLSearchParams() }));
const wrap = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>;
const role = (r: string) => useAuthStore.setState({ user: { id: 'u1', role: r } as never, isAuthenticated: true });

const diff = (o: Record<string, unknown>) => ({ before: 0.3, after: 0.15, diff: -0.15, low: -0.19, high: -0.11, includesZero: false, small: false, ...o });
const detail = (status: string) => ({
  id: 'a1', indicatorKey: 'NO_DIAGNOSIS', title: '상병 연결 개선', status, problem: '관리도 신호 2026-07', rootCause: null, plan: '처방 창 안내',
  ownerId: 'u2', createdBy: 'u1', dueDate: null, triggerPeriod: '2026-07',
  baselineFrom: '2026-07-31T15:00:00.000Z', baselineTo: '2026-08-31T15:00:00.000Z', baselineNumerator: 300, baselineDenominator: 1000,
  names: { u1: '관리자', u2: '박내과' },
  events: [{ id: 'e1', kind: 'CREATED', fromStatus: null, toStatus: 'PLAN', note: null, checkFrom: null, checkTo: null, checkNumerator: null, checkDenominator: null, actorId: 'u1', at: '2026-10-07T00:00:00Z' }],
  effect: null,
});

beforeEach(() => { cleanup(); get.mockReset(); post.mockReset(); });

describe('경고 부담', () => {
  it('🔴 유형 라벨 · 옛 형식은 "유형 미기록" · 사유 없는 무시 · CDSS 표본 0 은 그렇다고', async () => {
    role('ADMIN');
    get.mockResolvedValue({ data: {
      truncated: {}, dur: { warnedPrescriptions: 3, overridden: 1, overriddenNoReason: 1,
        byType: [{ type: 'INTERACTION', prescriptions: 2, alerts: 3, overridden: 1, overriddenNoReason: 1 }, { type: 'UNTYPED', prescriptions: 1, alerts: 1, overridden: 0, overriddenNoReason: 0 }],
        topDrugs: [{ name: '와파린', prescriptions: 2, overridden: 1, types: ['INTERACTION'] }] },
      cdss: { logs: 0, byLevel: [] } } });
    const { QualityAlertsSection } = await import('@/app/(main)/orders/QualityAlertsSection');
    const { container } = render(<QualityAlertsSection query="from=2026-09-01&to=2026-09-30" />, { wrapper: wrap });
    await waitFor(() => expect(container.querySelector('[data-qi-alert-type="INTERACTION"]')).toBeTruthy());
    expect(get).toHaveBeenCalledWith('/api/v1/orders/quality/alerts?from=2026-09-01&to=2026-09-30');
    expect(container.querySelector('[data-qi-alert-type="INTERACTION"]')!.textContent).toContain('병용 상호작용');
    expect(container.querySelector('[data-qi-alert-type="UNTYPED"]')!.textContent).toContain('유형 미기록');
    expect(container.querySelector('[data-qi-alert-cdss]')!.textContent).toContain('CDSS 점검 기록이 없습니다');
  });
});

describe('효과 표시', () => {
  it('🔴 바람직/아님은 방향이 있을 때만 · 0 포함은 "변화 확인 불가" · 작은 표본 · 확인 전', async () => {
    const { EffectText } = await import('@/app/(main)/orders/QualityImprovements');
    const r = (e: unknown) => render(<EffectText effect={e as never} />, { wrapper: wrap }).container.querySelector('[data-qi-effect]')!;
    expect(r({ diff: diff({}), direction: 'LOWER_IS_BETTER', favorable: true }).getAttribute('data-qi-effect')).toBe('favorable');
    cleanup();
    expect(r({ diff: diff({}), direction: 'LOWER_IS_BETTER', favorable: false }).textContent).toContain('바람직하지 않은 쪽');
    cleanup();
    const unclear = r({ diff: diff({ low: -0.2, high: 0.05, includesZero: true, small: true }), direction: 'LOWER_IS_BETTER', favorable: null });
    expect(unclear.textContent).toContain('변화 확인 불가');
    expect(unclear.textContent).toContain('표본 작음');
    cleanup();
    expect(r({ diff: diff({}), direction: null, favorable: null }).textContent).toContain('방향 미정');
    cleanup();
    expect(r(null).textContent).toContain('효과 확인 전');
  });
});

describe('개선 활동 시작 폼', () => {
  it('🔴 필수 비면 못 누름 · 기간·글만 보낸다(수 없음) · 관리도 신호 달을 넘긴다', async () => {
    role('ADMIN');
    get.mockResolvedValue({ data: [] });
    post.mockResolvedValue({ data: {} });
    const { ImprovementCreateForm } = await import('@/app/(main)/orders/QualityImprovements');
    const { container, getByLabelText } = render(<ImprovementCreateForm indicatorKey="NO_DIAGNOSIS" triggerPeriod="2026-07" defaultFrom="2026-08-01" defaultTo="2026-08-31" onClose={() => {}} />, { wrapper: wrap });
    const submit = container.querySelector('[data-qi-improve-submit]') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.change(getByLabelText('제목'), { target: { value: '상병 연결' } });
    fireEvent.change(getByLabelText('개선 계획'), { target: { value: '처방 창 안내' } });
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);
    await waitFor(() => expect(post).toHaveBeenCalled());
    const [url, body] = post.mock.calls[0];
    expect(url).toBe('/api/v1/orders/quality/improvements');
    expect(body).toMatchObject({ indicatorKey: 'NO_DIAGNOSIS', baselineFrom: '2026-08-01', baselineTo: '2026-08-31', triggerPeriod: '2026-07' });
    expect(body.problem).toContain('2026-07');
    expect(Object.keys(body).some((k) => /numerator|denominator/i.test(k))).toBe(false);
  });
});

describe('개선 활동 상세', () => {
  async function open(r: string, status: string) {
    role(r);
    get.mockImplementation((url: string) => Promise.resolve({ data: url.endsWith('/improvements/a1') ? detail(status) : url.includes('/improvements')
      ? [{ ...detail(status), ownerName: '박내과', lastCheck: null }] : [] }));
    const { ImprovementsSection } = await import('@/app/(main)/orders/QualityImprovements');
    const utils = render(<ImprovementsSection />, { wrapper: wrap });
    await waitFor(() => expect(utils.container.querySelector('[data-qi-improvement="a1"]')).toBeTruthy());
    fireEvent.click(utils.container.querySelector('[data-qi-improvement="a1"] button')!);
    await waitFor(() => expect(utils.container.querySelector('[data-qi-improve-detail="a1"]')).toBeTruthy());
    return utils;
  }

  it('🔴 정해진 다음 단계만 · 계획 단계엔 효과 확인 폼 없음', async () => {
    const { container } = await open('ADMIN', 'PLAN');
    const steps = [...container.querySelectorAll('[data-qi-transit]')].map((b) => b.getAttribute('data-qi-transit'));
    expect(steps).toEqual(['DO', 'CANCELLED']);
    expect(container.querySelector('[data-qi-check-form]')).toBeNull();
  });

  it('🔴 실행 단계 — 효과 확인은 기간만 보낸다', async () => {
    post.mockResolvedValue({ data: {} });
    const { container, getByLabelText } = await open('ADMIN', 'DO');
    fireEvent.change(getByLabelText('효과 확인 시작일'), { target: { value: '2026-09-01' } });
    fireEvent.change(getByLabelText('효과 확인 종료일'), { target: { value: '2026-09-30' } });
    fireEvent.click(container.querySelector('[data-qi-check-run]')!);
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/v1/orders/quality/improvements/a1/checks', { from: '2026-09-01', to: '2026-09-30' }));
  });

  it('🔴 의사는 읽기만 — 단계·메모·효과 확인 버튼 없음', async () => {
    const { container } = await open('DOCTOR', 'DO');
    expect(container.querySelector('[data-qi-transit]')).toBeNull();
    expect(container.querySelector('[data-qi-check-form]')).toBeNull();
    expect(container.querySelector('[data-qi-improve-events]')).toBeTruthy();
  });
});
