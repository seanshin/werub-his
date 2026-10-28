import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TypeOverview, orderTypes } from '../../src/app/(main)/executive/finance-benchmark/TypeOverview';

/**
 * 경영성과 종별 개관(2026-09-28) — 종합병원 밖(병원·요양병원·정신병원)도 공시가 있다 · 의원은 공시 대상이 아니다.
 */
const ratios = (m: number | null) => ({
  medicalProfitMargin: m, ordinaryMargin: m, laborRatio: 0.5, materialRatio: 0.2, adminRatio: 0.2,
  inpatientShare: 0.5, netMargin: m, nonMedicalNetRatio: 0, researchShare: 0,
});
const row = (name: string, hospitalType: string | null, profit: number | null) => ({
  name, hospitalType, beds: 100, medicalProfit: profit, ratios: ratios(profit == null ? null : profit > 0 ? 0.1 : -0.1),
});

describe('종별 개관', () => {
  it('정본 순서(상급종합→종합→병원→요양) 뒤에 그 밖의 종별(정신병원)', () => {
    expect(orderTypes(['정신병원', '요양병원', '종합병원', '병원', '상급종합병원'])).toEqual(['상급종합병원', '종합병원', '병원', '요양병원', '정신병원']);
  });

  it('종별 줄 · 흑자 기관은 분모 병기 · 의원 줄은 손익을 채우지 않는다 · 종별 없는 기관 수를 밝힌다 · 줄을 누르면 그 종별', () => {
    const onPick = vi.fn();
    const { getByText, container } = render(
      <QueryClientProvider client={new QueryClient()}><TypeOverview active="" onPick={onPick} rows={[
        row('가', '요양병원', 1), row('나', '요양병원', -1), row('다', '요양병원', null),
        row('라', '정신병원', 1), row('마', null, 1),
      ]} /></QueryClientProvider>,
    );
    const trs = [...container.querySelectorAll('tbody tr')];
    expect(trs.map((t) => t.querySelector('td')?.textContent)).toEqual(['요양병원', '정신병원', '의원(개원가)']);
    // 요양병원 — 의료이익 산출 가능 2곳 중 흑자 1곳(null 은 분모에서 뺀다)
    const surplus = trs[0].querySelectorAll('td')[3].textContent ?? '';
    expect(surplus).toMatch(/1\s*\/\s*2/);
    expect(surplus).toMatch(/50/);
    expect(getByText(/공개된 손익이 없습니다/)).toBeTruthy();
    expect(getByText(/종별이 비어 있는 기관 1곳/)).toBeTruthy();
    fireEvent.click(trs[1]);
    expect(onPick).toHaveBeenCalledWith('정신병원');
  });
});
