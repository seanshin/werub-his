/**
 * 간호 근무조 도구(2026-10-10) — VS 일괄 NEWS2 칸·미리보기 · I/O 수지 패널 · 위험 평가 추이 패널.
 *  · 🔴 의식·산소는 관측했을 때만 보낸다(미관측을 ALERT/false 로 채우지 않는다) · 7요소가 없으면 NEWS2 를 0점으로 그리지 않는다
 *  · 🔴 원내 기준 미설정이면 배설 공백을 강조하지 않는다 · 재측정 빈도는 RCP 참고라고 말한다
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { buildVsBatchBody, vsBatchHasValue, vsBatchNews2Preview } from '@/lib/vs-batch-form';

const get = vi.fn();
vi.mock('@/lib/api-client', async (orig) => ({ ...(await orig<object>()), apiClient: { get: (...a: unknown[]) => get(...a), post: vi.fn(), patch: vi.fn(), getToken: () => 'x' } }));
const wrap = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>;
beforeEach(() => { cleanup(); get.mockReset(); });

describe('VS 일괄 폼', () => {
  it('🔴 의식·산소는 고른 경우에만 · 측정 시각은 ISO · 재원 함께', () => {
    const b = buildVsBatchBody({ heartRate: '80', consciousness: '', supplementalO2: '' }, 'p1', 'a1');
    expect(b).toEqual({ patientId: 'p1', admissionId: 'a1', heartRate: 80 });
    const b2 = buildVsBatchBody({ heartRate: '80', consciousness: 'VOICE', supplementalO2: 'false', measuredAtLocal: '2026-10-10T09:00' }, 'p1');
    expect(b2).toMatchObject({ consciousness: 'VOICE', supplementalO2: false });
    expect(typeof b2.measuredAt).toBe('string');
    expect(vsBatchHasValue({ patientId: 'p1', admissionId: 'a1', measuredAt: 'x' })).toBe(false);
  });
  it('🔴 NEWS2 미리보기 — 7요소가 다 있을 때만 · 빠진 요소를 말한다', () => {
    const five = { respiratoryRate: '16', spO2: '98', systolicBp: '120', heartRate: '70', bodyTemperature: '36.8' };
    expect(vsBatchNews2Preview(five)).toMatchObject({ result: null, missing: ['산소 투여', '의식'] });
    const full = vsBatchNews2Preview({ ...five, supplementalO2: 'true', consciousness: 'ALERT' });
    expect(full.result?.totalScore).toBe(2);
    expect(full.missing).toEqual([]);
  });
});

describe('I/O 수지 패널', () => {
  const block = (i: number, o: number, rows = 1) => ({ from: '', to: '', rows, totalIntake: i, totalOutput: o, balance: i - o, byLedger: { IO: { intake: i, output: o, rows }, FLOWSHEET: { intake: 0, output: 0, rows: 0 } } });
  const data = (output: Record<string, unknown>) => ({ data: { shift: { name: 'DAY', ...block(300, 200) }, previousShift: { name: 'NIGHT', ...block(0, 0, 0) }, last24h: block(800, 200), output } });
  it('🔴 기준 미설정이면 강조하지 않고 그렇게 말한다 · 0 mL 기록 수', async () => {
    get.mockResolvedValue(data({ lastOutputAt: '2026-10-09T23:00:00Z', hoursSinceLastOutput: 6, zeroOutputRecords24h: 1, alertHours: null, overdue: null }));
    const { IoBalancePanel } = await import('@/components/nursing/IoBalancePanel');
    const { container } = render(<IoBalancePanel admissionId="a1" />, { wrapper: wrap });
    await waitFor(() => expect(container.querySelector('[data-io-balance]')).not.toBeNull());
    expect(container.querySelector('[data-io-output-gap]')!.getAttribute('data-io-output-gap')).toBe('unjudged');
    expect(container.textContent).toContain('nursing.io.noOutputAlertHours');
    expect(container.querySelector('[data-io-zero-output="1"]')).not.toBeNull();
    expect(container.querySelector('[data-io-balance-block="shift"] [data-io-balance-value="100"]')).not.toBeNull();
  });
  it('기준을 넘었으면 강조', async () => {
    get.mockResolvedValue(data({ lastOutputAt: '2026-10-09T23:00:00Z', hoursSinceLastOutput: 6, zeroOutputRecords24h: 0, alertHours: 4, overdue: true }));
    const { IoBalancePanel } = await import('@/components/nursing/IoBalancePanel');
    const { container } = render(<IoBalancePanel admissionId="a1" />, { wrapper: wrap });
    await waitFor(() => expect(container.querySelector('[data-io-output-gap="overdue"]')).not.toBeNull());
  });
});

describe('위험 평가 추이 패널', () => {
  it('🔴 재측정은 원내 규정 아님(RCP 참고) · 지났으면 표시 · 재평가 일정 없음을 말한다', async () => {
    get.mockResolvedValue({ data: {
      patientId: 'p1',
      news2: { items: [{ id: 'e1', recordedAt: '2026-10-10T00:00:00Z', totalScore: 5, riskLevel: 'MEDIUM', escalationRequired: true, supplementalO2: false, consciousness: 'ALERT' }], total: 1, truncated: false,
        monitoringReference: { band: 'MEDIUM', minIntervalHours: 1, label: '최소 1시간마다' }, monitoringSource: 'RCP NEWS2(2017) 임상 대응 — 원내 규정 아님' },
      fall: { items: [], total: 0, truncated: false }, braden: { items: [], total: 0, truncated: false, needsReview: 0 }, schedules: [],
    } });
    const { RiskHistoryPanel } = await import('@/components/nursing/RiskHistoryPanel');
    const { container } = render(<RiskHistoryPanel admissionId="a1" now={Date.parse('2026-10-10T03:00:00Z')} />, { wrapper: wrap });
    await waitFor(() => expect(container.querySelector('[data-news2-monitoring="MEDIUM"]')).not.toBeNull());
    expect(container.querySelector('[data-news2-past="yes"]')).not.toBeNull();
    expect(container.textContent).toContain('원내 규정 아님');
    expect(container.querySelector('[data-reassess-none]')).not.toBeNull();
  });
  it('🔴 NEWS2 가 없으면 0점이 아니라 없다고', async () => {
    get.mockResolvedValue({ data: { patientId: 'p1', news2: { items: [], total: 0, truncated: false, monitoringReference: null, monitoringSource: '' }, fall: { items: [], total: 0, truncated: false }, braden: { items: [], total: 0, truncated: false, needsReview: 0 }, schedules: [] } });
    const { RiskHistoryPanel } = await import('@/components/nursing/RiskHistoryPanel');
    const { container } = render(<RiskHistoryPanel admissionId="a1" />, { wrapper: wrap });
    await waitFor(() => expect(container.querySelector('[data-news2-trend]')).not.toBeNull());
    expect(container.querySelector('[data-news2-point]')).toBeNull();
    expect(container.querySelector('[data-news2-monitoring]')).toBeNull();
  });
});
