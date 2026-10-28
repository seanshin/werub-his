/**
 * 회복실 상세 패널(2026-10-07).
 *  · 마취 인계: 마취기록 없으면 "없다"고(지어내지 않음) · 있으면 기도·역전제·EBL
 *  · 점수 이력: 시점 라벨 · 없으면 "이력 없음"
 *  · 활력 추이: 2회 미만이면 그리지 않는다 · 빈 칸을 0 으로 잇지 않는다(구간 끊김)
 *  · 섭취·배설: 경로·양 없으면 저장 막힘 · 수지는 양쪽 다 있을 때만
 *  · 마취과 확인: 의사만 버튼 · 간호사는 "미확인(의사 몫)"
 *  · 질 지표: 분모 0 = 산출 불가
 * 재주입: 위 규칙 하나를 되돌리면 실패한다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuthStore } from '@/stores/auth-store';

const get = vi.fn();
vi.mock('@/lib/api-client', async (orig) => ({ ...(await orig<object>()), apiClient: { get: (...a: unknown[]) => get(...a), post: vi.fn(), patch: vi.fn(), getToken: () => 'x' } }));
const wrap = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>;
beforeEach(() => { cleanup(); get.mockReset(); });
const mod = () => import('@/app/(main)/pacu/PacuDetailPanels');

describe('마취 인계 카드', () => {
  it('🔴 마취기록이 없으면 없다고 말한다', async () => {
    get.mockResolvedValue({ data: { surgery: { procedureName: 'x' }, anesthesia: null, intraop: { total: 0, truncated: false, byKind: {} } } });
    const { AnesthesiaHandoffCard } = await mod();
    const { container } = render(<AnesthesiaHandoffCard recordId="r1" />, { wrapper: wrap });
    await waitFor(() => expect(container.querySelector('[data-pacu-handoff-none]')).toBeTruthy());
  });
  it('기록이 있으면 기도·역전제·EBL', async () => {
    get.mockResolvedValue({ data: { surgery: null, anesthesia: { anesthesiaType: 'GENERAL', airwayType: 'ETT', ettSize: '7.0', reversal: [{ drug: 'Sugammadex', dose: '200 mg' }], ebl: 150, urineOutput: null }, intraop: { total: 3, truncated: false, byKind: {} } } });
    const { AnesthesiaHandoffCard } = await mod();
    const { container } = render(<AnesthesiaHandoffCard recordId="r1" />, { wrapper: wrap });
    await waitFor(() => expect(container.textContent).toContain('ETT 7.0'));
    expect(container.textContent).toContain('Sugammadex');
    expect(container.textContent).toContain('EBL 150');
  });
});

describe('점수 이력·활력 추이', () => {
  it('🔴 시점 라벨 · 없으면 이력 없음', async () => {
    const { ScoreHistory } = await mod();
    const a = render(<ScoreHistory history={[{ kind: 'ALDRETE', score: 8, phase: 'ADMIT', at: '2026-10-07T01:00:00Z', by: null }, { kind: 'ALDRETE', score: 10, phase: 'DISCHARGE', at: '2026-10-07T02:00:00Z', by: null }]} />, { wrapper: wrap });
    expect(a.container.querySelector('[data-pacu-score-entry="ALDRETE-ADMIT"]')).toBeTruthy();
    expect(a.container.querySelector('[data-pacu-score-entry="ALDRETE-DISCHARGE"]')).toBeTruthy();
    cleanup();
    const b = render(<ScoreHistory history={[]} />, { wrapper: wrap });
    expect(b.container.querySelector('[data-pacu-score-history="none"]')).toBeTruthy();
  });
  it('🔴 측정 2회 미만이면 그리지 않는다 · 빈 칸은 선을 끊는다', async () => {
    const { VitalsTrend } = await mod();
    const one = render(<VitalsTrend vitals={[{ time: '2026-10-07T01:00:00Z', hr: 80 }]} />, { wrapper: wrap });
    expect(one.container.querySelector('[data-pacu-trend="few"]')).toBeTruthy();
    cleanup();
    const gap = render(<VitalsTrend vitals={[{ time: '2026-10-07T01:00:00Z', hr: 80 }, { time: '2026-10-07T01:10:00Z', spo2: 95 }, { time: '2026-10-07T01:20:00Z', hr: 90 }]} />, { wrapper: wrap });
    // HR 은 가운데 측정이 없어 두 조각(각 점 하나)이어야 한다 — 0 으로 내려 잇지 않는다
    const hrPaths = [...gap.container.querySelectorAll('path')].filter((p) => p.getAttribute('stroke') === '#e11d48');
    expect(hrPaths.length).toBe(2);
  });
});

describe('섭취·배설·마취과 확인·질 지표', () => {
  it('🔴 경로·양이 없으면 저장 막힘 · 한쪽만 있으면 수지 없음', async () => {
    const { PacuIoPanel } = await mod();
    const { container } = render(<PacuIoPanel record={{ id: 'r1', ioEntries: [{ kind: 'IN', route: 'IV', ml: 200, at: '2026-10-07T01:00:00Z' }] }} />, { wrapper: wrap });
    const save = container.querySelector('[data-pacu-io-save]') as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    expect(container.querySelector('[data-pacu-io-balance]')!.textContent).toBe('—');
    fireEvent.change(container.querySelector('[data-pacu-io-route]')!, { target: { value: 'IV' } });
    fireEvent.change(container.querySelector('input[aria-label="mL"]')!, { target: { value: '0' } });
    expect(save.disabled).toBe(false);
  });
  it('🔴 마취과 확인 버튼은 의사만', async () => {
    const { PacuOpsBar } = await mod();
    useAuthStore.setState({ user: { id: 'n', role: 'NURSE' } as never, isAuthenticated: true });
    const n = render(<PacuOpsBar record={{ id: 'r1' }} />, { wrapper: wrap });
    expect(n.container.querySelector('[data-pacu-signoff="pending"]')).toBeTruthy();
    cleanup();
    useAuthStore.setState({ user: { id: 'd', role: 'DOCTOR' } as never, isAuthenticated: true });
    const d = render(<PacuOpsBar record={{ id: 'r1' }} />, { wrapper: wrap });
    expect(d.container.querySelector('[data-pacu-signoff="button"]')).toBeTruthy();
  });
  it('질 지표 분모 0 = 산출 불가', async () => {
    const { PacuQualityStrip } = await mod();
    const z = { num: 0, den: 0, rate: null };
    const { container } = render(<PacuQualityStrip quality={{ sample: 0, ponvModerate: z, arrivalHypothermia: { ...z, thresholdC: 36 }, respiratoryEvent: z, icuDisposition: { ...z, plannedUnknown: true }, anesthesiaSignOff: z }} />, { wrapper: wrap });
    expect(container.querySelector('[data-pacu-qi="ponv"]')!.textContent).toContain('산출 불가');
  });
});
