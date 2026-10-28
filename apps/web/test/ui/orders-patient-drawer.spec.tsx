/**
 * 오더 드릴다운 서랍(2026-10-06) — 한 환자의 오더·결과·처방·사람·차트 연동.
 *  · 권한 밖 역할은 부르지 않는다(서버 @Roles 와 같은 판정)
 *  · 검사 결과는 원장 값 그대로(재반올림 없음) · 위급/이상 플래그 색 · 참고 범위
 *  · DUR 무시 사유가 없으면 "기록 없음"(지어내지 않는다)
 *  · 동작은 기존 정본 EP 만 — 접수(ORDERED 만)·결과 확인(의사·RESULT_UNACK 만) · 완료 버튼 없음
 *  · 차트 연동 링크는 환자 차트 탭 키(`?tab=`)와 같다
 *  · 매트릭스 환자 이름 → 서랍
 * 재주입: 위 규칙 하나를 되돌리면 실패한다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuthStore } from '@/stores/auth-store';

const get = vi.fn();
const patch = vi.fn();
vi.mock('@/lib/api-client', async (orig) => ({ ...(await orig<object>()), apiClient: { get: (...a: unknown[]) => get(...a), patch: (...a: unknown[]) => patch(...a), getToken: () => 'x' } }));
vi.mock('@/components/clinical/allergy-status', () => ({ AllergyStatusBadge: () => <span data-allergy-badge /> }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => '/orders', useSearchParams: () => new URLSearchParams() }));
const wrap = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>;

const NOW = '2026-10-06T03:00:00.000Z';
const phases = { WAITING: 0, IN_PROCESS: 0, RESULT_UNACK: 0, DONE: 0, CANCELLED: 0 };
const people = { received: null, started: null, completed: null, acknowledged: null, cancelled: null };
const base = (over: Record<string, unknown>) => ({
  id: 'o1', department: 'LAB', name: 'CBC', priority: 'ROUTINE', status: 'ORDERED', phase: 'WAITING', careContext: 'INPATIENT',
  patient: { id: 'p1', name: '김하나', mrn: 'M1' }, location: null, doctor: '박의사', createdAt: '2026-10-05T03:00:00.000Z',
  stages: [{ key: 'ORDERED', at: '2026-10-05T03:00:00.000Z' }, { key: 'RECEIVED', at: null }],
  current: { key: 'ORDERED', at: '2026-10-05T03:00:00.000Z' }, next: 'RECEIVED', inStageMin: 25, sinceOrderedMin: 25, totalMin: null,
  critical: false, abnormal: false, attention: null, carriedOver: false, dur: { warned: false, overridden: false },
  prescription: null, people, notes: null, lab: null, imaging: null, dispensing: null, ...over,
});
const detail = (over: Record<string, unknown> = {}) => ({
  now: NOW, period: { from: '2026-09-29T15:00:00.000Z', days: 7 }, truncated: false, total: 3,
  patient: { id: 'p1', name: 'Бат-Эрдэнэ Сарнай', koreanName: '사르나이', mrn: 'FT-4', age: 36, gender: 'FEMALE' },
  location: { ward: '5층 내과병동', room: '501', bed: 'A' }, careContext: 'INPATIENT', doctors: ['박의사'],
  attention: { configured: false }, notes: [{ code: 'RESULT_UNACK', level: 'ATTENTION', count: 1, minutes: null }],
  byDept: [{ department: 'LAB', total: 2, byPhase: { ...phases, WAITING: 1, RESULT_UNACK: 1 } }, { department: 'PHARMACY', total: 1, byPhase: { ...phases, DONE: 1 } }],
  orders: [
    base({}),
    base({ id: 'o2', name: 'Chem', status: 'COMPLETED', phase: 'RESULT_UNACK', critical: true,
      lab: { status: 'COMPLETED', items: [{ name: 'K', value: '6.83', unit: 'mmol/L', flag: 'HH', range: { min: '3.5', max: '5.1' } }, { name: 'Na', value: '139', unit: 'mmol/L', flag: null, range: null }] },
      people: { ...people, completed: '이검사' } }),
    base({ id: 'o3', department: 'PHARMACY', name: 'Warfarin 5mg', status: 'COMPLETED', phase: 'DONE',
      prescription: { id: 'rx1', type: 'INPATIENT', dosage: '5mg', frequency: 'QD', route: 'PO', duration: 7, quantity: 7, durWarnings: ['병용 주의: Aspirin'], durOverridden: true, durOverrideReason: null } }),
  ],
  ...over,
});

beforeEach(() => { cleanup(); get.mockReset(); patch.mockReset(); useAuthStore.setState({ user: { id: 'u1', role: 'NURSE' } as never, isAuthenticated: true }); });

async function drawer(d: unknown) {
  get.mockResolvedValue({ data: d });
  const { OrderPatientDrawer } = await import('@/app/(main)/orders/OrderPatientDrawer');
  return render(<OrderPatientDrawer patientId="p1" onClose={() => {}} />, { wrapper: wrap });
}
const open = (c: HTMLElement, id: string) => fireEvent.click(c.querySelector(`[data-drawer-order="${id}"] button`)!);

describe('오더 드릴다운 서랍', () => {
  it('🔴 권한 밖 역할(원무)은 드릴다운 EP 를 부르지 않는다', async () => {
    useAuthStore.setState({ user: { id: 'r', role: 'RECEPTIONIST' } as never, isAuthenticated: true });
    const { container } = await drawer(detail());
    expect(container.textContent).toContain('의사·간호사·약사·임상병리사가 봅니다');
    expect(get).not.toHaveBeenCalled();
  });

  it('🔴 머리 — 원어+한국식 호칭·위치·진료의 · 차트 연동 링크는 차트 탭 키와 같다', async () => {
    const { container } = await drawer(detail());
    await waitFor(() => expect(container.querySelector('[data-drawer-header]')).toBeTruthy());
    expect(get).toHaveBeenCalledWith('/api/v1/orders/tracking/patient/p1');
    expect(container.querySelector('[data-drawer-header]')!.textContent).toContain('사르나이');
    expect(container.querySelector('[data-drawer-header]')!.textContent).toContain('501-A');
    const hrefs = [...container.querySelectorAll('[data-drawer-chart-links] a')].map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(['/patients/p1', '/patients/p1?tab=labresults', '/patients/p1?tab=imaging', '/patients/p1?tab=medications', '/patients/p1?tab=orders', '/patients/p1?tab=journey']);
    // 차트 화면의 탭 키와 기계 대조 — 탭 키가 바뀌면 링크가 첫 탭으로 떨어진다
    const chart = readFileSync(join(__dirname, '../../src/app/(main)/patients/[id]/page.tsx'), 'utf8');
    for (const h of hrefs.filter((x) => x!.includes('?tab='))) expect(chart).toContain(`key: '${h!.split('=')[1]}'`);
    expect(container.querySelector('[data-drawer-timeline]')).toBeTruthy();
    expect(container.querySelectorAll('[data-timeline-row]').length).toBe(3);
  });

  it('🔴 검사 결과는 원장 값 그대로 · 위급 플래그 색 · 범위 없으면 —', async () => {
    const { container } = await drawer(detail());
    await waitFor(() => expect(container.querySelector('[data-drawer-orders]')).toBeTruthy());
    open(container, 'o2');
    const lab = container.querySelector('[data-drawer-lab]')!;
    expect(lab.textContent).toContain('6.83');
    expect(lab.textContent).toContain('3.5–5.1');
    const kCell = [...lab.querySelectorAll('td')].find((td) => td.textContent?.includes('6.83'))!;
    expect(kCell.className).toContain('text-rose-700');
    const naRow = [...lab.querySelectorAll('tr')].find((tr) => tr.textContent?.includes('Na'))!;
    expect(naRow.textContent).toContain('—');
  });

  it('🔴 DUR 무시 사유가 없으면 "기록 없음"(지어내지 않는다) · 처방 세부', async () => {
    const { container } = await drawer(detail());
    await waitFor(() => expect(container.querySelector('[data-drawer-orders]')).toBeTruthy());
    open(container, 'o3');
    const dur = container.querySelector('[data-drawer-dur]')!;
    expect(dur.textContent).toContain('경고 후 무시');
    expect(dur.textContent).toContain('기록 없음');
    expect(container.querySelector('[data-drawer-rx]')!.textContent).toContain('5mg · QD · PO');
  });

  it('🔴 접수는 ORDERED 만·정본 EP · 결과 확인은 의사만 · 완료 버튼은 없다', async () => {
    patch.mockResolvedValue({ data: {} });
    const { container } = await drawer(detail());
    await waitFor(() => expect(container.querySelector('[data-drawer-orders]')).toBeTruthy());
    open(container, 'o1');
    fireEvent.click(container.querySelector('[data-drawer-action="receive"]')!);
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/api/v1/orders/o1/status', { status: 'RECEIVED' }));
    open(container, 'o2');
    expect(container.querySelector('[data-drawer-action="ack"]')).toBeNull(); // 간호사
    expect(container.querySelector('[data-drawer-action="receive"]')).toBeNull(); // COMPLETED
    expect(container.querySelector('[data-drawer-action="complete"]')).toBeNull();
  });

  it('🔴 의사는 결과 미확인 오더에 결과 확인 — 정본 EP', async () => {
    useAuthStore.setState({ user: { id: 'd', role: 'DOCTOR' } as never, isAuthenticated: true });
    patch.mockResolvedValue({ data: {} });
    const { container } = await drawer(detail());
    await waitFor(() => expect(container.querySelector('[data-drawer-orders]')).toBeTruthy());
    open(container, 'o2');
    fireEvent.click(container.querySelector('[data-drawer-action="ack"]')!);
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/api/v1/doctors/orders/o2/acknowledge', {}));
  });

  it('🔴 잘렸으면 말한다 · 대조군 — 안 잘렸으면 말하지 않는다', async () => {
    const { container } = await drawer(detail({ truncated: true, total: 412 }));
    await waitFor(() => expect(container.querySelector('[data-drawer-orders]')).toBeTruthy());
    expect(container.textContent).toContain('412');
    cleanup();
    const r = await drawer(detail());
    await waitFor(() => expect(r.container.querySelector('[data-drawer-orders]')).toBeTruthy());
    expect(r.container.textContent).not.toContain('전체 3건 중');
  });

  it('🔴 매트릭스 환자 이름을 누르면 서랍이 그 환자로 열린다', async () => {
    const phasesM = { ...phases, WAITING: 1 };
    get.mockImplementation((url: string) => Promise.resolve({ data: url.includes('/patient/') ? detail() : {
      date: '2026-10-06', now: NOW, population: 'DAY_ISSUED_PLUS_ACTIVE', truncated: false, total: 1, attention: { configured: false, thresholds: null },
      summary: { active: 1, waiting: 1, inProcess: 0, resultUnack: 0, done: 0, cancelled: 0, statActive: 0, critical: 0, attention: null, carriedOver: 0 },
      lanes: [], orders: [base({})],
      matrix: [{ patient: { id: 'p1', name: '김하나', mrn: 'M1' }, careContext: 'INPATIENT', total: 1, active: 1, stat: 0, critical: 0, oldestActiveMin: 25, notes: [],
        cells: { LAB: { total: 1, byPhase: phasesM, stat: 0, critical: 0, attention: 0, oldestActiveMin: 25, orderIds: ['o1'] }, IMAGING: null, PHARMACY: null, THERAPY: null } }],
    } }));
    const { OrderPatientMatrix } = await import('@/app/(main)/orders/OrderPatientMatrix');
    const { container } = render(<OrderPatientMatrix date="2026-10-06" filters={{ dept: '', care: '', statOnly: false, search: '' }} />, { wrapper: wrap });
    await waitFor(() => expect(container.querySelector('[data-track-drill="p1"]')).toBeTruthy());
    expect(document.querySelector('[data-order-drawer]')).toBeNull();
    fireEvent.click(container.querySelector('[data-track-drill="p1"]')!);
    await waitFor(() => expect(get).toHaveBeenCalledWith('/api/v1/orders/tracking/patient/p1'));
    expect(document.querySelector('[data-order-drawer]')).toBeTruthy();
  });
});
