/**
 * 대시보드 실화면 재검토(2026-10-02) — 관리자·원무 화면이 "정리가 안 되었고, 수납 대기열은 금액만 나와 쓸모가 없다".
 *  · 🔴 폭 단위가 섞여(1/4·1/3·1/2) 줄마다 끝이 비었다 → 관리자·원무 기본 배치는 어느 폭에서도 줄이 꽉 찬다
 *  · 🔴 수납 대기열이 금액·"대기"만 — 서버가 준 환자·진료과·담당의를 버렸고, 80건 중 8건을 말없이 잘랐다
 *  · 🔴 미확인 알림이 같은 제목 4줄 · 머리 건수가 잘라낸 5건을 셌다 · 첫 조회 전을 "새 알림 없음"
 *  · 🔴 시스템 상태가 개통 이래 "데이터 없음"(공용 조회가 봉투 없는 응답을 버림) · DB·Redis 는 묻지도 않음
 *  · 🔴 의사 본인 대기열(/queue/my)이 원무(403)·관리자(늘 빈 목록) 기본 배치에 → 접수 대기 현황
 *  · 관리자 바로가기가 의사 것(진료 예약·오더·응급 접수) · 관리자 "오늘 내 예약 0"
 * 재주입: 위젯이 환자명을 버리면, 잘림 문구를 지우면, 알림을 묶지 않으면, 건수를 잘린 목록에서 세면,
 *        봉투 없는 응답을 다시 버리면, 기본 배치에 my-queue 를 되살리면, 폭 단위를 다시 섞으면 실패한다.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { getDefaultConfig } from '@/app/(main)/dashboard/components/default-layouts';
import { widgetGridClass, spansByBreakpoint } from '@/app/(main)/dashboard/components/widget-size';

const get = vi.fn();
vi.mock('@/lib/api-client', async (orig) => ({ ...(await orig<object>()), apiClient: { get: (...a: unknown[]) => get(...a), getToken: () => null } }));
let role = 'ADMIN';
vi.mock('@/stores/auth-store', () => ({ useAuthStore: (sel?: (s: unknown) => unknown) => { const st = { user: { id: 'u1', role } }; return sel ? sel(st) : st; } }));
let notifState: Record<string, unknown> = {};
vi.mock('@/stores/notification-store', () => ({ useNotificationStore: (sel: (s: unknown) => unknown) => sel(notifState) }));

const wrap = (ui: React.ReactElement) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
const kstToday = () => new Date();
const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString();

beforeEach(() => { get.mockReset(); role = 'ADMIN'; });
afterEach(() => cleanup());

describe('수납 대기열 — 금액만이 아니라 누구·어느 과·얼마나', () => {
  const item = (id: string, createdAt: string, extra: Record<string, unknown> = {}) => ({
    id, status: 'PENDING', createdAt, patientCopay: 12300, totalAmount: 40000,
    patient: { mrn: `MRN-${id}`, familyName: '홍', givenName: `길동${id}` },
    encounter: { doctor: { familyName: '김', givenName: '내과', department: '내과' } },
    ...extra,
  });

  it('🔴 환자·등록번호·진료과·담당의·본인부담을 그리고, 행이 그 건의 수납 창으로 간다', async () => {
    get.mockResolvedValue({ data: [item('1', kstToday().toISOString())] });
    const { default: W } = await import('@/app/(main)/dashboard/components/widgets/ext/CashierQueueWidget');
    const { container } = wrap(<W />);
    await waitFor(() => expect(container.textContent).toContain('홍길동1'));
    expect(container.textContent).toContain('MRN-1');
    expect(container.textContent).toContain('내과 · 김내과');
    expect(container.textContent).toMatch(/12,300/);
    expect(container.querySelector('a[data-cashier-row="1"]')?.getAttribute('href')).toBe('/billing?billingId=1');
    expect(get.mock.calls[0][0]).toBe('/api/v1/billing/cashier-queue');
  });

  it('🔴 오늘 발생(창구)과 이전 발생(미수 추적)을 가르고, 이전 건은 며칠째인지 말한다', async () => {
    get.mockResolvedValue({ data: [item('old', daysAgo(30)), item('now', kstToday().toISOString())] });
    const { default: W } = await import('@/app/(main)/dashboard/components/widgets/ext/CashierQueueWidget');
    const { container } = wrap(<W />);
    await waitFor(() => expect(container.textContent).toContain('홍길동now'));
    const text = container.textContent ?? '';
    expect(text).toContain('이전 발생 — 아직 수납되지 않음');
    expect(text.indexOf('홍길동now')).toBeLessThan(text.indexOf('홍길동old')); // 오늘 건이 먼저
    expect(text).toMatch(/30\s*일째/);
  });

  it('🔴 자르면 잘랐다고 말한다 — 몇 건 중 몇 건', async () => {
    get.mockResolvedValue({ data: Array.from({ length: 20 }, (_, i) => item(String(i), daysAgo(2))) });
    const { default: W } = await import('@/app/(main)/dashboard/components/widgets/ext/CashierQueueWidget');
    const { container } = wrap(<W />);
    await waitFor(() => expect(container.textContent).toContain('홍길동0'));
    expect(container.querySelectorAll('a[data-cashier-row]').length).toBeLessThan(20);
    expect(container.textContent).toMatch(/20건 중 \d+건 표시/);
  });

  it('🔴 금액 정본 — null·빈 값은 0원이 아니다(Number(null)=0 이 "0원"을 그렸다)', async () => {
    const { formatMoney } = await import('@/lib/ui-settings');
    const s = { currencyStyle: 'suffix' } as never;
    expect(formatMoney(null, s, '산정 전')).toBe('산정 전');
    expect(formatMoney('', s)).toBe('-');
    expect(formatMoney(undefined, s)).toBe('-');
    // 대조군: 진짜 0 은 0원이다
    expect(formatMoney(0, s)).toBe('0원');
  });

  it('본인부담이 산정되지 않은 건을 0원으로 말하지 않는다', async () => {
    get.mockResolvedValue({ data: [item('n', kstToday().toISOString(), { patientCopay: null })] });
    const { default: W } = await import('@/app/(main)/dashboard/components/widgets/ext/CashierQueueWidget');
    const { container } = wrap(<W />);
    await waitFor(() => expect(container.textContent).toContain('홍길동n'));
    expect(container.textContent).toContain('산정 전');
  });

  it('대조군: 대기가 없으면 없다고 말하고, 조회 실패는 실패라고 말한다', { timeout: 10000 }, async () => {
    get.mockResolvedValueOnce({ data: [] });
    const { default: W } = await import('@/app/(main)/dashboard/components/widgets/ext/CashierQueueWidget');
    const r1 = wrap(<W />);
    await waitFor(() => expect(r1.container.textContent).toContain('수납 대기 없음'));
    cleanup();
    get.mockRejectedValue(new Error('500')); // 재시도까지 전부 실패
    const r2 = wrap(<W />);
    // 공용 위젯 조회는 2회 재시도한다(1s·2s) — 실패를 말하기까지 기다린다
    await waitFor(() => expect(r2.container.textContent).toContain('조회 실패'), { timeout: 6000 });
  });
});

describe('공용 목록 위젯 — 자르면 잘랐다고', () => {
  it('8행을 넘으면 "N건 중 8건 표시"', async () => {
    get.mockResolvedValue({ data: Array.from({ length: 12 }, (_, i) => ({ id: String(i) })) });
    const { default: RowListWidget } = await import('@/app/(main)/dashboard/components/widgets/ext/RowListWidget');
    const { container } = wrap(<RowListWidget widgetId="t" endpoint="/x" empty="없음" pick={(d) => d.map((x: { id: string }) => ({ key: x.id, label: `행${x.id}` }))} />);
    await waitFor(() => expect(container.textContent).toContain('행0'));
    expect(container.querySelector('[data-row-truncated]')?.textContent).toMatch(/12건 중 8건 표시/);
  });
});

describe('미확인 알림 — 같은 제목은 한 줄로', () => {
  const n = (id: string, title: string, severity?: string) => ({ id, title, severity, read: false, createdAt: `2026-10-02T0${id.length}:00:00Z`, message: '', type: 'system' });

  it('🔴 같은 제목 4건을 한 줄 ×4 로 묶고, 머리 건수는 전체 미확인 수다(잘라낸 목록의 수가 아니다)', async () => {
    notifState = {
      hasFetched: true, fetchError: false, unreadCount: 99,
      notifications: [n('a', '미서명 차트 회수'), n('b', '미서명 차트 회수'), n('c', '미서명 차트 회수'), n('d', '미서명 차트 회수'), n('e', '수술 안전 미이행', 'high')],
    };
    const { default: W } = await import('@/app/(main)/dashboard/components/widgets/SafetyAlertsWidget');
    const { container } = wrap(<W />);
    const text = container.textContent ?? '';
    expect(text.match(/미서명 차트 회수/g)?.length).toBe(1);
    expect(text).toContain('99');
    // 위급이 먼저
    expect(text.indexOf('수술 안전 미이행')).toBeLessThan(text.indexOf('미서명 차트 회수'));
  });

  it('🔴 첫 조회 전·조회 실패를 "새 알림 없음"이라 말하지 않는다', async () => {
    const { default: W } = await import('@/app/(main)/dashboard/components/widgets/SafetyAlertsWidget');
    notifState = { hasFetched: false, fetchError: false, unreadCount: 0, notifications: [] };
    const r1 = wrap(<W />);
    expect(r1.container.textContent).not.toContain('새 알림 없음');
    cleanup();
    notifState = { hasFetched: true, fetchError: true, unreadCount: 0, notifications: [] };
    const r2 = wrap(<W />);
    expect(r2.container.textContent).toContain('알림 조회 실패');
    cleanup();
    // 대조군: 조회했고 없으면 없다고 말한다
    notifState = { hasFetched: true, fetchError: false, unreadCount: 0, notifications: [] };
    const r3 = wrap(<W />);
    expect(r3.container.textContent).toContain('새 알림 없음');
  });
});

describe('시스템 상태 — 점검한 것만 말한다', () => {
  it('🔴 API·DB·Redis 점검 EP 를 부르고, DB 오류를 오류라고 말한다', async () => {
    get.mockResolvedValue({ data: { api: 'ok', db: 'error', redis: 'ok', version: 'v9.9.9' } });
    const { default: W } = await import('@/app/(main)/dashboard/components/widgets/ext/SystemHealthWidget');
    const { container } = wrap(<W />);
    await waitFor(() => expect(container.textContent).toContain('v9.9.9'));
    expect(get.mock.calls[0][0]).toBe('/api/v1/system-health');
    expect(container.textContent).toContain('응답 오류');
    expect(container.textContent?.match(/정상/g)?.length).toBe(2);
  });

  it('응답이 오지 않으면 셋 다 "조회 실패" — 정상으로도 오류로도 단정하지 않는다', { timeout: 10000 }, async () => {
    get.mockRejectedValue(new Error('net'));
    const { default: W } = await import('@/app/(main)/dashboard/components/widgets/ext/SystemHealthWidget');
    const { container } = wrap(<W />);
    await waitFor(() => expect(container.textContent?.match(/조회 실패/g)?.length).toBe(3), { timeout: 6000 });
    expect(container.textContent).not.toContain('정상');
  });

  it('🔴 공용 위젯 조회가 봉투(`{data}`) 없는 응답을 버리지 않는다', async () => {
    get.mockResolvedValue({ status: 'ok', version: 'v1' });
    const { default: ApiWidget } = await import('@/app/(main)/dashboard/components/widgets/ApiWidget');
    const { container } = wrap(<ApiWidget widgetId="bare" endpoint="/health" render={(d) => <span>{String(d.status)}</span>} />);
    await waitFor(() => expect(container.textContent).toBe('ok'));
  });
});

describe('접수 대기 현황 — 창구가 보는 대기', () => {
  it('🔴 과별 대기 인원을 많은 순으로, 평균 대기는 표본 있는 과만 — 표본 0 이면 잴 수 없다고 말한다', async () => {
    get.mockResolvedValue({ data: { data: {
      statusCounts: [
        { _count: 3, departmentName: '내과', status: 'WAITING' },
        { _count: 9, departmentName: '외과', status: 'WAITING' },
        { _count: 5, departmentName: '외과', status: 'COMPLETED' },
      ],
      avgWaitMinutes: {}, waitSampleN: 0, waitUnmeasuredN: 12, waitingNow: 12, waitingScheduled: 4,
    } } });
    const { default: W } = await import('@/app/(main)/dashboard/components/widgets/ReceptionQueueWidget');
    const { container } = wrap(<W />);
    await waitFor(() => expect(container.textContent).toContain('외과'));
    const text = container.textContent ?? '';
    expect(text.indexOf('외과')).toBeLessThan(text.indexOf('내과'));
    expect(text).toMatch(/9\s*명/);
    expect(text).toContain('대기시간을 잴 수 없음');
    expect(text).not.toContain('평균');
    expect(get.mock.calls[0][0]).toBe('/api/v1/queue/stats');
  });

  it('대조군: 표본이 있으면 그 과의 평균과 근거 건수를 말한다', async () => {
    get.mockResolvedValue({ data: { data: {
      statusCounts: [{ _count: 2, departmentName: '내과', status: 'WAITING' }],
      avgWaitMinutes: { 내과: 17 }, waitSampleN: 6, waitUnmeasuredN: 4, waitingNow: 2, waitingScheduled: 0,
    } } });
    const { default: W } = await import('@/app/(main)/dashboard/components/widgets/ReceptionQueueWidget');
    const { container } = wrap(<W />);
    await waitFor(() => expect(container.textContent).toContain('평균'));
    expect(container.textContent).toMatch(/17\s*분/);
    expect(container.textContent).toMatch(/6건 기준/);
  });
});

describe('관리자 — 관리자의 일', () => {
  it('🔴 관리자 바로가기가 의사 것이 아니다(수납·사람 결정·직원·감시자)', async () => {
    const { default: QuickActions } = await import('@/app/(main)/dashboard/components/QuickActions');
    const { container } = render(<QuickActions role="ADMIN" />);
    const hrefs = [...container.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(expect.arrayContaining(['/billing', '/admin/decisions', '/admin/sentinel']));
    expect(hrefs).not.toContain('/emergency');
    cleanup();
    // 대조군: 의사는 그대로
    const d = render(<QuickActions role="DOCTOR" />);
    expect([...d.container.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toContain('/emergency');
  });

  it('🔴 관리자는 "오늘 내 예약"을 묻지 않는다(진료를 보지 않으니 늘 0건이었다)', async () => {
    get.mockResolvedValue({ data: [] });
    const { default: W } = await import('@/app/(main)/dashboard/components/widgets/MyTodayWidget');
    wrap(<W />);
    await waitFor(() => expect(get).toHaveBeenCalled());
    expect(get.mock.calls.map((c) => String(c[0])).some((u) => u.includes('/appointments'))).toBe(false);
    expect(screen.queryByText('오늘 내 예약')).toBeNull();
  });
});

/**
 * 줄 채움 — 위젯 폭을 단위(1·2·전폭)로 환산해 dense 배치(앞 줄 빈자리를 뒤 카드가 메움)를 흉내낸다.
 * 🔴 종전 관리자 배치는 2xl(3단위/줄)에서 줄마다 끝이 비었다.
 */
function rowsAt(role: string, bp: '2xl' | 'min-[2200px]') {
  const per = { '2xl': 3, 'min-[2200px]': 4 }[bp];
  const unitSpan = 12 / per;
  const items = getDefaultConfig(role).layouts.lg.map((l) => l.i).filter((i) => i !== 'stat-bar');
  const rows: number[] = [];
  for (const id of items) {
    const u = spansByBreakpoint(widgetGridClass(id))[bp] / unitSpan;
    const at = rows.findIndex((used) => used + u <= per);
    if (at >= 0) rows[at] += u; else rows.push(u);
  }
  return { rows, per };
}

describe('🔴 관리자·원무 기본 배치는 줄이 꽉 찬다(끝이 비지 않는다)', () => {
  for (const role of ['ADMIN', 'RECEPTIONIST']) {
    it(`${role} — 2xl(3단위)에서 모든 줄이 꽉 찬다`, () => {
      const { rows, per } = rowsAt(role, '2xl');
      expect(rows.length).toBeGreaterThan(1);
      expect(rows, `${role} 줄별 사용 단위`).toEqual(rows.map(() => per));
    });
    it(`${role} — 초광폭(4단위)에서 빈 줄 끝은 마지막 줄뿐이다`, () => {
      const { rows, per } = rowsAt(role, 'min-[2200px]');
      expect(rows.slice(0, -1)).toEqual(rows.slice(0, -1).map(() => per));
    });
  }
});

describe('🔴 줄 단위 정렬 — 카드 높이로 자리를 정하지 않는다', () => {
  const src = (f: string) => require('node:fs').readFileSync(require('node:path').join(process.cwd(), 'src/app/(main)/dashboard/components', f), 'utf-8') as string;
  it('격자가 줄 단위로 서고(같은 줄 같은 높이) 카드가 줄 높이를 채운다', () => {
    const shell = src('DashboardShell.tsx');
    expect(shell).toMatch(/className="grid grid-cols-12 grid-flow-row-dense items-stretch gap-3" data-dashboard-grid/);
    // 실측 높이로 행을 차지하던 masonry 가 되살아나면 한 열에 카드가 쌓이고 옆 열이 빈다(2026-10-02 실화면)
    expect(shell).not.toMatch(/gridRowEnd|gridAutoRows|MasonryCell/);
    expect(shell).toMatch(/className="h-full"/);
    expect(src('WidgetWrapper.tsx')).toMatch(/group\/widget h-full flex flex-col/);
  });
});
