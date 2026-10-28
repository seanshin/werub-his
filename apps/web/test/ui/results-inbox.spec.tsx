/**
 * 검사결과 확인함·위급값 상향 배너·알림 센터 실패 상태 — 2026-09-30.
 *
 *  1. 확인 EP 는 있었는데 부르는 화면이 없었다 → /results-inbox(1011): 실패는 실패로, 확인하면 줄어든다
 *  2. 대시보드 '검사결과 도착'이 병원 전체 결과를 "내 결과"처럼 보였다(서버가 mine 을 무시) → 의사는 확인함 EP
 *  3. 상향된 위급값이 남에게 안 보였다 → 배너가 "다른 담당의 경보"를 표시하고, 확인 권한은 서버 판정을 따른다
 *  4. /notifications 가 조회 실패를 "알림이 없습니다"로 그렸다 → 실패 상태 + 다시 시도 · 알림이 그 건으로 이동
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const get = vi.fn();
const patch = vi.fn();
const post = vi.fn();
vi.mock('@/lib/api-client', async (orig) => ({
  ...(await orig<object>()),
  apiClient: {
    get: (...a: unknown[]) => get(...a),
    patch: (...a: unknown[]) => patch(...a),
    post: (...a: unknown[]) => post(...a),
    getToken: () => null,
  },
}));
vi.mock('next/link', () => ({ default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => <a href={href} className={className}>{children}</a> }));
let search = new URLSearchParams();
vi.mock('next/navigation', () => ({
  useSearchParams: () => search,
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/results-inbox',
}));

import { useAuthStore } from '@/stores/auth-store';
import { useNotificationStore, hrefForNotification } from '@/stores/notification-store';

const wrap = (ui: React.ReactElement) =>
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);

const P = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', familyName: '홍', givenName: '길동', mrn: 'M1' };
const item = (o: Partial<Record<string, unknown>> = {}) => ({
  orderId: 'o-1', department: 'LAB', priority: 'ROUTINE', completedAt: new Date().toISOString(), severity: 'CRITICAL',
  testName: '전해질', testCode: 'C1', patient: P, encounterId: 'e1', orderedByMe: true,
  lab: { resultId: 'lr1', status: 'COMPLETED', verifiedAt: null, itemCount: 3, flaggedItems: [{ testName: 'K', value: '7.1', unit: 'mmol/L', flag: 'HH' }], unjudgedCount: 0 },
  imaging: null, ...o,
});
const inbox = (items: unknown[], total = items.length) => ({
  data: { scope: 'MINE', patientId: null, total, counts: { critical: 1, abnormal: 0, other: total - 1 }, offset: 0, limit: 50, items },
});

beforeEach(() => {
  cleanup();
  get.mockReset(); patch.mockReset(); post.mockReset();
  search = new URLSearchParams();
  useAuthStore.setState({ user: { id: 'u1', role: 'DOCTOR', email: 'x@y', name: 'x' } as never });
});

describe('1. 검사결과 확인함 화면', () => {
  it('🔴 조회 실패는 "확인할 결과가 없습니다"가 아니라 실패로', async () => {
    get.mockRejectedValue(new Error('서버 오류'));
    const { default: Page } = await import('@/app/(main)/results-inbox/page');
    const { container } = wrap(<Page />);
    await vi.waitFor(() => expect(container.textContent).toMatch(/재시도|서버 오류/), { timeout: 3000 });
    expect(container.textContent).not.toContain('확인할 결과가 없습니다');
  });

  it('내 오더 EP 를 부르고, 위급을 표시하고, 차트로 가는 링크가 있다', async () => {
    get.mockResolvedValue(inbox([item()]));
    const { default: Page } = await import('@/app/(main)/results-inbox/page');
    const { container } = wrap(<Page />);
    await screen.findByText('전해질');
    expect(get.mock.calls[0][0]).toMatch(/^\/api\/v1\/doctors\/results-inbox\?limit=50&offset=0$/);
    // 2026-10-07 차트의 그 결과 탭으로(검사 → labresults)
    expect(container.querySelector(`a[href="/patients/${P.id}?tab=labresults"]`)).toBeTruthy();
    expect(container.textContent).toContain('위급');
    expect(container.textContent).toContain('예비(검증 전)');
  });

  it('센서스에서 온 환자 지정(?patientId=)을 서버에 그대로 넘긴다', async () => {
    search = new URLSearchParams({ patientId: P.id });
    get.mockResolvedValue(inbox([item()]));
    const { default: Page } = await import('@/app/(main)/results-inbox/page');
    wrap(<Page />);
    await screen.findByText('전해질');
    expect(get.mock.calls[0][0]).toContain(`patientId=${P.id}`);
    expect(screen.getByText(/이 환자의 미확인 결과 전부/)).toBeTruthy();
  });

  it('자르면 자른다고 — 전체 N건 중 몇 번째인지 말한다', async () => {
    get.mockResolvedValue(inbox([item()], 120));
    const { default: Page } = await import('@/app/(main)/results-inbox/page');
    const { container } = wrap(<Page />);
    await screen.findByText('전해질');
    expect(container.textContent).toMatch(/전체 120건 중 1–1번째/);
  });

  it('단건 확인은 확인 EP 를, 일괄 확인은 일괄 EP 를 부른다', async () => {
    get.mockResolvedValue(inbox([item(), item({ orderId: 'o-2', severity: 'NORMAL', lab: { resultId: 'lr2', status: 'VERIFIED', verifiedAt: null, itemCount: 2, flaggedItems: [], unjudgedCount: 0 } })]));
    patch.mockResolvedValue({ data: {} });
    post.mockResolvedValue({ data: { requested: 2, acknowledged: 2, skipped: 0 } });
    const { default: Page } = await import('@/app/(main)/results-inbox/page');
    wrap(<Page />);
    await screen.findAllByText('전해질');
    fireEvent.click(screen.getAllByText('확인함')[0]);
    await vi.waitFor(() => expect(patch).toHaveBeenCalledWith('/api/v1/doctors/orders/o-1/acknowledge', {}));
    fireEvent.click(screen.getByLabelText('전체 선택'));
    fireEvent.click(screen.getByText(/선택 2건 확인/));
    await vi.waitFor(() => expect(post).toHaveBeenCalledWith('/api/v1/doctors/orders/acknowledge', { orderIds: ['o-1', 'o-2'] }));
  });
});

describe('2. 대시보드 검사결과 도착 위젯', () => {
  it('🔴 의사는 확인함 EP 를 부른다 — 서버가 무시하던 mine=true 목록을 "내 결과"로 쓰지 않는다', async () => {
    get.mockResolvedValue(inbox([item()], 7));
    const { default: W } = await import('@/app/(main)/dashboard/components/widgets/LabResultsWidget');
    const { container } = wrap(<W />);
    await screen.findByText(/미확인 7건/);
    // 표시 설정(ui.*) 조회는 날짜 정본 부품(KDate)이 부른다 — 데이터 출처 대조에서 뺀다(2026-10-02 · 지난 결과는 날짜로)
    const urls = get.mock.calls.map((c) => String(c[0])).filter((u) => !u.startsWith('/api/v1/config?category=ui'));
    expect(urls.length).toBeGreaterThan(0);
    expect(urls.every((u) => u.startsWith('/api/v1/doctors/results-inbox'))).toBe(true);
    expect(urls.some((u) => u.includes('mine=true'))).toBe(false);
    expect(container.querySelector('a[href="/doctor-inbox?tab=results"]')).toBeTruthy();
  });

  it('검사실은 병원 전체 최근 완료분이라고 밝힌다(검사실에게 "내 오더"는 없다)', async () => {
    useAuthStore.setState({ user: { id: 'u2', role: 'LAB_TECH', email: 'x@y', name: 'x' } as never });
    get.mockResolvedValue({ data: [] });
    const { default: W } = await import('@/app/(main)/dashboard/components/widgets/LabResultsWidget');
    wrap(<W />);
    await screen.findByText(/병원 전체 최근 완료분/);
    expect(get.mock.calls.map((c) => String(c[0])).every((u) => u.startsWith('/api/v1/orders?') && !u.includes('mine'))).toBe(true);
  });

  it('센서스 "미확인 검사 N건"이 그 환자의 확인함으로 이어진다', async () => {
    get.mockResolvedValue({ data: { doctorInfo: null, totalPatients: 1, byStatus: { critical: 0, unstable: 0, new: 0, stable: 1, dcPlan: 0 }, patients: [{
      patient: { ...P, gender: 'M', dateOfBirth: '1970-01-01' },
      admission: { id: 'adm1', admitDate: '2026-09-01', ward: 'W', room: '1', bed: '1', daysAdmitted: 3 },
      status: 'STABLE', primaryDiagnosis: null, latestVitals: null, vitalTrend: 'STABLE', lastRoundAt: null, lastRoundType: null,
      pendingLabCount: 2, pendingLabItems: [], todayNursingNotes: 0, activeRxCount: 0, urgentAlerts: [],
    }] } });
    const { default: MyCensusPanel } = await import('@/app/(main)/dashboard/components/MyCensusPanel');
    const { container } = wrap(<MyCensusPanel />);
    await screen.findByText(/미확인 검사/);
    const a = container.querySelector(`a[href="/results-inbox?patientId=${P.id}"]`);
    expect(a?.textContent).toMatch(/미확인 검사.*2/);
    // 링크 안에 링크를 넣지 않았다(행 링크와 형제)
    expect(container.querySelector('a a')).toBeNull();
  });
});

describe('3. 위급값 배너 — 상향된 남의 경보', () => {
  const ALERT = { id: 'a1', testName: 'K', value: '7.2', unit: 'mEq/L', reason: 'HH', notifiedAt: new Date().toISOString(), patient: { familyName: '홍', givenName: '길동', mrn: 'M1' } };
  const route = (alerts: unknown[], meta?: unknown) => get.mockImplementation((url: string) => {
    if (url.endsWith('/pending')) return Promise.resolve({ data: alerts, ...(meta ? { meta } : {}) });
    if (url.endsWith('/escalation-policy')) return Promise.resolve({ data: { afterMinutes: 30, invalid: false } });
    return Promise.reject(new Error(`unexpected ${url}`));
  });

  it('🔴 다른 담당의의 상향 경보임을 밝히고, 확인하려면 대리 사유 입력을 받는다', async () => {
    route([{ ...ALERT, status: 'ESCALATED', isMine: false, unassigned: false, escalatedFromOther: true, assignedDoctor: { familyName: '김', givenName: '담당' }, canAcknowledge: true }]);
    const { CriticalValueAlertBanner } = await import('@/components/CriticalValueAlertBanner');
    wrap(<CriticalValueAlertBanner />);
    await screen.findByText(/다른 담당의\(김담당\) 경보/);
    fireEvent.click(screen.getByText(/확인하기/));
    expect(await screen.findByText(/담당의 본인이 아닙니다/)).toBeTruthy();
  });

  it('🔴 확인 권한이 없는 역할(서버 판정)에는 확인 버튼을 주지 않고 그 사실을 말한다', async () => {
    useAuthStore.setState({ user: { id: 'n1', role: 'NURSE', email: 'x@y', name: 'x' } as never });
    route([{ ...ALERT, status: 'ESCALATED', isMine: false, unassigned: false, escalatedFromOther: true, assignedDoctor: null, canAcknowledge: false }]);
    const { CriticalValueAlertBanner } = await import('@/components/CriticalValueAlertBanner');
    const { container } = wrap(<CriticalValueAlertBanner />);
    await screen.findByText(/확인은 의사·관리자만 할 수 있습니다/);
    expect(container.textContent).not.toContain('확인하기');
    expect(container.textContent).toContain('다른 담당의 경보');
  });

  it('상한에서 잘리면 전체 건수를 함께 말한다', async () => {
    route([{ ...ALERT, isMine: true, canAcknowledge: true }], { total: 61, limit: 50 });
    const { CriticalValueAlertBanner } = await import('@/components/CriticalValueAlertBanner');
    wrap(<CriticalValueAlertBanner />);
    expect(await screen.findByText(/전체 61건 중 1건 표시/)).toBeTruthy();
  });
});

describe('4. 알림 센터', () => {
  const setStore = (s: Partial<ReturnType<typeof useNotificationStore.getState>>) => {
    const fetchNotifications = vi.fn().mockResolvedValue(undefined);
    useNotificationStore.setState({
      notifications: [], unreadCount: 0, fetchError: false, hasFetched: false,
      fetchNotifications, connectSSE: vi.fn(), disconnectSSE: vi.fn(), ...s,
    });
    return fetchNotifications;
  };

  it('🔴 조회 실패는 "알림이 없습니다"가 아니라 실패 + 다시 시도', async () => {
    const fetchN = setStore({ fetchError: true });
    const { default: Page } = await import('@/app/(main)/notifications/page');
    const { container } = render(<Page />);
    expect(container.textContent).toContain('알림을 불러오지 못했습니다');
    expect(container.textContent).not.toContain('알림이 없습니다');
    fireEvent.click(screen.getByText('다시 시도'));
    expect(fetchN.mock.calls.length).toBeGreaterThanOrEqual(2); // 마운트 1회 + 다시 시도 1회
  });

  it('첫 응답 전 빈 목록도 "없음"이 아니다 · 대조군: 받아 온 결과가 0건이면 "알림이 없습니다"', async () => {
    setStore({});
    const { default: Page } = await import('@/app/(main)/notifications/page');
    const first = render(<Page />);
    expect(first.container.textContent).not.toContain('알림이 없습니다');
    cleanup();
    setStore({ hasFetched: true });
    const second = render(<Page />);
    expect(second.container.textContent).toContain('알림이 없습니다');
  });

  it('알림이 그 건으로 이동한다 — 환자 알림은 차트, 결과 도착은 확인함 · UUID 아닌 id 는 경로에 넣지 않는다', () => {
    expect(hrefForNotification('PATIENT', P.id, 'MED_OVERDUE')).toBe(`/patients/${P.id}`);
    expect(hrefForNotification('PATIENT', 'MRN001', 'MED_OVERDUE')).toBe('/patients');
    expect(hrefForNotification('ORDER', 'x', 'LAB_RESULT')).toBe('/doctor-inbox?tab=results');
    expect(hrefForNotification('ORDER', 'x', 'IMAGING_REPORT')).toBe('/doctor-inbox?tab=results');
    // 대조군: 다른 오더 알림은 종전 경로 그대로
    expect(hrefForNotification('ORDER', 'x', 'NEW_ORDER')).toBe('/orders');
  });
});

describe('화면번호·메뉴', () => {
  it('/results-inbox 는 1011 · 의사·관리자 메뉴(서버 @Roles DOCTOR·ADMIN 과 같다)', async () => {
    const { SCREEN_REGISTRY } = await import('@/components/layout/Sidebar');
    const e = SCREEN_REGISTRY.find((x) => x.href === '/results-inbox');
    expect(e?.code).toBe('1011');
    expect([...(e?.roles ?? [])].sort()).toEqual(['ADMIN', 'DOCTOR']);
  });
});
