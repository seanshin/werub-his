import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ExecutiveService } from '../../src/modules/executive/executive.service';

/**
 * 🔴 이 스펙은 화면 실사용 점검 W7(2026-08-14) 에서 **정본으로 갱신**됐다.
 *    종전 스펙은 다음 결함을 그대로 굳혀두고 있었다:
 *      - `unpaidCount` = 오늘 생성된 PENDING 건수 (알림은 전 기간을 세어 같은 화면이 0건/54건을 동시 주장)
 *      - `getInfection` 이 `organism === 'MRSA'` 완전일치라도 통과 (실 컬럼은 학명이라 항상 0)
 *      - `getClinicalWeeklyTrend().departments` 가 하드코딩 6과와 정확히 같기를 **요구**
 *      - 표본이 없을 때 rate 가 100/0 이어도 통과
 */

describe('ExecutiveService', () => {
  let service: ExecutiveService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      billing: { findMany: vi.fn(), count: vi.fn(), aggregate: vi.fn() },
      encounter: { findMany: vi.fn(), count: vi.fn(), groupBy: vi.fn() },
      encounterDiagnosis: { findMany: vi.fn() },
      bed: { findMany: vi.fn(), count: vi.fn() },
      admission: { findMany: vi.fn(), count: vi.fn() },
      icuBed: { count: vi.fn() },
      icuAdmission: { count: vi.fn() },
      user: { findMany: vi.fn().mockResolvedValue([]) },
      staff: { groupBy: vi.fn() },
      claim: { findMany: vi.fn(), aggregate: vi.fn() },
      inventoryItem: { count: vi.fn(), fields: { safetyStock: 'safetyStock' } },
      equipment: { count: vi.fn() },
      appointment: { count: vi.fn() },
      waitingQueue: { count: vi.fn(), groupBy: vi.fn() },
      surgery: { count: vi.fn() },
      safetyIncident: { findMany: vi.fn() },
      infectionSurveillance: { findMany: vi.fn() },
    };

    /**
     * 🔴 (2026-09-16 J3) KPI 목표치는 코드 상수에서 **원내 설정(`exec.target.*`)**으로 옮겼다 —
     *    목표가 설정돼 있지 않으면 달성률을 만들지 않는다. 아래 스펙들은 *달성률 계산*을 검사하므로
     *    종전 상수와 같은 값을 **설정된 목표(source:'db')**로 주입해 같은 의도를 유지한다.
     *    (목표 미설정 시 rate=null 은 `metric-honesty-j3.spec.ts` 가 따로 본다)
     */
    const LEGACY_TARGETS: Record<string, number> = {
      'exec.target.dailyOutpatients': 150,
      'exec.target.bedOccupancyPct': 80,
      'exec.target.avgLosDays': 7,
      'exec.target.monthlySurgeries': 50,
      'exec.target.claimReductionPct': 3,
    };
    const configRuntime = {
      getWithSource: vi.fn(async (k: string) => ({ value: LEGACY_TARGETS[k] ?? null, source: LEGACY_TARGETS[k] != null ? 'db' : 'unset', registered: true })),
    };
    service = new ExecutiveService(mockPrisma, configRuntime as never);
  });

  /** getOverview 는 billing.aggregate 를 3번(발생·수납확정·지난주) · 미수납은 행 단위 findMany(P4-1 — 감면을 빼고 행마다) */
  function mockOverviewAggregates(opts: {
    accrued?: { sum: number; n: number };
    collected?: { sum: number; n: number };
    unpaid?: { copay: number; paid: number; n: number };
    lastWeek?: { sum: number; n: number };
  } = {}) {
    const a = opts.accrued ?? { sum: 0, n: 0 };
    const c = opts.collected ?? { sum: 0, n: 0 };
    const u = opts.unpaid ?? { copay: 0, paid: 0, n: 0 };
    const l = opts.lastWeek ?? { sum: 0, n: 0 };
    vi.mocked(mockPrisma.billing.aggregate)
      .mockResolvedValueOnce({ _sum: { totalAmount: a.sum }, _count: a.n })
      .mockResolvedValueOnce({ _sum: { paidAmount: c.sum }, _count: c.n })
      .mockResolvedValueOnce({ _sum: { totalAmount: l.sum }, _count: l.n });
    // 미수 n 건 — 첫 행에 금액을 모두 싣고 나머지는 0원 미수(건수는 행 수)
    vi.mocked(mockPrisma.billing.findMany).mockResolvedValueOnce(
      Array.from({ length: u.n }, (_, i) => ({ patientCopay: i === 0 ? u.copay : 0, discountAmount: 0, paidAmount: i === 0 ? u.paid : 0 })),
    );
  }

  describe('getOverview', () => {
    it('오늘 매출을 발생/수납확정 두 정본으로 낸다', async () => {
      mockOverviewAggregates({
        accrued: { sum: 150000, n: 2 },
        collected: { sum: 100000, n: 1 },
        unpaid: { copay: 50000, paid: 0, n: 1 },
      });
      vi.mocked(mockPrisma.encounter.count).mockResolvedValue(0);
      vi.mocked(mockPrisma.bed.count).mockResolvedValue(0);
      vi.mocked(mockPrisma.admission.count).mockResolvedValue(5);
      vi.mocked(mockPrisma.icuBed.count).mockResolvedValue(10);
      vi.mocked(mockPrisma.icuAdmission.count).mockResolvedValue(3);

      const result = await service.getOverview();

      expect(result.todayRevenue).toBe(150000);
      expect(result.revenue.accrued).toEqual({ value: 150000, n: 2 });
      // 🔴 /journey-console 은 '매출'을 수납확정으로 말한다 — 같은 화면에서 두 정의를 모두 노출
      expect(result.revenue.collected).toEqual({ value: 100000, n: 1 });
    });

    it('🔴 미수납은 오늘 생성분이 아니라 전 기간이며, 금액과 건수의 집합이 같다', async () => {
      mockOverviewAggregates({ unpaid: { copay: 10_156_935, paid: 0, n: 54 } });
      vi.mocked(mockPrisma.encounter.count).mockResolvedValue(0);
      vi.mocked(mockPrisma.bed.count).mockResolvedValue(0);
      vi.mocked(mockPrisma.admission.count).mockResolvedValue(0);
      vi.mocked(mockPrisma.icuBed.count).mockResolvedValue(0);
      vi.mocked(mockPrisma.icuAdmission.count).mockResolvedValue(0);

      const result = await service.getOverview();

      expect(result.unpaidAmount).toBe(10_156_935);
      expect(result.unpaidCount).toBe(54);
      expect(result.unpaid.scope).toBe('ALL_TIME');

      // 미수납 조회에 기간 필터가 없어야 한다 · 금액과 건수가 같은 행에서 나온다(집합 불일치 방지)
      const unpaidArg = vi.mocked(mockPrisma.billing.findMany).mock.calls[0][0];
      expect(unpaidArg.where.createdAt).toBeUndefined();
      expect(unpaidArg.where.status.in).toEqual(expect.arrayContaining(['PENDING', 'PARTIAL', 'DEFERRED']));
      expect(unpaidArg.select).toMatchObject({ patientCopay: true, discountAmount: true, paidAmount: true });
    });

    it('🔴 지난 7일 표본이 없으면 전주比는 0% 가 아니라 null 이다', async () => {
      mockOverviewAggregates({ accrued: { sum: 0, n: 0 }, lastWeek: { sum: 0, n: 0 } });
      vi.mocked(mockPrisma.encounter.count).mockResolvedValue(0); // 오늘·지난주 모두 0
      vi.mocked(mockPrisma.bed.count).mockResolvedValue(0);
      vi.mocked(mockPrisma.admission.count).mockResolvedValue(0);
      vi.mocked(mockPrisma.icuBed.count).mockResolvedValue(0);
      vi.mocked(mockPrisma.icuAdmission.count).mockResolvedValue(0);

      const result = await service.getOverview();

      expect(result.revenueChange).toBeNull();
      expect(result.revenueChangeMetric).toEqual({ value: null, n: 0 });
      expect(result.patientChange).toBeNull();
      expect(result.patientChangeMetric).toEqual({ value: null, n: 0 });
    });

    it('표본이 있으면 전주比를 낸다', async () => {
      mockOverviewAggregates({ accrued: { sum: 200000, n: 1 }, lastWeek: { sum: 700000, n: 7 } });
      vi.mocked(mockPrisma.encounter.count).mockResolvedValue(0);
      vi.mocked(mockPrisma.bed.count).mockResolvedValue(0);
      vi.mocked(mockPrisma.admission.count).mockResolvedValue(0);
      vi.mocked(mockPrisma.icuBed.count).mockResolvedValue(0);
      vi.mocked(mockPrisma.icuAdmission.count).mockResolvedValue(0);

      const result = await service.getOverview();

      expect(result.revenueChange).toBe(100); // 20만 vs 일평균 10만
      expect(result.revenueChangeMetric?.n).toBe(7);
    });

    it('병상 가동률을 퍼센트로 낸다(단위를 필드명이 말한다)', async () => {
      mockOverviewAggregates();
      vi.mocked(mockPrisma.encounter.count).mockResolvedValue(0);
      vi.mocked(mockPrisma.bed.count).mockResolvedValueOnce(5).mockResolvedValueOnce(4);
      vi.mocked(mockPrisma.admission.count).mockResolvedValue(0);
      vi.mocked(mockPrisma.icuBed.count).mockResolvedValue(0);
      vi.mocked(mockPrisma.icuAdmission.count).mockResolvedValue(0);

      const result = await service.getOverview();

      expect(result.bedOccupancy).toBe(80);
      expect(result.bedOccupancyPct).toEqual({ value: 80, n: 5, numerator: 4, denominator: 5 });
      expect(result.bedOccupancyUnit).toBe('percent');
    });

    it('🔴 등록 병상이 0 이면 가동률은 0% 가 아니라 null 이다', async () => {
      mockOverviewAggregates();
      vi.mocked(mockPrisma.encounter.count).mockResolvedValue(0);
      vi.mocked(mockPrisma.bed.count).mockResolvedValue(0);
      vi.mocked(mockPrisma.admission.count).mockResolvedValue(0);
      vi.mocked(mockPrisma.icuBed.count).mockResolvedValue(0);
      vi.mocked(mockPrisma.icuAdmission.count).mockResolvedValue(0);

      const result = await service.getOverview();

      expect(result.bedOccupancy).toBeNull();
      expect(result.bedOccupancyPct).toEqual({ value: null, n: 0, numerator: 0, denominator: 0 });
    });

    it('ICU 통계를 포함한다', async () => {
      mockOverviewAggregates();
      vi.mocked(mockPrisma.encounter.count).mockResolvedValue(0);
      vi.mocked(mockPrisma.bed.count).mockResolvedValue(0);
      vi.mocked(mockPrisma.admission.count).mockResolvedValue(0);
      vi.mocked(mockPrisma.icuBed.count).mockResolvedValue(20);
      vi.mocked(mockPrisma.icuAdmission.count).mockResolvedValue(8);

      const result = await service.getOverview();

      expect(result.icuTotal).toBe(20);
      expect(result.icuOccupied).toBe(8);
      expect(result.icuOccupancyPct).toEqual({ value: 40, n: 20, numerator: 8, denominator: 20 });
    });
  });

  describe('getWeeklyRevenue', () => {
    it('7일치 버킷을 낸다', async () => {
      vi.mocked(mockPrisma.billing.findMany).mockResolvedValue([
        { totalAmount: 100000, createdAt: new Date() },
        { totalAmount: 150000, createdAt: new Date() },
      ]);

      const result = await service.getWeeklyRevenue();

      expect(result).toHaveLength(7);
      expect(result[0]).toHaveProperty('date');
      expect(result[0]).toHaveProperty('revenue');
      expect(result[0]).toHaveProperty('count');
    });

    it('같은 날 청구를 하나의 버킷에 합산한다', async () => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const sixDaysAgo = new Date(today);
      sixDaysAgo.setDate(sixDaysAgo.getDate() - 6);

      vi.mocked(mockPrisma.billing.findMany).mockResolvedValue([
        { totalAmount: 100000, createdAt: sixDaysAgo },
        { totalAmount: 50000, createdAt: sixDaysAgo },
      ]);

      const result = await service.getWeeklyRevenue();

      expect(result[0].revenue).toBe(150000);
      expect(result[0].count).toBe(2);
    });
  });

  describe('getMonthlyTrend', () => {
    it('5개월치를 낸다', async () => {
      const now = new Date();
      vi.mocked(mockPrisma.encounter.findMany).mockResolvedValue([{ createdAt: now }, { createdAt: now }]);
      vi.mocked(mockPrisma.billing.findMany).mockResolvedValue([
        { totalAmount: 1000000, createdAt: now },
        { totalAmount: 500000, createdAt: now },
      ]);

      const result = await service.getMonthlyTrend();

      expect(result).toHaveLength(5);
      expect(result[0].month).toMatch(/^\d{4}-\d{2}$/);
    });
  });

  describe('getDepartmentStats', () => {
    it('실제 작성자 id 로 부서를 찾는다(role=DOCTOR 로 좁히지 않는다)', async () => {
      vi.mocked(mockPrisma.encounter.findMany).mockResolvedValue([
        { doctorId: 'dr-1' }, { doctorId: 'dr-2' }, { doctorId: 'admin-9' },
      ]);
      vi.mocked(mockPrisma.billing.findMany).mockResolvedValue([
        { totalAmount: 500000, encounter: { doctorId: 'dr-1' } },
        { totalAmount: 300000, encounter: { doctorId: 'admin-9' } },
      ]);
      vi.mocked(mockPrisma.user.findMany).mockResolvedValue([
        { id: 'dr-1', department: '내과' },
        { id: 'dr-2', department: '외과' },
        { id: 'admin-9', department: null }, // 부서 미지정
      ]);

      const result = await service.getDepartmentStats();

      // 🔴 user 조회에 role 필터를 걸지 않는다(걸면 그 밖 작성자의 진료가 통째로 '기타'로 샌다)
      const userArg = vi.mocked(mockPrisma.user.findMany).mock.calls[0][0];
      expect(userArg.where.role).toBeUndefined();
      expect(userArg.where.id.in).toEqual(expect.arrayContaining(['dr-1', 'dr-2', 'admin-9']));

      expect(result.map(r => r.department)).toEqual(expect.arrayContaining(['내과', '외과', '부서 미지정']));
      expect(result.find(r => r.department === '부서 미지정')?.revenue).toBe(300000);
    });

    it('매출 내림차순으로 정렬한다', async () => {
      vi.mocked(mockPrisma.encounter.findMany).mockResolvedValue([]);
      vi.mocked(mockPrisma.billing.findMany).mockResolvedValue([
        { totalAmount: 300000, encounter: { doctorId: 'dr-1' } },
        { totalAmount: 500000, encounter: { doctorId: 'dr-2' } },
      ]);
      vi.mocked(mockPrisma.user.findMany).mockResolvedValue([
        { id: 'dr-1', department: '내과' },
        { id: 'dr-2', department: '외과' },
      ]);

      const result = await service.getDepartmentStats();

      expect(result[0].revenue).toBeGreaterThanOrEqual(result[1].revenue);
    });
  });

  describe('getStaffSummary', () => {
    it('🔴 라벨을 서버가 낸다 — DB enum(MEDICAL·TECHNICAL·ADMIN·SUPPORT) 기준', async () => {
      vi.mocked(mockPrisma.staff.groupBy).mockResolvedValue([
        { category: 'MEDICAL', _count: { id: 20 } },
        { category: 'TECHNICAL', _count: { id: 10 } },
        { category: 'ADMIN', _count: { id: 5 } },
        { category: 'SUPPORT', _count: { id: 3 } },
      ]);

      const result = await service.getStaffSummary();

      expect(result.total).toBe(38);
      expect(result.categories.map(c => c.label)).toEqual(['의료진', '의료기사', '행정직', '지원직']);
    });

    it('모르는 코드는 임의로 번역하지 않고 원문을 남긴다', async () => {
      vi.mocked(mockPrisma.staff.groupBy).mockResolvedValue([{ category: 'NEW_CODE', _count: { id: 2 } }]);

      const result = await service.getStaffSummary();

      expect(result.categories[0].label).toBe('NEW_CODE');
    });
  });

  describe('getKpi', () => {
    function mockKpi(opts: { encounters?: number; beds?: [number, number]; discharged?: any[]; claim?: { claimed: number; reduced: number; n: number }; surgeries?: number } = {}) {
      vi.mocked(mockPrisma.encounter.count).mockResolvedValue(opts.encounters ?? 0);
      if (opts.beds) vi.mocked(mockPrisma.bed.count).mockResolvedValueOnce(opts.beds[0]).mockResolvedValueOnce(opts.beds[1]);
      else vi.mocked(mockPrisma.bed.count).mockResolvedValue(0);
      vi.mocked(mockPrisma.admission.count).mockResolvedValue(0);
      vi.mocked(mockPrisma.admission.findMany).mockResolvedValue(opts.discharged ?? []);
      const c = opts.claim ?? { claimed: 0, reduced: 0, n: 0 };
      vi.mocked(mockPrisma.claim.aggregate).mockResolvedValue({ _sum: { claimedAmount: c.claimed, reducedAmount: c.reduced }, _count: c.n });
      vi.mocked(mockPrisma.surgery.count).mockResolvedValue(opts.surgeries ?? 0);
    }

    it('🔴 이번달 청구 0건이면 삭감률 달성률은 100% 가 아니라 null(산출 불가) 이다', async () => {
      mockKpi({ claim: { claimed: 0, reduced: 0, n: 0 } });

      const result = await service.getKpi();

      const k = result.find(x => x.name === '청구 삭감률')!;
      expect(k.rate).toBeNull();
      expect(k.actual).toBe('-');
      expect(k.n).toBe(0);
      expect(k.note).toContain('산출 불가');
    });

    it('청구가 있으면 삭감률을 낸다', async () => {
      mockKpi({ claim: { claimed: 1_500_000, reduced: 25_000, n: 12 } });

      const result = await service.getKpi();

      const k = result.find(x => x.name === '청구 삭감률')!;
      expect(k.actual).toMatch(/^\d+\.\d+%$/);
      expect(k.rate).toBe(100); // 1.7% <= 3%
      expect(k.n).toBe(12);
    });

    it('🔴 이번달 퇴원 0건이면 평균 재원일수 달성률은 0(미달) 이 아니라 null 이다', async () => {
      mockKpi({ discharged: [] });

      const result = await service.getKpi();

      const k = result.find(x => x.name === '평균 재원일수')!;
      expect(k.actual).toBe('-');
      expect(k.rate).toBeNull(); // 종전: 0 (빨강 미달)
    });

    it('퇴원 표본이 있으면 평균 재원일수를 낸다', async () => {
      const now = new Date();
      mockKpi({
        discharged: [{
          admitDate: new Date(now.getFullYear(), now.getMonth(), 1),
          dischargeDate: new Date(now.getFullYear(), now.getMonth(), 5),
        }],
      });

      const result = await service.getKpi();

      const k = result.find(x => x.name === '평균 재원일수')!;
      expect(k.actual).toBe('4.0일');
      expect(k.rate).toBe(100);
      expect(k.n).toBe(1);
    });

    it('🔴 진짜 0 은 0 이다 — 수술 0건/목표 50건은 달성률 0%', async () => {
      mockKpi({ surgeries: 0 });

      const result = await service.getKpi();

      const k = result.find(x => x.name === '수술건수/월')!;
      expect(k.rate).toBe(0); // null 이 아니다 — 관측했고 0 이었다
      expect(k.actual).toBe('0건');
    });

    it('등록 병상이 0 이면 병상 가동률 달성률도 null 이다', async () => {
      mockKpi();

      const result = await service.getKpi();

      const k = result.find(x => x.name === '병상 가동률')!;
      expect(k.actual).toBe('-');
      expect(k.rate).toBeNull();
    });

    it('목표가 없는 참고 지표(입원환자)의 달성률은 0 이 아니라 null 이다', async () => {
      mockKpi();

      const result = await service.getKpi();

      const k = result.find(x => x.name === '입원환자')!;
      expect(k.rate).toBeNull();
      expect(k.note).toContain('목표 미설정');
    });
  });

  describe('getClaimsSummary', () => {
    it('상태별 건수를 센다', async () => {
      vi.mocked(mockPrisma.claim.findMany).mockResolvedValue([
        { status: 'DRAFT', claimedAmount: 100000, reducedAmount: 0 },
        { status: 'SUBMITTED', claimedAmount: 200000, reducedAmount: 0 },
        { status: 'UNDER_REVIEW', claimedAmount: 150000, reducedAmount: 10000 },
        { status: 'APPROVED', claimedAmount: 300000, reducedAmount: 15000 },
        { status: 'PAID', claimedAmount: 250000, reducedAmount: 10000 },
      ]);

      const result = await service.getClaimsSummary();

      expect(result.count).toBe(5);
      expect(result.draft).toBe(1);
      expect(result.submitted).toBe(2);
      expect(result.approved).toBe(2);
    });

    it('삭감률을 낸다', async () => {
      vi.mocked(mockPrisma.claim.findMany).mockResolvedValue([
        { status: 'APPROVED', claimedAmount: 1000000, reducedAmount: 50000 },
      ]);

      const result = await service.getClaimsSummary();

      expect(result.totalClaimed).toBe(1000000);
      expect(parseFloat(result.reductionRate!)).toBe(5.0);
    });

    it('🔴 청구 0건의 삭감률은 "0.0"(=삭감 없음)이 아니라 null 이다', async () => {
      vi.mocked(mockPrisma.claim.findMany).mockResolvedValue([]);

      const result = await service.getClaimsSummary();

      expect(result.reductionRate).toBeNull();
      expect(result.reductionRatePct).toEqual({ value: null, n: 0 });
      expect(result.note).toContain('산출 불가');
    });
  });

  describe('getAlerts', () => {
    it('🔴 미수납 알림은 KPI 카드와 같은 집합(전 기간 PENDING·PARTIAL·DEFERRED)을 센다', async () => {
      vi.mocked(mockPrisma.billing.count).mockResolvedValue(54);
      vi.mocked(mockPrisma.inventoryItem.count).mockResolvedValue(0);
      vi.mocked(mockPrisma.encounter.count).mockResolvedValue(0);
      vi.mocked(mockPrisma.equipment.count).mockResolvedValue(0);

      const result = await service.getAlerts();

      const a = result.find(x => x.type === 'billing')!;
      expect(a.message).toContain('미수납 54건');
      expect(a.count).toBe(54);
      expect(a.href).toBeTruthy(); // P7 — 근거 목록으로 가는 길
      const arg = vi.mocked(mockPrisma.billing.count).mock.calls[0][0];
      expect(arg.where.status.in).toEqual(expect.arrayContaining(['PENDING', 'PARTIAL', 'DEFERRED']));
    });

    it('미완료 차트 알림에 정의(24시간 경과)와 목록 링크가 있다', async () => {
      vi.mocked(mockPrisma.billing.count).mockResolvedValue(0);
      vi.mocked(mockPrisma.inventoryItem.count).mockResolvedValue(0);
      vi.mocked(mockPrisma.encounter.count).mockResolvedValue(195);
      vi.mocked(mockPrisma.equipment.count).mockResolvedValue(0);

      const result = await service.getAlerts();

      const a = result.find(x => x.type === 'chart')!;
      expect(a.message).toContain('195건');
      expect(a.message).toContain('24시간');
      expect(a.href).toBe('/admin/him');
    });

    it('🔴 조회 실패를 0 으로 흡수하지 않고 error 알림으로 드러낸다', async () => {
      vi.mocked(mockPrisma.billing.count).mockResolvedValue(0);
      vi.mocked(mockPrisma.inventoryItem.count).mockRejectedValue(new Error('relation does not exist'));
      vi.mocked(mockPrisma.encounter.count).mockResolvedValue(0);
      vi.mocked(mockPrisma.equipment.count).mockRejectedValue(new Error('boom'));

      const result = await service.getAlerts();

      expect(result.find(x => x.type === 'inventory:error')?.severity).toBe('error');
      expect(result.find(x => x.type === 'equipment:error')?.severity).toBe('error');
      // 실패가 "0건"(=문제 없음)으로 사라지지 않았는지
      expect(result.some(x => x.type === 'inventory' && x.severity !== 'error')).toBe(false);
    });
  });

  describe('getClinicalOverview', () => {
    it('🔴 "현재 대기"는 오늘 생성분이 아니다 — createdAt 필터가 없어야 한다', async () => {
      vi.mocked(mockPrisma.encounter.count).mockResolvedValue(25);
      vi.mocked(mockPrisma.appointment.count).mockResolvedValue(30);
      vi.mocked(mockPrisma.admission.count).mockResolvedValue(8);
      vi.mocked(mockPrisma.icuAdmission.count).mockResolvedValue(3);
      vi.mocked(mockPrisma.waitingQueue.count).mockResolvedValue(196);

      const result = await service.getClinicalOverview();

      expect(result.waitingPatients).toBe(196);
      const arg = vi.mocked(mockPrisma.waitingQueue.count).mock.calls[0][0];
      expect(arg.where.createdAt).toBeUndefined();
      // /journey-console 대기 정본(WAITING+CALLED)과 같은 집합
      expect(arg.where.status.in).toEqual(['WAITING', 'CALLED']);
      expect(result.waitingBasis).toContain('접수일 무관');
    });
  });

  describe('getDoctorStats', () => {
    it('의사별 실적을 낸다', async () => {
      vi.mocked(mockPrisma.user.findMany).mockResolvedValue([
        { id: 'dr-1', familyName: '이', givenName: '의사', department: '내과', role: 'DOCTOR', isActive: true },
        { id: 'dr-2', familyName: '김', givenName: '의사', department: '외과', role: 'DOCTOR', isActive: true },
      ]);
      vi.mocked(mockPrisma.encounter.groupBy)
        .mockResolvedValueOnce([{ doctorId: 'dr-1', _count: 15 }, { doctorId: 'dr-2', _count: 10 }])
        .mockResolvedValueOnce([{ doctorId: 'dr-1', _count: 50 }, { doctorId: 'dr-2', _count: 40 }])
        .mockResolvedValueOnce([{ doctorId: 'dr-1', _count: 2 }, { doctorId: 'dr-2', _count: 1 }]);
      vi.mocked(mockPrisma.waitingQueue.groupBy).mockResolvedValue([
        { doctorId: 'dr-1', _count: 5 }, { doctorId: 'dr-2', _count: 3 },
      ]);

      const result = await service.getDoctorStats();

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('이의사');
      expect(result[0].department).toBe('내과');
      expect(result[0].todayEncounters).toBeGreaterThanOrEqual(result[1].todayEncounters);
    });

    it('🔴 의사가 아닌 작성자의 미완료 차트도 담당자와 함께 표에 올린다', async () => {
      // 1번째 user.findMany = role=DOCTOR 목록, 2번째 = 그 밖의 작성자 보강 조회
      vi.mocked(mockPrisma.user.findMany)
        .mockResolvedValueOnce([{ id: 'dr-1', familyName: '이', givenName: '의사', department: '내과', role: 'DOCTOR', isActive: true }])
        .mockResolvedValueOnce([{ id: 'admin-9', familyName: '박', givenName: '행정', department: null, role: 'ADMIN', isActive: true }]);
      vi.mocked(mockPrisma.encounter.groupBy)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ doctorId: 'dr-1', _count: 51 }, { doctorId: 'admin-9', _count: 144 }]);
      vi.mocked(mockPrisma.waitingQueue.groupBy).mockResolvedValue([]);

      const result = await service.getDoctorStats();

      const admin = result.find(r => r.id === 'admin-9');
      expect(admin).toBeDefined();
      expect(admin!.incompleteCharts).toBe(144);
      expect(admin!.isDoctor).toBe(false);
      expect(admin!.role).toBe('ADMIN');
      expect(admin!.department).toBe('부서 미지정');
      // 알림(195건)과 표의 합이 일치한다
      expect(result.reduce((s, r) => s + r.incompleteCharts, 0)).toBe(195);
    });

    it('🔴 미완료 차트 정의를 알림과 맞춘다(DRAFT 24시간 경과)', async () => {
      vi.mocked(mockPrisma.user.findMany).mockResolvedValue([]);
      vi.mocked(mockPrisma.encounter.groupBy).mockResolvedValue([]);
      vi.mocked(mockPrisma.waitingQueue.groupBy).mockResolvedValue([]);

      await service.getDoctorStats();

      const draftArg = vi.mocked(mockPrisma.encounter.groupBy).mock.calls[2][0];
      expect(draftArg.where.status).toBe('DRAFT');
      expect(draftArg.where.createdAt.lt).toBeInstanceOf(Date);
    });
  });

  describe('getSafety', () => {
    it('유형별로 센다', async () => {
      vi.mocked(mockPrisma.safetyIncident.findMany).mockResolvedValue([
        { type: 'FALL' }, { type: 'FALL' }, { type: 'MEDICATION_ERROR' }, { type: 'OTHER' },
      ]);

      const result = await service.getSafety();

      expect(result.unavailable).toBe(false);
      expect(result.totalIncidents).toBe(4);
      expect(result.falls).toBe(2);
      expect(result.medicationErrors).toBe(1);
      expect(result.others).toBe(1);
      expect(result.byType).toEqual(expect.arrayContaining([{ type: 'FALL', count: 2 }]));
    });

    it('🔴 조회 실패는 "0건"이 아니라 unavailable 이다', async () => {
      vi.mocked(mockPrisma.safetyIncident.findMany).mockRejectedValue(new Error('boom'));

      const result = await service.getSafety();

      expect(result.unavailable).toBe(true);
      expect(result.totalIncidents).toBeNull(); // 종전: 0 → "이번달 안전사고 없음"
    });
  });

  describe('getInfection', () => {
    it('🔴 organism 은 학명이라 완전일치로는 MRSA 를 셀 수 없다 — 내성 표기가 있는 건만 센다', async () => {
      vi.mocked(mockPrisma.infectionSurveillance.findMany).mockResolvedValue([
        { organism: 'Staphylococcus aureus', isolationType: 'CONTACT' }, // 내성 표기 없음 → 판정 불가
        { organism: 'MRSA (methicillin-resistant S. aureus)', isolationType: 'CONTACT' },
        { organism: 'E. coli', isolationType: null },
        { organism: null, isolationType: null }, // 미기재
      ]);

      const result = await service.getInfection();

      expect(result.active).toBe(4);
      expect(result.mrsa).toBe(1);
      expect(result.sAureusUnclassified).toBe(1); // 종전엔 이 건이 '기타균'으로 사라졌다
      expect(result.organismUnknown).toBe(1);
      expect(result.isolated).toBe(2);
      expect(result.organisms).toEqual(expect.arrayContaining([{ name: 'E. coli', count: 1 }]));
    });

    it('표본이 없으면 빈 목록을 낸다(폴백 금지)', async () => {
      vi.mocked(mockPrisma.infectionSurveillance.findMany).mockResolvedValue([]);

      const result = await service.getInfection();

      expect(result.active).toBe(0);
      expect(result.organisms).toEqual([]);
    });

    it('🔴 조회 실패는 "활성 감염 0"이 아니라 unavailable 이다', async () => {
      vi.mocked(mockPrisma.infectionSurveillance.findMany).mockRejectedValue(new Error('boom'));

      const result = await service.getInfection();

      expect(result.unavailable).toBe(true);
      expect(result.active).toBeNull();
    });
  });

  describe('getClinicalWeeklyTrend', () => {
    it('🔴 진료과 축을 하드코딩하지 않고 실데이터에서 만든다', async () => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const sixDaysAgo = new Date(today);
      sixDaysAgo.setDate(sixDaysAgo.getDate() - 6);

      vi.mocked(mockPrisma.encounter.findMany).mockResolvedValue([
        ...Array.from({ length: 5 }, () => ({ createdAt: sixDaysAgo, doctor: { department: '피부과' } })),
        ...Array.from({ length: 3 }, () => ({ createdAt: sixDaysAgo, doctor: { department: '내과' } })),
        ...Array.from({ length: 4 }, () => ({ createdAt: sixDaysAgo, doctor: { department: null } })),
      ]);

      const result = await service.getClinicalWeeklyTrend();

      // 하드코딩 6과가 아니라 실제 등장한 과만
      expect(result.departments).toEqual(['피부과', '부서 미지정', '내과']);
      expect(result.total).toBe(12);
      expect(result.days).toHaveLength(7);
      expect(result.days[0]['피부과']).toBe(5);
      expect(result.days[0]['부서 미지정']).toBe(4);
      expect(result.days[0].total).toBe(12);
    });

    it('🔴 where 절로 진료과를 잘라내지 않는다(잘라낸 합계를 총량처럼 쓰면 안 된다)', async () => {
      vi.mocked(mockPrisma.encounter.findMany).mockResolvedValue([]);

      const result = await service.getClinicalWeeklyTrend();

      const arg = vi.mocked(mockPrisma.encounter.findMany).mock.calls[0][0];
      expect(arg.where.doctor).toBeUndefined();
      // 표본 부재의 정답은 폴백이 아니라 빈 목록
      expect(result.departments).toEqual([]);
      expect(result.total).toBe(0);
    });
  });

  describe('getHourlyDistribution', () => {
    it('날짜 문자열을 로컬(KST) 자정으로 파싱한다', async () => {
      vi.mocked(mockPrisma.encounter.findMany).mockResolvedValue([]);

      await service.getHourlyDistribution('2026-08-14');

      const arg = vi.mocked(mockPrisma.encounter.findMany).mock.calls[0][0];
      const gte: Date = arg.where.createdAt.gte;
      expect(gte.getFullYear()).toBe(2026);
      expect(gte.getMonth()).toBe(7);
      expect(gte.getDate()).toBe(14);
      expect(gte.getHours()).toBe(0); // 🔴 new Date('2026-08-14') 였다면 UTC 자정이라 로컬 시각이 0 이 아니다
    });

    it('파싱 불가한 값이면 오늘로 떨어진다(Invalid Date 를 Prisma 로 넘기지 않는다)', async () => {
      vi.mocked(mockPrisma.encounter.findMany).mockResolvedValue([]);

      await service.getHourlyDistribution('not-a-date');

      const arg = vi.mocked(mockPrisma.encounter.findMany).mock.calls[0][0];
      expect(Number.isNaN(arg.where.createdAt.gte.getTime())).toBe(false);
    });
  });

  describe('getTopDiagnoses', () => {
    it('date-only 상한을 그날 끝까지로 잡는다(dayRange 정본)', async () => {
      vi.mocked(mockPrisma.encounterDiagnosis.findMany).mockResolvedValue([]);

      await service.getTopDiagnoses(10, '2026-08-14', '2026-08-14');

      const arg = vi.mocked(mockPrisma.encounterDiagnosis.findMany).mock.calls[0][0];
      const { gte, lt } = arg.where.encounter.createdAt;
      expect(gte.getDate()).toBe(14);
      expect(lt.getDate()).toBe(15); // 폭 0 이 아니다
    });
  });
});
