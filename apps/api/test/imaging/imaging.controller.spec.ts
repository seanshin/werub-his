import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ImagingController } from '../../src/modules/imaging/imaging.controller';
import { ImagingService } from '../../src/modules/imaging/imaging.service';
import { ImagingResultStatus } from '@prisma/client';

describe('ImagingController', () => {
  let controller: ImagingController;
  let mockService: any;
  let mockSafety: any;

  beforeEach(() => {
    mockService = {
      getQueue: vi.fn(),
      acquire: vi.fn(),
      report: vi.fn(),
      getDetail: vi.fn(),
      getPatientResults: vi.fn(),
      cancelAcquisition: vi.fn(),
      updateAcquisition: vi.fn(),
    };
    mockSafety = {
      assertAcquireGate: vi.fn(),
      recordExposure: vi.fn(),
      getPatientExposure: vi.fn(),
    };

    controller = new ImagingController(mockService, mockSafety);
  });

  describe('getQueue', () => {
    it('should return imaging orders', async () => {
      const mockQueue = [
        {
          id: 'order-1',
          status: 'ORDERED',
          prescription: { procedureCode: { nameKo: 'X-ray' } },
        },
      ];

      mockService.getQueue.mockResolvedValue(mockQueue);

      const result = await controller.getQueue();

      expect(result.data).toEqual(mockQueue);
      expect(mockService.getQueue).toHaveBeenCalled();
    });
  });

  describe('acquire', () => {
    it('should acquire imaging with modality and body part', async () => {
      const orderId = 'order-1';
      const dto = { modality: 'CT', bodyPart: 'Chest', notes: '촬영 완료' };

      const mockResult = {
        id: 'img-1',
        status: ImagingResultStatus.ACQUIRED,
      };

      mockService.acquire.mockResolvedValue(mockResult);

      const result = await controller.acquire(orderId, dto, 'u-1');

      expect(result.data).toEqual(mockResult);
      expect(mockService.acquire).toHaveBeenCalledWith(
        orderId,
        dto.modality,
        dto.bodyPart,
        dto.notes,
        'u-1',
        expect.objectContaining({}),
      );
    });

    it('should acquire with minimal data', async () => {
      const orderId = 'order-1';
      const dto = {};

      mockService.acquire.mockResolvedValue({ id: 'img-1' });

      await controller.acquire(orderId, dto as any, 'u-1');

      expect(mockService.acquire).toHaveBeenCalledWith(
        orderId,
        undefined,
        undefined,
        undefined,
        'u-1',
        expect.objectContaining({}),
      );
    });
  });

  describe('report', () => {
    it('should report imaging findings', async () => {
      const orderId = 'order-1';
      const dto = {
        finding: '종양 발견',
        impression: '폐암',
        radiologistId: 'doc-1',
      };

      const mockResult = {
        id: 'img-1',
        status: ImagingResultStatus.REPORTED,
      };

      mockService.report.mockResolvedValue(mockResult);

      const result = await controller.report(orderId, dto);

      expect(result.data).toEqual(mockResult);
      expect(mockService.report).toHaveBeenCalledWith(
        orderId,
        dto.finding,
        dto.impression,
        dto.radiologistId
      );
    });
  });

  describe('getDetail', () => {
    it('should return imaging detail', async () => {
      const imagingResultId = 'img-1';
      const mockDetail = {
        id: imagingResultId,
        modality: 'CT',
        finding: '종양',
        impression: '폐암',
      };

      mockService.getDetail.mockResolvedValue(mockDetail);

      const result = await controller.getDetail(imagingResultId);

      expect(result.data).toEqual(mockDetail);
      expect(mockService.getDetail).toHaveBeenCalledWith(imagingResultId);
    });
  });

  describe('getPatientResults', () => {
    it('should return patient imaging results', async () => {
      const patientId = 'pat-1';
      const mockResults = [
        { id: 'img-1', orderId: 'order-1' },
        { id: 'img-2', orderId: 'order-2' },
      ];

      mockService.getPatientResults.mockResolvedValue(mockResults);

      const result = await controller.getPatientResults(patientId);

      expect(result.data).toEqual(mockResults);
      expect(mockService.getPatientResults).toHaveBeenCalledWith(patientId);
    });
  });

  describe('cancelAcquisition', () => {
    it('should cancel acquisition with reason', async () => {
      const imagingResultId = 'img-1';
      const reason = '장비 오류';

      mockService.cancelAcquisition.mockResolvedValue({
        id: imagingResultId,
        status: ImagingResultStatus.ORDERED,
      });

      await controller.cancelAcquisition(imagingResultId, { reason });

      expect(mockService.cancelAcquisition).toHaveBeenCalledWith(
        imagingResultId,
        reason
      );
    });

    it('should cancel without reason', async () => {
      const imagingResultId = 'img-1';

      mockService.cancelAcquisition.mockResolvedValue({
        id: imagingResultId,
        status: ImagingResultStatus.ORDERED,
      });

      await controller.cancelAcquisition(imagingResultId, {});

      expect(mockService.cancelAcquisition).toHaveBeenCalledWith(
        imagingResultId,
        ''
      );
    });
  });

  describe('updateAcquisition', () => {
    it('should update acquisition information', async () => {
      const imagingResultId = 'img-1';
      const dto = {
        modality: 'MRI',
        bodyPart: 'Brain',
        notes: '뇌 MRI',
      };

      mockService.updateAcquisition.mockResolvedValue({
        id: imagingResultId,
        modality: dto.modality,
      });

      const result = await controller.updateAcquisition(imagingResultId, dto);

      expect(result.data.modality).toBe(dto.modality);
      expect(mockService.updateAcquisition).toHaveBeenCalledWith(
        imagingResultId,
        dto.modality,
        dto.bodyPart,
        dto.notes
      );
    });
  });
});
