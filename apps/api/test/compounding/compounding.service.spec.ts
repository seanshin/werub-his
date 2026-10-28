import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { CompoundingService } from '../../src/modules/compounding/compounding.service';

describe('CompoundingService', () => {
  let service: CompoundingService;
  let mockPrisma: any;
  let mockEmitter: any;

  const order = (status: string, over: Record<string, unknown> = {}) => ({
    id: 'cmp-1', sourceType: 'IV_RX', patientId: 'pat-1', prescriptionId: null,
    status, isHazardous: false, compoundedBy: null, ...over,
  });

  beforeEach(() => {
    mockPrisma = {
      compoundingOrder: {
        create: vi.fn().mockResolvedValue({}),
        findUnique: vi.fn(),
        findMany: vi.fn().mockResolvedValue([]),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        update: vi.fn().mockResolvedValue({}),
      },
      compoundingComponent: { update: vi.fn().mockResolvedValue({}) },
      prescription: { findUnique: vi.fn() },
      medicationAdministration: { updateMany: vi.fn().mockResolvedValue({ count: 2 }) },
      $transaction: vi.fn((ops: unknown[]) => Promise.all(ops as Promise<unknown>[])),
    };
    mockEmitter = { emit: vi.fn() };
    service = new CompoundingService(mockPrisma, mockEmitter);
  });

  describe('createOrder — 처방 연결 검증', () => {
    it('should reject unknown prescription', async () => {
      mockPrisma.prescription.findUnique.mockResolvedValue(null);
      await expect(
        service.createOrder({ sourceType: 'IV_RX', patientId: 'pat-1', prescriptionId: 'rx-x' }, 'u-1'),
      ).rejects.toThrow(/처방을 찾을 수 없습니다/);
    });

    it('should reject prescription belonging to another patient', async () => {
      mockPrisma.prescription.findUnique.mockResolvedValue({ id: 'rx-1', encounter: { patientId: 'pat-OTHER' } });
      await expect(
        service.createOrder({ sourceType: 'IV_RX', patientId: 'pat-1', prescriptionId: 'rx-1' }, 'u-1'),
      ).rejects.toThrow(/환자가 일치하지 않습니다/);
    });

    it('should create with valid linked prescription', async () => {
      mockPrisma.prescription.findUnique.mockResolvedValue({ id: 'rx-1', encounter: { patientId: 'pat-1' } });
      await service.createOrder({ sourceType: 'IV_RX', patientId: 'pat-1', prescriptionId: 'rx-1' }, 'u-1');
      expect(mockPrisma.compoundingOrder.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ prescriptionId: 'rx-1' }) }),
      );
    });

    it('should mark CHEMO hazardous automatically', async () => {
      await service.createOrder({ sourceType: 'CHEMO', patientId: 'pat-1' }, 'u-1');
      expect(mockPrisma.compoundingOrder.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ isHazardous: true }) }),
      );
    });
  });

  describe('release — MAR 연결·청구 이벤트', () => {
    it('should link unlinked MARs and emit compounding.released with prescriptionId', async () => {
      mockPrisma.compoundingOrder.findUnique
        .mockResolvedValueOnce(order('VERIFIED', { prescriptionId: 'rx-1' })) // release 조회
        .mockResolvedValueOnce(order('RELEASED', { prescriptionId: 'rx-1' })); // atomic 재조회
      await service.release('cmp-1');

      expect(mockPrisma.medicationAdministration.updateMany).toHaveBeenCalledWith({
        where: { prescriptionId: 'rx-1', compoundingOrderId: null },
        data: { compoundingOrderId: 'cmp-1' },
      });
      expect(mockEmitter.emit).toHaveBeenCalledWith('compounding.released',
        expect.objectContaining({ compoundingOrderId: 'cmp-1', prescriptionId: 'rx-1', patientId: 'pat-1' }));
    });

    it('should emit without prescriptionId (비연동) and skip MAR link', async () => {
      mockPrisma.compoundingOrder.findUnique
        .mockResolvedValueOnce(order('VERIFIED'))
        .mockResolvedValueOnce(order('RELEASED'));
      await service.release('cmp-1');

      expect(mockPrisma.medicationAdministration.updateMany).not.toHaveBeenCalled();
      expect(mockEmitter.emit).toHaveBeenCalledWith('compounding.released',
        expect.objectContaining({ prescriptionId: undefined }));
    });

    it('should reject release from non-VERIFIED status', async () => {
      mockPrisma.compoundingOrder.findUnique.mockResolvedValue(order('COMPOUNDED'));
      await expect(service.release('cmp-1')).rejects.toThrow(/VERIFIED에서만/);
      expect(mockEmitter.emit).not.toHaveBeenCalled();
    });

    it('should not emit on concurrent release conflict (원자 클레임 실패)', async () => {
      mockPrisma.compoundingOrder.findUnique.mockResolvedValue(order('VERIFIED'));
      mockPrisma.compoundingOrder.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.release('cmp-1')).rejects.toThrow(ConflictException);
      expect(mockEmitter.emit).not.toHaveBeenCalled();
      expect(mockPrisma.medicationAdministration.updateMany).not.toHaveBeenCalled();
    });

    it('should not block release when MAR link fails (비차단)', async () => {
      mockPrisma.compoundingOrder.findUnique
        .mockResolvedValueOnce(order('VERIFIED', { prescriptionId: 'rx-1' }))
        .mockResolvedValueOnce(order('RELEASED', { prescriptionId: 'rx-1' }));
      mockPrisma.medicationAdministration.updateMany.mockRejectedValue(new Error('db down'));
      await expect(service.release('cmp-1')).resolves.toBeTruthy();
      expect(mockEmitter.emit).toHaveBeenCalled(); // 청구 이벤트는 계속
    });
  });

  describe('기존 안전 게이트 회귀', () => {
    it('should require shielded hood for hazardous prep', async () => {
      mockPrisma.compoundingOrder.findUnique.mockResolvedValue(order('CALCULATED', { isHazardous: true }));
      await expect(service.prep('cmp-1', { compoundedBy: 'u-1', hoodType: 'LAFW' })).rejects.toThrow(/차폐가 필수/);
    });

    it('should reject self-verification (조제자=검증자)', async () => {
      mockPrisma.compoundingOrder.findUnique.mockResolvedValue(order('COMPOUNDED', { compoundedBy: 'u-1' }));
      await expect(service.verify('cmp-1', { verifiedBy: 'u-1' })).rejects.toThrow(/달라야/);
    });
  });
});
