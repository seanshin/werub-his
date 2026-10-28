import { describe, it, expect } from 'vitest';
import { disclosureIdentityIssues, financeRatios, parseCsvLine, peerDeviation, peerStat, regionOf } from './hospital-finance';

// 공시 실제 한 행(2021 · (의)나사렛의료재단 나사렛국제병원 · 원 단위) — 항등식이 맞는 행
const NAZARETH = {
  medicalRevenue: 79081905450, inpatientRevenue: 44082709774, outpatientRevenue: 24175326743, otherMedicalRevenue: 10823868933,
  medicalCost: 70483451542, laborCost: 37337543250, materialCost: 19157874834, adminCost: 13988033458, otherMedicalCost: 0,
  medicalProfit: 8598453908, nonMedicalRevenue: 5623968425, nonMedicalCost: 164045914, preTaxIncome: 14058376419,
};

describe('financeRatios', () => {
  it('분모 = 의료수익 · 의료이익률·경상이익률·비용 구조', () => {
    const r = financeRatios(NAZARETH);
    expect(r.medicalProfitMargin).toBeCloseTo(0.10873, 4);
    expect(r.ordinaryMargin).toBeCloseTo(0.17777, 4);
    expect(r.materialRatio).toBeCloseTo(0.24225, 4);
    expect(r.laborRatio! + r.materialRatio! + r.adminRatio!).toBeCloseTo(NAZARETH.medicalCost / NAZARETH.medicalRevenue, 9);
    // 경상이익률 = 의료이익률 + 의료외 순손익률(공시 항등식)
    expect(r.medicalProfitMargin! + r.nonMedicalNetRatio!).toBeCloseTo(r.ordinaryMargin!, 9);
    expect(r.netMargin).toBeNull(); // 당기순이익 계정이 없으면 산출 불가
  });
  it('🔴 의료수익 0·음수·없음 → 전부 null(산출 불가 · 0 아님) · 분자 없으면 그 지표만 null', () => {
    for (const rev of [0, -5, undefined]) {
      expect(Object.values(financeRatios({ ...NAZARETH, medicalRevenue: rev as number }))).toEqual(Array(9).fill(null));
    }
    const { laborCost: _, ...noLabor } = NAZARETH;
    expect(financeRatios(noLabor).laborRatio).toBeNull();
    expect(financeRatios(noLabor).materialRatio).not.toBeNull();
  });
});

describe('peerStat · peerDeviation', () => {
  it('중앙값·사분위·n · null 제외 · 표본 0 이면 전부 null', () => {
    expect(peerStat([0.1, null, 0.3, 0.2, undefined, -0.9])).toEqual({ n: 4, mean: expect.closeTo(-0.075, 9), median: expect.closeTo(0.15, 9), p25: expect.closeTo(-0.15, 9), p75: expect.closeTo(0.225, 9) });
    expect(peerStat([null])).toEqual({ n: 0, mean: null, median: null, p25: null, p75: null });
  });
  it('🔴 편차 기준은 중앙값(극단값에 끌리지 않게) · 비용은 높을수록 나쁨 · 이익은 낮을수록 나쁨', () => {
    const peer = peerStat([0.2, 0.22, 0.24, 0.26, 0.9]); // 평균 0.364 · 중앙값 0.24
    expect(peerDeviation('materialRatio', 0.4, peer)).toEqual({ diff: expect.closeTo(0.16, 9), worse: true });
    expect(peerDeviation('medicalProfitMargin', 0.1, peer)).toEqual({ diff: expect.closeTo(-0.14, 9), worse: true });
    expect(peerDeviation('laborRatio', null, peer)).toEqual({ diff: null, worse: null });
  });
});

describe('disclosureIdentityIssues · regionOf · parseCsvLine', () => {
  it('실제 공시 행은 항등식 통과 · 깨면 해당 식 이름', () => {
    expect(disclosureIdentityIssues(NAZARETH)).toEqual([]);
    expect(disclosureIdentityIssues({ ...NAZARETH, medicalProfit: 1 })).toEqual(['PROFIT', 'PRETAX']);
    expect(disclosureIdentityIssues({ ...NAZARETH, laborCost: 0 })).toEqual(['COST_PARTS']);
    expect(disclosureIdentityIssues({ medicalRevenue: 1 })).toEqual([]); // 검사할 계정이 없으면 검사하지 않는다
  });
  it('시도·시군구 · 따옴표 필드', () => {
    expect(regionOf('인천광역시 연수구 먼우금로 98')).toEqual({ sido: '인천광역시', sigungu: '연수구' });
    expect(regionOf(null)).toEqual({ sido: null, sigungu: null });
    // 🔴 공시 주소 실측(FY2024): 약칭 시도 · 시도가 첫 어절이 아닌 주소 · 시도가 없는 주소
    expect(regionOf('대전 유성구 계룡로 123')).toEqual({ sido: '대전광역시', sigungu: '유성구' });
    expect(regionOf('경북 안동시 앙실로 11')).toEqual({ sido: '경상북도', sigungu: '안동시' });
    expect(regionOf('1층 서울특별시 강남구 테헤란로 1')).toEqual({ sido: '서울특별시', sigungu: '강남구' });
    expect(regionOf('. 201호')).toEqual({ sido: null, sigungu: null });
    expect(regionOf('경기도 광주시 경충대로 1')).toEqual({ sido: '경기도', sigungu: '광주시' });
    expect(parseCsvLine('2021,"병원, 본관","a""b",3')).toEqual(['2021', '병원, 본관', 'a"b', '3']);
  });
});
