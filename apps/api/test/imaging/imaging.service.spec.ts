import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ImagingService } from '../../src/modules/imaging/imaging.service';
import { NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { ImagingResultStatus } from '@prisma/client';

describe('ImagingService', () => {
  let service: ImagingService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      order: {
        findMany: vi.fn(),
        findUnique: vi.fn(),
        update: vi.fn(),
      },
      imagingResult: {
        findUnique: vi.fn(),
        findMany: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
    };

    const mockEventEmitter = { emit: vi.fn() };
    const mockSafety = {
      assertAcquireGate: vi.fn().mockResolvedValue({
        evaluatedAt: new Date().toISOString(), modality: 'CR', usesContrast: false, ionizing: true, checks: [],
      }),
      recordExposure: vi.fn(),
      getPatientExposure: vi.fn(),
    };
    // 🔴 (G3) 한 트랜잭션으로 묶인 쓰기 — 목은 정본의 실제 호출 모양을 쓴다(tx 는 같은 목 재사용)
    mockPrisma.$transaction = vi.fn(async (arg: any) =>
      typeof arg === 'function' ? arg(mockPrisma) : Promise.all(arg),
    );
    service = new ImagingService(mockPrisma, mockEventEmitter as any, undefined as any, mockSafety as any);
  });

  describe('getQueue', () => {
    it('should return pending imaging orders', async () => {
      const mockOrders = [
        {
          id: 'order-1',
          status: 'ORDERED',
          prescription: {
            procedureCode: { code: 'RAD001', nameKo: 'X-ray' },
            encounter: { patient: { id: 'pat-1', mrn: 'MRN001', familyName: '김', givenName: '환자' } },
          },
        },
      ];

      mockPrisma.order.findMany.mockResolvedValue(mockOrders);

      const result = await service.getQueue();

      expect(result).toEqual(mockOrders);
      expect(mockPrisma.order.findMany).toHaveBeenCalledWith({
        where: { department: 'IMAGING', status: { in: ['ORDERED', 'RECEIVED', 'IN_PROGRESS'] } },
        orderBy: { createdAt: 'asc' },
        include: expect.any(Object),
      });
    });
  });

  describe('acquire', () => {
    const orderId = 'order-1';

    it('should acquire imaging when order is ORDERED', async () => {
      const mockOrder = {
        id: orderId,
        status: 'ORDERED',
        prescription: { encounter: { patientId: 'pat-1' } },
      };

      const mockImaging = {
        id: 'img-1',
        orderId,
        patientId: 'pat-1',
        modality: 'CT',
        status: ImagingResultStatus.ACQUIRED,
        acquiredAt: new Date(),
      };

      mockPrisma.order.findUnique.mockResolvedValue(mockOrder);
      mockPrisma.order.update.mockResolvedValue({ ...mockOrder, status: 'IN_PROGRESS' });
      mockPrisma.imagingResult.create.mockResolvedValue(mockImaging);

      const result = await service.acquire(orderId, 'CT', 'Chest');

      expect(result.status).toBe(ImagingResultStatus.ACQUIRED);
      expect(mockPrisma.order.update).toHaveBeenCalledWith({
        where: { id: orderId },
        data: { status: 'IN_PROGRESS', startedAt: expect.any(Date) },
      });
    });

    it('should fall back to safety-gate detected modality if not provided', async () => {
      mockPrisma.order.findUnique.mockResolvedValue({
        id: orderId,
        status: 'RECEIVED',
        prescription: { encounter: { patientId: 'pat-1' } },
      });
      mockPrisma.order.update.mockResolvedValue({});
      mockPrisma.imagingResult.create.mockResolvedValue({ id: 'img-1' });

      await service.acquire(orderId);

      expect(mockPrisma.imagingResult.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          modality: 'CR', // mock 안전게이트가 판정한 modality
        }),
        include: expect.any(Object),
      });
    });

    it('should throw NotFoundException when order not found', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(null);

      await expect(service.acquire(orderId)).rejects.toThrow(NotFoundException);
    });

    it('should throw ConflictException when order is already completed', async () => {
      mockPrisma.order.findUnique.mockResolvedValue({
        id: orderId,
        status: 'COMPLETED',
      });

      await expect(service.acquire(orderId)).rejects.toThrow(ConflictException);
    });
  });

  describe('report', () => {
    const orderId = 'order-1';
    const finding = '우측 상엽에 3cm 크기의 종양';
    const impression = '폐암 의심, 병리검사 권고';

    it('should report imaging when status is ACQUIRED', async () => {
      mockPrisma.imagingResult.findUnique.mockResolvedValue({
        id: 'img-1',
        orderId,
        status: ImagingResultStatus.ACQUIRED,
        order: {},
      });
      mockPrisma.order.update.mockResolvedValue({});
      mockPrisma.imagingResult.update.mockResolvedValue({
        id: 'img-1',
        status: ImagingResultStatus.REPORTED,
        reportedAt: new Date(),
      });

      const result = await service.report(orderId, finding, impression);

      expect(result.status).toBe(ImagingResultStatus.REPORTED);
      expect(mockPrisma.imagingResult.update).toHaveBeenCalledWith({
        where: { id: 'img-1' },
        data: {
          finding,
          impression,
          radiologistId: null,
          status: ImagingResultStatus.REPORTED,
          reportedAt: expect.any(Date),
        },
        include: expect.any(Object),
      });
    });

    it('should accept radiologistId', async () => {
      mockPrisma.imagingResult.findUnique.mockResolvedValue({
        id: 'img-1',
        orderId,
        status: ImagingResultStatus.ACQUIRED,
        order: {},
      });
      mockPrisma.order.update.mockResolvedValue({});
      mockPrisma.imagingResult.update.mockResolvedValue({ id: 'img-1' });

      const radiologistId = 'doc-1';
      await service.report(orderId, finding, impression, radiologistId);

      expect(mockPrisma.imagingResult.update).toHaveBeenCalledWith({
        where: { id: 'img-1' },
        data: expect.objectContaining({
          radiologistId,
        }),
        include: expect.any(Object),
      });
    });

    it('should throw BadRequestException when finding is empty', async () => {
      await expect(service.report(orderId, '', impression)).rejects.toThrow(
        BadRequestException
      );
    });

    it('should throw ConflictException when status is not ACQUIRED', async () => {
      mockPrisma.imagingResult.findUnique.mockResolvedValue({
        id: 'img-1',
        status: ImagingResultStatus.ORDERED,
      });

      await expect(service.report(orderId, finding, impression)).rejects.toThrow(
        ConflictException
      );
    });
  });

  describe('getDetail', () => {
    it('should return detailed imaging information', async () => {
      const mockImaging = {
        id: 'img-1',
        orderId: 'order-1',
        modality: 'CT',
        finding: '종양 발견',
        impression: '폐암',
        patient: { id: 'pat-1', mrn: 'MRN001' },
        radiologist: { id: 'doc-1', familyName: '이', givenName: '의사' },
      };

      mockPrisma.imagingResult.findUnique.mockResolvedValue(mockImaging);

      const result = await service.getDetail('img-1');

      expect(result).toEqual(mockImaging);
      expect(result.radiologist).toBeDefined();
    });

    it('should throw NotFoundException when not found', async () => {
      mockPrisma.imagingResult.findUnique.mockResolvedValue(null);

      await expect(service.getDetail('img-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('getPatientResults', () => {
    it('should return patient imaging results ordered by creation date', async () => {
      const mockResults = [
        { id: 'img-1', orderId: 'order-1', createdAt: new Date('2026-05-13') },
        { id: 'img-2', orderId: 'order-2', createdAt: new Date('2026-05-12') },
      ];

      mockPrisma.imagingResult.findMany.mockResolvedValue(mockResults);

      const result = await service.getPatientResults('pat-1');

      expect(result).toEqual(mockResults);
      expect(mockPrisma.imagingResult.findMany).toHaveBeenCalledWith({
        where: { patientId: 'pat-1' },
        orderBy: { createdAt: 'desc' },
        include: expect.any(Object),
      });
    });
  });

  describe('cancelAcquisition', () => {
    const imagingResultId = 'img-1';

    it('should cancel acquisition and reset order status', async () => {
      mockPrisma.imagingResult.findUnique.mockResolvedValue({
        id: imagingResultId,
        orderId: 'order-1',
        status: ImagingResultStatus.ACQUIRED,
        notes: null,
      });
      mockPrisma.order.update.mockResolvedValue({});
      mockPrisma.imagingResult.update.mockResolvedValue({
        id: imagingResultId,
        status: ImagingResultStatus.ORDERED,
      });

      const reason = '장비 오류';
      await service.cancelAcquisition(imagingResultId, reason);

      expect(mockPrisma.order.update).toHaveBeenCalledWith({
        where: { id: 'order-1' },
        data: { status: 'RECEIVED', startedAt: null },
      });
    });

    it('should throw ConflictException when reported', async () => {
      mockPrisma.imagingResult.findUnique.mockResolvedValue({
        id: imagingResultId,
        status: ImagingResultStatus.REPORTED,
      });

      await expect(service.cancelAcquisition(imagingResultId, '')).rejects.toThrow(
        ConflictException
      );
    });
  });

  describe('updateAcquisition', () => {
    const imagingResultId = 'img-1';

    it('should update acquisition information', async () => {
      mockPrisma.imagingResult.findUnique.mockResolvedValue({
        id: imagingResultId,
        status: ImagingResultStatus.ACQUIRED,
      });
      mockPrisma.imagingResult.update.mockResolvedValue({
        id: imagingResultId,
        modality: 'MRI',
        bodyPart: 'Brain',
      });

      const result = await service.updateAcquisition(
        imagingResultId,
        'MRI',
        'Brain',
        '뇌 MRI'
      );

      expect(mockPrisma.imagingResult.update).toHaveBeenCalledWith({
        where: { id: imagingResultId },
        data: {
          modality: 'MRI',
          bodyPart: 'Brain',
        },
        include: expect.any(Object),
      });
    });

    it('should throw ConflictException when not ACQUIRED', async () => {
      mockPrisma.imagingResult.findUnique.mockResolvedValue({
        id: imagingResultId,
        status: ImagingResultStatus.REPORTED,
      });

      await expect(service.updateAcquisition(imagingResultId)).rejects.toThrow(
        ConflictException
      );
    });
  });
});
