import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PharmacyController } from '../../src/modules/pharmacy/pharmacy.controller';
import { PharmacyService } from '../../src/modules/pharmacy/pharmacy.service';
import { DispensingStatus } from '@prisma/client';

describe('PharmacyController', () => {
  let controller: PharmacyController;
  let mockService: any;

  beforeEach(() => {
    mockService = {
      getQueue: vi.fn(),
      startDispensing: vi.fn(),
      completeDispensing: vi.fn(),
      verifyDispensing: vi.fn(),
      getDispensingDetail: vi.fn(),
      updateDispensingItems: vi.fn(),
      cancelDispensing: vi.fn(),
    };

    controller = new PharmacyController(mockService);
  });

  describe('getQueue', () => {
    it('should return list of pending pharmacy orders', async () => {
      const mockQueue = [
        {
          id: 'order-1',
          status: 'ORDERED',
          prescription: { medicationCode: { nameKo: '로사르탄정' } },
        },
      ];

      mockService.getQueue.mockResolvedValue(mockQueue);

      const result = await controller.getQueue();

      expect(result.data).toEqual(mockQueue);
      expect(mockService.getQueue).toHaveBeenCalled();
    });
  });

  describe('startDispensing', () => {
    it('should start dispensing with notes', async () => {
      const orderId = 'order-1';
      const userId = 'pharm-1';
      const dto = { notes: '냉동 보관 필요' };

      const mockDispensing = {
        id: 'disp-1',
        status: DispensingStatus.PENDING,
      };

      mockService.startDispensing.mockResolvedValue(mockDispensing);

      const result = await controller.startDispensing(orderId, dto, userId);

      expect(result.data).toEqual(mockDispensing);
      expect(mockService.startDispensing).toHaveBeenCalledWith(orderId, userId, dto.notes, undefined);
    });

    it('should start dispensing without notes', async () => {
      const orderId = 'order-1';
      const userId = 'pharm-1';
      const dto = {};

      mockService.startDispensing.mockResolvedValue({ id: 'disp-1' });

      await controller.startDispensing(orderId, dto as any, userId);

      expect(mockService.startDispensing).toHaveBeenCalledWith(orderId, userId, undefined, undefined);
    });
  });

  describe('complete', () => {
    it('should complete dispensing', async () => {
      const dispensingId = 'disp-1';
      const mockCompleted = {
        id: dispensingId,
        status: DispensingStatus.DISPENSED,
        dispensedAt: new Date(),
      };

      mockService.completeDispensing.mockResolvedValue(mockCompleted);

      const result = await controller.complete(dispensingId);

      expect(result.data).toEqual(mockCompleted);
      expect(mockService.completeDispensing).toHaveBeenCalledWith(dispensingId, undefined);
    });
  });

  describe('verify', () => {
    it('should verify dispensing', async () => {
      const dispensingId = 'disp-1';
      const mockVerified = {
        id: dispensingId,
        status: DispensingStatus.VERIFIED,
        verifiedAt: new Date(),
      };

      mockService.verifyDispensing.mockResolvedValue(mockVerified);

      const result = await controller.verify(dispensingId, 'pharm-1');

      expect(result.data).toEqual(mockVerified);
      // 환자 앱 "약 조제 완료" 푸시는 명시 옵트인 — 본문 미지정이면 false
      expect(mockService.verifyDispensing).toHaveBeenCalledWith(dispensingId, 'pharm-1', undefined, { notifyPatient: false });
    });
  });

  describe('getDetail', () => {
    it('should return detailed dispensing information', async () => {
      const dispensingId = 'disp-1';
      const mockDetail = {
        id: dispensingId,
        items: [],
        patient: { id: 'pat-1', mrn: 'MRN001' },
      };

      mockService.getDispensingDetail.mockResolvedValue(mockDetail);

      const result = await controller.getDetail(dispensingId);

      expect(result.data).toEqual(mockDetail);
      expect(mockService.getDispensingDetail).toHaveBeenCalledWith(dispensingId);
    });
  });

  describe('updateItems', () => {
    it('should update dispensing items', async () => {
      const dispensingId = 'disp-1';
      const dto = {
        items: [
          { medicationCodeId: 'med-1', prescribedQty: 30, dispensedQty: 28 },
        ],
      };

      mockService.updateDispensingItems.mockResolvedValue({
        id: dispensingId,
        items: dto.items,
      });

      const result = await controller.updateItems(dispensingId, dto);

      expect(result.data.items).toEqual(dto.items);
      expect(mockService.updateDispensingItems).toHaveBeenCalledWith(
        dispensingId,
        dto.items
      );
    });

    it('should return detail when items not provided', async () => {
      const dispensingId = 'disp-1';
      const dto = {};

      mockService.getDispensingDetail.mockResolvedValue({
        id: dispensingId,
      });

      await controller.updateItems(dispensingId, dto as any);

      expect(mockService.getDispensingDetail).toHaveBeenCalledWith(dispensingId);
    });
  });

  describe('cancel', () => {
    it('should cancel dispensing with reason', async () => {
      const dispensingId = 'disp-1';
      const reason = '약물 부족';

      mockService.cancelDispensing.mockResolvedValue({
        id: dispensingId,
        status: DispensingStatus.CANCELLED,
      });

      await controller.cancel(dispensingId, { reason });

      expect(mockService.cancelDispensing).toHaveBeenCalledWith(dispensingId, reason);
    });

    it('should cancel dispensing without reason', async () => {
      const dispensingId = 'disp-1';

      mockService.cancelDispensing.mockResolvedValue({
        id: dispensingId,
        status: DispensingStatus.CANCELLED,
      });

      await controller.cancel(dispensingId, {});

      expect(mockService.cancelDispensing).toHaveBeenCalledWith(dispensingId, '');
    });
  });
});
