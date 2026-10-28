/**
 * 새 처방 입력 — 처방 도우미(2026-10-07).
 *  · 진단 기반 표준처방(CP) 추천: 상병 없으면 부르지 않고 그렇다고 말한다 · 의사만(관리자는 EP 403 → 칩 없음) · 매칭 근거·금기 미대조 경고 · 적용은 약속처방 미리보기로
 *  · 사전처방 대기: 감싼 응답을 푼다 · 이번 진료로 승인(encounterId) · 처방 목록에 더한다 · DUR 재검증 실패는 경고 · 간호사는 승인 버튼 없음
 *  · 임상경로: 시작일=Day 0 · 앞선 날 기록 없는 항목은 "기록 없음"(지연이라 말하지 않는다) · 기록된 결과는 그대로
 *  · 약속처방 세트 적용: 실패 항목을 말없이 빼지 않는다 · 근거 상병을 붙인다
 * 재주입: 위 규칙 하나를 되돌리면 실패한다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuthStore } from '@/stores/auth-store';
import { useToastStore } from '@/stores/toast-store';

const get = vi.fn();
const patch = vi.fn();
vi.mock('@/lib/api-client', async (orig) => ({ ...(await orig<object>()), apiClient: { get: (...a: unknown[]) => get(...a), patch: (...a: unknown[]) => patch(...a), post: vi.fn(), getToken: () => 'x' } }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => '/orders', useSearchParams: () => new URLSearchParams() }));
const wrap = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>;

const preOrder = { id: 'po1', type: 'LAB', priority: 'ROUTINE', reason: '재진 전 검사', createdAt: '2026-10-01T01:00:00Z', doctor: { familyName: '박', givenName: '내과' }, procedureCode: { code: 'B1010', nameKo: 'CBC' } };
const assignment = { id: 'as1', status: 'ACTIVE', startDate: '2026-10-05', pathway: { name: '폐렴 표준진료지침', code: 'CP-PNA', totalDays: 7 } };
const detail = {
  ...assignment,
  pathway: { ...assignment.pathway, milestones: [
    { id: 'm0', day: 0, category: 'ORDER', title: '흉부 X선', isRequired: true },
    { id: 'm1', day: 1, category: 'MEDICATION', title: '항생제 시작', isRequired: true },
    { id: 'm2', day: 2, category: 'ASSESSMENT', title: '활력 재평가', isRequired: false },
    { id: 'm3', day: 3, category: 'EDUCATION', title: '흡입 교육', isRequired: false },
  ] },
  outcomes: [{ milestoneId: 'm0', status: 'DONE' }],
};
type Routes = { rec?: unknown; pre?: unknown; asg?: unknown; det?: unknown };
function route(r: Routes) {
  get.mockImplementation((url: string) => {
    if (url.includes('/order-sets/recommend')) return Promise.resolve({ data: r.rec ?? [] });
    if (url.includes('/pre-orders/patient/')) return Promise.resolve({ data: r.pre ?? { data: [] } });
    if (url.endsWith('/pathways/assignments')) return Promise.resolve({ data: r.asg ?? [] });
    if (url.includes('/pathways/assignments/')) return Promise.resolve({ data: r.det ?? detail });
    return Promise.resolve({ data: null });
  });
}
async function bar(role: string, props: Partial<{ diagnosisCodes: string[]; primaryCode: string | null }> = {}, r: Routes = {}) {
  useAuthStore.setState({ user: { id: 'u1', role } as never, isAuthenticated: true });
  route(r);
  const onOpenOrderSet = vi.fn(); const onPrescriptionsAdded = vi.fn();
  const { OrderAssistBar } = await import('@/app/(main)/orders/OrderAssistBar');
  const utils = render(<OrderAssistBar patientId="p1" encounterId="e1" diagnosisCodes={props.diagnosisCodes ?? []} primaryCode={props.primaryCode ?? null}
    today="2026-10-07" onOpenOrderSet={onOpenOrderSet} onPrescriptionsAdded={onPrescriptionsAdded} />, { wrapper: wrap });
  return { ...utils, onOpenOrderSet, onPrescriptionsAdded };
}
const click = (c: HTMLElement, sel: string) => fireEvent.click(c.querySelector(sel)!);

beforeEach(() => { cleanup(); get.mockReset(); patch.mockReset(); useToastStore.setState({ toasts: [] }); });

describe('처방 도우미 — 진단 기반 표준처방', () => {
  it('🔴 상병 없으면 추천 EP 를 부르지 않고 그렇다고 말한다', async () => {
    const { container } = await bar('DOCTOR');
    click(container, '[data-assist-chip="CP"]');
    expect(container.querySelector('[data-assist-cp-needs-dx]')).toBeTruthy();
    expect(get.mock.calls.some((c) => String(c[0]).includes('recommend'))).toBe(false);
  });

  it('🔴 상병으로 부르고 매칭 근거·주상병·금기 미대조를 보인다 · 적용은 약속처방 미리보기로', async () => {
    const { container, onOpenOrderSet } = await bar('DOCTOR', { diagnosisCodes: ['J18.9', 'E11'], primaryCode: 'J18.9' }, {
      rec: [{ id: 'os1', name: '폐렴 입원 세트', matchedBy: 'EXACT', matchedCode: 'J18.9', items: [{}, {}, {}], contraUnevaluated: true }],
    });
    await waitFor(() => expect(get).toHaveBeenCalledWith('/api/v1/order-sets/recommend', { diagnosisCodes: 'J18.9,E11', primaryCode: 'J18.9', patientId: 'p1' }));
    click(container, '[data-assist-chip="CP"]');
    await waitFor(() => expect(container.querySelector('[data-assist-cp="os1"]')).toBeTruthy());
    const row = container.querySelector('[data-assist-cp="os1"]')!.textContent!;
    expect(row).toContain('상병 일치'); expect(row).toContain('주상병'); expect(row).toContain('자동 대조가 안 됩니다');
    click(container, '[data-assist-cp-open="os1"]');
    expect(onOpenOrderSet).toHaveBeenCalledWith('os1');
  });

  it('관리자 — 추천 EP 는 RolesGuard 관리자 통과(운영 200)라 칩과 호출이 있다 · 간호사는 없다(대조군)', async () => {
    const { container } = await bar('ADMIN', { diagnosisCodes: ['J18.9'] });
    expect(container.querySelector('[data-assist-chip="CP"]')).toBeTruthy();
    await waitFor(() => expect(get.mock.calls.some((c) => String(c[0]).includes('recommend'))).toBe(true));
    cleanup(); get.mockReset();
    const n = await bar('NURSE', { diagnosisCodes: ['J18.9'] });
    expect(n.container.querySelector('[data-assist-chip="CP"]')).toBeNull();
    await new Promise((r) => setTimeout(r, 0));
    expect(get.mock.calls.some((c) => String(c[0]).includes('recommend'))).toBe(false);
  });
});

describe('처방 도우미 — 사전처방 대기', () => {
  it('🔴 감싼 응답을 풀어 건수를 보이고 · 이번 진료로 승인 → 처방 목록에 더한다', async () => {
    patch.mockResolvedValue({ data: { durCheck: { status: 'PASS' } } });
    const { container, onPrescriptionsAdded } = await bar('DOCTOR', {}, { pre: { data: [preOrder] } });
    await waitFor(() => expect(container.querySelector('[data-assist-chip="PREORDER"]')!.textContent).toContain('1'));
    click(container, '[data-assist-chip="PREORDER"]');
    expect(container.querySelector('[data-assist-preorder="po1"]')!.textContent).toContain('박내과');
    click(container, '[data-assist-approve="po1"]');
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/api/v1/pre-orders/po1/approve', { encounterId: 'e1' }));
    await waitFor(() => expect(onPrescriptionsAdded).toHaveBeenCalledWith([{ type: 'LAB', name: 'CBC', code: 'B1010' }]));
  });

  it('🔴 승인 때 DUR 재검증 실패는 경고로 말한다(성공처럼 말하지 않는다)', async () => {
    patch.mockResolvedValue({ data: { durCheck: { status: 'FAILED' } } });
    const { container } = await bar('DOCTOR', {}, { pre: { data: [preOrder] } });
    await waitFor(() => expect(container.querySelector('[data-assist-chip="PREORDER"]')!.textContent).toContain('1'));
    click(container, '[data-assist-chip="PREORDER"]');
    click(container, '[data-assist-approve="po1"]');
    await waitFor(() => expect(useToastStore.getState().toasts.some((t) => t.type === 'warning' && t.message.includes('DUR'))).toBe(true));
    expect(useToastStore.getState().toasts.some((t) => t.type === 'success')).toBe(false);
  });

  it('간호사 — 사전처방은 보이되 승인 버튼은 없다 · 경로 칩은 있다 · 추천 칩은 없다', async () => {
    const { container } = await bar('NURSE', {}, { pre: { data: [preOrder] } });
    await waitFor(() => expect(container.querySelector('[data-assist-chip="PREORDER"]')!.textContent).toContain('1'));
    click(container, '[data-assist-chip="PREORDER"]');
    expect(container.querySelector('[data-assist-approve="po1"]')).toBeNull();
    expect(container.querySelector('[data-assist-chip="PATHWAY"]')).toBeTruthy();
    expect(container.querySelector('[data-assist-chip="CP"]')).toBeNull();
  });
});

describe('처방 도우미 — 임상경로', () => {
  it('🔴 시작일 Day 0 · 앞선 날 미기록은 "기록 없음"(지연 아님) · 완료는 그대로', async () => {
    const { container } = await bar('DOCTOR', {}, { asg: [assignment] });
    await waitFor(() => expect(container.querySelector('[data-assist-chip="PATHWAY"]')!.textContent).toContain('1'));
    click(container, '[data-assist-chip="PATHWAY"]');
    await waitFor(() => expect(container.querySelector('[data-assist-day]')).toBeTruthy());
    expect(container.querySelector('[data-assist-day]')!.getAttribute('data-assist-day')).toBe('2');
    await waitFor(() => expect(container.querySelector('[data-assist-ms="overdue"]')).toBeTruthy());
    const overdue = container.querySelector('[data-assist-ms="overdue"]')!;
    expect(overdue.textContent).toContain('항생제 시작');
    expect(overdue.textContent).toContain('기록 없음');
    expect(overdue.textContent).not.toContain('흉부 X선'); // Day 0 은 완료
    expect(overdue.textContent).not.toMatch(/지연(?! 기록)/);
    expect(container.querySelector('[data-assist-ms="today"]')!.textContent).toContain('활력 재평가');
    expect(container.querySelector('[data-assist-ms="next"]')!.textContent).toContain('흡입 교육');
  });

  it('🔴 예정 기간을 넘긴 경로는 그렇다고 말한다 · 대조군: 기간 안이면 말하지 않는다', async () => {
    const late = await bar('DOCTOR', {}, { asg: [{ ...assignment, startDate: '2026-08-26T00:00:00.000Z' }], det: { ...detail, startDate: '2026-08-26T00:00:00.000Z' } });
    await waitFor(() => expect(late.container.querySelector('[data-assist-chip="PATHWAY"]')!.textContent).toContain('1'));
    click(late.container, '[data-assist-chip="PATHWAY"]');
    await waitFor(() => expect(late.container.querySelector('[data-assist-overrun]')).toBeTruthy());
    cleanup();
    const ok = await bar('DOCTOR', {}, { asg: [assignment] });
    await waitFor(() => expect(ok.container.querySelector('[data-assist-chip="PATHWAY"]')!.textContent).toContain('1'));
    click(ok.container, '[data-assist-chip="PATHWAY"]');
    await waitFor(() => expect(ok.container.querySelector('[data-assist-day]')).toBeTruthy());
    expect(ok.container.querySelector('[data-assist-overrun]')).toBeNull();
  });

  it('pathwayDayOf — 달력 날짜 차이(시각·시간대 무관)', async () => {
    const { pathwayDayOf } = await import('@/app/(main)/orders/OrderAssistBar');
    expect(pathwayDayOf('2026-10-05', '2026-10-05')).toBe(0);
    expect(pathwayDayOf('2026-09-30T00:00:00.000Z', '2026-10-02')).toBe(2);
    expect(pathwayDayOf('bad', '2026-10-02')).toBeNull();
  });
});

describe('약속처방 세트 적용(새 처방 입력 창)', () => {
  const src = readFileSync(join(__dirname, '../../src/app/(main)/orders/page.tsx'), 'utf8');
  const panel = src.slice(src.indexOf('function OrderSetPanel('), src.indexOf('const renderSetRow'));
  it('🔴 실패 항목을 말없이 빼지 않는다 — 이름·이유를 말한다', () => {
    expect(panel).toContain('failed.push(');
    expect(panel).not.toMatch(/catch\s*\{\s*\/\*\s*skip/);
    expect(panel).toMatch(/if \(failed\.length\)\s*\{\s*toast\.error/);
  });
  it('🔴 세트 항목에도 근거 상병을 붙인다', () => {
    expect(panel).toMatch(/\.\.\.\(diagnosisCodeId \? \{ diagnosisCodeId \} : \{\}\)/);
    expect(src).toMatch(/diagnosisCodeId=\{diagnoses\.find\(d => d\.type === 'PRIMARY'\)\?\.diagnosisCodeId\}/);
  });
});
