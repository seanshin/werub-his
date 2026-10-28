import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const get = vi.fn();
vi.mock('@/lib/api-client', () => ({ apiClient: { get: (...a: unknown[]) => get(...a) } }));

import { ProfitDrilldown, type DrillRow } from '../../src/app/(main)/executive/finance-benchmark/ProfitDrilldown';

/**
 * 🔴 손익 흐름 세목 드릴다운(2026-09-29) — 줄을 누르면 세목이 펼쳐지고, 세목이 없는 해는 "세목 자료 없음"(0 으로 그리지 않는다).
 */
const cur: DrillRow = {
  name: '가병원', institutionCode: 'C1', beds: 100, medicalRevenue: 1000,
  ratios: { medicalProfitMargin: 0.1, ordinaryMargin: 0.1, laborRatio: 0.5, materialRatio: 0.2, adminRatio: 0.2, inpatientShare: 0.5, netMargin: 0.08, nonMedicalNetRatio: 0, researchShare: 0 },
  accounts: { medicalRevenue: 1000, laborCost: 500, materialCost: 200, adminCost: 200, medicalProfit: 100, nonMedicalRevenue: 10, nonMedicalCost: 10, preTaxIncome: 100, netIncome: 80 },
};
const node = (code: string, name: string, parent: string | null, amount: number | null, share: number | null, peer: number | null) =>
  ({ code, name, parent, amount, share, peerMedianShare: peer, peerN: 12 });
const wrap = () => render(<QueryClientProvider client={new QueryClient()}><ProfitDrilldown cur={cur} year={2024} /></QueryClientProvider>);

describe('손익 흐름 드릴다운', () => {
  beforeEach(() => get.mockReset());

  it('인건비를 누르면 세목(큰 것부터)·동급 대비(%p) — 비용이 동급보다 높으면 붉게 · 세목 합 불일치를 말한다', async () => {
    get.mockResolvedValue({ data: { available: true, peerCount: 12, mismatches: [{ code: '60201000', name: '인건비' }], nodes: [
      node('60201000', '인건비', '60200000', 500, 0.5, 0.45),
      node('60201010', '급여', '60201000', 300, 0.3, 0.25),
      node('60201030', '퇴직급여', '60201000', 150, 0.15, 0.16),
    ] } });
    wrap();
    const labor = await waitFor(() => { const b = document.querySelector('[data-step="labor"]') as HTMLButtonElement; expect(b.disabled).toBe(false); return b; });
    fireEvent.click(labor);
    const rows = [...document.querySelectorAll('[data-drill-row]')].map((r) => r.getAttribute('data-drill-row'));
    expect(rows).toEqual(['60201010', '60201030']); // 큰 것부터
    const salary = document.querySelector('[data-drill-row="60201010"]')!;
    expect(salary.textContent).toContain('+5.0%p');
    expect(salary.querySelector('.text-rose-600')).toBeTruthy();
    expect(screen.getByText(/세목 합이 상위 계정과 다른 곳: 인건비/)).toBeTruthy();
    // 세목이 없는 줄(의료이익)은 누를 수 없다
    expect((document.querySelector('[data-step="mp"]') as HTMLButtonElement).disabled).toBe(true);
  });

  it('세목 자료가 없는 해 — 펼칠 수 없고 "세목 자료 없음"을 말한다', async () => {
    get.mockResolvedValue({ data: { available: false, reason: 'NO_DETAIL' } });
    wrap();
    await screen.findByText(/세목 자료가 없어 상위 계정만/);
    expect((document.querySelector('[data-step="labor"]') as HTMLButtonElement).disabled).toBe(true);
  });
});
