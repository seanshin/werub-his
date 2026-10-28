/**
 * 역할별 대시보드 위젯 내용 재검토(2026-10-02) — 운영 실로그인 탐침(역할 9종 · 기본 배치 위젯이 부르는 EP 전수)에서 나온 것.
 *  · 🔴 의사 '오늘 수술 일정' — 응답에 없는 `scheduledDate` 를 읽어 개통 이래 늘 "없음"(실측 오늘 3건)
 *  · 🔴 의사 '오늘 진료표' — 종일(`period: ALL`)을 "오전 없음·오후 없음" · 진료실(`roomName`) 미표시 · 시각을 지어냄
 *  · 🔴 의사 '미완료 차트' — 날짜 `date` 키 부재로 전부 '-' · 배지가 한 쪽(10)을 셌다(실측 47)
 *  · 🔴 간호 패널 — 병상 응답을 잘못 읽어 "입원 중 0 · 가용 57"(실측 5·49) · '담당 환자'가 병원 전체 입원 수 · 외래 대기 늘 0
 *  · 🔴 약사 패널 — '검수 대기'를 오더 상태로 세어 늘 0(실측 5) · 재고 칸 403 · 목록 이중
 *  · 🔴 검사실 패널 — 장비 칸 403 · 영상 대기 기준이 위젯과 달랐다 · 목록 이중
 *  · 🔴 대기열 위젯(조제·검사·영상) — 행이 부서 코드와 상태뿐
 *  · 🔴 '입원 추이' — 객체 응답을 배열로 읽어 늘 "입원 데이터 없음"
 *  · 🔴 경영진 — 수납·청구·예약 통계 위젯이 403 → 경영 정본(/executive/*) 위젯
 * 재주입: 각 결함을 되돌리면 해당 it 이 실패한다.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { pharmacyStageOf, queueWaitingSummary } from '@/lib/widget-summaries';

const routes: Record<string, unknown> = {};
const get = vi.fn((url: string) => {
  const key = Object.keys(routes).find((k) => url.startsWith(k));
  if (key === undefined) return Promise.resolve({ data: [] });
  const v = routes[key];
  return v instanceof Error ? Promise.reject(v) : Promise.resolve(v);
});
vi.mock('@/lib/api-client', async (orig) => ({ ...(await orig<object>()), apiClient: { get: (u: string) => get(u), post: vi.fn(), patch: vi.fn(), getToken: () => null } }));
let user: { id: string; role: string } = { id: 'doc-1', role: 'DOCTOR' };
vi.mock('@/stores/auth-store', () => ({ useAuthStore: (sel?: (s: unknown) => unknown) => { const st = { user }; return sel ? sel(st) : st; } }));

const wrap = (ui: React.ReactElement) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
const kstNow = () => new Date();
const urls = () => get.mock.calls.map((c) => String(c[0]));

beforeEach(() => { get.mockClear(); for (const k of Object.keys(routes)) delete routes[k]; user = { id: 'doc-1', role: 'DOCTOR' }; });
afterEach(() => cleanup());

describe('의사', () => {
  it('🔴 오늘 수술 — scheduledAt 의 KST 날짜로 가르고(오전 8:30 KST = 전날 23:30Z 포함) 내가 집도하는 것만', async () => {
    const today = kstNow().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
    const early = new Date(`${today}T08:30:00+09:00`).toISOString(); // UTC 로는 전날
    routes['/api/v1/surgery/schedule'] = { data: [
      { id: 's1', scheduledAt: early, surgeonId: 'doc-1', status: 'SCHEDULED', procedureName: '충수절제술', patient: { familyName: '홍', givenName: '길동' }, orRoom: { name: 'OR-2' } },
      { id: 's2', scheduledAt: early, surgeonId: 'other', status: 'SCHEDULED', procedureName: '남의 수술', patient: { familyName: '김', givenName: '철수' } },
    ] };
    const { default: W } = await import('@/app/(main)/dashboard/components/widgets/SurgeryWidget');
    const { container } = wrap(<W settings={{ filterMine: true }} />);
    await waitFor(() => expect(container.textContent).toContain('홍길동'));
    expect(container.textContent).toContain('OR-2');
    expect(container.textContent).not.toContain('남의 수술');
    expect(urls().find((u) => u.startsWith('/api/v1/surgery/schedule'))).toMatch(/dateFrom=.*dateTo=/);
  });

  it('🔴 오늘 진료표 — 종일(ALL)·진료실(roomName)을 그리고, 시각이 없으면 지어내지 않는다', async () => {
    routes['/api/v1/clinic-schedule/today'] = { data: [
      { doctorId: 'doc-1', period: 'ALL', startTime: '09:00', endTime: '18:00', roomName: '내과 1진료실' },
      { doctorId: 'doc-1', period: 'PM', startTime: null, endTime: null, roomName: null },
      { doctorId: 'other', period: 'AM', startTime: '09:00', endTime: '12:00', roomName: '남의 방' },
    ] };
    const { default: W } = await import('@/app/(main)/dashboard/components/widgets/ScheduleWidget');
    const { container } = wrap(<W />);
    await waitFor(() => expect(container.textContent).toContain('종일'));
    expect(container.textContent).toContain('내과 1진료실');
    expect(container.textContent).toContain('시각 미기록');
    expect(container.textContent).not.toContain('12:30'); // 종전 지어낸 기본값
    expect(container.textContent).not.toContain('남의 방');
  });

  it('진료표 조회 실패를 "오늘 진료 없음"이라 말하지 않는다', async () => {
    routes['/api/v1/clinic-schedule/today'] = new Error('500');
    const { default: W } = await import('@/app/(main)/dashboard/components/widgets/ScheduleWidget');
    const { container } = wrap(<W />);
    await waitFor(() => expect(container.textContent).toContain('조회 실패'));
    expect(container.textContent).not.toContain('오늘 진료 없음');
  });

  it('🔴 미완료 차트 — 배지는 서버 전체 수(pagination.total), 날짜는 createdAt', async () => {
    routes['/api/v1/encounters'] = { data: [{ id: 'e1', patientId: 'p1', createdAt: '2026-08-25T23:14:21Z', patient: { familyName: '윤', givenName: '서연' } }], pagination: { total: 47 } };
    const { default: W } = await import('@/app/(main)/dashboard/components/widgets/DraftChartsWidget');
    const { container } = wrap(<W />);
    await waitFor(() => expect(container.textContent).toContain('윤서연'));
    expect(container.querySelector('[data-draft-total]')?.getAttribute('data-draft-total')).toBe('47');
    expect(container.textContent).toMatch(/8월 26일|08-26|Aug/); // KST 날짜(UTC 23시 = 다음날)
  });
});

describe('간호', () => {
  it('🔴 병상은 byStatus 로 — 사용 중 5·가용 49(전체−사용이 아니다) · 담당은 내 배정 · 외래 대기 칸 없음', async () => {
    user = { id: 'n-1', role: 'NURSE' };
    routes['/api/v1/beds/status'] = { data: { total: 57, byStatus: [{ status: 'OCCUPIED', _count: 5 }, { status: 'AVAILABLE', _count: 49 }, { status: 'CLEANING', _count: 2 }] } };
    routes['/api/v1/nurse-station/assignments/my'] = { data: [{ id: 'a1' }, { id: 'a2' }] };
    routes['/api/v1/inpatient'] = { data: Array.from({ length: 5 }, (_, i) => ({ id: `i${i}`, patient: { familyName: '환', givenName: `자${i}` } })) };
    routes['/api/workgroup/medication/overdue'] = { data: { overdue: [], totalOverdue: 0 } };
    const { default: W } = await import('@/app/(main)/dashboard/components/NurseDashboard');
    const { container } = wrap(<W />);
    await waitFor(() => expect(container.textContent).toContain('49'));
    const text = container.textContent ?? '';
    expect(text).toContain('병상 현황(병원 전체)');
    expect(text).not.toContain('외래 대기');
    expect(text).toContain('내 배정 환자');
    expect(urls()).not.toContain('/api/v1/queue/stats');
    expect(urls()).toContain('/api/v1/nurse-station/assignments/my');
  });
});

describe('약사', () => {
  it('🔴 단계 정본 — 검수·불출 대기는 조제 상태(오더는 COMPLETED)', () => {
    expect(pharmacyStageOf({ status: 'COMPLETED', dispensing: { status: 'DISPENSED' } })).toBe('VERIFY_WAIT');
    expect(pharmacyStageOf({ status: 'COMPLETED', dispensing: { status: 'VERIFIED' } })).toBe('ISSUE_WAIT');
    expect(pharmacyStageOf({ status: 'ORDERED' })).toBe('ORDERED');
    // 종전 판정 — order.status === 'DISPENSED' — 은 한 건도 잡지 못했다(대조)
    expect(pharmacyStageOf({ status: 'DISPENSED' })).toBe('OTHER');
  });

  it('🔴 약사 패널 — 검수 대기 5 · 재고(/inventory 403) 를 부르지 않는다', async () => {
    user = { id: 'ph-1', role: 'PHARMACIST' };
    routes['/api/v1/pharmacy/queue'] = { data: [
      ...Array.from({ length: 5 }, (_, i) => ({ id: `c${i}`, status: 'COMPLETED', dispensing: { status: 'DISPENSED' } })),
      ...Array.from({ length: 6 }, (_, i) => ({ id: `o${i}`, status: 'ORDERED' })),
    ] };
    const { default: W } = await import('@/app/(main)/dashboard/components/PharmacistDashboard');
    const { container } = wrap(<W />);
    await waitFor(() => expect(container.querySelector('[data-pharmacy-stage="VERIFY_WAIT"]')?.textContent).toMatch(/5$/));
    expect(container.querySelector('[data-pharmacy-stage="ORDERED"]')?.textContent).toMatch(/6$/);
    expect(urls().some((u) => u.startsWith('/api/v1/inventory'))).toBe(false);
  });

  it('🔴 조제 대기열 행은 환자·약품·단계', async () => {
    routes['/api/v1/pharmacy/queue'] = { data: [{ id: 'q1', status: 'COMPLETED', dispensing: { status: 'DISPENSED' }, prescription: { medicationCode: { nameKo: '세파렉신캡슐 500mg' }, encounter: { patient: { familyName: '김', givenName: '영수' } } } }] };
    const { default: W } = await import('@/app/(main)/dashboard/components/widgets/ext/PharmacyQueueWidget');
    const { container } = wrap(<W />);
    await waitFor(() => expect(container.textContent).toContain('세파렉신'));
    expect(container.textContent).toContain('김영수');
    expect(container.textContent).toContain('검수 대기');
  });
});

describe('검사실', () => {
  it('🔴 검사실 패널 — 장비(/equipment 403)를 부르지 않고, 영상은 대기열 위젯과 같은 응답(촬영 중 포함)', async () => {
    user = { id: 'lt-1', role: 'LAB_TECH' };
    routes['/api/v1/lab/queue'] = { data: [{ id: 'l1', status: 'ORDERED' }, { id: 'l2', status: 'RECEIVED' }] };
    routes['/api/v1/imaging/queue'] = { data: [{ id: 'm1', status: 'ORDERED' }, { id: 'm2', status: 'IN_PROGRESS' }, { id: 'm3', status: 'IN_PROGRESS' }] };
    const { default: W } = await import('@/app/(main)/dashboard/components/LabTechDashboard');
    const { container } = wrap(<W />);
    await waitFor(() => expect(container.querySelector('[data-lab-stage="img-progress"]')?.textContent).toMatch(/2$/));
    expect(container.querySelector('[data-lab-stage="lab-progress"]')?.textContent).toMatch(/1$/); // 접수됨 포함
    expect(urls().some((u) => u.startsWith('/api/v1/equipment'))).toBe(false);
    expect(urls().some((u) => u.startsWith('/api/v1/orders?department=IMAGING'))).toBe(false);
  });

  it('🔴 검사·영상 대기열 행은 환자·검사명', async () => {
    routes['/api/v1/lab/queue'] = { data: [{ id: 'l1', status: 'ORDERED', prescription: { procedureCode: { nameKo: 'HbA1c' }, encounter: { patient: { familyName: '강', givenName: '미경' } } } }] };
    routes['/api/v1/imaging/queue'] = { data: [{ id: 'm1', status: 'ORDERED', prescription: { instructions: 'CT BRAIN', encounter: { patient: { familyName: '신', givenName: '현묵' } } } }] };
    const { default: L } = await import('@/app/(main)/dashboard/components/widgets/ext/LabQueueWidget');
    const { default: I } = await import('@/app/(main)/dashboard/components/widgets/ext/ImagingQueueWidget');
    const r = wrap(<><L /><I /></>);
    await waitFor(() => expect(r.container.textContent).toContain('HbA1c'));
    expect(r.container.textContent).toContain('강미경');
    expect(r.container.textContent).toContain('CT BRAIN');
  });
});

describe('공통·경영진', () => {
  it('🔴 입원 추이 — 객체 응답을 읽고, 일별 행이 없으면 "이 기간 입원 없음"(데이터 없음이 아니다)', async () => {
    routes['/api/v1/operational-stats/admission-trends'] = { data: { totalAdmissions: 0, totalDischarges: 0, avgStayDays: null, avgStayDaysSampleN: 0, dailyTrends: [] } };
    const { default: W } = await import('@/app/(main)/dashboard/components/widgets/ext/AdmissionTrendWidget');
    const r = wrap(<W />);
    await waitFor(() => expect(r.container.textContent).toContain('이 기간 입원 없음'));
    expect(r.container.textContent).toContain('계산하지 않음');
    cleanup();
    routes['/api/v1/operational-stats/admission-trends'] = { data: { totalAdmissions: 3, totalDischarges: 1, avgStayDays: 4.5, avgStayDaysSampleN: 1, dailyTrends: [{ date: '2026-10-01', admissions: 3 }] } };
    const r2 = wrap(<W />);
    await waitFor(() => expect(r2.container.textContent).toMatch(/3\s*건/));
    expect(r2.container.textContent).toContain('4.5');
  });

  it('🔴 경영 요약 — 경영 정본을 읽고, 표본 0 을 0원으로 그리지 않는다', async () => {
    user = { id: 'ex-1', role: 'EXECUTIVE' };
    routes['/api/v1/executive/overview'] = { data: { revenue: { accrued: { value: null, n: 0 }, collected: { value: 120000, n: 2 } }, unpaid: { amount: 7153842, count: 80 }, todayPatients: 0, bedOccupancyPct: { numerator: 5, denominator: 57 } } };
    const { default: W } = await import('@/app/(main)/dashboard/components/widgets/ext/ExecutiveSummaryWidget');
    const { container } = wrap(<W />);
    await waitFor(() => expect(container.textContent).toContain('해당 건 없음'));
    expect(container.textContent).toMatch(/120,000/);
    expect(container.textContent).toMatch(/7,153,842/);
    expect(urls()).toContain('/api/v1/executive/overview');
  });

  it('접수 대기 요약 정본 — 서버 키(waitingNow·statusCounts)를 읽는다 · 없으면 null', () => {
    const s = queueWaitingSummary({ waitingNow: 260, statusCounts: [{ departmentName: '내과', status: 'WAITING', _count: 20 }], avgWaitMinutes: {}, waitSampleN: 0, waitUnmeasuredN: 260 });
    expect(s.waitingNow).toBe(260);
    expect(s.byDept).toEqual([{ dept: '내과', waiting: 20, avgWaitMin: null }]);
    expect(queueWaitingSummary({}).waitingNow).toBeNull();
  });

  it('🔴 지난 시각은 날짜로 — 오늘이 아니면 시각만 그리지 않는다', async () => {
    const { When } = await import('@/app/(main)/dashboard/components/widgets/ext/RowListWidget');
    const r = wrap(<When at="2026-08-17T03:55:00Z" />);
    await waitFor(() => expect(r.container.textContent).not.toBe(''));
    expect(r.container.textContent).not.toMatch(/^\d{1,2}:\d{2}$/);
  });

  it('간호사는 "오늘 내 예약"을 묻지 않는다(예약은 의사에게 걸린다)', async () => {
    user = { id: 'n-1', role: 'NURSE' };
    const { default: W } = await import('@/app/(main)/dashboard/components/widgets/MyTodayWidget');
    wrap(<W />);
    await waitFor(() => expect(get).toHaveBeenCalled());
    expect(urls().some((u) => u.includes('/appointments'))).toBe(false);
  });

  it('상단 지표 띠는 병원 전체라고 말한다', async () => {
    routes['/api/v1/dashboard/overview'] = { data: { myWaiting: 260 } };
    const { default: W } = await import('@/app/(main)/dashboard/components/widgets/StatBarWidget');
    const { container } = wrap(<W />);
    expect(container.querySelector('[data-statbar-scope]')?.textContent).toBe('병원 전체');
  });
});
