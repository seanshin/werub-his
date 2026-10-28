import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DialysisService } from '../../src/modules/dialysis/dialysis.service';
import { NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

describe('DialysisService', () => {
  let service: DialysisService;
  let mockPrisma: any;

  const mockOrder = {
    id: 'do-1', patientId: 'pat-1', modality: 'HD', frequency: '주 3회',
    duration: 240, isActive: true,
    patient: { familyName: '김', givenName: '환자', mrn: 'MR001' },
  };

  beforeEach(() => {
    mockPrisma = {
      dialysisOrder: {
        create: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(),
        update: vi.fn(), count: vi.fn(), groupBy: vi.fn(),
      },
      dialysisSession: {
        create: vi.fn(), createMany: vi.fn(), findMany: vi.fn(),
        findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        count: vi.fn(), groupBy: vi.fn(),
      },
      dialysisMachine: {
        create: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(),
        update: vi.fn(), groupBy: vi.fn(),
      },
    };
    service = new DialysisService(mockPrisma);
  });

  // ── Orders ──

  describe('createOrder', () => {
    it('should create HD order', async () => {
      mockPrisma.dialysisOrder.create.mockResolvedValue(mockOrder);
      const result = await service.createOrder({
        patientId: 'pat-1', modality: 'HD', frequency: '주 3회',
        duration: 240, prescribedBy: 'doc-1', startDate: '2026-06-01',
      });
      expect(result.modality).toBe('HD');
    });
  });

  describe('getOrders', () => {
    it('should return orders with patient info', async () => {
      mockPrisma.dialysisOrder.findMany.mockResolvedValue([mockOrder]);
      const result = await service.getOrders({ isActive: true });
      expect(result).toHaveLength(1);
    });
  });

  describe('getOrderDetail', () => {
    it('should return order with sessions', async () => {
      mockPrisma.dialysisOrder.findUnique.mockResolvedValue({
        ...mockOrder, sessions: [],
      });
      const result = await service.getOrderDetail('do-1');
      expect(result.id).toBe('do-1');
    });

    it('should throw NotFoundException for missing order', async () => {
      mockPrisma.dialysisOrder.findUnique.mockResolvedValue(null);
      await expect(service.getOrderDetail('bad')).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateOrder', () => {
    it('should update order fields', async () => {
      mockPrisma.dialysisOrder.findUnique.mockResolvedValue(mockOrder);
      mockPrisma.dialysisOrder.update.mockResolvedValue({ ...mockOrder, duration: 180 });
      const result = await service.updateOrder('do-1', { duration: 180 });
      expect(result.duration).toBe(180);
    });

    it('should throw NotFoundException for missing order', async () => {
      mockPrisma.dialysisOrder.findUnique.mockResolvedValue(null);
      await expect(service.updateOrder('bad', {})).rejects.toThrow(NotFoundException);
    });
  });

  // ── Sessions ──

  describe('generateSessions', () => {
    it('should generate monthly sessions (주 3회 = 월수금)', async () => {
      mockPrisma.dialysisOrder.findUnique.mockResolvedValue(mockOrder);
      mockPrisma.dialysisSession.createMany.mockResolvedValue({ count: 13 });
      mockPrisma.dialysisSession.findMany.mockResolvedValue([]);

      const result = await service.generateSessions({
        orderId: 'do-1', year: 2026, month: 6,
      });
      expect(mockPrisma.dialysisSession.createMany).toHaveBeenCalled();
    });

    it('should throw NotFoundException for missing order', async () => {
      mockPrisma.dialysisOrder.findUnique.mockResolvedValue(null);
      await expect(service.generateSessions({ orderId: 'bad', year: 2026, month: 6 }))
        .rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException for inactive order', async () => {
      mockPrisma.dialysisOrder.findUnique.mockResolvedValue({ ...mockOrder, isActive: false });
      await expect(service.generateSessions({ orderId: 'do-1', year: 2026, month: 6 }))
        .rejects.toThrow(BadRequestException);
    });
  });

  describe('startSession', () => {
    it('should start session with pre-vitals', async () => {
      mockPrisma.dialysisSession.findUnique
        .mockResolvedValueOnce({ id: 'ds-1', status: 'SCHEDULED' }) // 사전 검증
        .mockResolvedValueOnce({ id: 'ds-1', status: 'IN_PROGRESS' }); // 원자 전이 후 반환
      mockPrisma.dialysisSession.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.startSession('ds-1', {
        preWeight: 70.5, preBp: '140/90', preHr: 80,
      });
      expect(result.status).toBe('IN_PROGRESS');
    });

    it('[P2] 동시 시작(원자 전이 count=0) 충돌 차단', async () => {
      mockPrisma.dialysisSession.findUnique.mockResolvedValue({ id: 'ds-1', status: 'SCHEDULED' });
      mockPrisma.dialysisSession.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.startSession('ds-1', { preWeight: 70 })).rejects.toThrow(ConflictException);
    });

    it('should throw NotFoundException for missing session', async () => {
      mockPrisma.dialysisSession.findUnique.mockResolvedValue(null);
      await expect(service.startSession('bad', {})).rejects.toThrow(NotFoundException);
    });

    it('[P1] SCHEDULED 아니면 시작 차단(완료세션 재시작 방지)', async () => {
      mockPrisma.dialysisSession.findUnique.mockResolvedValue({ id: 'ds-1', status: 'COMPLETED' });
      await expect(service.startSession('ds-1', { preWeight: 70 })).rejects.toThrow(BadRequestException);
    });

    it('[P1] 투석 전 체중 없으면 시작 차단', async () => {
      mockPrisma.dialysisSession.findUnique.mockResolvedValue({ id: 'ds-1', status: 'SCHEDULED' });
      await expect(service.startSession('ds-1', { preBp: '140/90' })).rejects.toThrow(BadRequestException);
    });
  });

  describe('completeSession', () => {
    // 🔴 2026-08-18 규약 변경: 이 스펙은 종전에 **근사치 저장을 계약으로 굳혀두고 있었다**.
    //    Kt/V 는 실측만 원장에 남긴다(근사식은 비진단이며 적절도 판정에 쓸 수 없다).
    it('실측 Kt/V 를 보내면 그 값이 원장에 저장된다', async () => {
      mockPrisma.dialysisSession.findUnique
        .mockResolvedValueOnce({
          id: 'ds-1', status: 'IN_PROGRESS', preWeight: new Prisma.Decimal(70),
          order: { duration: 240 },
        })
        .mockResolvedValueOnce({ id: 'ds-1', status: 'COMPLETED' });
      mockPrisma.dialysisSession.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.completeSession('ds-1', {
        postWeight: 68, actualDuration: 240, ktV: 1.32,
      });
      expect(result.status).toBe('COMPLETED');
      expect(mockPrisma.dialysisSession.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'ds-1', status: 'IN_PROGRESS' },
          data: expect.objectContaining({ ktV: expect.any(Prisma.Decimal) }),
        }),
      );
    });

    it('🔴 실측이 없으면 Kt/V 를 저장하지 않는다 — 근사치를 기록으로 만들지 않는다', async () => {
      mockPrisma.dialysisSession.findUnique
        .mockResolvedValueOnce({
          id: 'ds-1', status: 'IN_PROGRESS', preWeight: new Prisma.Decimal(70),
          order: { duration: 240 },
        })
        .mockResolvedValueOnce({ id: 'ds-1', status: 'COMPLETED' });
      mockPrisma.dialysisSession.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.completeSession('ds-1', { postWeight: 68, actualDuration: 240 });
      const data = mockPrisma.dialysisSession.updateMany.mock.calls[0][0].data;
      expect(data.ktV).toBeUndefined();
      // 참고 추정치는 이름으로 구분해 응답에만 싣는다
      expect((result as unknown as { estimatedKtV: number | null }).estimatedKtV).toBeGreaterThan(0);
    });

    it('[P1] IN_PROGRESS 아니면 완료 차단', async () => {
      mockPrisma.dialysisSession.findUnique.mockResolvedValue({ id: 'ds-1', status: 'SCHEDULED', order: { duration: 240 } });
      await expect(service.completeSession('ds-1', { postWeight: 68 })).rejects.toThrow(BadRequestException);
    });

    it('[P1] 투석 후 체중이 전 체중보다 크면 차단(순증)', async () => {
      mockPrisma.dialysisSession.findUnique.mockResolvedValue({ id: 'ds-1', status: 'IN_PROGRESS', preWeight: new Prisma.Decimal(70), order: { duration: 240 } });
      await expect(service.completeSession('ds-1', { postWeight: 72 })).rejects.toMatchObject({ response: { code: 'DIALYSIS_WEIGHT_GAIN' } });
    });

    it('[P1] 건체중 대비 과다 제수(하한 하회) 차단', async () => {
      // 건체중 70kg, 전 체중 72kg인데 후 체중 62kg → 건체중 8kg 하회 = 과다 제수
      mockPrisma.dialysisSession.findUnique.mockResolvedValue({ id: 'ds-1', status: 'IN_PROGRESS', preWeight: new Prisma.Decimal(72), order: { duration: 240, dryWeight: new Prisma.Decimal(70) } });
      await expect(service.completeSession('ds-1', { postWeight: 62 })).rejects.toMatchObject({ response: { code: 'DIALYSIS_OVER_UF' } });
    });

    it('[P2] 동시 완료(원자 전이 count=0) 충돌 차단', async () => {
      mockPrisma.dialysisSession.findUnique.mockResolvedValue({ id: 'ds-1', status: 'IN_PROGRESS', preWeight: new Prisma.Decimal(70), order: { duration: 240 } });
      mockPrisma.dialysisSession.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.completeSession('ds-1', { postWeight: 68 })).rejects.toThrow(ConflictException);
    });
  });

  describe('addIntradialyticVitals', () => {
    it('should append vitals to array', async () => {
      mockPrisma.dialysisSession.findUnique.mockResolvedValue({
        id: 'ds-1', intradialyticVitals: [{ time: '10:00', bp: '130/80' }],
      });
      mockPrisma.dialysisSession.update.mockResolvedValue({});

      await service.addIntradialyticVitals('ds-1', { time: '11:00', bp: '125/78' });

      expect(mockPrisma.dialysisSession.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            intradialyticVitals: expect.arrayContaining([
              { time: '10:00', bp: '130/80' },
              { time: '11:00', bp: '125/78' },
            ]),
          }),
        }),
      );
    });
  });

  describe('addComplication', () => {
    it('should append complication', async () => {
      mockPrisma.dialysisSession.findUnique.mockResolvedValue({
        id: 'ds-1', complications: [],
      });
      mockPrisma.dialysisSession.update.mockResolvedValue({});

      await service.addComplication('ds-1', { type: 'HYPOTENSION', description: '혈압 저하' });

      expect(mockPrisma.dialysisSession.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            complications: [{ type: 'HYPOTENSION', description: '혈압 저하' }],
          }),
        }),
      );
    });
  });

  // ── Machines ──

  describe('getMachines', () => {
    it('should return machines', async () => {
      mockPrisma.dialysisMachine.findMany.mockResolvedValue([{ id: 'dm-1', name: 'HD-01' }]);
      const result = await service.getMachines();
      expect(result).toHaveLength(1);
    });
  });

  describe('createMachine', () => {
    it('should create machine', async () => {
      mockPrisma.dialysisMachine.create.mockResolvedValue({ id: 'dm-1' });
      const result = await service.createMachine({ name: 'HD-01', machineType: 'HD' });
      expect(result.id).toBe('dm-1');
    });
  });

  describe('updateMachineStatus', () => {
    it('should update machine status', async () => {
      mockPrisma.dialysisMachine.findUnique.mockResolvedValue({ id: 'dm-1' });
      mockPrisma.dialysisMachine.update.mockResolvedValue({ id: 'dm-1', status: 'MAINTENANCE' });
      const result = await service.updateMachineStatus('dm-1', 'MAINTENANCE');
      expect(result.status).toBe('MAINTENANCE');
    });

    it('should throw NotFoundException', async () => {
      mockPrisma.dialysisMachine.findUnique.mockResolvedValue(null);
      await expect(service.updateMachineStatus('bad', 'ACTIVE')).rejects.toThrow(NotFoundException);
    });
  });

  describe('disinfectMachine', () => {
    it('should record disinfection', async () => {
      mockPrisma.dialysisMachine.findUnique.mockResolvedValue({ id: 'dm-1' });
      mockPrisma.dialysisMachine.update.mockResolvedValue({
        id: 'dm-1', lastDisinfection: new Date(),
      });
      const result = await service.disinfectMachine('dm-1');
      expect(result.lastDisinfection).toBeTruthy();
    });
  });

  // ── Dashboard / Stats ──

  describe('getDashboard', () => {
    it('should return dashboard data', async () => {
      mockPrisma.dialysisSession.count.mockResolvedValue(12);
      mockPrisma.dialysisSession.groupBy.mockResolvedValue([]);
      mockPrisma.dialysisMachine.groupBy.mockResolvedValue([]);
      mockPrisma.dialysisOrder.count.mockResolvedValue(5);

      const result = await service.getDashboard();
      expect(result.todaySessions).toBe(12);
      expect(result.activeOrders).toBe(5);
    });
  });

  describe('getStats', () => {
    it('should return stats with Kt/V adequacy', async () => {
      mockPrisma.dialysisOrder.count
        .mockResolvedValueOnce(20) // total
        .mockResolvedValueOnce(15); // active
      mockPrisma.dialysisSession.count.mockResolvedValue(100);
      mockPrisma.dialysisOrder.groupBy.mockResolvedValue([]);
      mockPrisma.dialysisSession.findMany.mockResolvedValue([
        { ktV: new Prisma.Decimal(1.3) },
        { ktV: new Prisma.Decimal(1.1) },
        { ktV: new Prisma.Decimal(1.5) },
      ]);

      const result = await service.getStats();
      expect(result.totalOrders).toBe(20);
      expect(result.ktVRate).toBe(67); // 2/3 ≥ 1.2
    });
  });
});
