/**
 * 의사 할 일함(2026-10-07) — 결과 확인·구두 처방 확인·갱신 대기·약사 회신을 한 곳에서.
 *  · 요약은 각 목록 정본 응답만(서버 counts·버킷 그대로) · 조회 실패는 "0건 아님" · 하나라도 모르면 전체 합계를 말하지 않는다
 *  · 결과 확인함이 잘렸으면 가장 오래 기다린 시간을 모른다고 · "늦음"은 판정하지 않는다
 *  · 카드를 누르면 그 목록 화면(정본 컴포넌트)이 탭으로 · 메뉴는 하나 · 개별 경로는 OFF_NAV · 알림은 할 일함 탭으로
 * 재주입: 위 규칙 하나를 되돌리면 실패한다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuthStore } from '@/stores/auth-store';
import { groupByPatient, inboxGrandTotal, summarizeConsults, summarizePreOrders, summarizeRenewals, summarizeResults, summarizeVerbal, summarizePharmacist, waitedMinutes, summarizeUnsigned, summarizeSentConsults, overdueOf } from '@/lib/doctor-inbox';

const get = vi.fn();
const replace = vi.fn();
let search = new URLSearchParams();
vi.mock('@/lib/api-client', async (orig) => ({ ...(await orig<object>()), apiClient: { get: (...a: unknown[]) => get(...a), patch: vi.fn(), post: vi.fn(), getToken: () => 'x' } }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace }), usePathname: () => '/doctor-inbox', useSearchParams: () => search }));
const wrap = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>;

describe('요약 — 사전처방·협진·환자별', () => {
  it('🔴 사전처방: 기록된 만료 시각·예정일만으로 구분(서버 판정 지어내지 않음)', () => {
    const now = Date.parse('2026-10-07T03:00:00Z');
    expect(summarizePreOrders([
      { createdAt: '2026-10-01T00:00:00Z', scheduledDate: '2026-10-05', expiresAt: '2026-10-06T00:00:00Z' },
      { createdAt: '2026-10-02T00:00:00Z', scheduledDate: '2026-10-07', expiresAt: null },
      { createdAt: '2026-10-03T00:00:00Z', scheduledDate: null, expiresAt: null },
    ], now, '2026-10-07')).toMatchObject({ total: 3, urgent: [{ label: '만료 시각 지남', count: 1 }, { label: '예정일 지남', count: 1 }], other: [{ label: '오늘 예정', count: 1 }], oldestAt: '2026-10-01T00:00:00Z' });
  });
  it('🔴 협진: 열린 것만 · 의뢰서 긴급도 어휘만 · 상한까지 왔으면 잘림', () => {
    const items = [{ createdAt: '2026-10-06T00:00:00Z', status: 'REQUESTED', urgency: 'EMERGENT' }, { createdAt: '2026-10-07T00:00:00Z', status: 'ACCEPTED', urgency: 'ROUTINE' }, { createdAt: '2026-10-05T00:00:00Z', status: 'REPLIED', urgency: 'URGENT' }];
    expect(summarizeConsults(items, 50)).toMatchObject({ total: 2, urgent: [{ label: '응급', count: 1 }, { label: '긴급', count: 0 }], other: [{ label: '접수함', count: 1 }], truncated: false, oldestAt: '2026-10-06T00:00:00Z' });
    expect(summarizeConsults(items, 3).truncated).toBe(true);
  });
  it('🔴 환자별: id 우선·없으면 MRN · 둘 다 없으면 묶지 않고 센다 · 긴급 많은 순', () => {
    const r = groupByPatient([
      { category: 'results', patient: { id: 'p1', mrn: 'M1', familyName: '김', givenName: '가' }, at: '2026-10-06T00:00:00Z', urgent: false },
      { category: 'renewals', patient: { id: 'p2', mrn: 'M2', familyName: '이', givenName: '나' }, at: '2026-10-05T00:00:00Z', urgent: true },
      { category: 'pharmacist', patient: { id: null, mrn: 'M2', familyName: '이', givenName: '나' }, at: '2026-10-04T00:00:00Z', urgent: false },
      { category: 'verbal', patient: { id: 'p1', mrn: 'M1', familyName: '김', givenName: '가' }, at: '2026-10-07T00:00:00Z', urgent: false },
      { category: 'consults', patient: null, at: null, urgent: true },
      { category: 'consults', patient: { id: null, mrn: null, familyName: '박', givenName: null }, at: null, urgent: false },
    ]);
    expect(r.unattributed).toBe(2);
    expect(r.rows.map((x) => x.key)).toEqual(['id:p2', 'id:p1', 'mrn:M2']);
    expect(r.rows[1]).toMatchObject({ total: 2, counts: { results: 1, verbal: 1 }, oldestAt: '2026-10-06T00:00:00Z' });
  });
});

describe('요약 — 정본 응답만', () => {
  it('결과: 서버 counts 그대로 · 잘렸으면 가장 오래된 시각 모름', () => {
    const full = summarizeResults({ total: 2, counts: { critical: 1, abnormal: 1, other: 0 }, items: [{ completedAt: '2026-10-07T01:00:00Z' }, { completedAt: '2026-10-06T01:00:00Z' }] });
    expect(full).toMatchObject({ total: 2, urgent: [{ label: '위급', count: 1 }], oldestAt: '2026-10-06T01:00:00Z', truncated: false });
    const cut = summarizeResults({ total: 300, counts: { critical: 0, abnormal: 0, other: 300 }, items: [{ completedAt: '2026-10-06T01:00:00Z' }] });
    expect(cut).toMatchObject({ total: 300, oldestAt: null, truncated: true });
  });
  it('구두: 복창 기록 없음 수 · 가장 오래된 처방', () => {
    expect(summarizeVerbal({ total: 2, truncated: false, items: [{ createdAt: '2026-10-07T02:00:00Z', readBackConfirmedAt: null }, { createdAt: '2026-10-07T01:00:00Z', readBackConfirmedAt: '2026-10-07T01:05:00Z' }] }))
      .toMatchObject({ total: 2, urgent: [{ label: '복창 기록 없음', count: 1 }], oldestAt: '2026-10-07T01:00:00Z' });
  });
  it('갱신: 서버 버킷 합 · 만료 기준 시각은 기간 끝', () => {
    expect(summarizeRenewals({ counts: { EXPIRED: 1, ENDING_SOON: 2, NO_END: 3 }, truncated: false, items: [{ createdAt: '2026-10-01T00:00:00Z', dosing: { endsAt: '2026-10-05T00:00:00Z' } }] }))
      .toMatchObject({ total: 6, urgent: [{ label: '만료됨', count: 1 }], oldestAt: '2026-10-05T00:00:00Z' });
  });
  it('약사: 중재+대체조제', () => {
    expect(summarizePharmacist([{ createdAt: '2026-10-07T00:00:00Z' }], [{ requestedAt: '2026-10-06T00:00:00Z' }], false)).toMatchObject({ total: 2, oldestAt: '2026-10-06T00:00:00Z' });
  });
  it('🔴 하나라도 실패·조회 중이면 전체 합계 없음 · 미래 시각은 경과 없음', () => {
    const s = summarizePharmacist([], [], false);
    expect(inboxGrandTotal([s, s])).toBe(0);
    expect(inboxGrandTotal([s, 'failed'])).toBeNull();
    expect(inboxGrandTotal([s, 'loading'])).toBeNull();
    expect(waitedMinutes('2099-01-01T00:00:00Z', Date.parse('2026-10-07T00:00:00Z'))).toBeNull();
    expect(waitedMinutes('2026-10-06T23:00:00Z', Date.parse('2026-10-07T00:00:00Z'))).toBe(60);
  });
});

// 나 기준 후속 일(2026-10-10) — 기본은 모두 0 · 처리 기한 미설정
let FOLLOWUPS: Record<string, unknown> = {};
const emptyFollowups = () => ({
  unsignedEncounters: { items: [], total: 0, truncated: false },
  unsignedDischargeSummaries: { items: [], total: 0, truncated: false },
  repliedConsults: { items: [], total: 0, truncated: false },
  policy: { dueHours: null }, limit: 50,
});
function route(fail: string[] = []) {
  if (!Object.keys(FOLLOWUPS).length) FOLLOWUPS = emptyFollowups();
  get.mockImplementation((url: string) => {
    const f = fail.find((x) => url.includes(x));
    if (f) return Promise.reject(new Error('boom'));
    if (url.includes('/doctors/results-inbox')) return Promise.resolve({ data: { scope: 'MINE', patientId: null, total: 1, counts: { critical: 1, abnormal: 0, other: 0 }, offset: 0, limit: 100, items: [{ orderId: 'o1', completedAt: '2026-10-06T00:00:00Z', severity: 'CRITICAL', patient: { id: 'p1', mrn: 'M1', familyName: '김', givenName: '가' } }] } });
    if (url.includes('/verbal-cosign/pending')) return Promise.resolve({ data: { items: [], total: 0, cap: 200, truncated: false } });
    if (url.includes('/renewals/due')) return Promise.resolve({ data: { items: [], counts: { EXPIRED: 0, ENDING_SOON: 0, NO_END: 0 }, soonHours: 24, noEndReviewDays: null, scanned: 0, totalActive: 0, truncated: false } });
    if (url.includes('/interventions/mine')) return Promise.resolve({ data: [] });
    if (url.includes('/substitution/mine')) return Promise.resolve({ data: [] });
    if (url.includes('/pre-orders/pending')) return Promise.resolve({ data: { data: [{ id: 'po1', type: 'LAB', createdAt: '2026-10-06T00:00:00Z', patient: { id: 'p9', mrn: 'M9', familyName: '최', givenName: '라' }, procedureCode: { nameKo: 'CBC' } }] } });
    if (url.includes('/consultations/inbox')) return Promise.resolve({ data: [{ id: 'c1', createdAt: '2026-10-06T00:00:00Z', status: 'REQUESTED', urgency: 'URGENT', encounter: { patient: { id: 'p9', mrn: 'M9', familyName: '최', givenName: '라' } } }] });
    if (url.includes('/doctors/my-followups')) return Promise.resolve({ data: FOLLOWUPS });
    return Promise.resolve({ data: [] });
  });
}
async function mount(role = 'DOCTOR') {
  useAuthStore.setState({ user: { id: 'u1', role, familyName: '박', givenName: '내과' } as never, isAuthenticated: true });
  const { default: Page } = await import('@/app/(main)/doctor-inbox/page');
  return render(<Page />, { wrapper: wrap });
}
beforeEach(() => { cleanup(); get.mockReset(); replace.mockReset(); search = new URLSearchParams(); FOLLOWUPS = {}; });

describe('화면', () => {
  it('🔴 넷을 센다 · 위급 표지 · 전체 합계', async () => {
    route();
    const { container } = await mount();
    await waitFor(() => expect(container.querySelector('[data-inbox-grand="3"]')).toBeTruthy());
    expect(container.querySelector('[data-inbox-card="results"] [data-inbox-urgent="1"]')).toBeTruthy();
    expect(container.querySelector('[data-inbox-card="consults"] [data-inbox-urgent="1"]')).toBeTruthy();
    expect(container.querySelectorAll('[data-inbox-card]').length).toBe(8);
  });
  it('🔴 실패는 "0건 아님" · 전체 합계는 말하지 않는다', async () => {
    route(['/renewals/due']);
    const { container } = await mount();
    await waitFor(() => expect(container.querySelector('[data-inbox-failed="renewals"]')).toBeTruthy());
    expect(container.querySelector('[data-inbox-grand="unknown"]')).toBeTruthy();
    expect(container.querySelector('[data-inbox-card="renewals"] [data-inbox-total]')).toBeNull();
  });
  it('카드를 누르면 그 탭 · 탭 파라미터면 그 목록 화면', async () => {
    route();
    search = new URLSearchParams('tab=verbal');
    const { container } = await mount();
    expect(container.querySelector('[data-inbox-panel="verbal"]')).toBeTruthy();
    fireEvent.click(container.querySelector('[data-inbox-card="renewals"]')!);
    expect(replace).toHaveBeenCalledWith('/doctor-inbox?tab=renewals', { scroll: false });
  });
});

describe('권한·범위·배치', () => {
  it('🔴 권한 밖(간호사)은 목록을 부르지 않고 이유를 말한다', async () => {
    route();
    const { container } = await mount('NURSE');
    expect(container.querySelector('[data-inbox-forbidden]')).toBeTruthy();
    await new Promise((r) => setTimeout(r, 0));
    expect(get).not.toHaveBeenCalled();
  });
  it('🔴 누구의 목록인지 말한다 · 관리자는 "다른 의사의 일을 모아 보는 화면이 아니다"', async () => {
    route();
    const doc = await mount('DOCTOR');
    await waitFor(() => expect(doc.container.querySelector('[data-inbox-scope="DOCTOR"]')).toBeTruthy());
    expect(doc.container.querySelector('[data-inbox-admin-note]')).toBeNull();
    cleanup();
    const adm = await mount('ADMIN');
    await waitFor(() => expect(adm.container.querySelector('[data-inbox-admin-note]')).toBeTruthy());
  });
  it('묶음 4(결과·처방·기록·협업) · 먼저 볼 것은 0 이 아닌 긴급 구분만 · 누르면 그 목록', async () => {
    route();
    const { container } = await mount();
    await waitFor(() => expect(container.querySelector('[data-inbox-firsts]')).toBeTruthy());
    expect([...container.querySelectorAll('[data-inbox-group]')].map((g) => g.getAttribute('data-inbox-group'))).toEqual(['result', 'order', 'record', 'collab']);
    expect(container.querySelector('[data-inbox-group="order"] [data-inbox-card="preorders"]')).toBeTruthy();
    const firsts = [...container.querySelectorAll('[data-inbox-first]')].map((b) => b.getAttribute('data-inbox-first'));
    expect(firsts).toEqual(['results', 'consults']);
    fireEvent.click(container.querySelector('[data-inbox-first="consults"]')!);
    expect(replace).toHaveBeenCalledWith('/doctor-inbox?tab=consults', { scroll: false });
  });
});

describe('환자별 보기·사전처방 목록', () => {
  it('🔴 한 환자에게 걸린 일을 묶는다(사전처방+협진) · 칩을 누르면 그 목록', async () => {
    route();
    search = new URLSearchParams('view=patients');
    const { container } = await mount();
    await waitFor(() => expect(container.querySelector('[data-inbox-patient="id:p9"]')).toBeTruthy());
    const row = container.querySelector('[data-inbox-patient="id:p9"]')!;
    expect(row.querySelector('[data-inbox-patient-chip="preorders"]')).toBeTruthy();
    expect(row.querySelector('[data-inbox-patient-urgent="1"]')).toBeTruthy();
    // 긴급(위급 결과)·협진 긴급 환자가 위로
    expect(container.querySelectorAll('[data-inbox-patient]')[0].getAttribute('data-inbox-patient')).toMatch(/id:p(1|9)/);
    fireEvent.click(row.querySelector('[data-inbox-patient-chip="consults"]')!);
    expect(replace).toHaveBeenCalledWith('/doctor-inbox?tab=consults', { scroll: false });
  });
  it('🔴 차트에서 온 환자만(patient=) · 결과 칩은 그 환자 결과로', async () => {
    route();
    search = new URLSearchParams('view=patients&patient=p9');
    const { container } = await mount();
    await waitFor(() => expect(container.querySelector('[data-inbox-patient="id:p9"]')).toBeTruthy());
    expect(container.querySelector('[data-inbox-patient-focus="p9"]')).toBeTruthy();
    expect(container.querySelectorAll('[data-inbox-patient]').length).toBe(1);
  });
  it('결과 칩은 그 환자의 결과 목록으로(patientId)', async () => {
    route();
    search = new URLSearchParams('view=patients');
    const { container } = await mount();
    await waitFor(() => expect(container.querySelector('[data-inbox-patient="id:p1"] [data-inbox-patient-chip="results"]')).toBeTruthy());
    fireEvent.click(container.querySelector('[data-inbox-patient="id:p1"] [data-inbox-patient-chip="results"]')!);
    expect(replace).toHaveBeenCalledWith('/doctor-inbox?tab=results&patientId=p1', { scroll: false });
  });
  it('🔴 못 받은 목록은 환자별 보기에 없다고 말한다', async () => {
    route(['/consultations/inbox']);
    search = new URLSearchParams('view=patients');
    const { container } = await mount();
    await waitFor(() => expect(container.querySelector('[data-inbox-patients-missing]')).toBeTruthy());
    expect(container.querySelector('[data-inbox-patients-missing]')!.textContent).toContain('협진 회신 대기');
  });
  it('🔴 사전처방 목록 — 응답 이중 봉투를 풀고 · 승인은 차트 사전처방 탭으로', async () => {
    route();
    search = new URLSearchParams('tab=preorders');
    const { container } = await mount();
    await waitFor(() => expect(container.querySelector('[data-preorder-row="po1"]')).toBeTruthy());
    expect(container.querySelector('[data-preorder-open="po1"]')!.getAttribute('href')).toBe('/patients/p9?tab=pre-orders');
  });
});

describe('배선', () => {
  const read = (p: string) => readFileSync(resolve(__dirname, '../../src', p), 'utf8');
  it('🔴 메뉴는 하나 · 개별 화면은 OFF_NAV · 알림·위젯은 할 일함 탭으로', () => {
    const side = read('components/layout/Sidebar.tsx');
    const nav = side.slice(side.indexOf('export const NAV_SECTIONS'), side.indexOf('export const OFF_NAV_SCREENS'));
    expect(nav).toContain("href: '/doctor-inbox'");
    for (const h of ['/results-inbox', '/verbal-orders', '/renewals', '/pharmacist-replies']) {
      expect(nav).not.toContain(`href: '${h}'`);
      expect(side.slice(side.indexOf('export const OFF_NAV_SCREENS'))).toContain(`href: '${h}'`);
    }
    expect(read('stores/notification-store.ts')).toContain("'/doctor-inbox?tab=results'");
    expect(read('stores/notification-store.ts')).toContain("'/doctor-inbox?tab=pharmacist'");
  });
  it('🔴 목록은 정본 화면 컴포넌트를 그대로 싣는다(두 번째 목록을 만들지 않는다)', () => {
    const page = read('app/(main)/doctor-inbox/page.tsx');
    for (const m of ['../results-inbox/page', '../verbal-orders/page', '../renewals/page', '../pharmacist-replies/page']) expect(page).toContain(`from '${m}'`);
  });
});

describe('나 기준 후속 일 — 미서명 기록·회신 도착한 내 협진·처리 기한(2026-10-10)', () => {
  const NOW = Date.parse('2026-10-10T00:00:00Z');
  const f = () => ({
    unsignedEncounters: { items: [{ id: 'e1', createdAt: '2026-10-08T00:00:00Z', updatedAt: '2026-10-08T00:00:00Z', chiefComplaint: '두통', patient: { id: 'p1', mrn: 'M1', familyName: '김', givenName: '가' } }], total: 1, truncated: false },
    unsignedDischargeSummaries: { items: [{ id: 'd1', admissionId: 'a1', createdAt: '2026-10-09T00:00:00Z', updatedAt: '2026-10-09T00:00:00Z', admission: { patient: { id: 'p2', mrn: 'M2', familyName: '이', givenName: '나' }, dischargeDate: '2026-10-09T00:00:00Z', status: 'DISCHARGED' } }], total: 1, truncated: false },
    repliedConsults: { items: [{ id: 'c9', toDepartment: '신경과', urgency: 'URGENT', reason: '의식 변화', replyContent: 'MRI 권함', recommendations: null, repliedAt: '2026-10-09T12:00:00Z', createdAt: '2026-10-09T00:00:00Z', replyDoctor: { familyName: '정', givenName: '신경' }, encounter: { id: 'en9', patient: { id: 'p9', mrn: 'M9', familyName: '최', givenName: '라' } } }], total: 1, truncated: false },
    policy: { dueHours: null as number | null }, limit: 50,
  });

  it('미서명: 진료기록+퇴원요약 · 퇴원 후 미서명 퇴원요약이 먼저 볼 것 · 잘리면 가장 오래 기다림 모름', () => {
    expect(summarizeUnsigned(f() as never)).toMatchObject({ total: 2, urgent: [{ label: '퇴원 후 미서명 퇴원요약', count: 1 }], oldestAt: '2026-10-08T00:00:00Z', truncated: false });
    const t = f(); t.unsignedEncounters.truncated = true; t.unsignedEncounters.total = 80;
    expect(summarizeUnsigned(t as never)).toMatchObject({ total: 81, oldestAt: null, truncated: true });
  });
  it('회신 도착: 기다림은 회신 도착 시각부터 · 긴급 구분은 의뢰서 어휘', () => {
    expect(summarizeSentConsults(f() as never)).toMatchObject({ total: 1, urgent: [{ label: '응급', count: 0 }, { label: '긴급', count: 1 }], oldestAt: '2026-10-09T12:00:00Z' });
  });
  it('🔴 처리 기한 미설정이면 늦음을 판정하지 않는다(null) · 설정되면 가장 오래 기다린 항목으로', () => {
    expect(overdueOf('2026-10-08T00:00:00Z', null, NOW)).toBeNull();
    expect(overdueOf('2026-10-08T00:00:00Z', 24, NOW)).toBe(true);
    expect(overdueOf('2026-10-09T12:00:00Z', 24, NOW)).toBe(false);
    expect(overdueOf(null, 24, NOW)).toBeNull();
  });

  it('화면: 카드 둘 · 기한 미설정 고지 · 넘김 표지 없음', async () => {
    FOLLOWUPS = f();
    route();
    const { container } = await mount();
    await waitFor(() => expect(container.querySelector('[data-inbox-card="unsigned"] [data-inbox-total="2"]')).toBeTruthy());
    expect(container.querySelector('[data-inbox-card="sentConsults"] [data-inbox-total="1"]')).toBeTruthy();
    expect(container.querySelector('[data-inbox-due="unset"]')).toBeTruthy();
    expect(container.querySelector('[data-inbox-overdue]')).toBeNull();
  });
  it('화면: 기한이 설정되면 넘긴 목록에만 표지', async () => {
    const x = f(); x.policy.dueHours = 1; FOLLOWUPS = x;
    route();
    const { container } = await mount();
    await waitFor(() => expect(container.querySelector('[data-inbox-due="1"]')).toBeTruthy());
    await waitFor(() => expect(container.querySelector('[data-inbox-overdue="unsigned"]')).toBeTruthy());
  });
  it('🔴 후속 일 조회 실패는 두 카드 모두 "0건 아님" · 기한도 판정하지 않는다', async () => {
    route(['/doctors/my-followups']);
    const { container } = await mount();
    await waitFor(() => expect(container.querySelector('[data-inbox-failed="unsigned"]')).toBeTruthy());
    expect(container.querySelector('[data-inbox-failed="sentConsults"]')).toBeTruthy();
    expect(container.querySelector('[data-inbox-due="failed"]')).toBeTruthy();
  });
  it('탭: 미서명 기록 목록 — 진료기록은 그 기록으로, 퇴원요약은 퇴원요약 화면으로', async () => {
    FOLLOWUPS = f();
    route();
    search = new URLSearchParams('tab=unsigned');
    const { container } = await mount();
    await waitFor(() => expect(container.querySelector('[data-unsigned-open="e1"]')).toBeTruthy());
    expect(container.querySelector('[data-unsigned-open="e1"]')!.getAttribute('href')).toBe('/patients/p1/encounter/new?encounterId=e1');
    expect(container.querySelector('[data-unsigned-discharge-open="d1"]')!.getAttribute('href')).toBe('/inpatient/a1/discharge-summary');
  });
});
