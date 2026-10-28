import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AnomalyDetectionService } from '../../src/modules/audit-enhanced/anomaly-detection.service';

describe('AnomalyDetectionService', () => {
  let service: AnomalyDetectionService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      auditLog: {
        groupBy: vi.fn(),
        count: vi.fn(),
        findMany: vi.fn().mockResolvedValue([]),
      },
      // 🔴 W8 — VIP 정본은 `patient_flags(flagType='VIP')` 하나다(vip-canonical.ts).
      //    종전에는 이상탐지만 `vip_patients`(운영 0행)를 읽어, 화면에서 VIP 로 찍어도
      //    접근 경보가 걸릴 수 없었다.
      patientFlag: {
        count: vi.fn().mockResolvedValue(0),
        findMany: vi.fn().mockResolvedValue([]),
      },
      breakTheGlassAccess: {
        count: vi.fn(),
      },
      // 🔴 SMART 앱 접근은 AuditLog(User FK)에 담기지 않는 별도 축 — 감사 대시보드가 통째로 빠뜨렸다
      smartAccessLog: {
        count: vi.fn().mockResolvedValue(0),
      },
    };

    service = new AnomalyDetectionService(mockPrisma);
  });

  describe('checkBulkAccess', () => {
    it('should detect bulk access anomaly', async () => {
      const mockLogs = Array.from({ length: 10 }, (_, i) => ({
        resourceId: `patient-${i}`,
      }));
      vi.mocked(mockPrisma.auditLog.groupBy).mockResolvedValue(mockLogs);

      const result = await service.checkBulkAccess('user-1');

      expect(result).toBeDefined();
      expect(result?.type).toBe('BULK_ACCESS');
      expect(result?.userId).toBe('user-1');
    });

    it('should return null if no anomaly', async () => {
      vi.mocked(mockPrisma.auditLog.groupBy).mockResolvedValue([
        { resourceId: 'patient-1' },
        { resourceId: 'patient-2' },
      ]);

      const result = await service.checkBulkAccess('user-1');

      expect(result).toBeNull();
    });

    // 2026-07 감사 커버리지 확대: 열람 감사는 도메인 무관하게 대상 환자(resourceId)에 귀속된다.
    // resourceType 을 'Patient' 로 고정하면 차트 대량 열람을 탐지하지 못한다.
    it('should count distinct patients read in past hour across domains', async () => {
      vi.mocked(mockPrisma.auditLog.groupBy).mockResolvedValue([]);

      await service.checkBulkAccess('user-1');

      const arg = vi.mocked(mockPrisma.auditLog.groupBy).mock.calls[0][0];
      expect(arg.by).toEqual(['resourceId']);
      expect(arg.where).toEqual(
        expect.objectContaining({
          userId: 'user-1',
          action: 'READ',
          resourceId: { not: '00000000-0000-0000-0000-000000000000' },
          timestamp: expect.any(Object),
        })
      );
      expect(arg.where).not.toHaveProperty('resourceType');
    });

    it('should include count in message', async () => {
      const mockLogs = Array.from({ length: 15 }, (_, i) => ({
        resourceId: `patient-${i}`,
      }));
      vi.mocked(mockPrisma.auditLog.groupBy).mockResolvedValue(mockLogs);

      const result = await service.checkBulkAccess('user-1');

      expect(result?.message).toContain('15');
    });
  });

  describe('checkVipAccess', () => {
    it('should detect VIP access', async () => {
      vi.mocked(mockPrisma.patientFlag.count).mockResolvedValue(1);

      const result = await service.checkVipAccess('patient-1', 'user-1');

      expect(result).toBeDefined();
      expect(result?.type).toBe('VIP_ACCESS');
      expect(result?.userId).toBe('user-1');
    });

    it('should return null if not VIP', async () => {
      vi.mocked(mockPrisma.patientFlag.count).mockResolvedValue(0);

      const result = await service.checkVipAccess('patient-1', 'user-1');

      expect(result).toBeNull();
    });

    it('should include patientId in message', async () => {
      vi.mocked(mockPrisma.patientFlag.count).mockResolvedValue(1);

      const result = await service.checkVipAccess('patient-123', 'user-1');

      expect(result?.message).toContain('patient-123');
    });

    /**
     * 🔴 W8 가드 — VIP 정본은 하나다. 이상탐지가 `vip_patients` 를 읽으면 화면(patient_flags)이
     * 찍은 VIP 가 감지되지 않는다(운영 실측: 화면 2행 / vip_patients 0행 → 경보 구조적 불가).
     */
    it('🔴 VIP 판정은 patient_flags(flagType=VIP·isActive) 정본만 읽는다', async () => {
      vi.mocked(mockPrisma.patientFlag.count).mockResolvedValue(0);

      await service.checkVipAccess('patient-1', 'user-1');

      expect(mockPrisma.patientFlag.count).toHaveBeenCalledWith({
        where: { flagType: 'VIP', isActive: true, patientId: 'patient-1' },
      });
      expect(mockPrisma.vipPatient).toBeUndefined(); // 폐지된 정본을 다시 읽지 않는다
    });
  });

  /**
   * 🔴 W8 — `checkVipAccess()` 는 정의만 되고 **어디서도 호출되지 않았다**.
   * 주기 점검에 배선해 실제로 감지가 일어나게 한다(있는 줄 알았던 통제가 없던 것).
   */
  describe('detectVipAccess (주기 점검 배선)', () => {
    it('VIP 지정이 없으면 조회조차 하지 않고 빈 결과 — 경보 0건이 사실', async () => {
      vi.mocked(mockPrisma.patientFlag.findMany).mockResolvedValue([]);

      const alerts = await service.detectVipAccess(new Date('2026-08-14T00:00:00Z'));

      expect(alerts).toEqual([]);
      expect(mockPrisma.auditLog.findMany).not.toHaveBeenCalled();
    });

    it('VIP 환자 열람을 (직원·환자) 쌍당 1건으로 경보한다', async () => {
      vi.mocked(mockPrisma.patientFlag.findMany).mockResolvedValue([
        { patientId: 'patient-1' },
        { patientId: 'patient-1' }, // 두 직원이 찍은 같은 환자
      ]);
      vi.mocked(mockPrisma.auditLog.findMany).mockResolvedValue([
        { userId: 'user-1', resourceId: 'patient-1', timestamp: new Date('2026-08-14T01:00:00Z') },
        { userId: 'user-1', resourceId: 'patient-1', timestamp: new Date('2026-08-14T01:05:00Z') },
        { userId: 'user-2', resourceId: 'patient-1', timestamp: new Date('2026-08-14T02:00:00Z') },
      ]);

      const alerts = await service.detectVipAccess(new Date('2026-08-14T00:00:00Z'));

      expect(alerts).toHaveLength(2);
      expect(alerts.every((a) => a.type === 'VIP_ACCESS')).toBe(true);
      expect(alerts.map((a) => a.userId)).toEqual(['user-1', 'user-2']);
    });
  });

  describe('checkAfterHoursAccess', () => {
    it('should check after-hours logic', async () => {
      // This method checks current time using getHours()
      // Test basic functionality without time mocking
      const result = await service.checkAfterHoursAccess('user-1');

      // Result depends on current time: either anomaly or null
      if (result) {
        expect(result.type).toBe('AFTER_HOURS');
        expect(result.userId).toBe('user-1');
        expect(result.message).toContain('시간');
      } else {
        expect(result).toBeNull();
      }
    });

    it('should have detectedAt timestamp when anomaly detected', async () => {
      const result = await service.checkAfterHoursAccess('user-1');

      if (result) {
        expect(result.detectedAt).toBeDefined();
      }
    });

    it('should return null or anomaly based on hour', async () => {
      const result = await service.checkAfterHoursAccess('user-1');

      // Result should be null or have AFTER_HOURS type
      if (result !== null) {
        expect(result.type).toBe('AFTER_HOURS');
      }
    });
  });

  describe('getDashboardStats', () => {
    it('should return dashboard statistics', async () => {
      vi.mocked(mockPrisma.auditLog.count).mockResolvedValue(100);
      vi.mocked(mockPrisma.auditLog.groupBy)
        .mockResolvedValueOnce([
          { action: 'READ', _count: 80 },
          { action: 'WRITE', _count: 20 },
        ])
        .mockResolvedValueOnce([
          { resourceType: 'Patient', _count: 60 },
          { resourceType: 'Prescription', _count: 40 },
        ]);
      vi.mocked(mockPrisma.breakTheGlassAccess.count).mockResolvedValue(5);

      const result = await service.getDashboardStats();

      expect(result.totalAccess).toBe(100);
      expect(result.byAction.length).toBeGreaterThan(0);
      expect(result.byResource.length).toBeGreaterThan(0);
      expect(result.btgCount).toBe(5);
    });

    it('should filter by date range', async () => {
      vi.mocked(mockPrisma.auditLog.count).mockResolvedValue(50);
      vi.mocked(mockPrisma.auditLog.groupBy)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);
      vi.mocked(mockPrisma.breakTheGlassAccess.count).mockResolvedValue(2);

      await service.getDashboardStats('2026-05-01', '2026-05-31');

      expect(mockPrisma.auditLog.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            timestamp: expect.any(Object),
          }),
        })
      );
    });

    /**
     * 🔴 `new Date('2026-08-13')` 은 TZ 와 무관하게 **항상 UTC 자정**이라, 같은 날짜를
     * gte/lte 로 넣으면 폭 0 인 구간이 됐다. 실측: 화면 "총 접근 0" / 실제 21건.
     * 감사 화면이 "그날 아무도 환자 기록을 열지 않았다"고 말했다.
     */
    it('🔴 같은 날짜를 주면 그 하루 전체를 센다 — 폭 0 이 아니다', async () => {
      vi.mocked(mockPrisma.auditLog.count).mockResolvedValue(21);
      vi.mocked(mockPrisma.auditLog.groupBy).mockResolvedValue([]);
      vi.mocked(mockPrisma.breakTheGlassAccess.count).mockResolvedValue(0);

      await service.getDashboardStats('2026-08-13', '2026-08-13');

      const where = vi.mocked(mockPrisma.auditLog.count).mock.calls[0][0].where as {
        timestamp: { gte: Date; lt: Date };
      };
      expect(where.timestamp.lt.getTime() - where.timestamp.gte.getTime()).toBe(86_400_000);
      expect(where.timestamp.gte.getHours()).toBe(0); // UTC 자정이면 KST 09시가 된다
    });

    it('🔴 BTG 카드도 같은 구간을 쓴다 — 종전엔 dateTo 를 무시해 옆 목록과 분모가 달랐다', async () => {
      vi.mocked(mockPrisma.auditLog.count).mockResolvedValue(0);
      vi.mocked(mockPrisma.auditLog.groupBy).mockResolvedValue([]);
      vi.mocked(mockPrisma.breakTheGlassAccess.count).mockResolvedValue(0);

      await service.getDashboardStats('2026-08-01', '2026-08-13');

      const btgWhere = vi.mocked(mockPrisma.breakTheGlassAccess.count).mock.calls[0][0]
        ?.where as { accessedAt: { gte: Date; lt: Date } };
      expect(btgWhere.accessedAt.lt).toBeInstanceOf(Date);
    });

    it('🔴 SMART 앱 접근을 별도 축으로 함께 낸다 — 종전엔 실접근의 1.1% 만 보여주며 "총 접근"이라 했다', async () => {
      vi.mocked(mockPrisma.auditLog.count).mockResolvedValue(130);
      vi.mocked(mockPrisma.auditLog.groupBy).mockResolvedValue([]);
      vi.mocked(mockPrisma.breakTheGlassAccess.count).mockResolvedValue(0);
      vi.mocked(mockPrisma.smartAccessLog.count)
        .mockResolvedValueOnce(12078)
        .mockResolvedValueOnce(8052);

      const r = await service.getDashboardStats();

      expect(r.smartAccess).toBe(12078);
      expect(r.smartPatientScoped).toBe(8052);
      expect(r.totalAccessAllChannels).toBe(130 + 12078);
    });

    it('🔴 BTG 가드가 미배선임을 알린다 — "0건"이 "긴급열람 없음"으로 읽히면 안 된다', async () => {
      vi.mocked(mockPrisma.auditLog.count).mockResolvedValue(0);
      vi.mocked(mockPrisma.auditLog.groupBy).mockResolvedValue([]);
      vi.mocked(mockPrisma.breakTheGlassAccess.count).mockResolvedValue(0);

      const r = await service.getDashboardStats();

      expect(r.btgInstrumented).toBe(false);
    });

    it('🔴 리소스 유형 대소문자 분열을 합친다 — PRESCRIPTION 과 Prescription 이 두 줄이었다', async () => {
      vi.mocked(mockPrisma.auditLog.count).mockResolvedValue(51);
      vi.mocked(mockPrisma.auditLog.groupBy)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          { resourceType: 'PRESCRIPTION', _count: 8 },
          { resourceType: 'Prescription', _count: 43 },
        ]);
      vi.mocked(mockPrisma.breakTheGlassAccess.count).mockResolvedValue(0);

      const r = await service.getDashboardStats();

      expect(r.byResource).toEqual([{ resource: 'Prescription', count: 51 }]);
    });

    /**
     * 🔴 W8 가드 — 감사 로그 화면(`/admin/audit`)과 감사 대시보드가 **같은 분모**를 쓰게 하려고
     * 최근 24시간도 여기서 낸다. 종전에는 `/admin/audit` 만 별도 `/audit/stats` 를 봐서
     * SMART 앱 접근 27,102건을 통째로 누락하고 그것을 '전체 로그'라 불렀다.
     */
    it('🔴 최근 24시간을 양 채널로 함께 낸다 — 두 감사 화면이 같은 분모를 쓴다', async () => {
      vi.mocked(mockPrisma.auditLog.count).mockResolvedValue(6131);
      vi.mocked(mockPrisma.auditLog.groupBy).mockResolvedValue([]);
      vi.mocked(mockPrisma.breakTheGlassAccess.count).mockResolvedValue(0);
      vi.mocked(mockPrisma.smartAccessLog.count).mockResolvedValue(27102);

      const r = await service.getDashboardStats();

      expect(r.last24hAudit).toBe(6131);
      expect(r.last24hSmart).toBe(27102);
      expect(r.last24hAllChannels).toBe(6131 + 27102);
    });

    it('🔴 리소스 유형을 상위 N 종으로 자르지 않는다 — 잘린 유형은 필터에서 조회조차 불가했다', async () => {
      const many = Array.from({ length: 104 }, (_, i) => ({ resourceType: `Type${i}`, _count: 1 }));
      vi.mocked(mockPrisma.auditLog.count).mockResolvedValue(104);
      vi.mocked(mockPrisma.auditLog.groupBy).mockResolvedValueOnce([]).mockResolvedValueOnce(many);
      vi.mocked(mockPrisma.breakTheGlassAccess.count).mockResolvedValue(0);

      const r = await service.getDashboardStats();

      expect(r.byResource).toHaveLength(104);
    });

    it('should map actions with counts', async () => {
      vi.mocked(mockPrisma.auditLog.count).mockResolvedValue(100);
      vi.mocked(mockPrisma.auditLog.groupBy)
        .mockResolvedValueOnce([
          { action: 'READ', _count: 80 },
        ])
        .mockResolvedValueOnce([
          { resourceType: 'Patient', _count: 60 },
        ]);
      vi.mocked(mockPrisma.breakTheGlassAccess.count).mockResolvedValue(5);

      const result = await service.getDashboardStats();

      expect(result.byAction[0]).toHaveProperty('action');
      expect(result.byAction[0]).toHaveProperty('count');
    });

    it('should map resources with counts', async () => {
      vi.mocked(mockPrisma.auditLog.count).mockResolvedValue(100);
      vi.mocked(mockPrisma.auditLog.groupBy)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          { resourceType: 'Patient', _count: 60 },
        ]);
      vi.mocked(mockPrisma.breakTheGlassAccess.count).mockResolvedValue(5);

      const result = await service.getDashboardStats();

      expect(result.byResource[0]).toHaveProperty('resource');
      expect(result.byResource[0]).toHaveProperty('count');
    });
  });
});
