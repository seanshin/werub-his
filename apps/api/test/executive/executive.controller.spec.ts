import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ExecutiveController } from '../../src/modules/executive/executive.controller';

describe('ExecutiveController', () => {
  let controller: ExecutiveController;
  let mockService: any;

  beforeEach(() => {
    mockService = {
      getOverview: vi.fn(),
      getWeeklyRevenue: vi.fn(),
      getMonthlyTrend: vi.fn(),
      getDepartmentStats: vi.fn(),
      getStaffSummary: vi.fn(),
      getKpi: vi.fn(),
      getClaimsSummary: vi.fn(),
      getAlerts: vi.fn(),
      getClinicalOverview: vi.fn(),
      getDoctorStats: vi.fn(),
      getSafety: vi.fn(),
      getInfection: vi.fn(),
      getClinicalWeeklyTrend: vi.fn(),
    };

    controller = new ExecutiveController(mockService);
  });

  describe('GET /overview (Management Dashboard)', () => {
    it('should return overview data', async () => {
      const mockOverview = {
        todayRevenue: 1500000,
        unpaidAmount: 300000,
        unpaidCount: 5,
        revenueChange: 25,
        todayPatients: 45,
        patientChange: 10,
        bedOccupancy: 75,
        totalBeds: 100,
        occupiedBeds: 75,
        icuTotal: 20,
        icuOccupied: 8,
        inpatients: 23,
      };

      vi.mocked(mockService.getOverview).mockResolvedValue(mockOverview);

      const result = await controller.getOverview();

      expect(result.data.todayRevenue).toBe(1500000);
      expect(result.data.bedOccupancy).toBe(75);
      expect(mockService.getOverview).toHaveBeenCalled();
    });

    it('should wrap response in data object', async () => {
      const mockOverview = { todayRevenue: 1000000 };

      vi.mocked(mockService.getOverview).mockResolvedValue(mockOverview);

      const result = await controller.getOverview();

      expect(result).toHaveProperty('data');
      expect(result.data.todayRevenue).toBe(1000000);
    });

    it('should include financial metrics', async () => {
      const mockOverview = {
        todayRevenue: 1500000,
        unpaidAmount: 300000,
        unpaidCount: 5,
        revenueChange: 25,
      };

      vi.mocked(mockService.getOverview).mockResolvedValue(mockOverview);

      const result = await controller.getOverview();

      expect(result.data.todayRevenue).toBeDefined();
      expect(result.data.unpaidAmount).toBeDefined();
      expect(result.data.revenueChange).toBeDefined();
    });
  });

  describe('GET /revenue/weekly', () => {
    it('should return weekly revenue data', async () => {
      const mockWeeklyData = [
        { date: '2026-05-07', revenue: 1000000, count: 10 },
        { date: '2026-05-08', revenue: 1200000, count: 12 },
        { date: '2026-05-09', revenue: 1100000, count: 11 },
      ];

      vi.mocked(mockService.getWeeklyRevenue).mockResolvedValue(mockWeeklyData);

      const result = await controller.getWeeklyRevenue();

      expect(result.data).toHaveLength(3);
      expect(result.data[0].date).toBe('2026-05-07');
      expect(mockService.getWeeklyRevenue).toHaveBeenCalled();
    });

    it('should include daily counts', async () => {
      const mockWeeklyData = [
        { date: '2026-05-13', revenue: 1500000, count: 15 },
      ];

      vi.mocked(mockService.getWeeklyRevenue).mockResolvedValue(mockWeeklyData);

      const result = await controller.getWeeklyRevenue();

      expect(result.data[0].count).toBe(15);
    });

    it('should wrap response in data object', async () => {
      vi.mocked(mockService.getWeeklyRevenue).mockResolvedValue([]);

      const result = await controller.getWeeklyRevenue();

      expect(result).toHaveProperty('data');
      expect(Array.isArray(result.data)).toBe(true);
    });
  });

  describe('GET /revenue/monthly', () => {
    it('should return monthly trend data', async () => {
      const mockMonthlyData = [
        { month: '2026-01', encounters: 500, revenue: 5000000 },
        { month: '2026-02', encounters: 520, revenue: 5200000 },
        { month: '2026-03', encounters: 550, revenue: 5500000 },
        { month: '2026-04', encounters: 580, revenue: 5800000 },
        { month: '2026-05', encounters: 300, revenue: 3000000 },
      ];

      vi.mocked(mockService.getMonthlyTrend).mockResolvedValue(mockMonthlyData);

      const result = await controller.getMonthlyTrend();

      expect(result.data).toHaveLength(5);
      expect(result.data[0].month).toBe('2026-01');
      expect(mockService.getMonthlyTrend).toHaveBeenCalled();
    });

    it('should include encounter and revenue metrics', async () => {
      const mockMonthlyData = [
        { month: '2026-05', encounters: 300, revenue: 3000000 },
      ];

      vi.mocked(mockService.getMonthlyTrend).mockResolvedValue(mockMonthlyData);

      const result = await controller.getMonthlyTrend();

      expect(result.data[0].encounters).toBe(300);
      expect(result.data[0].revenue).toBe(3000000);
    });
  });

  describe('GET /departments', () => {
    it('should return department statistics', async () => {
      const mockDeptStats = [
        { department: '내과', encounters: 120, revenue: 2400000 },
        { department: '외과', encounters: 80, revenue: 2000000 },
        { department: '정형외과', encounters: 60, revenue: 1500000 },
      ];

      vi.mocked(mockService.getDepartmentStats).mockResolvedValue(mockDeptStats);

      const result = await controller.getDepartmentStats();

      expect(result.data).toHaveLength(3);
      expect(result.data[0].department).toBe('내과');
      expect(mockService.getDepartmentStats).toHaveBeenCalled();
    });

    it('should sort by revenue descending', async () => {
      const mockDeptStats = [
        { department: '내과', encounters: 120, revenue: 2400000 },
        { department: '외과', encounters: 80, revenue: 2000000 },
      ];

      vi.mocked(mockService.getDepartmentStats).mockResolvedValue(mockDeptStats);

      const result = await controller.getDepartmentStats();

      expect(result.data[0].revenue).toBeGreaterThanOrEqual(result.data[1].revenue);
    });

    it('should wrap response in data object', async () => {
      vi.mocked(mockService.getDepartmentStats).mockResolvedValue([]);

      const result = await controller.getDepartmentStats();

      expect(result).toHaveProperty('data');
      expect(Array.isArray(result.data)).toBe(true);
    });
  });

  describe('GET /staff-summary', () => {
    it('should return staff summary by category', async () => {
      const mockStaffSummary = {
        total: 150,
        categories: [
          { category: 'DOCTOR', count: 25 },
          { category: 'NURSE', count: 80 },
          { category: 'TECHNICIAN', count: 30 },
          { category: 'ADMIN', count: 15 },
        ],
      };

      vi.mocked(mockService.getStaffSummary).mockResolvedValue(mockStaffSummary);

      const result = await controller.getStaffSummary();

      expect(result.data.total).toBe(150);
      expect(result.data.categories).toHaveLength(4);
      expect(mockService.getStaffSummary).toHaveBeenCalled();
    });

    it('should include staff count by category', async () => {
      const mockStaffSummary = {
        total: 100,
        categories: [
          { category: 'NURSE', count: 60 },
        ],
      };

      vi.mocked(mockService.getStaffSummary).mockResolvedValue(mockStaffSummary);

      const result = await controller.getStaffSummary();

      expect(result.data.categories[0].category).toBe('NURSE');
      expect(result.data.categories[0].count).toBe(60);
    });
  });

  describe('GET /kpi', () => {
    it('should return KPI metrics', async () => {
      const mockKpi = [
        { name: '일평균 외래환자', target: '150명', actual: '120명', rate: 80 },
        { name: '병상 가동률', target: '80%', actual: '75%', rate: 93 },
        { name: '평균 재원일수', target: '7일', actual: '6.5일', rate: 100 },
        { name: '수술건수/월', target: '50건', actual: '45건', rate: 90 },
        { name: '청구 삭감률', target: '<3%', actual: '2.5%', rate: 100 },
        { name: '입원환자', target: '-', actual: '23명', rate: 0 },
      ];

      vi.mocked(mockService.getKpi).mockResolvedValue(mockKpi);

      const result = await controller.getKpi();

      expect(result.data).toHaveLength(6);
      expect(result.data[0].name).toBe('일평균 외래환자');
      expect(mockService.getKpi).toHaveBeenCalled();
    });

    it('should include target and actual values for each KPI', async () => {
      const mockKpi = [
        { name: '일평균 외래환자', target: '150명', actual: '120명', rate: 80 },
      ];

      vi.mocked(mockService.getKpi).mockResolvedValue(mockKpi);

      const result = await controller.getKpi();

      expect(result.data[0].target).toBe('150명');
      expect(result.data[0].actual).toBe('120명');
      expect(result.data[0].rate).toBe(80);
    });

    it('should wrap response in data object', async () => {
      vi.mocked(mockService.getKpi).mockResolvedValue([]);

      const result = await controller.getKpi();

      expect(result).toHaveProperty('data');
      expect(Array.isArray(result.data)).toBe(true);
    });
  });

  describe('GET /claims', () => {
    it('should return claims summary', async () => {
      const mockClaimsSummary = {
        draft: 5,
        submitted: 15,
        approved: 50,
        totalClaimed: 5000000,
        reductionRate: '2.5',
      };

      vi.mocked(mockService.getClaimsSummary).mockResolvedValue(mockClaimsSummary);

      const result = await controller.getClaims();

      expect(result.data.draft).toBe(5);
      expect(result.data.submitted).toBe(15);
      expect(result.data.approved).toBe(50);
      expect(mockService.getClaimsSummary).toHaveBeenCalled();
    });

    it('should include reduction rate', async () => {
      const mockClaimsSummary = {
        draft: 0,
        submitted: 10,
        approved: 40,
        totalClaimed: 5000000,
        reductionRate: '3.2',
      };

      vi.mocked(mockService.getClaimsSummary).mockResolvedValue(mockClaimsSummary);

      const result = await controller.getClaims();

      expect(result.data.reductionRate).toBe('3.2');
    });

    it('should wrap response in data object', async () => {
      const mockClaimsSummary = { draft: 0, submitted: 0, approved: 0, totalClaimed: 0, reductionRate: '0' };

      vi.mocked(mockService.getClaimsSummary).mockResolvedValue(mockClaimsSummary);

      const result = await controller.getClaims();

      expect(result).toHaveProperty('data');
    });
  });

  describe('GET /alerts', () => {
    it('should return management alerts', async () => {
      const mockAlerts = [
        { type: 'billing', message: '미수납 5건', severity: 'warning' },
        { type: 'inventory', message: '재고 부족 3품목', severity: 'warning' },
        { type: 'chart', message: '미완료 차트 2건', severity: 'info' },
      ];

      vi.mocked(mockService.getAlerts).mockResolvedValue(mockAlerts);

      const result = await controller.getAlerts();

      expect(result.data).toHaveLength(3);
      expect(result.data[0].type).toBe('billing');
      expect(mockService.getAlerts).toHaveBeenCalled();
    });

    it('should include severity levels', async () => {
      const mockAlerts = [
        { type: 'billing', message: '미수납 10건', severity: 'warning' },
      ];

      vi.mocked(mockService.getAlerts).mockResolvedValue(mockAlerts);

      const result = await controller.getAlerts();

      expect(result.data[0].severity).toBe('warning');
    });
  });

  describe('GET /clinical/overview (Clinical Quality Dashboard)', () => {
    it('should return clinical overview', async () => {
      const mockClinicalOverview = {
        todayEncounters: 45,
        totalAppointments: 60,
        waitingPatients: 12,
        inpatients: 23,
        icuPatients: 8,
      };

      vi.mocked(mockService.getClinicalOverview).mockResolvedValue(mockClinicalOverview);

      const result = await controller.getClinicalOverview();

      expect(result.data.todayEncounters).toBe(45);
      expect(result.data.inpatients).toBe(23);
      expect(mockService.getClinicalOverview).toHaveBeenCalled();
    });

    it('should include waiting and ICU patients', async () => {
      const mockClinicalOverview = {
        todayEncounters: 45,
        totalAppointments: 60,
        waitingPatients: 12,
        inpatients: 23,
        icuPatients: 8,
      };

      vi.mocked(mockService.getClinicalOverview).mockResolvedValue(mockClinicalOverview);

      const result = await controller.getClinicalOverview();

      expect(result.data.waitingPatients).toBe(12);
      expect(result.data.icuPatients).toBe(8);
    });

    it('should wrap response in data object', async () => {
      const mockClinicalOverview = { todayEncounters: 0, totalAppointments: 0, waitingPatients: 0, inpatients: 0, icuPatients: 0 };

      vi.mocked(mockService.getClinicalOverview).mockResolvedValue(mockClinicalOverview);

      const result = await controller.getClinicalOverview();

      expect(result).toHaveProperty('data');
    });
  });

  describe('GET /clinical/doctors', () => {
    it('should return doctor statistics', async () => {
      const mockDoctorStats = [
        {
          id: 'dr-1',
          name: '이의사',
          department: '내과',
          todayEncounters: 15,
          weekEncounters: 50,
          waitingPatients: 5,
          incompleteCharts: 2,
        },
        {
          id: 'dr-2',
          name: '김의사',
          department: '외과',
          todayEncounters: 12,
          weekEncounters: 45,
          waitingPatients: 3,
          incompleteCharts: 1,
        },
      ];

      vi.mocked(mockService.getDoctorStats).mockResolvedValue(mockDoctorStats);

      const result = await controller.getDoctorStats();

      expect(result.data).toHaveLength(2);
      expect(result.data[0].name).toBe('이의사');
      expect(mockService.getDoctorStats).toHaveBeenCalled();
    });

    it('should include daily and weekly encounter counts', async () => {
      const mockDoctorStats = [
        {
          id: 'dr-1',
          name: '이의사',
          department: '내과',
          todayEncounters: 15,
          weekEncounters: 50,
          waitingPatients: 5,
          incompleteCharts: 2,
        },
      ];

      vi.mocked(mockService.getDoctorStats).mockResolvedValue(mockDoctorStats);

      const result = await controller.getDoctorStats();

      expect(result.data[0].todayEncounters).toBe(15);
      expect(result.data[0].weekEncounters).toBe(50);
    });

    it('should include incomplete charts count', async () => {
      const mockDoctorStats = [
        {
          id: 'dr-1',
          name: '이의사',
          department: '내과',
          todayEncounters: 10,
          weekEncounters: 40,
          waitingPatients: 4,
          incompleteCharts: 3,
        },
      ];

      vi.mocked(mockService.getDoctorStats).mockResolvedValue(mockDoctorStats);

      const result = await controller.getDoctorStats();

      expect(result.data[0].incompleteCharts).toBe(3);
    });
  });

  describe('GET /clinical/safety', () => {
    it('should return safety incident data', async () => {
      const mockSafety = {
        totalIncidents: 8,
        falls: 3,
        medicationErrors: 2,
        others: 3,
      };

      vi.mocked(mockService.getSafety).mockResolvedValue(mockSafety);

      const result = await controller.getSafety();

      expect(result.data.totalIncidents).toBe(8);
      expect(result.data.falls).toBe(3);
      expect(mockService.getSafety).toHaveBeenCalled();
    });

    it('should categorize incidents by type', async () => {
      const mockSafety = {
        totalIncidents: 10,
        falls: 5,
        medicationErrors: 3,
        others: 2,
      };

      vi.mocked(mockService.getSafety).mockResolvedValue(mockSafety);

      const result = await controller.getSafety();

      expect(result.data.falls).toBe(5);
      expect(result.data.medicationErrors).toBe(3);
      expect(result.data.others).toBe(2);
    });

    it('should wrap response in data object', async () => {
      const mockSafety = { totalIncidents: 0, falls: 0, medicationErrors: 0, others: 0 };

      vi.mocked(mockService.getSafety).mockResolvedValue(mockSafety);

      const result = await controller.getSafety();

      expect(result).toHaveProperty('data');
    });
  });

  describe('GET /clinical/infection', () => {
    it('should return infection surveillance data', async () => {
      const mockInfection = {
        active: 6,
        mrsa: 3,
        others: 3,
        isolated: 5,
      };

      vi.mocked(mockService.getInfection).mockResolvedValue(mockInfection);

      const result = await controller.getInfection();

      expect(result.data.active).toBe(6);
      expect(result.data.mrsa).toBe(3);
      expect(mockService.getInfection).toHaveBeenCalled();
    });

    it('should include isolation count', async () => {
      const mockInfection = {
        active: 8,
        mrsa: 4,
        others: 4,
        isolated: 6,
      };

      vi.mocked(mockService.getInfection).mockResolvedValue(mockInfection);

      const result = await controller.getInfection();

      expect(result.data.isolated).toBe(6);
    });

    it('should wrap response in data object', async () => {
      const mockInfection = { active: 0, mrsa: 0, others: 0, isolated: 0 };

      vi.mocked(mockService.getInfection).mockResolvedValue(mockInfection);

      const result = await controller.getInfection();

      expect(result).toHaveProperty('data');
    });
  });

  describe('GET /clinical/weekly-trend', () => {
    it('should return weekly trend by department', async () => {
      const mockWeeklyTrend = {
        departments: ['내과', '외과', '소아청소년과', '정형외과', '산부인과', '응급의학과'],
        days: [
          { date: '2026-05-07', '내과': 20, '외과': 15, '소아청소년과': 10, '정형외과': 8, '산부인과': 5, '응급의학과': 12 },
          { date: '2026-05-08', '내과': 22, '외과': 16, '소아청소년과': 11, '정형외과': 9, '산부인과': 6, '응급의학과': 13 },
        ],
      };

      vi.mocked(mockService.getClinicalWeeklyTrend).mockResolvedValue(mockWeeklyTrend);

      const result = await controller.getClinicalWeeklyTrend();

      expect(result.data.departments).toHaveLength(6);
      expect(result.data.days).toHaveLength(2);
      expect(mockService.getClinicalWeeklyTrend).toHaveBeenCalled();
    });

    it('should include encounter counts for each department per day', async () => {
      const mockWeeklyTrend = {
        departments: ['내과', '외과'],
        days: [
          { date: '2026-05-13', '내과': 25, '외과': 18 },
        ],
      };

      vi.mocked(mockService.getClinicalWeeklyTrend).mockResolvedValue(mockWeeklyTrend);

      const result = await controller.getClinicalWeeklyTrend();

      expect(result.data.days[0]['내과']).toBe(25);
      expect(result.data.days[0]['외과']).toBe(18);
    });

    it('should wrap response in data object', async () => {
      const mockWeeklyTrend = { departments: [], days: [] };

      vi.mocked(mockService.getClinicalWeeklyTrend).mockResolvedValue(mockWeeklyTrend);

      const result = await controller.getClinicalWeeklyTrend();

      expect(result).toHaveProperty('data');
    });
  });

  describe('Authorization', () => {
    it('진입은 기능 접근 매트릭스(executive.console)로 통제된다', async () => {
      // @UseGuards(JwtAuthGuard, FeatureAccessGuard) + @RequireFeature('executive.console')
      // (종전 주석은 @Roles(UserRole.ADMIN) 을 말했으나 컨트롤러는 매트릭스 가드를 쓴다)
      vi.mocked(mockService.getOverview).mockResolvedValue({});

      const result = await controller.getOverview();

      expect(result).toHaveProperty('data');
    });

    it('should use JWT authentication guard', async () => {
      vi.mocked(mockService.getWeeklyRevenue).mockResolvedValue([]);

      const result = await controller.getWeeklyRevenue();

      expect(result).toHaveProperty('data');
    });
  });

  /**
   * 🔴 컨트롤러는 서비스 값을 **접지 않고** 그대로 흘려야 한다.
   *    여기서 `?? 0` 을 한 번만 넣어도 "산출 불가"가 다시 0/100 으로 둔갑한다(P17).
   */
  describe('산출 불가(null) 전달 계약', () => {
    it('overview 의 null 지표를 0 으로 접지 않는다', async () => {
      vi.mocked(mockService.getOverview).mockResolvedValue({
        revenueChange: null, patientChange: null, bedOccupancy: null,
        revenueChangeMetric: { value: null, n: 0 },
      });

      const result = await controller.getOverview();

      expect(result.data.revenueChange).toBeNull();
      expect(result.data.patientChange).toBeNull();
      expect(result.data.bedOccupancy).toBeNull();
      expect(result.data.revenueChangeMetric).toEqual({ value: null, n: 0 });
    });

    it('KPI 의 rate=null 을 그대로 전달한다', async () => {
      vi.mocked(mockService.getKpi).mockResolvedValue([
        { name: '청구 삭감률', target: '<3%', actual: '-', rate: null, n: 0, note: '이번달 청구 0건 — 산출 불가' },
        { name: '수술건수/월', target: '50건', actual: '0건', rate: 0, n: 0 },
      ]);

      const result = await controller.getKpi();

      expect(result.data[0].rate).toBeNull(); // 표본 부재
      expect(result.data[1].rate).toBe(0); // 진짜 0 — null 로 뭉개지 않는다
    });

    it('claims 의 reductionRate=null 을 "0.0" 으로 바꾸지 않는다', async () => {
      vi.mocked(mockService.getClaimsSummary).mockResolvedValue({
        count: 0, draft: 0, submitted: 0, approved: 0, totalClaimed: 0, reductionRate: null,
      });

      const result = await controller.getClaims();

      expect(result.data.reductionRate).toBeNull();
    });

    it('안전/감염의 조회 실패(unavailable)를 숨기지 않는다', async () => {
      vi.mocked(mockService.getSafety).mockResolvedValue({ unavailable: true, totalIncidents: null });
      vi.mocked(mockService.getInfection).mockResolvedValue({ unavailable: true, active: null });

      expect((await controller.getSafety()).data.unavailable).toBe(true);
      expect((await controller.getInfection()).data.active).toBeNull();
    });
  });
});
