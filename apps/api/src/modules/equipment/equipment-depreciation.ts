/**
 * 장비 감가상각(정액법) 순수 계산 — 테스트 용이성 위해 서비스에서 분리.
 * GL 전기는 ERP 담당, HIS는 자산관리 조회용.
 */

// 카테고리별 내용연수(년). 기본 5년.
export const USEFUL_LIFE: Record<string, number> = {
  진단장비: 8, 치료장비: 6, 수술장비: 6, 응급장비: 5, 모니터링: 5, 검사장비: 8, 영상장비: 8,
};

export function usefulLifeOf(category: string): number {
  return USEFUL_LIFE[category] ?? 5;
}

export interface DepreciationYear { year: number; depreciation: number; accumulated: number; bookValue: number }
export interface DepreciationResult {
  method: 'STRAIGHT_LINE';
  usefulLifeYears: number;
  annualDepreciation: number;
  currentBookValue: number;
  accumulatedDepreciation: number;
  fullyDepreciated: boolean;
  schedule: DepreciationYear[];
}

/**
 * 정액법 감가상각 스케줄.
 * @param purchasePrice 취득가(원)
 * @param startYear 취득연도
 * @param category 카테고리(내용연수 결정)
 * @param retired 처분(RETIRED) 여부 — true면 현재 장부가 0
 * @param nowYear 현재 연도
 */
export function computeDepreciation(purchasePrice: number, startYear: number, category: string, retired: boolean, nowYear: number): DepreciationResult {
  const years = usefulLifeOf(category);
  const annual = Math.round(purchasePrice / years);

  let accumulated = 0;
  const schedule: DepreciationYear[] = [];
  for (let y = 0; y < years; y++) {
    const dep = y === years - 1 ? purchasePrice - accumulated : annual; // 최종연도 잔액 보정(정수 오차)
    accumulated += dep;
    schedule.push({ year: startYear + y, depreciation: dep, accumulated, bookValue: Math.max(0, purchasePrice - accumulated) });
  }

  const elapsed = Math.min(years, Math.max(0, nowYear - startYear + 1));
  const currentAccum = elapsed >= years ? purchasePrice : Math.min(purchasePrice, annual * elapsed);
  const currentBookValue = retired ? 0 : Math.max(0, purchasePrice - currentAccum);

  return {
    method: 'STRAIGHT_LINE',
    usefulLifeYears: years,
    annualDepreciation: annual,
    currentBookValue,
    accumulatedDepreciation: retired ? purchasePrice : currentAccum,
    fullyDepreciated: nowYear >= startYear + years,
    schedule,
  };
}
