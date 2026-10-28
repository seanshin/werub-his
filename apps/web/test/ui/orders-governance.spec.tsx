/**
 * 오더 위원회 기준 점검 패널(2026-10-06).
 *  · 권한 밖 역할은 부르지 않는다
 *  · 위원회별 카드 · 근거 3상태 배지(의결 번호 / 담당만 / 미지정) · 값은 출처와 함께(기본값은 "기본값")
 *  · 점검: 분자/분모 · 해당 오더 펼침 · 분모 0 은 산출 불가 · 기준 미설정은 "점검하지 않았습니다" · 셀 기록 없음은 "기준 표시만"
 * 재주입: 위 규칙 하나를 되돌리면 실패한다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuthStore } from '@/stores/auth-store';

const get = vi.fn();
vi.mock('@/lib/api-client', async (orig) => ({ ...(await orig<object>()), apiClient: { get: (...a: unknown[]) => get(...a), getToken: () => 'x' } }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => '/orders', useSearchParams: () => new URLSearchParams() }));
const wrap = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>;

const std = (over: Record<string, unknown>) => ({
  surfaceKey: 'config:x', label: 'DUR 게이트(병용·임부 금기 등)', depts: ['PHARMACY'], checkKind: null,
  value: { value: 'BLOCK', source: 'db' }, basis: { state: 'NOT_GOVERNED', owners: [], decisions: 0, latest: null }, check: { state: 'NO_CHECK' }, ...over,
});
const data = {
  date: '2026-10-06', now: '2026-10-06T03:00:00.000Z', truncated: false, total: 10,
  committees: [
    { code: 'DTC', name: '약사위원회', standards: [
      std({ surfaceKey: 'config:dur.enforce', checkKind: 'DUR_OVERRIDE',
        basis: { state: 'DECIDED', owners: [{ code: 'DTC', name: '약사위원회' }], decisions: 2, latest: { source: 'COMMITTEE', registryKey: null, decisionNo: 'GOV-2026-003', status: 'ENACTED', resolvedAt: '2026-08-01T00:00:00Z', resolution: 'LAB 만 WARN 으로 시행' } },
        check: { state: 'CHECKED', numerator: 1, denominator: 3, offendersTruncated: false, offenders: [{ id: 'o1', department: 'PHARMACY', name: '와파린', priority: 'STAT', phase: 'WAITING', patient: { id: 'p1', name: '김하나', mrn: 'M1' }, sinceOrderedMin: 40 }] } }),
      std({ surfaceKey: 'config:formulary.enforce', label: '원내 처방집 시행', value: { value: {}, source: 'default' }, basis: { state: 'NO_DECISION', owners: [{ code: 'DTC', name: '약사위원회' }], decisions: 0, latest: null } }),
    ] },
    { code: 'QPS', name: '질향상·환자안전위원회', standards: [
      std({ surfaceKey: 'config:orders.tracking.attentionMin', label: '오더 처리 주의 기준(긴급도별 분)', checkKind: 'ATTENTION', value: { value: null, source: 'default' }, basis: { state: 'NO_DECISION', owners: [{ code: 'QPS', name: '질향상·환자안전위원회' }], decisions: 0, latest: null }, check: { state: 'UNSET' } }),
      std({ surfaceKey: 'master:reference-range', label: '검사 참고치·위급값 범위', checkKind: 'CRITICAL_UNACK', value: null, basis: { state: 'NO_DECISION', owners: [{ code: 'QPS', name: '질향상·환자안전위원회' }], decisions: 0, latest: null }, check: { state: 'CHECKED', numerator: 0, denominator: 0, offenders: [], offendersTruncated: false } }),
    ] },
  ],
  unassigned: [std({ surfaceKey: 'config:imaging.pregnancyEnforce', label: '영상 임신 확인', depts: ['IMAGING'], value: { value: 'OFF', source: 'default' } })],
  summary: { standards: 5, decided: 1, noDecision: 3, notGoverned: 1, checked: 2, unset: 1, withFindings: 1 },
};

beforeEach(() => { cleanup(); get.mockReset(); useAuthStore.setState({ user: { id: 'u1', role: 'PHARMACIST' } as never, isAuthenticated: true }); });

async function mount() {
  get.mockImplementation((url: string) => Promise.resolve({ data: url.includes('/governance/agendas') ? [] : data }));
  const { OrderGovernancePanel } = await import('@/app/(main)/orders/OrderGovernancePanel');
  return render(<OrderGovernancePanel date="2026-10-06" />, { wrapper: wrap });
}

describe('오더 위원회 기준 점검 패널', () => {
  it('🔴 권한 밖 역할은 부르지 않는다', async () => {
    useAuthStore.setState({ user: { id: 'r', role: 'RECEPTIONIST' } as never, isAuthenticated: true });
    await mount();
    expect(get).not.toHaveBeenCalled();
  });

  it('🔴 위원회별 카드 · 근거 3상태 · 값 출처(기본값은 기본값) · 의결 주문 인용', async () => {
    const { container } = await mount();
    await waitFor(() => expect(container.querySelector('[data-gov-panel]')).toBeTruthy());
    expect(get).toHaveBeenCalledWith('/api/v1/orders/governance-check?date=2026-10-06');
    expect(container.querySelector('[data-gov-committee="DTC"]')!.textContent).toContain('약사위원회');
    const dur = container.querySelector('[data-gov-standard="config:dur.enforce"]')!;
    expect(dur.querySelector('[data-gov-basis="DECIDED"]')!.textContent).toContain('GOV-2026-003');
    expect(dur.textContent).toContain('설정됨');
    expect(dur.textContent).toContain('LAB 만 WARN 으로 시행');
    const form = container.querySelector('[data-gov-standard="config:formulary.enforce"]')!;
    expect(form.querySelector('[data-gov-basis="NO_DECISION"]')).toBeTruthy();
    expect(form.textContent).toContain('기본값');
    expect(form.textContent).toContain('값 없음');
    expect(container.querySelector('[data-gov-committee="UNASSIGNED"] [data-gov-basis="NOT_GOVERNED"]')).toBeTruthy();
  });

  it('🔴 점검 — 분자/분모·해당 오더 펼침 · 분모 0 은 산출 불가 · 기준 미설정·점검 없음을 그대로 말한다', async () => {
    const { container } = await mount();
    await waitFor(() => expect(container.querySelector('[data-gov-panel]')).toBeTruthy());
    const dur = container.querySelector('[data-gov-standard="config:dur.enforce"] [data-gov-check="CHECKED"]')!;
    expect(dur.textContent).toContain('1 / 3');
    expect(dur.querySelector('[data-gov-offenders]')).toBeNull();
    fireEvent.click(dur.querySelector('button')!);
    expect(dur.querySelector('[data-gov-offenders]')!.textContent).toContain('와파린');
    expect(container.querySelector('[data-gov-standard="master:reference-range"]')!.textContent).toMatch(/산출 불가.*해당 오더 없음/);
    expect(container.querySelector('[data-gov-standard="config:orders.tracking.attentionMin"] [data-gov-check="UNSET"]')).toBeTruthy();
    expect(container.querySelector('[data-gov-standard="config:imaging.pregnancyEnforce"] [data-gov-check="NO_CHECK"]')).toBeTruthy();
  });
});
