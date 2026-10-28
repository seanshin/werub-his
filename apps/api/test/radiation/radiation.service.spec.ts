import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RadiationService } from '../../src/modules/radiation/radiation.service';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

describe('RadiationService', () => {
  let service: RadiationService;
  let mockPrisma: any;

  const mockPlan = {
    id: 'rtp-1', patientId: 'pat-1', diagnosis: '유방암', intent: 'CURATIVE',
    technique: 'IMRT', site: '좌측 유방', totalDose: new Prisma.Decimal(50),
    fractionDose: new Prisma.Decimal(2), totalFractions: 25,
    startDate: new Date('2026-06-01'), status: 'PLANNED',
    patient: { familyName: '김', givenName: '환자', mrn: 'MR001' },
  };

  beforeEach(() => {
    mockPrisma = {
      radiationPlan: {
        create: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(),
        update: vi.fn(), count: vi.fn(), groupBy: vi.fn(),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      radiationFraction: {
        create: vi.fn(), createMany: vi.fn(), deleteMany: vi.fn(),
        findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn(), count: vi.fn(),
        // 상태 전이·취소는 조건부 갱신(2026-10-10)
        groupBy: vi.fn().mockResolvedValue([]), updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      radiationToxicity: {
        create: vi.fn(), findMany: vi.fn(),
      },
      $transaction: vi.fn().mockImplementation((cb: any) => cb(mockPrisma)),
      $queryRaw: vi.fn().mockResolvedValue([{ id: 'rtp-1' }]), // FOR UPDATE 계획 행잠금
    };
    // radiationFraction 원자 선점(updateMany) 목
    mockPrisma.radiationFraction.updateMany = vi.fn().mockResolvedValue({ count: 1 });
    service = new RadiationService(mockPrisma);
  });

  // ── Plans ──

  describe('createPlan', () => {
    it('should create radiation plan', async () => {
      mockPrisma.radiationPlan.create.mockResolvedValue(mockPlan);
      const result = await service.createPlan({
        patientId: 'pat-1', diagnosis: '유방암', intent: 'CURATIVE',
        technique: 'IMRT', site: '좌측 유방', totalDose: 50,
        fractionDose: 2, totalFractions: 25, prescribedBy: 'doc-1',
      });
      expect(result.technique).toBe('IMRT');
      expect(result.totalFractions).toBe(25);
    });
  });

  describe('getPlans', () => {
    it('should return plans with counts', async () => {
      // 실제 select 모양 — 목록은 늘 fractions{status, deliveredDose} 를 싣는다(누적선량 요약 · 2026-10-10)
      mockPrisma.radiationPlan.findMany.mockResolvedValue([{ ...mockPlan, fractions: [{ status: 'DELIVERED', deliveredDose: '2.00' }] }]);
      const result = await service.getPlans({ patientId: 'pat-1' });
      expect(result).toHaveLength(1);
      expect(result[0].doseSummary).toMatchObject({ deliveredGy: 2, recordedFractions: 1 });
    });
  });

  describe('getPlanDetail', () => {
    it('should return plan with fractions and toxicities', async () => {
      mockPrisma.radiationPlan.findUnique.mockResolvedValue({
        ...mockPlan, fractions: [], toxicities: [],
      });
      const result = await service.getPlanDetail('rtp-1');
      expect(result.id).toBe('rtp-1');
    });

    it('should throw NotFoundException', async () => {
      mockPrisma.radiationPlan.findUnique.mockResolvedValue(null);
      await expect(service.getPlanDetail('bad')).rejects.toThrow(NotFoundException);
    });
  });

  describe('updatePlanStatus', () => {
    it('should update plan status (허용 상태)', async () => {
      mockPrisma.radiationPlan.findUnique.mockResolvedValueOnce(mockPlan).mockResolvedValueOnce({ ...mockPlan, status: 'ON_HOLD' });
      const result = await service.updatePlanStatus('rtp-1', 'ON_HOLD');
      expect(result!.status).toBe('ON_HOLD');
      expect(mockPrisma.radiationPlan.updateMany).toHaveBeenCalledWith({ where: { id: 'rtp-1', status: 'PLANNED' }, data: { status: 'ON_HOLD' } });
    });

    it('🔴 끝난 계획은 되돌리지 않는다 · 승인 전 계획을 치료 중으로 바꾸지 않는다(2026-10-10)', async () => {
      mockPrisma.radiationPlan.findUnique.mockResolvedValue({ ...mockPlan, status: 'COMPLETED' });
      await expect(service.updatePlanStatus('rtp-1', 'IN_TREATMENT')).rejects.toMatchObject({ response: { code: 'RT_PLAN_TRANSITION' } });
      mockPrisma.radiationPlan.findUnique.mockResolvedValue({ ...mockPlan, status: 'PLANNED' });
      await expect(service.updatePlanStatus('rtp-1', 'IN_TREATMENT')).rejects.toMatchObject({ response: { code: 'RT_PLAN_TRANSITION' } });
      expect(mockPrisma.radiationPlan.updateMany).not.toHaveBeenCalled();
    });

    it('🔴 보류 해제는 보류 전 단계로만 — 승인·분할 있음이면 치료 중', async () => {
      mockPrisma.radiationPlan.findUnique.mockResolvedValue({ ...mockPlan, status: 'ON_HOLD', planApprovedAt: new Date() });
      mockPrisma.radiationFraction.groupBy.mockResolvedValue([{ status: 'SCHEDULED', _count: { _all: 3 } }]);
      await expect(service.updatePlanStatus('rtp-1', 'PLANNED')).rejects.toMatchObject({ response: { code: 'RT_PLAN_TRANSITION' } });
      await service.updatePlanStatus('rtp-1', 'IN_TREATMENT');
      expect(mockPrisma.radiationPlan.updateMany).toHaveBeenCalledTimes(1);
    });

    it('🔴 예정 분할이 남았으면 완료 불가(조기 종료는 취소로)', async () => {
      mockPrisma.radiationPlan.findUnique.mockResolvedValue({ ...mockPlan, status: 'IN_TREATMENT', planApprovedAt: new Date() });
      mockPrisma.radiationFraction.groupBy.mockResolvedValue([{ status: 'SCHEDULED', _count: { _all: 2 } }, { status: 'DELIVERED', _count: { _all: 23 } }]);
      await expect(service.updatePlanStatus('rtp-1', 'COMPLETED')).rejects.toMatchObject({ response: { code: 'RT_PLAN_FRACTIONS_REMAIN' } });
    });

    it('[P1] APPROVED 위조 차단(approvePlan 경로만)', async () => {
      mockPrisma.radiationPlan.findUnique.mockResolvedValue(mockPlan);
      await expect(service.updatePlanStatus('rtp-1', 'APPROVED')).rejects.toThrow(BadRequestException);
    });

    it('[P1] 허용되지 않는 상태 차단', async () => {
      mockPrisma.radiationPlan.findUnique.mockResolvedValue(mockPlan);
      await expect(service.updatePlanStatus('rtp-1', 'WHATEVER')).rejects.toThrow(BadRequestException);
    });
  });

  describe('approvePlan 4-eyes', () => {
    it('[P1] 처방자 본인 승인 금지', async () => {
      mockPrisma.radiationPlan.findUnique.mockResolvedValue({ ...mockPlan, prescribedBy: 'doc-1' });
      await expect(service.approvePlan('rtp-1', 'doc-1')).rejects.toMatchObject({ response: { code: 'RT_SELF_APPROVAL' } });
    });
  });

  describe('approvePlan', () => {
    it('should approve plan with timestamp', async () => {
      mockPrisma.radiationPlan.findUnique.mockResolvedValue(mockPlan);
      mockPrisma.radiationPlan.update.mockResolvedValue({
        ...mockPlan, status: 'APPROVED', planApprovedAt: new Date(),
      });
      const result = await service.approvePlan('rtp-1', 'doc-1');
      expect(result.status).toBe('APPROVED');
    });

    it('should throw NotFoundException', async () => {
      mockPrisma.radiationPlan.findUnique.mockResolvedValue(null);
      await expect(service.approvePlan('bad', 'doc-1')).rejects.toThrow(NotFoundException);
    });
  });

  // ── Fractions ──

  describe('generateFractions', () => {
    it('should generate fractions skipping weekends (승인된 계획)', async () => {
      mockPrisma.radiationPlan.findUnique.mockResolvedValue({ ...mockPlan, planApprovedAt: new Date() });
      mockPrisma.radiationFraction.count.mockResolvedValue(0); // 조사된 분할 없음
      mockPrisma.radiationFraction.deleteMany.mockResolvedValue({});
      mockPrisma.radiationFraction.createMany.mockResolvedValue({ count: 25 });
      mockPrisma.radiationPlan.update.mockResolvedValue({});
      mockPrisma.radiationFraction.findMany.mockResolvedValue(
        Array.from({ length: 25 }, (_, i) => ({
          id: `rf-${i}`, fractionNumber: i + 1, status: 'SCHEDULED',
        })),
      );

      const result = await service.generateFractions('rtp-1');
      expect(result).toHaveLength(25);
      expect(mockPrisma.radiationFraction.deleteMany).toHaveBeenCalledWith({ where: { planId: 'rtp-1', status: { in: ['SCHEDULED', 'CANCELLED'] } } });
    });

    it('[P0] 미승인 계획은 분할 생성 차단', async () => {
      mockPrisma.radiationPlan.findUnique.mockResolvedValue({ ...mockPlan, planApprovedAt: null });
      await expect(service.generateFractions('rtp-1')).rejects.toMatchObject({ response: { code: 'RT_PLAN_NOT_APPROVED' } });
    });

    it('[P0] 이미 조사된 분할 있으면 재생성 차단(이력 보존)', async () => {
      mockPrisma.radiationPlan.findUnique.mockResolvedValue({ ...mockPlan, planApprovedAt: new Date() });
      mockPrisma.radiationFraction.count.mockResolvedValue(3);
      await expect(service.generateFractions('rtp-1')).rejects.toMatchObject({ response: { code: 'RT_FRACTIONS_DELIVERED' } });
    });

    it('should throw NotFoundException for missing plan', async () => {
      mockPrisma.radiationPlan.findUnique.mockResolvedValue(null);
      await expect(service.generateFractions('bad')).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException if no start date', async () => {
      mockPrisma.radiationPlan.findUnique.mockResolvedValue({ ...mockPlan, startDate: null });
      await expect(service.generateFractions('rtp-1')).rejects.toThrow(BadRequestException);
    });
  });

  describe('deliverFraction', () => {
    const approvedPlan = { ...mockPlan, status: 'APPROVED', planApprovedAt: new Date() };

    it('🔴 조사 기록자는 로그인한 실무자(본문 therapistId 가 없어도 · 2026-10-10)', async () => {
      mockPrisma.radiationFraction.findUnique.mockResolvedValue({ id: 'rf-1', planId: 'rtp-1', status: 'SCHEDULED', plan: approvedPlan });
      mockPrisma.radiationFraction.findMany.mockResolvedValue([]);
      mockPrisma.radiationFraction.update.mockResolvedValue({ id: 'rf-1', status: 'DELIVERED' });
      await service.deliverFraction('rf-1', { deliveredDose: 2 }, 'tech-7');
      expect(mockPrisma.radiationFraction.update.mock.calls.at(-1)[0].data.therapistId).toBe('tech-7');
    });

    it('should deliver fraction with cumulative dose (승인·SCHEDULED)', async () => {
      mockPrisma.radiationFraction.findUnique.mockResolvedValue({
        id: 'rf-1', planId: 'rtp-1', status: 'SCHEDULED', plan: approvedPlan,
      });
      mockPrisma.radiationFraction.findMany.mockResolvedValue([
        { deliveredDose: new Prisma.Decimal(2) },
        { deliveredDose: new Prisma.Decimal(2) },
      ]);
      mockPrisma.radiationFraction.update.mockResolvedValue({ id: 'rf-1', status: 'DELIVERED' });

      const result = await service.deliverFraction('rf-1', { deliveredDose: 2 });

      expect(result.status).toBe('DELIVERED');
      // cumulative = 2 + 2 + 2 = 6 (≤ 50 → 통과)
      expect(mockPrisma.radiationFraction.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ cumulativeDose: new Prisma.Decimal(6) }) }),
      );
    });

    it('[P0] 누적선량이 총선량 초과 시 조사 차단', async () => {
      mockPrisma.radiationFraction.findUnique.mockResolvedValue({ id: 'rf-1', planId: 'rtp-1', status: 'SCHEDULED', plan: approvedPlan });
      // 이미 49Gy 조사 + 2Gy → 51 > 50*1.05=52.5? 아니오. 60Gy로 초과 유도
      mockPrisma.radiationFraction.findMany.mockResolvedValue([{ deliveredDose: new Prisma.Decimal(60) }]);
      await expect(service.deliverFraction('rf-1', { deliveredDose: 2 })).rejects.toMatchObject({ response: { code: 'RT_DOSE_EXCEEDED' } });
    });

    it('[P0] 분할선량이 처방과 ±10% 초과 이탈 시 차단', async () => {
      mockPrisma.radiationFraction.findUnique.mockResolvedValue({ id: 'rf-1', planId: 'rtp-1', status: 'SCHEDULED', plan: approvedPlan });
      mockPrisma.radiationFraction.findMany.mockResolvedValue([]);
      await expect(service.deliverFraction('rf-1', { deliveredDose: 10 })).rejects.toMatchObject({ response: { code: 'RT_DOSE_EXCEEDED' } }); // 처방 2Gy
    });

    it('[P0] 미승인 계획 분할 조사 차단', async () => {
      mockPrisma.radiationFraction.findUnique.mockResolvedValue({ id: 'rf-1', planId: 'rtp-1', status: 'SCHEDULED', plan: { ...mockPlan, planApprovedAt: null } });
      await expect(service.deliverFraction('rf-1', { deliveredDose: 2 })).rejects.toThrow(BadRequestException);
    });

    it('[P1] SCHEDULED 아닌 분할 조사 차단(이중가산 방지)', async () => {
      mockPrisma.radiationFraction.findUnique.mockResolvedValue({ id: 'rf-1', planId: 'rtp-1', status: 'DELIVERED', plan: approvedPlan });
      await expect(service.deliverFraction('rf-1', { deliveredDose: 2 })).rejects.toThrow(BadRequestException);
    });

    it('[P1] 취소/보류 계획의 SCHEDULED 분할 조사 차단', async () => {
      for (const st of ['ON_HOLD', 'CANCELLED', 'COMPLETED']) {
        mockPrisma.radiationFraction.findUnique.mockResolvedValue({
          id: 'rf-1', planId: 'rtp-1', status: 'SCHEDULED', plan: { ...approvedPlan, status: st },
        });
        await expect(service.deliverFraction('rf-1', { deliveredDose: 2 }))
          .rejects.toMatchObject({ response: { code: 'RT_PLAN_NOT_ACTIVE' } });
      }
    });

    it('should throw NotFoundException', async () => {
      mockPrisma.radiationFraction.findUnique.mockResolvedValue(null);
      await expect(service.deliverFraction('bad', { deliveredDose: 2 }))
        .rejects.toThrow(NotFoundException);
    });
  });

  describe('cancelFraction', () => {
    it('should cancel fraction', async () => {
      mockPrisma.radiationFraction.findUnique.mockResolvedValueOnce({ id: 'rf-1', status: 'SCHEDULED' }).mockResolvedValueOnce({ id: 'rf-1', status: 'CANCELLED' });
      const result = await service.cancelFraction('rf-1', '환자 상태 불량');
      expect(result!.status).toBe('CANCELLED');
    });

    it('🔴 이미 조사한 분할은 취소로 바꾸지 않는다 · 사유 필수(2026-10-10)', async () => {
      mockPrisma.radiationFraction.findUnique.mockResolvedValue({ id: 'rf-1', status: 'DELIVERED' });
      await expect(service.cancelFraction('rf-1', '착오')).rejects.toMatchObject({ response: { code: 'RT_FRACTION_NOT_CANCELLABLE' } });
      mockPrisma.radiationFraction.findUnique.mockResolvedValue({ id: 'rf-1', status: 'SCHEDULED' });
      await expect(service.cancelFraction('rf-1', '  ')).rejects.toMatchObject({ response: { code: 'RT_FRACTION_CANCEL_REASON_REQUIRED' } });
      expect(mockPrisma.radiationFraction.updateMany).not.toHaveBeenCalled();
    });
  });

  // ── Toxicity ──

  describe('addToxicity', () => {
    it('should record toxicity', async () => {
      mockPrisma.radiationToxicity.create.mockResolvedValue({
        id: 'rt-1', week: 2, skinGrade: 1,
      });
      const result = await service.addToxicity('rtp-1', {
        week: 2, skinGrade: 1, fatigueGrade: 2, assessedBy: 'doc-1',
      });
      expect(result.week).toBe(2);
    });
  });

  describe('getToxicities', () => {
    it('should return toxicities by week', async () => {
      mockPrisma.radiationToxicity.findMany.mockResolvedValue([
        { week: 1 }, { week: 2 },
      ]);
      const result = await service.getToxicities('rtp-1');
      expect(result).toHaveLength(2);
    });
  });

  // ── Machines ──

  describe('getMachines', () => {
    it('should return machine usage stats', async () => {
      mockPrisma.radiationPlan.groupBy.mockResolvedValue([
        { machine: 'TrueBeam', _count: 10 },
      ]);
      const result = await service.getMachines();
      expect(result).toHaveLength(1);
    });
  });

  // ── Dashboard / Stats ──

  describe('getDashboard', () => {
    it('should return dashboard data', async () => {
      mockPrisma.radiationFraction.count.mockResolvedValue(5);
      mockPrisma.radiationPlan.count
        .mockResolvedValueOnce(3)  // inTreatment
        .mockResolvedValueOnce(2)  // planned
        .mockResolvedValueOnce(10); // completed

      const result = await service.getDashboard();
      expect(result.todayFractions).toBe(5);
      expect(result.inTreatment).toBe(3);
    });
  });

  describe('getStats', () => {
    it('should return completion rate', async () => {
      mockPrisma.radiationPlan.count.mockResolvedValue(15);
      mockPrisma.radiationPlan.groupBy.mockResolvedValue([]);
      mockPrisma.radiationFraction.count
        .mockResolvedValueOnce(200)  // delivered
        .mockResolvedValueOnce(250); // total

      const result = await service.getStats();
      expect(result.completionRate).toBe(80); // 200/250
    });
  });
});
