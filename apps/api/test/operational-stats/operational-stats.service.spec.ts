import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OperationalStatsService } from '../../src/modules/operational-stats/operational-stats.service';
import { AdmissionStatus } from '@prisma/client';

describe('OperationalStatsService', () => {
  let service: OperationalStatsService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      ward: { findMany: vi.fn() },
      admission: { findMany: vi.fn(), count: vi.fn() },
      prescription: { findMany: vi.fn(), groupBy: vi.fn() },
      procedureCode: { findMany: vi.fn() },
      billing: { findMany: vi.fn() },
    };
    service = new OperationalStatsService(mockPrisma);
  });

  describe('getWardStats', () => {
    it('should return ward statistics', async () => {
      mockPrisma.ward.findMany.mockResolvedValue([
        { id: 'ward-1', name: '5층 내과', beds: [{}, {}] },
      ]);
      mockPrisma.admission.findMany.mockResolvedValue([
        { status: AdmissionStatus.ADMITTED, bed: { wardId: 'ward-1' } },
        { status: AdmissionStatus.DISCHARGED, bed: { wardId: 'ward-1' } },
      ]);

      const result = await service.getWardStats();

      expect(result.length).toBe(1);
      expect(result[0].totalBeds).toBe(2);
      expect(result[0].totalAdmissions).toBe(2);
    });
  });

  describe('getAdmissionTrends', () => {
    it('should return admission trends', async () => {
      const date = new Date('2026-05-13');
      mockPrisma.admission.findMany.mockResolvedValue([
        { admitDate: date, dischargeDate: new Date('2026-05-18'), status: AdmissionStatus.DISCHARGED },
        { admitDate: date, dischargeDate: null, status: AdmissionStatus.ADMITTED },
      ]);

      const result = await service.getAdmissionTrends();

      expect(result.totalAdmissions).toBe(2);
      expect(result.totalDischarges).toBe(1);
      expect(result.avgStayDays).toBe(5);
    });
  });

  describe('getPatientFlow', () => {
    /**
     * 🔴 이 스펙은 종전에 결함을 계약으로 굳혀뒀다 —
     *    `dischargedToday` 에 **창(기본 30일)** 퇴원 수가 담기는 걸 그대로 통과시켰다.
     *    운영 실측(2026-08-14) 30일 퇴원 1 / 오늘 퇴원 0 인데 화면은 '오늘 퇴원 1명'이었다.
     *    이제 창 값은 `dischargedInWindow`, '오늘'은 진짜 오늘만 담는다.
     *    호출 순서: [창입원, 창퇴원, 현재재원, 오늘입원, 오늘퇴원]
     */
    it('창 기준과 오늘 기준을 각각 이름대로 돌려준다', async () => {
      mockPrisma.admission.count
        .mockResolvedValueOnce(10) // 창 입원
        .mockResolvedValueOnce(5)  // 창 퇴원
        .mockResolvedValueOnce(20) // 현재 재원
        .mockResolvedValueOnce(2)  // 오늘 입원
        .mockResolvedValueOnce(1); // 오늘 퇴원

      const result = await service.getPatientFlow();

      expect(result.newAdmissions).toBe(10);
      expect(result.dischargedInWindow).toBe(5);
      expect(result.activePatients).toBe(20);
      expect(result.netFlow).toBe(5);
      expect(result.admittedToday).toBe(2);
      expect(result.dischargedToday).toBe(1);
      expect(result.netFlowToday).toBe(1);
    });

    it('🔴 `dischargedToday` 에 창(30일) 값이 새어 들어오지 않는다 — 역검증', async () => {
      // 창 퇴원 5건, 오늘 퇴원 0건인 병원
      mockPrisma.admission.count
        .mockResolvedValueOnce(10)
        .mockResolvedValueOnce(5)
        .mockResolvedValueOnce(20)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0);

      const result = await service.getPatientFlow();

      expect(result.dischargedToday).toBe(0);
      expect(result.dischargedToday).not.toBe(result.dischargedInWindow);
    });

    it('조회창을 응답에 실어 화면이 기간을 라벨에 적을 수 있다', async () => {
      mockPrisma.admission.count.mockResolvedValue(0);

      const dflt = await service.getPatientFlow();
      expect(dflt.window.isDefault).toBe(true);
      expect(dflt.window.days).toBe(30);

      const explicit = await service.getPatientFlow('2026-08-01', '2026-08-08');
      expect(explicit.window.isDefault).toBe(false);
      expect(explicit.window.days).toBe(7);
    });

    it('오늘 조회창은 KST 자정 경계다 — 컨테이너 OS(UTC) 자정이 아니다', async () => {
      mockPrisma.admission.count.mockResolvedValue(0);
      await service.getPatientFlow();

      // 마지막 두 호출(오늘 입원·오늘 퇴원)의 경계가 KST 자정(UTC 15:00)인지
      const calls = mockPrisma.admission.count.mock.calls;
      const todayCall = calls[calls.length - 1][0] as { where: { dischargeDate: { gte: Date; lt: Date } } };
      const gte = todayCall.where.dischargeDate.gte;
      expect(gte.getUTCHours()).toBe(15);
      expect(gte.getUTCMinutes()).toBe(0);
      expect(todayCall.where.dischargeDate.lt.getTime() - gte.getTime()).toBe(86_400_000);
    });
  });

  describe('getDiseaseStats', () => {
    it('should return disease statistics', async () => {
      mockPrisma.prescription.groupBy.mockResolvedValue([
        { procedureCodeId: 'pc-j45', _count: { _all: 2 } },
        { procedureCodeId: 'pc-i10', _count: { _all: 1 } },
      ]);
      mockPrisma.procedureCode.findMany.mockResolvedValue([
        { id: 'pc-j45', code: 'J45', nameKo: '천식' },
        { id: 'pc-i10', code: 'I10', nameKo: '고혈압' },
      ]);

      const result = await service.getDiseaseStats();

      expect(result.length).toBe(2);
      expect(result[0].count).toBe(2);
    });
  });

  describe('getFinancialStats', () => {
    it('should return financial statistics', async () => {
      mockPrisma.billing.findMany.mockResolvedValue([
        { totalAmount: 100000, insuranceCovered: 80000, patientCopay: 20000, status: 'PAID' },
        { totalAmount: 200000, insuranceCovered: 160000, patientCopay: 40000, status: 'PENDING' },
      ]);

      const result = await service.getFinancialStats();

      expect(result.totalBillings).toBe(2);
      expect(result.totalAmount).toBe(300000);
      expect(result.avgBillingAmount).toBe(150000);
    });
  });
});
