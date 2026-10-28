/**
 * 전문진료 기능 확장·UX(2026-10-10).
 *  · 사전연명의료 등록: 미선택 시작 · 고른 항목만 보냄 · POLST 는 의사만 · 저장 어휘 DNR/DO 를 카드가 같은 말로
 *  · 방사선 진행 막대: 처방 총선량 없으면 그리지 않음 · 넘으면 넘었다고
 *  · TDM 추이: trough 미측정은 점 없음 · 목표 띠는 그 행에 하한·상한이 모두 있을 때만
 *  · 신경 점수 추이: 부분 GCS 를 총점으로 만들지 않음 · 점 둘 미만이면 변화 없음
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuthStore } from '@/stores/auth-store';

const get = vi.fn();
const post = vi.fn();
vi.mock('@/lib/api-client', async (orig) => ({ ...(await orig<object>()), apiClient: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a), patch: vi.fn(), getToken: () => 'x' } }));
const wrap = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>;
beforeEach(() => { cleanup(); get.mockReset(); post.mockReset(); post.mockResolvedValue({ data: { id: 'd1' } }); });

describe('사전연명의료 등록', () => {
  const mount = async (role: string) => {
    useAuthStore.setState({ user: { id: 'u1', role } as never, isAuthenticated: true });
    const { AdvanceDirectiveForm } = await import('@/app/(main)/hospice/AdvanceDirectiveForm');
    return render(<AdvanceDirectiveForm patientId="p1" />, { wrapper: wrap });
  };
  it('🔴 미선택 시작 — 종류와 항목 하나 이상을 골라야 · 고른 항목만 보낸다(시행으로 채우지 않는다)', async () => {
    const { container } = await mount('DOCTOR');
    const btn = () => container.querySelector('[data-directive-submit]') as HTMLButtonElement;
    expect(btn().disabled).toBe(true);
    fireEvent.change(container.querySelector('[data-directive-type]')!, { target: { value: 'POLST' } });
    expect(btn().disabled).toBe(true);
    fireEvent.change(container.querySelector('[data-directive-field="cprDecision"]')!, { target: { value: 'DNR' } });
    expect(btn().disabled).toBe(false);
    fireEvent.click(btn());
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post.mock.calls[0][1]).toEqual({ patientId: 'p1', documentType: 'POLST', cprDecision: 'DNR' });
  });
  it('🔴 간호사는 연명의료계획서(POLST)를 고를 수 없다 · 사전연명의료의향서는 등록', async () => {
    const { container } = await mount('NURSE');
    const opt = container.querySelector('[data-directive-type] option[value="POLST"]') as HTMLOptionElement;
    expect(opt.disabled).toBe(true);
    fireEvent.change(container.querySelector('[data-directive-type]')!, { target: { value: 'AD' } });
    fireEvent.change(container.querySelector('[data-directive-hospice]')!, { target: { value: 'no' } });
    fireEvent.change(container.querySelector('[data-directive-field="ventilatorDecision"]')!, { target: { value: 'DO' } });
    fireEvent.click(container.querySelector('[data-directive-submit]')!);
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post.mock.calls[0][1]).toEqual({ patientId: 'p1', documentType: 'AD', ventilatorDecision: 'DO', hospiceConsent: false });
  });
  it('카드는 저장 어휘를 같은 말로 · 모르는 값은 원문', async () => {
    get.mockResolvedValue({ data: [{ id: 'a', documentType: 'AD', registeredAt: '2026-10-01', status: 'ACTIVE', cprDecision: 'DNR', ventilatorDecision: 'XYZ' }] });
    const { AdvanceDirectiveCard } = await import('@/app/(main)/hospice/AdvanceDirectiveCard');
    const { container } = render(<AdvanceDirectiveCard patientId="p1" />, { wrapper: wrap });
    await waitFor(() => expect(container.textContent).toContain('시행하지 않음(유보·중단)'));
    expect(container.textContent).toContain('XYZ');
  });
});

describe('방사선 누적선량 진행', () => {
  it('🔴 처방 총선량이 없으면 막대를 그리지 않는다 · 넘으면 넘었다고', async () => {
    const { DoseProgressBar, fractionCounts } = await import('@/app/(main)/radiation/radiation-dose');
    expect(render(<DoseProgressBar summary={{ deliveredGy: 10, recordedFractions: 5, prescribedGy: null }} />).container.innerHTML).toBe('');
    cleanup();
    const { container } = render(<DoseProgressBar summary={{ deliveredGy: 62, recordedFractions: 31, prescribedGy: 60 }} />);
    expect(container.querySelector('[data-dose-progress="over"]')).not.toBeNull();
    cleanup();
    expect(render(<DoseProgressBar summary={{ deliveredGy: 30, recordedFractions: 15, prescribedGy: 60 }} />).container.querySelector('[data-dose-progress="within"]')).not.toBeNull();
    expect(fractionCounts([{ status: 'DELIVERED' }, { status: 'DELIVERED' }, { status: 'SCHEDULED' }])).toEqual({ DELIVERED: 2, SCHEDULED: 1 });
  });
});

describe('TDM 추이', () => {
  it('🔴 trough 미측정은 점 없음 · 목표 띠는 하한·상한이 모두 기록된 행만', async () => {
    const { tdmSeries, TdmTrendChart } = await import('@/app/(main)/transplant/transplant-tdm');
    const rows = [
      { id: '1', drug: 'tac', troughLevel: 8, peakLevel: null, targetLow: 5, targetHigh: 10, inRange: true, doseAdjustment: null, sampledAt: '2026-10-01T00:00:00Z' },
      { id: '2', drug: 'tac', troughLevel: null, peakLevel: null, targetLow: 5, targetHigh: 10, inRange: null, doseAdjustment: null, sampledAt: '2026-10-02T00:00:00Z' },
      { id: '3', drug: 'tac', troughLevel: 12, peakLevel: null, targetLow: null, targetHigh: 10, inRange: null, doseAdjustment: null, sampledAt: '2026-10-03T00:00:00Z' },
    ];
    const s = tdmSeries(rows as never);
    expect(s.get('tac')!.map((p) => p.v)).toEqual([8, 12]);
    const { container } = render(<TdmTrendChart drug="tac" points={s.get('tac')!} />);
    expect(container.querySelectorAll('[data-tdm-band]').length).toBe(1);
  });
});

describe('신경 점수 추이', () => {
  it('🔴 부분 GCS 는 총점이 아니다 · 저장 총점 우선 · 둘 미만이면 변화 없음', async () => {
    const { neuroSeries, neuroDelta } = await import('@/lib/specialty/neuro-trend');
    const s = neuroSeries([
      { examinedAt: '2026-10-01T00:00:00Z', gcsEye: 4, gcsMotor: 6 },
      { examinedAt: '2026-10-02T00:00:00Z', gcsTotal: 9, nihss: 12 },
      { examinedAt: '2026-10-03T00:00:00Z', gcsEye: 4, gcsVerbal: 5, gcsMotor: 6, nihss: 8 },
    ]);
    expect(s.gcs.map((p) => p.v)).toEqual([9, 15]);
    expect(s.nihss.map((p) => p.v)).toEqual([12, 8]);
    expect(neuroDelta(s.nihss)).toBe(-4);
    expect(neuroDelta(s.gcs.slice(0, 1))).toBeNull();
  });
});
