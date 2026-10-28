/**
 * 대시보드 위젯 파서 계약 테스트 (W8 · R8)
 *
 * 🔴 여기 fixture 는 **서버가 실제로 반환하는 객체 그대로**다(각 case 에 원본 file:line 을 적었다).
 *    위젯이 영구 '-' 였던 이유는 조회 실패가 아니라 **키 이름이 서버와 달랐기** 때문이고,
 *    그런 결함은 200 OK 라서 로그에도 남지 않는다 — 계약을 여기서 못 박는다.
 */
import { describe, it, expect } from 'vitest';
import {
  bedStatusSummary,
  cashierTodaySummary,
  patientFlowSummary,
  bloodInventorySummary,
  adrSummary,
  satisfactionSummary,
} from '@/lib/widget-summaries';

describe('bedStatusSummary — GET /api/v1/beds/status (bed.service.ts getBedStatusSummary)', () => {
  it('byStatus 배열에서 사용중/가용을 꺼내고 가동률을 낸다 (운영 실측: 총 57 · OCCUPIED 5 · AVAILABLE 49)', () => {
    const r = bedStatusSummary({
      total: 57,
      byStatus: [{ status: 'AVAILABLE', _count: 49 }, { status: 'OCCUPIED', _count: 5 }, { status: 'MAINTENANCE', _count: 3 }],
    });
    expect(r).toEqual({ total: 57, occupied: 5, available: 49, occupancyRate: 9 });
  });

  it('🔴 등록 병상 0 이면 가동률은 0% 가 아니라 null(산출 불가)', () => {
    const r = bedStatusSummary({ total: 0, byStatus: [] });
    expect(r.occupancyRate).toBeNull();
    expect(r.occupancyRate).not.toBe(0);
  });

  it('응답이 비어도 던지지 않는다', () => {
    expect(bedStatusSummary(undefined).total).toBe(0);
  });
});

describe('cashierTodaySummary — GET /api/v1/billing/cashier-stats (billing.service.ts _getCashierStats)', () => {
  it('서버 키(totalRevenue·completedCount·pendingCount·deferredCount)를 위젯 칸으로 잇는다', () => {
    const r = cashierTodaySummary({ pendingCount: 54, completedCount: 26, deferredCount: 0, totalRevenue: 1234500 });
    expect(r).toEqual({ todayRevenue: 1234500, todayCount: 26, pendingCount: 54, deferredCount: 0 });
  });

  it('🔴 이 EP 에 없는 미수납 **금액**을 만들어내지 않는다', () => {
    const r = cashierTodaySummary({ pendingCount: 54, completedCount: 0, deferredCount: 0, totalRevenue: 0 });
    expect(Object.keys(r)).not.toContain('unpaidAmount');
  });
});

describe('patientFlowSummary — GET /api/v1/operational-stats/patient-flow', () => {
  it('newAdmissions/dischargedToday/activePatients/netFlow 를 잇는다', () => {
    const r = patientFlowSummary({ newAdmissions: 12, dischargedToday: 9, activePatients: 5, netFlow: 3 });
    expect(r).toEqual({ admitted: 12, discharged: 9, active: 5, netFlow: 3 });
  });

  it('종전 키(admitted/discharged)로 오는 응답은 없다 — 0 으로 접혀도 사실이 바뀌지 않게 방어', () => {
    expect(patientFlowSummary({ admitted: 99, discharged: 99 }).admitted).toBe(0);
  });
});

describe('bloodInventorySummary — GET /api/v1/blood-bank/inventory/stats (groupBy 배열)', () => {
  // 운영 실측: A/POS 5·A/NEG 1·AB/POS 2·B/POS 3·O/POS 6(+ISSUED 1)·O/NEG 1 … rhFactor 는 응답에 없다
  const fixture = [
    { productType: 'RBC', bloodType: 'A', status: 'AVAILABLE', count: 6 },
    { productType: 'RBC', bloodType: 'AB', status: 'AVAILABLE', count: 2 },
    { productType: 'RBC', bloodType: 'B', status: 'AVAILABLE', count: 3 },
    { productType: 'RBC', bloodType: 'O', status: 'AVAILABLE', count: 7 },
    { productType: 'RBC', bloodType: 'O', status: 'ISSUED', count: 1 },
  ];

  it('상태별 유닛 수를 센다', () => {
    const r = bloodInventorySummary(fixture);
    expect(r.availableUnits).toBe(18);
    expect(r.issuedUnits).toBe(1);
    expect(r.totalUnits).toBe(19);
  });

  it('🔴 A+/B+/O+ 를 만들지 않는다 — 응답에 rhFactor 가 없어 ABO 를 Rh 로 참칭하면 수혈 적합성을 잘못 말한다', () => {
    const r = bloodInventorySummary(fixture) as unknown as Record<string, unknown>;
    expect(Object.keys(r)).not.toContain('aPositive');
    expect(Object.keys(r)).not.toContain('oPositive');
  });
});

describe('adrSummary — GET /api/v1/pharmacy/adr/stats (groupBy 배열)', () => {
  const fixture = [
    { suspectedDrugCode: 'D1', severity: 'SEVERE', _count: { id: 2 } },
    { suspectedDrugCode: 'D1', severity: 'MILD', _count: { id: 5 } },
    { suspectedDrugCode: 'D2', severity: 'MODERATE', _count: { id: 3 } },
    { suspectedDrugCode: 'D3', severity: 'FATAL', _count: { id: 1 } },
  ];

  it('건수·중증도·의심약물 수를 센다 (FATAL 은 중증에 포함)', () => {
    expect(adrSummary(fixture)).toEqual({ total: 11, severe: 3, moderate: 3, drugs: 3 });
  });

  it('🔴 groupBy 에 없는 thisMonth·resolved 를 0 으로 지어내지 않는다', () => {
    const r = adrSummary(fixture) as unknown as Record<string, unknown>;
    expect(Object.keys(r)).not.toContain('thisMonth');
    expect(Object.keys(r)).not.toContain('resolved');
  });
});

describe('satisfactionSummary — GET /api/v1/satisfaction/stats/department (배열·표본 없으면 [])', () => {
  it('응답 수로 가중 평균한 NPS 를 낸다', () => {
    const r = satisfactionSummary([
      { department: '내과', nps: 50, responseCount: 10 },
      { department: '외과', nps: 0, responseCount: 10 },
    ]);
    expect(r.avgNps).toBe(25);
    expect(r.responses).toBe(20);
    expect(r.departments).toBe(2);
    expect(r.worstNps).toBe(0);
  });

  it('🔴 응답 0건이면 평균 NPS 는 0(=최악)이 아니라 null(산출 불가)', () => {
    const r = satisfactionSummary([]);
    expect(r.avgNps).toBeNull();
    expect(r.worstNps).toBeNull();
    expect(r.responses).toBe(0);
  });
});
