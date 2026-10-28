import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TrendChart, type TrendRow } from '../../src/app/(main)/executive/finance-benchmark/TrendChart';

/**
 * 🔴 경영성과 추이 — 가로축은 연도. 공시가 없는 해는 선을 끊고 "공시 없음"(2026-09-29).
 *    종전: 점을 순서대로 이어 2021→2023 이 이웃한 한 칸처럼 그려졌다(없는 해를 조용히 건너뜀).
 */
const r = (year: number, v: number): TrendRow => ({
  year, hospitalType: '상급종합병원',
  ratios: { medicalProfitMargin: v, ordinaryMargin: v, laborRatio: null, materialRatio: null, adminRatio: null, inpatientShare: null, netMargin: null, nonMedicalNetRatio: null, researchShare: null },
  peerMedian: { medicalProfitMargin: 0, ordinaryMargin: 0 }, peerN: 10,
});

describe('추이 차트', () => {
  it('빠진 해(2022)는 "공시 없음" 칸 · 그 양쪽은 선으로 잇지 않는다', () => {
    const { container } = render(<QueryClientProvider client={new QueryClient()}><TrendChart k="medicalProfitMargin" rows={[r(2020, 0.02), r(2021, 0.05), r(2023, 0.03), r(2024, -0.02)]} /></QueryClientProvider>);
    expect([...container.querySelectorAll('[data-missing-year]')].map((g) => g.getAttribute('data-missing-year'))).toEqual(['2022']);
    expect(container.textContent).toContain('공시 없음');
    // 값 선: 2020→2021, 2023→2024 두 개(2021→2023 없음) + 중앙값 점선 두 개
    const solid = [...container.querySelectorAll('line')].filter((l) => !l.getAttribute('stroke-dasharray'));
    expect(solid).toHaveLength(2);
    // 가로 위치가 연도 간격 — 2023 은 2021 에서 두 칸
    const cx = [...container.querySelectorAll('circle')].map((c) => Number(c.getAttribute('cx')));
    expect(cx[2] - cx[1]).toBeCloseTo((cx[1] - cx[0]) * 2);
  });
});
