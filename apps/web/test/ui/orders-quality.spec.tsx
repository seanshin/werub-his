/**
 * CPOE 질 지표 탭(2026-10-07).
 *  · 권한 밖(간호사·원무)은 부르지 않는다 · 의사는 본인 범위(처방의 필터 안 보냄·처방의별 표·월 기록 없음)
 *  · 분모 0 = "산출 불가" · 원장 등재 지표만 충족/미충족 · 미등재 관찰 지표는 방향을 지어내지 않는다
 *  · 지금 상태 기준 지표는 그 사실을 말한다 · 잘렸으면 말한다
 *  · 문제 건 환자 → 드릴다운 서랍 · 관리자 월 기록은 key·period 만 보낸다(수는 서버가 센다) · 처방의 행 → 좁히기
 * 재주입: 위 규칙 하나를 되돌리면 실패한다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CPOE_QI_DEFS } from '@hospital-run/shared';
import { useAuthStore } from '@/stores/auth-store';

const get = vi.fn();
const post = vi.fn();
vi.mock('@/lib/api-client', async (orig) => ({ ...(await orig<object>()), apiClient: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a), patch: vi.fn(), getToken: () => 'x' } }));
vi.mock('@/components/clinical/allergy-status', () => ({ AllergyStatusBadge: () => <span /> }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => '/orders', useSearchParams: () => new URLSearchParams() }));
const wrap = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>;

const ind = (key: string, over: Record<string, unknown> = {}) => ({
  key, numerator: 0, denominator: 0, value: null, offenders: null, trend: [{ start: '', numerator: 0, denominator: 0 }, { start: '', numerator: 1, denominator: 2 }],
  strata: { setting: { OUTPATIENT: { numerator: 0, denominator: 0 }, INPATIENT: { numerator: 0, denominator: 0 }, ER: { numerator: 0, denominator: 0 }, UNKNOWN: { numerator: 0, denominator: 0 } }, department: [] },
  qi: { registered: false, name: key, direction: null, directionSource: null }, ...over,
});
const quality = (over: Record<string, unknown> = {}) => ({
  period: { from: '', to: '', fromDate: '2026-09-08', toDate: '2026-10-07' },
  scope: { prescriberId: null, hospitalWide: true },
  truncated: { prescriptions: false, orders: false, interventions: false, cdss: false, criticals: false },
  totals: { prescriptions: 40, orders: 30, interventions: 0, cdss: 0, criticals: 2 },
  ackTimes: [{ kind: 'RESULT', median: null, p90: null, n: 0 }, { kind: 'CRITICAL', median: 12, p90: 30, n: 2 }],
  indicators: CPOE_QI_DEFS.map((d) => {
    if (d.key === 'NO_DIAGNOSIS') return ind(d.key, {
      numerator: 4, denominator: 10, value: 0.4,
      strata: { setting: { OUTPATIENT: { numerator: 3, denominator: 6 }, INPATIENT: { numerator: 0, denominator: 0 }, ER: { numerator: 0, denominator: 0 }, UNKNOWN: { numerator: 1, denominator: 4 } }, department: [{ department: '내과', numerator: 3, denominator: 8 }, { department: null, numerator: 1, denominator: 2 }] },
      offenders: { total: 4, items: [{ id: 'r1', kind: 'RX', at: '2026-10-01T01:00:00Z', patientId: 'p1', name: '아스피린', prescriber: 'd1' }] },
      qi: { registered: true, indicatorId: 'qi1', name: 'x', target: 10, unit: '%', valueScale: 100, direction: 'LOWER_IS_BETTER', directionSource: 'REGISTRY', current: { value: 40, meetTarget: false }, latest: { period: '2026-08', value: 12, meetTarget: false } },
    });
    if (d.key === 'RESULT_UNACK') return ind(d.key, { numerator: 1, denominator: 5, value: 0.2, offenders: { total: 1, items: [] } });
    return ind(d.key);
  }),
  tat: [{ department: 'LAB', priority: 'STAT', median: 45, p90: 90, n: 3 }, { department: 'LAB', priority: 'ROUTINE', median: null, p90: null, n: 0 }],
  byPrescriber: [{ prescriber: 'd1', prescriptions: 10, durOverridden: 1, durOverrideNoReason: 1, verbal: 0, verbalUncosigned: 0, noDiagnosis: 4, discontinueNoReason: 0, resultUnack: 1, criticalUnack: 2 }],
  names: { patients: { p1: { name: 'Бат-Эрдэнэ Сарнай', koreanName: '사르나이', mrn: 'FT-4' } }, users: { d1: { name: '박내과', department: '내과' } } },
  ...over,
});

const ALERTS = { truncated: {}, dur: { warnedPrescriptions: 0, overridden: 0, overriddenNoReason: 0, byType: [], topDrugs: [] }, cdss: { logs: 0, byLevel: [] } };
beforeEach(() => { cleanup(); get.mockReset(); post.mockReset(); });
const spcPoint = (period: string, numerator: number, denominator: number, extra: Record<string, unknown> = {}) => ({ period, numerator, denominator, p: denominator ? numerator / denominator : null, ucl: denominator ? 0.3 : null, lcl: denominator ? 0 : null, signal: null, ...extra });
const spc = (over: Record<string, unknown> = {}) => ({
  key: 'NO_DIAGNOSIS', months: 12, scope: { prescriberId: null, hospitalWide: true }, truncated: {},
  chart: { center: 0.1, degenerate: false, basis: { months: 3, numerator: 3, denominator: 30 },
    points: [spcPoint('2026-08', 1, 10), spcPoint('2026-09', 5, 10, { signal: 'OUTSIDE' }), spcPoint('2026-10', 1, 4, { partial: true })] },
  target: { value: 0.1, direction: 'LOWER_IS_BETTER' }, ...over,
});
async function panel(role: string, data: unknown, spcData: unknown = spc()) {
  useAuthStore.setState({ user: { id: 'u1', role } as never, isAuthenticated: true });
  get.mockImplementation((url: string) => Promise.resolve({ data:
    url.includes('/tracking/patient/') ? null
      : url.includes('/quality/spc') ? spcData
        : url.includes('/governance/agendas') ? []
        : url.includes('/quality/alerts') ? ALERTS
          : url.includes('/quality/improvements') ? []
            : url.startsWith('/api/v1/users') ? []
              : data }));
  const { OrderQualityPanel } = await import('@/app/(main)/orders/OrderQualityPanel');
  return render(<OrderQualityPanel />, { wrapper: wrap });
}
const card = (c: HTMLElement, k: string) => c.querySelector(`[data-qi-card="${k}"]`)!;

describe('CPOE 질 지표 탭', () => {
  it('🔴 권한 밖(간호사)은 부르지 않는다', async () => {
    const { container } = await panel('NURSE', quality());
    expect(container.textContent).toContain('의사(본인 처방)·관리자가 봅니다');
    expect(get).not.toHaveBeenCalled();
  });

  it('🔴 의사 — 처방의 필터를 보내지 않고 "내 처방" · 처방의별 표·월 기록 없음', async () => {
    const { container } = await panel('DOCTOR', quality({ scope: { prescriberId: 'u1', hospitalWide: false }, byPrescriber: null }));
    await waitFor(() => expect(container.querySelector('[data-qi-scope]')).toBeTruthy());
    expect(get.mock.calls[0][0]).toMatch(/^\/api\/v1\/orders\/quality\?from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}$/);
    expect(container.querySelector('[data-qi-scope]')!.textContent).toContain('내 처방');
    expect(container.querySelector('[data-qi-prescribers]')).toBeNull();
    expect(container.querySelector('[data-qi-record]')).toBeNull();
    // 개선 활동 시작은 관리자(서버 @Roles(ADMIN)) — 의사에겐 없다
    expect(container.querySelector('[data-qi-improve-open]')).toBeNull();
  });

  it('🔴 분모 0 = 산출 불가 · 등재 지표만 충족/미충족 · 미등재 관찰 지표는 "방향 미정"', async () => {
    const { container } = await panel('ADMIN', quality());
    await waitFor(() => expect(container.querySelector('[data-qi-card]')).toBeTruthy());
    expect(card(container, 'DUR_OVERRIDE_RATE').querySelector('[data-qi-value]')!.textContent).toContain('산출 불가');
    expect(card(container, 'NO_DIAGNOSIS').querySelector('[data-qi-improve-open]')).toBeTruthy(); // 대조군 — 관리자에겐 있다
    expect(card(container, 'DUR_OVERRIDE_RATE').querySelector('[data-qi-meet]')).toBeNull();
    expect(card(container, 'DUR_OVERRIDE_RATE').querySelector('[data-qi-ledger="unregistered"]')!.textContent).toContain('방향 미정');
    expect(card(container, 'NO_DIAGNOSIS').querySelector('[data-qi-value]')!.textContent).toContain('4');
    expect(card(container, 'NO_DIAGNOSIS').querySelector('[data-qi-meet="unmet"]')).toBeTruthy();
    expect(card(container, 'RESULT_UNACK').querySelector('[data-qi-asof]')).toBeTruthy();
    expect(card(container, 'NO_DIAGNOSIS').querySelector('[data-qi-asof]')).toBeNull();
    expect(container.querySelector('[data-qi-tat-cell="LAB-ROUTINE"]')!.textContent).toContain('표본 없음');
  });

  it('🔴 잘렸으면 말한다 · 대조군: 안 잘렸으면 말하지 않는다', async () => {
    const a = await panel('ADMIN', quality({ truncated: { prescriptions: true, orders: false, interventions: false, cdss: false } }));
    await waitFor(() => expect(a.container.querySelector('[data-qi-truncated]')).toBeTruthy());
    cleanup();
    const b = await panel('ADMIN', quality());
    await waitFor(() => expect(b.container.querySelector('[data-qi-scope]')).toBeTruthy());
    expect(b.container.querySelector('[data-qi-truncated]')).toBeNull();
  });

  it('🔴 문제 건 환자 → 드릴다운 서랍', async () => {
    const { container } = await panel('ADMIN', quality());
    await waitFor(() => expect(container.querySelector('[data-qi-card="NO_DIAGNOSIS"]')).toBeTruthy());
    fireEvent.click(card(container, 'NO_DIAGNOSIS').querySelector('[data-qi-offenders-toggle]')!);
    expect(container.querySelector('[data-qi-offenders="NO_DIAGNOSIS"]')!.textContent).toContain('사르나이');
    fireEvent.click(container.querySelector('[data-qi-patient="p1"]')!);
    await waitFor(() => expect(get).toHaveBeenCalledWith('/api/v1/orders/tracking/patient/p1'));
  });

  it('🔴 관리자 월 기록 — 등재 지표만 · key·period 만 보낸다', async () => {
    post.mockResolvedValue({ data: {} });
    const { container } = await panel('ADMIN', quality());
    await waitFor(() => expect(container.querySelector('[data-qi-record="NO_DIAGNOSIS"]')).toBeTruthy());
    expect(container.querySelector('[data-qi-record="DUR_OVERRIDE_RATE"]')).toBeNull();
    fireEvent.click(container.querySelector('[data-qi-record="NO_DIAGNOSIS"] button')!);
    await waitFor(() => expect(post).toHaveBeenCalled());
    const [url, body] = post.mock.calls[0];
    expect(url).toBe('/api/v1/orders/quality/measurements');
    expect(Object.keys(body).sort()).toEqual(['key', 'period']);
    expect(body).toMatchObject({ key: 'NO_DIAGNOSIS', period: expect.stringMatching(/^\d{4}-\d{2}$/) });
  });

  it('처방의 행을 누르면 그 처방의로 좁혀 다시 부른다', async () => {
    const { container } = await panel('ADMIN', quality());
    await waitFor(() => expect(container.querySelector('[data-qi-prescriber="d1"]')).toBeTruthy());
    fireEvent.click(container.querySelector('[data-qi-prescriber="d1"]')!);
    await waitFor(() => expect(get.mock.calls.some((c) => String(c[0]).includes('prescriberId=d1'))).toBe(true));
  });

  it('🔴 유형·진료과별 — 진료 유형 미기록·진료과 미상을 그대로 말한다 · 대상 0 층은 싣지 않는다', async () => {
    const { container } = await panel('ADMIN', quality());
    await waitFor(() => expect(container.querySelector('[data-qi-card="NO_DIAGNOSIS"]')).toBeTruthy());
    fireEvent.click(card(container, 'NO_DIAGNOSIS').querySelector('[data-qi-strata-toggle]')!);
    const st = container.querySelector('[data-qi-strata="NO_DIAGNOSIS"]')!;
    expect(st.querySelector('[data-qi-stratum="UNKNOWN"]')!.textContent).toContain('진료 유형 미기록');
    expect(st.querySelector('[data-qi-stratum="INPATIENT"]')).toBeNull();
    expect(st.textContent).toContain('진료과 미상');
    expect(card(container, 'DUR_OVERRIDE_RATE').querySelector('[data-qi-strata-toggle]')).toBeNull();
  });

  it('🔴 관리도 — 지표 EP 호출 · 신호 점·진행 중인 달 빈 점 · 원장 목가상읍 · 신호는 판정이 아니라고 말한다', async () => {
    const { container } = await panel('ADMIN', quality());
    await waitFor(() => expect(container.querySelector('[data-qi-spc-open="NO_DIAGNOSIS"]')).toBeTruthy());
    fireEvent.click(container.querySelector('[data-qi-spc-open="NO_DIAGNOSIS"]')!);
    await waitFor(() => expect(container.querySelector('[data-qi-spc-chart]')).toBeTruthy());
    expect(get.mock.calls.some((c) => c[0] === '/api/v1/orders/quality/spc?key=NO_DIAGNOSIS&months=12')).toBe(true);
    expect(container.querySelector('[data-qi-spc-point="2026-09"]')!.getAttribute('data-signal')).toBe('OUTSIDE');
    expect(container.querySelector('[data-qi-spc-point="2026-10"]')!.getAttribute('fill')).toBe('#fff');
    expect(container.querySelector('[data-qi-spc-target]')).toBeTruthy();
    expect(container.querySelector('[data-qi-spc-signals]')!.textContent).toContain('결함 판정이 아닙니다');
  });

  it('🔴 관리도 — 한계를 못 그리면(degenerate) 신호를 내지 않는다 · 목표 없으면 목가상읍 없음', async () => {
    const { container } = await panel('ADMIN', quality(), spc({ target: null, chart: { center: 0, degenerate: true, basis: { months: 2, numerator: 0, denominator: 20 }, points: [spcPoint('2026-09', 0, 10, { ucl: null, lcl: null })] } }));
    await waitFor(() => expect(container.querySelector('[data-qi-spc-open="NO_DIAGNOSIS"]')).toBeTruthy());
    fireEvent.click(container.querySelector('[data-qi-spc-open="NO_DIAGNOSIS"]')!);
    await waitFor(() => expect(container.querySelector('[data-qi-spc-degenerate]')).toBeTruthy());
    expect(container.querySelector('[data-qi-spc-signals]')).toBeNull();
    expect(container.querySelector('[data-qi-spc-target]')).toBeNull();
  });

  it('결과 확인 소요 — 표본 없으면 "표본 없음"(0 분이 아니다)', async () => {
    const { container } = await panel('ADMIN', quality());
    await waitFor(() => expect(container.querySelector('[data-qi-ack="RESULT"]')).toBeTruthy());
    expect(container.querySelector('[data-qi-ack="RESULT"]')!.textContent).toContain('표본 없음');
    expect(container.querySelector('[data-qi-ack="CRITICAL"]')!.textContent).not.toContain('표본 없음');
  });
});
