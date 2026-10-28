import { describe, it, expect, beforeEach, vi } from 'vitest';
import { QiService } from '../../src/modules/qi/qi.service';

describe('QiService', () => {
  let service: QiService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      waitingQueue: { findMany: vi.fn().mockResolvedValue([]) },
      encounter: { count: vi.fn().mockResolvedValue(0) },
      emergencyVisit: { findMany: vi.fn().mockResolvedValue([]) },
      admission: { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0) },
      bed: { count: vi.fn().mockResolvedValue(0) },
      surgery: { findMany: vi.fn().mockResolvedValue([]) },
      prescription: { count: vi.fn().mockResolvedValue(0), findMany: vi.fn().mockResolvedValue([]) },
      order: { count: vi.fn().mockResolvedValue(0) },
      qualityIndicator: { findMany: vi.fn().mockResolvedValue([]) },
      accreditationItem: { count: vi.fn().mockResolvedValue(8), findMany: vi.fn().mockResolvedValue([]), createMany: vi.fn() },
    };
    service = new QiService(mockPrisma);
  });

  describe('getMetrics', () => {
    it('should return all metric categories', async () => {
      const result = await service.getMetrics();
      expect(result.data).toHaveProperty('outpatient');
      expect(result.data).toHaveProperty('emergency');
      expect(result.data).toHaveProperty('inpatient');
      expect(result.data).toHaveProperty('surgery');
      expect(result.data).toHaveProperty('safety');
    });

    /**
     * 🔴 W8 갱신 — 종전 스펙은 `avgWaitMinutes === 0` 을 계약으로 굳혀뒀다.
     *    표본이 없을 때의 0 은 "대기가 없었다"로 읽힌다. 진짜 0 과 모르는 것을 뒤바꾸지 않는다(P1).
     */
    it('표본이 없으면 건수는 0, 대기 지표는 null(산출 불가)', async () => {
      const result = await service.getMetrics();
      expect(result.data.outpatient.totalVisits).toBe(0);
      expect(result.data.outpatient.avgWaitMinutes).toBeNull();
      expect(result.data.outpatient.maxWaitMinutes).toBeNull();
      expect(result.data.outpatient.waitOver30MinRate).toBeNull();
      expect(result.data.outpatient.waitSampleN).toBe(0);
      expect(result.data.emergency.totalVisits).toBe(0);
      expect(result.data.inpatient.totalAdmissions).toBe(0);
      expect(result.data.surgery.totalSurgeries).toBe(0);
    });

    it('should accept date range parameters', async () => {
      const result = await service.getMetrics('2026-05-01', '2026-05-31');
      expect(result.data.period.from).toBe('2026-05-01');
      expect(result.data.period.to).toBe('2026-05-31');
    });

    it('should use default dates when not provided', async () => {
      const result = await service.getMetrics();
      expect(result.data.period.from).toBeUndefined();
    });
  });

  // ── Outpatient metrics ──

  describe('outpatient metrics', () => {
    it('should calculate outpatient wait metrics', async () => {
      const now = Date.now();
      mockPrisma.waitingQueue.findMany.mockResolvedValue([
        { checkedInAt: new Date(now - 15 * 60000), startedAt: new Date(now), status: 'COMPLETED' },
        { checkedInAt: new Date(now - 45 * 60000), startedAt: new Date(now), status: 'COMPLETED' },
      ]);
      mockPrisma.encounter.count.mockResolvedValue(10);
      const result = await service.getMetrics();
      expect(result.data.outpatient.totalVisits).toBe(2);
      expect(result.data.outpatient.avgWaitMinutes).toBe(30);
      expect(result.data.outpatient.waitOver30Min).toBe(1);
      expect(result.data.outpatient.waitOver30MinRate).toBe(50);
    });

    /**
     * 🔴 W8 Q3 — 분자와 분모가 **같은 모집단**인가.
     *    실측: 접수 672 / startedAt 보유 13 / 초과 1 → 종전 표시 0.1%(=1/672), 실제 7.7%(=1/13).
     *    임계 10% 라서 종전 분모로는 경고가 **영원히 뜨지 않았다**.
     */
    it('🔴 대기 초과율의 분모는 대기시간을 산출할 수 있는 건(startedAt 보유)이다', async () => {
      const now = Date.now();
      const measurable = [{ checkedInAt: new Date(now - 45 * 60000), startedAt: new Date(now), status: 'COMPLETED' }];
      // startedAt 이 없는 건 = 대기시간을 모르는 건(분자에도 분모에도 들어가지 않는다)
      const unmeasurable = Array.from({ length: 99 }, () => ({ checkedInAt: new Date(now - 10 * 60000), startedAt: null, status: 'WAITING' }));
      mockPrisma.waitingQueue.findMany.mockResolvedValue([...measurable, ...unmeasurable]);
      const r = await service.getMetrics();
      expect(r.data.outpatient.totalVisits).toBe(100);
      expect(r.data.outpatient.waitSampleN).toBe(1);
      expect(r.data.outpatient.waitUnmeasuredN).toBe(99);
      expect(r.data.outpatient.waitOver30Min).toBe(1);
      expect(r.data.outpatient.waitOver30MinRate).toBe(100); // 1/1 — 종전 분모(100)였다면 1%
      expect(r.data.outpatient.waitBasis).toContain('99');
    });

    it('🔴 대기시간을 아는 건이 하나도 없으면 0% 가 아니라 null 이다', async () => {
      mockPrisma.waitingQueue.findMany.mockResolvedValue([
        { checkedInAt: new Date(), startedAt: null, status: 'WAITING' },
      ]);
      const r = await service.getMetrics();
      expect(r.data.outpatient.totalVisits).toBe(1);
      expect(r.data.outpatient.waitOver30MinRate).toBeNull();
      expect(r.data.outpatient.waitOver30Min).toBeNull();
      expect(r.data.outpatient.waitBasis).toContain('산출 불가');
    });

    it('🔴 조회 상한은 미래를 넘지 않는다 — 아직 오지 않은 접수는 실적이 아니다(W8 Q9)', async () => {
      await service.getMetrics('2026-08-01', '2099-12-31');
      const where = mockPrisma.waitingQueue.findMany.mock.calls.at(-1)![0].where;
      expect(where.checkedInAt.lte.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
    });

    it('should calculate encounter sign rate', async () => {
      mockPrisma.encounter.count
        .mockResolvedValueOnce(100)  // total encounters
        .mockResolvedValueOnce(80);  // signed encounters
      const result = await service.getMetrics();
      expect(result.data.outpatient.encounterSignRate).toBe(80);
    });

    it('should filter by department', async () => {
      mockPrisma.waitingQueue.findMany.mockResolvedValue([]);
      await service.getMetrics('2026-05-01', '2026-05-31', '내과');
      expect(mockPrisma.waitingQueue.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ departmentName: '내과' }) }),
      );
    });
  });

  // ── Emergency metrics ──

  describe('emergency metrics', () => {
    it('should calculate ER stay hours', async () => {
      const now = Date.now();
      mockPrisma.emergencyVisit.findMany.mockResolvedValue([
        { arrivalAt: new Date(now - 4 * 3600000), dispositionAt: new Date(now), treatmentStartedAt: new Date(now - 3 * 3600000), disposition: 'DISCHARGE', triageLevel: 'LEVEL_3' },
        { arrivalAt: new Date(now - 8 * 3600000), dispositionAt: new Date(now), treatmentStartedAt: new Date(now - 7 * 3600000), disposition: 'ADMISSION', triageLevel: 'LEVEL_2' },
      ]);
      const result = await service.getMetrics();
      expect(result.data.emergency.totalVisits).toBe(2);
      expect(result.data.emergency.avgStayHours).toBe(6);
      expect(result.data.emergency.stayOver6Hours).toBe(1);
      expect(result.data.emergency.admissionRate).toBe(50);
    });

    it('should calculate door-to-doctor time', async () => {
      const now = Date.now();
      mockPrisma.emergencyVisit.findMany.mockResolvedValue([
        { arrivalAt: new Date(now - 30 * 60000), treatmentStartedAt: new Date(now), dispositionAt: null, disposition: null, triageLevel: 'LEVEL_3' },
      ]);
      const result = await service.getMetrics();
      expect(result.data.emergency.doorToDoctor).toBe(30);
    });

    it('should build KTAS distribution', async () => {
      mockPrisma.emergencyVisit.findMany.mockResolvedValue([
        { arrivalAt: new Date(), treatmentStartedAt: null, dispositionAt: null, disposition: null, triageLevel: 'LEVEL_1' },
        { arrivalAt: new Date(), treatmentStartedAt: null, dispositionAt: null, disposition: null, triageLevel: 'LEVEL_3' },
        { arrivalAt: new Date(), treatmentStartedAt: null, dispositionAt: null, disposition: null, triageLevel: 'LEVEL_3' },
      ]);
      const result = await service.getMetrics();
      expect(result.data.emergency.ktasDistribution).toEqual({ LEVEL_1: 1, LEVEL_3: 2 });
    });
  });

  // ── Inpatient metrics ──

  describe('inpatient metrics', () => {
    it('should calculate length of stay and long stays', async () => {
      const now = Date.now();
      mockPrisma.admission.findMany.mockResolvedValue([
        { id: 'a-1', patientId: 'p-1', admitDate: new Date(now - 5 * 86400000), dischargeDate: new Date(now), status: 'DISCHARGED' },
        { id: 'a-2', patientId: 'p-2', admitDate: new Date(now - 20 * 86400000), dischargeDate: new Date(now), status: 'DISCHARGED' },
      ]);
      mockPrisma.admission.count.mockResolvedValue(0); // no readmissions
      const result = await service.getMetrics();
      expect(result.data.inpatient.totalAdmissions).toBe(2);
      expect(result.data.inpatient.avgLengthOfStay).toBe(12.5);
      expect(result.data.inpatient.longStay).toBe(1);
    });

    it('should calculate 30-day readmission rate', async () => {
      const now = Date.now();
      mockPrisma.admission.findMany.mockResolvedValue([
        { id: 'a-1', patientId: 'p-1', admitDate: new Date(now - 10 * 86400000), dischargeDate: new Date(now - 5 * 86400000), status: 'DISCHARGED' },
      ]);
      mockPrisma.admission.count.mockResolvedValue(1); // 1 readmission
      const result = await service.getMetrics();
      expect(result.data.inpatient.readmission30Days).toBe(1);
      expect(result.data.inpatient.readmissionRate).toBe(100);
    });

    it('should calculate bed occupancy', async () => {
      mockPrisma.bed.count.mockResolvedValueOnce(100).mockResolvedValueOnce(75);
      const result = await service.getMetrics();
      expect(result.data.inpatient.bedOccupancyRate).toBe(75);
    });

    // 🔴 종전 이 테스트는 "등록 병상 0 → 가동률 0" 을 **계약으로 못박고 있었다**.
    //    등록 병상이 없으면 가동률은 0%(=여유 있음)가 아니라 산출 불가(null)다.
    it('🔴 등록 병상이 0 이면 가동률은 0 이 아니라 null 이고, 분자·분모가 함께 나온다', async () => {
      mockPrisma.bed.count.mockResolvedValue(0);
      const result = await service.getMetrics();
      expect(result.data.inpatient.bedOccupancyRate).toBeNull();
      expect(result.data.inpatient.bedOccupancyNumerator).toBe(0);
      expect(result.data.inpatient.bedOccupancyDenominator).toBe(0);
    });
  });

  // ── Surgery metrics ──

  describe('surgery metrics', () => {
    it('should calculate surgery metrics', async () => {
      const now = Date.now();
      mockPrisma.surgery.findMany.mockResolvedValue([
        { status: 'COMPLETED', startedAt: new Date(now - 120 * 60000), endedAt: new Date(now), scheduledAt: new Date() },
        { status: 'CANCELLED', startedAt: null, endedAt: null, scheduledAt: new Date() },
      ]);
      const result = await service.getMetrics();
      expect(result.data.surgery.totalSurgeries).toBe(2);
      expect(result.data.surgery.avgOpTimeMinutes).toBe(120);
      expect(result.data.surgery.cancelledSurgeries).toBe(1);
      expect(result.data.surgery.cancellationRate).toBe(50);
    });

    // 🔴 (2026-09-16 J3) 종전 이름은 'should return 0' — **표본 0 에서 0 을 내는 것을 계약으로 못박고 있었다**.
    //    수술이 한 건도 완료되지 않은 기간의 '평균 수술시간 0분' 은 실적이 아니라 산출 불가다.
    it('완료 수술이 없으면 평균 수술시간은 0 이 아니라 null(산출 불가)', async () => {
      mockPrisma.surgery.findMany.mockResolvedValue([
        { status: 'SCHEDULED', startedAt: null, endedAt: null, scheduledAt: new Date() },
      ]);
      const result = await service.getMetrics();
      expect(result.data.surgery.avgOpTimeMinutes).toBeNull();
    });
  });

  // ── Safety metrics ──

  describe('safety metrics', () => {
    it('should return prescription and DUR metrics', async () => {
      mockPrisma.prescription.count
        .mockResolvedValueOnce(500)  // totalPrescriptions
        .mockResolvedValueOnce(45)   // durChecked
        .mockResolvedValueOnce(10);  // durOverridden
      mockPrisma.prescription.findMany.mockResolvedValue(
        Array.from({ length: 12 }, () => ({ durWarnings: [{ type: 'DDI' }] })),
      );
      mockPrisma.order.count.mockResolvedValue(30); // statOrders

      const result = await service.getMetrics();
      expect(result.data.safety.totalPrescriptions).toBe(500);
      expect(result.data.safety.durChecked).toBe(45);
      expect(result.data.safety.durAlerts).toBe(12);
      expect(result.data.safety.durOverridden).toBe(10);
      expect(result.data.safety.statOrders).toBe(30);
    });

    /**
     * 🔴 W8 Q2 — `durWarnings: { not: undefined }` 는 **Prisma 가 통째로 벗겨낸다**.
     *    남는 조건은 `durChecked: true` 뿐이라 실제로 센 것은 '검사 건수'였다(실측 8 vs 진짜 경고 2).
     */
    it('🔴 DUR 경고는 내용이 담긴 것만 센다 — JSON null·빈 배열은 경고가 아니다', async () => {
      mockPrisma.prescription.count
        .mockResolvedValueOnce(616) // total
        .mockResolvedValueOnce(8)   // durChecked (실측)
        .mockResolvedValueOnce(1);  // durOverridden
      // SQL NULL 은 where 에서 이미 걸러진 상태로 4행이 온다(실측) — 그중 2행은 JSON null
      mockPrisma.prescription.findMany.mockResolvedValue([
        { durWarnings: null },
        { durWarnings: null },
        { durWarnings: [{ type: 'THERAPEUTIC_DUPLICATION' }] },
        { durWarnings: [{ type: 'THERAPEUTIC_DUPLICATION' }] },
      ]);
      const r = await service.getMetrics();
      expect(r.data.safety.durChecked).toBe(8);
      expect(r.data.safety.durAlerts).toBe(2); // 종전 8(=durChecked) → 4배 부풀림
    });

    it('🔴 `{ not: undefined }` 가 다시 들어오지 못하게 — where 에 undefined 값 필터가 없어야 한다', async () => {
      await service.getMetrics();
      const where = mockPrisma.prescription.findMany.mock.calls.at(-1)![0].where;
      const hasUndefinedFilter = (o: unknown): boolean =>
        !!o && typeof o === 'object' && Object.values(o as Record<string, unknown>).some(
          (v) => v === undefined || (v && typeof v === 'object' && hasUndefinedFilter(v)),
        );
      expect(hasUndefinedFilter(where)).toBe(false);
      expect(JSON.stringify(where)).not.toContain('"not":null');
    });
  });

  /**
   * 🔴 W7 — 상수로 지어내던 지표들. 출처가 없으면 값을 만들지 않는다(만족도 벤치마크와 같은 처리).
   */
  describe('지어내지 않는다 — 출처 없는 값은 available:false', () => {
    it('전국 벤치마크: 하드코딩 6행(전국평균·상위10%·백분위) 제거', async () => {
      const r = await service.getBenchmarkComparison();
      expect(r.available).toBe(false);
      expect(r.benchmarks).toEqual([]);
      expect(r.reason).toBeTruthy();
    });

    it('심평원 적정성평가: 값·등급 8행 제거(외부 평가 결과는 등재 대상)', async () => {
      const r = await service.getAdequacyIndicators();
      expect(r.available).toBe(false);
      expect(r.indicators).toEqual([]);
      expect(r.totalCount).toBe(0);
    });

    it('PSI: 추정 상수 8지표 제거 · 실집계 기초 건수만', async () => {
      mockPrisma.admission.count.mockResolvedValue(120);
      mockPrisma.surgery.count = vi.fn().mockResolvedValue(40);
      const r = await service.calculatePsi();
      expect(r.available).toBe(false);
      expect(r.indicators).toEqual([]);
      expect(r.baseCounts.admissions).toBe(120);
    });

    it('HSMR: 임의 계수(입원×1.5%/1.8%) 제거 — 사망 원천 부재', async () => {
      mockPrisma.admission.count.mockResolvedValue(200);
      const r = await service.calculateHsmr('2026-05');
      expect(r.available).toBe(false);
      expect(r.observedDeaths).toBeNull();
      expect(r.expectedDeaths).toBeNull();
      expect(r.hsmr).toBeNull();
      expect(r.trend).toEqual([]);
      expect(r.totalAdmissions).toBe(200); // 실집계는 유지
    });

    it('재입원율: 부서별 임의 배분 제거 · 표본 없으면 rate 는 0 이 아니라 null', async () => {
      mockPrisma.admission.findMany.mockResolvedValue([]);
      const r = await service.getReadmissionRate('2026-05');
      expect(r.byDepartment).toEqual([]);
      expect(r.rate).toBeNull();
      expect(r.achievement).toBeNull(); // 🔴 퇴원 0건을 'ACHIEVED'로 적지 않는다
    });
  });

  describe('월별 지표 대시보드 — DB 실측 + 정본 판정', () => {
    const vap = {
      id: 'vap', name: '인공호흡기 관련 폐렴 발생률', category: '감염관리',
      formula: '(VAP 건수 / 인공호흡기 유치일수) × 1000', targetValue: 2.0,
      measurements: [
        { period: '2026-05', value: 1.51 },
        { period: '2026-04', value: 1.8 },
      ],
    };
    const hygiene = {
      id: 'hh', name: '손위생 수행률', category: '감염관리',
      formula: '(손위생 수행 횟수 / 손위생 기회 횟수) × 100', targetValue: 95,
      measurements: [{ period: '2026-04', value: 91 }], // 요청 달(2026-05) 측정 없음
    };

    it('🔴 방향을 반영해 판정한다 — VAP 1.51(목표 2.0)은 달성', async () => {
      mockPrisma.qualityIndicator.findMany.mockResolvedValue([vap]);
      const r = await service.getIndicatorDashboard('2026-05');
      expect(r.indicators[0].current).toBe(1.51);
      expect(r.indicators[0].direction).toBe('LOWER_IS_BETTER');
      expect(r.indicators[0].achieved).toBe(true);
      expect(r.indicators[0].unit).toBe('건/1000 인공호흡기 유치일수');
      expect(r.indicators[0].benchmark).toBeNull(); // 출처 없는 벤치마크 금지
    });

    it('🔴 요청한 달에 측정이 없으면 폴백하지 않는다(최신값으로 채우면 옛 값이 이번 달 실적이 된다)', async () => {
      mockPrisma.qualityIndicator.findMany.mockResolvedValue([hygiene]);
      const r = await service.getIndicatorDashboard('2026-05');
      expect(r.indicators[0].current).toBeNull();
      expect(r.indicators[0].achieved).toBeNull();
      expect(r.measuredCount).toBe(0);
    });

    it('목표 달성률: 미측정은 분모 밖 · 판정 0건이면 0% 가 아니라 null', async () => {
      mockPrisma.qualityIndicator.findMany.mockResolvedValue([vap, hygiene]);
      const r = await service.getTargetAchievement('2026-05');
      expect(r.summary).toMatchObject({ total: 2, judged: 1, achieved: 1, notAchieved: 0, unmeasured: 1 });
      expect(r.summary.overallRate).toBe(100);

      mockPrisma.qualityIndicator.findMany.mockResolvedValue([hygiene]);
      const none = await service.getTargetAchievement('2026-05');
      expect(none.summary.overallRate).toBeNull();
    });
  });

  describe('인증 체크리스트 — 근거를 지어내지 않는다', () => {
    it('🔴 미작성(PENDING)은 적합률 분모에서 빠진다 · 판정 0건이면 null', async () => {
      mockPrisma.accreditationItem.findMany.mockResolvedValue([
        { id: 'JCI-IPSG-1', standard: 'JCI', status: 'PENDING', evidence: null },
        { id: 'JCI-IPSG-2', standard: 'JCI', status: 'PENDING', evidence: null },
      ]);
      const r = await service.getAccreditationChecklist();
      expect(r.summary).toMatchObject({ total: 2, compliant: 0, pending: 2 });
      expect(r.complianceRate).toBeNull();
    });

    it('판정된 항목만으로 적합률을 낸다', async () => {
      mockPrisma.accreditationItem.findMany.mockResolvedValue([
        { id: 'a', standard: 'JCI', status: 'COMPLIANT', evidence: '손위생 관측 3,000건 중 2,850건 수행(2026-05)' },
        { id: 'b', standard: 'JCI', status: 'NON_COMPLIANT', evidence: '지침 갱신 미완료' },
        { id: 'c', standard: 'JCI', status: 'PENDING', evidence: null },
      ]);
      const r = await service.getAccreditationChecklist();
      expect(r.complianceRate).toBe(50); // 2건 판정 중 1건 적합(미작성 1건 제외)
    });

    /**
     * 🔴 W8 Q1 갱신 — 종전 스펙은 **self-seed 자체를 계약으로** 굳혀뒀다.
     *    `GET /qi/accreditation` 이 조회 한 번에 8행을 만들었다(운영 실측 2026-08-14 13:19:40).
     *    감사·규제 대응 화면에서 읽기가 쓰기를 하는 것은 그 자체로 결함이다.
     *    → 등재가 없으면 만들지 않고 '산출 불가'를 낸다.
     */
    it('🔴 조회는 DB 를 쓰지 않는다 — 항목이 없으면 만들지 말고 산출 불가를 낸다', async () => {
      mockPrisma.accreditationItem.count.mockResolvedValue(0);
      mockPrisma.accreditationItem.findMany.mockResolvedValue([]);
      const r = await service.getAccreditationChecklist();
      expect(mockPrisma.accreditationItem.createMany).not.toHaveBeenCalled();
      expect(r.available).toBe(false);
      expect(r.items).toEqual([]);
      expect(r.complianceRate).toBeNull();
      expect(r.reason).toContain('만들지 않습니다');
    });

    it('카탈로그(참조 목록)는 판정·근거를 담지 않는다 — 등재 시 뼈대만', () => {
      for (const item of QiService.DEFAULT_ACCREDITATION as Array<Record<string, unknown>>) {
        expect(item.evidence).toBeUndefined();
        expect(item.status).toBeUndefined();
        expect(item.name).toBeTruthy();
      }
    });
  });

  /**
   * 🔴 W8 Q1 구조 가드 — **GET(조회)은 어떤 쓰기도 하지 않는다**.
   *    prisma 의 변이 메서드를 전부 throw 로 바꿔놓고 모든 읽기 경로를 눌러본다.
   */
  describe('🔴 구조 가드: 조회 경로는 DB 를 쓰지 않는다', () => {
    const MUTATIONS = ['create', 'createMany', 'update', 'updateMany', 'upsert', 'delete', 'deleteMany'];

    it('QI 읽기 EP 전부 — 변이 호출 0', async () => {
      const boom = (model: string, op: string) => vi.fn(() => { throw new Error(`🔴 GET 이 DB 를 썼다: ${model}.${op}`); });
      for (const [model, api] of Object.entries(mockPrisma as Record<string, Record<string, unknown>>)) {
        for (const op of MUTATIONS) api[op] = boom(model, op);
      }
      mockPrisma.accreditationItem.count.mockResolvedValue(0);
      mockPrisma.surgery.count = vi.fn().mockResolvedValue(0);

      await service.getMetrics();
      await service.getAdequacyIndicators();
      await service.calculatePsi();
      await service.calculateHsmr('2026-05');
      await service.getReadmissionRate('2026-05');
      await service.getAccreditationChecklist();
      await service.getIndicatorDashboard('2026-05');
      await service.getBenchmarkComparison();
      await service.getTargetAchievement('2026-05');

      for (const api of Object.values(mockPrisma as Record<string, Record<string, { mock?: { calls: unknown[] } }>>)) {
        for (const op of MUTATIONS) expect(api[op]?.mock?.calls ?? []).toHaveLength(0);
      }
    });
  });

  /**
   * 🔴 W8 Q6 — 판정 함수는 W7 에서 수렴했는데 **표본 창**이 갈려서 두 화면이 다른 답을 냈다.
   *    응답이 "언제 것인지"를 스스로 말해야 화면이 묵은 값을 오늘로 읽지 않는다.
   */
  describe('🔴 표본 창을 응답이 말한다', () => {
    const stale = {
      id: 'hh', name: '손위생 수행률', category: '감염관리',
      formula: '(손위생 수행 횟수 / 손위생 기회 횟수) × 100', targetValue: 95,
      measurements: [{ period: '2026-05', value: 91 }],
    };

    it('요청 달에 측정이 없으면 산출 불가 + 최근 측정 시점을 함께 낸다', async () => {
      mockPrisma.qualityIndicator.findMany.mockResolvedValue([stale]);
      const r = await service.getIndicatorDashboard('2026-08');
      expect(r.measuredCount).toBe(0);
      expect(r.periodHasMeasurements).toBe(false);
      expect(r.latestAvailablePeriod).toBe('2026-05');
      expect(r.sampleWindowNote).toContain('2026-05');
      expect(r.indicators[0].current).toBeNull(); // 폴백 금지
      expect(r.indicators[0].latestAvailableValue).toBe(91); // 참고 시점 값은 별도 필드로만
    });

    it('목표 달성률도 같은 표본 창 정보를 낸다(보드와 대조 가능)', async () => {
      mockPrisma.qualityIndicator.findMany.mockResolvedValue([stale]);
      const r = await service.getTargetAchievement('2026-08');
      expect(r.summary.overallRate).toBeNull();
      expect(r.latestAvailablePeriod).toBe('2026-05');
      expect(r.periodHasMeasurements).toBe(false);
    });
  });
});
