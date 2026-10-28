import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LabController } from '../../src/modules/lab/lab.controller';
import { LabService } from '../../src/modules/lab/lab.service';
import { LabResultStatus } from '@prisma/client';

describe('LabController', () => {
  let controller: LabController;
  let service: LabService;

  beforeEach(() => {
    service = {
      getQueue: vi.fn(),
      collect: vi.fn(),
      submitResult: vi.fn(),
      getResult: vi.fn(),
      getPatientResults: vi.fn(),
      startTesting: vi.fn(),
      cancelTesting: vi.fn(),
    } as any;

    controller = new LabController(service, {} as any);
  });

  describe('getQueue', () => {
    it('should return lab queue', async () => {
      const mockQueue = [
        {
          id: 'ord-1',
          department: 'LAB',
          status: 'ORDERED',
          prescription: {
            encounter: {
              patient: { id: 'pat-1', mrn: 'MR001', familyName: '김', givenName: '환자' },
            },
            procedureCode: { code: 'CBC', nameKo: '일반혈액검사' },
          },
        },
      ];

      vi.mocked(service.getQueue).mockResolvedValue(mockQueue);

      const result = await controller.getQueue();

      expect(result.data).toHaveLength(1);
      expect(result.data[0].status).toBe('ORDERED');
      expect(service.getQueue).toHaveBeenCalled();
    });

    it('should return empty queue', async () => {
      vi.mocked(service.getQueue).mockResolvedValue([]);

      const result = await controller.getQueue();

      expect(result.data).toEqual([]);
    });
  });

  describe('collect', () => {
    it('should collect sample with notes', async () => {
      const dto = { notes: '정상 채혈' };

      const mockLabResult = {
        id: 'lab-1',
        orderId: 'ord-1',
        status: LabResultStatus.COLLECTED,
        collectedAt: new Date(),
        notes: '정상 채혈',
        technician: { id: 'tech-1', familyName: '이', givenName: '검사사' },
      };

      vi.mocked(service.collect).mockResolvedValue(mockLabResult);

      const result = await controller.collect('ord-1', dto, 'tech-1');

      expect(result.data.status).toBe(LabResultStatus.COLLECTED);
      expect(service.collect).toHaveBeenCalledWith('ord-1', 'tech-1', '정상 채혈');
    });

    it('should collect sample without notes', async () => {
      const dto = {};

      const mockLabResult = {
        id: 'lab-1',
        orderId: 'ord-1',
        status: LabResultStatus.COLLECTED,
      };

      vi.mocked(service.collect).mockResolvedValue(mockLabResult);

      const result = await controller.collect('ord-1', dto, 'tech-1');

      expect(result.data.status).toBe(LabResultStatus.COLLECTED);
      expect(service.collect).toHaveBeenCalledWith('ord-1', 'tech-1', undefined);
    });
  });

  describe('submitResult', () => {
    it('should submit lab results', async () => {
      const dto = {
        items: [
          { testName: 'WBC', value: '7.5', unit: '10^3/µL', normalMin: 4.5, normalMax: 11.0 },
        ],
        notes: '정상 범위',
      };

      const mockResult = {
        id: 'lab-1',
        orderId: 'ord-1',
        status: LabResultStatus.COMPLETED,
        items: [{ testName: 'WBC', value: '7.5', flag: 'N' }],
      };

      vi.mocked(service.submitResult).mockResolvedValue(mockResult);

      const result = await controller.submitResult('ord-1', dto, 'u-1');

      expect(result.data.status).toBe(LabResultStatus.COMPLETED);
      expect(service.submitResult).toHaveBeenCalledWith('ord-1', dto.items, '정상 범위', 'u-1');
    });

    it('should submit results with multiple items', async () => {
      const dto = {
        items: [
          { testName: 'WBC', value: '7.5', unit: '10^3/µL', normalMin: 4.5, normalMax: 11.0 },
          { testName: 'RBC', value: '4.8', unit: '10^6/µL', normalMin: 4.2, normalMax: 5.4 },
          { testName: 'Hb', value: '14.5', unit: 'g/dL', normalMin: 13.5, normalMax: 17.5 },
        ],
      };

      const mockResult = {
        id: 'lab-1',
        status: LabResultStatus.COMPLETED,
        items: [
          { testName: 'WBC', flag: 'N' },
          { testName: 'RBC', flag: 'N' },
          { testName: 'Hb', flag: 'N' },
        ],
      };

      vi.mocked(service.submitResult).mockResolvedValue(mockResult);

      const result = await controller.submitResult('ord-1', dto, 'u-1');

      expect(result.data.items).toHaveLength(3);
    });

    it('should submit results without notes', async () => {
      const dto = {
        items: [
          { testName: 'WBC', value: '7.5', unit: '10^3/µL' },
        ],
      };

      const mockResult = {
        id: 'lab-1',
        status: LabResultStatus.COMPLETED,
        items: [{ testName: 'WBC' }],
      };

      vi.mocked(service.submitResult).mockResolvedValue(mockResult);

      const result = await controller.submitResult('ord-1', dto, 'u-1');

      expect(result.data.status).toBe(LabResultStatus.COMPLETED);
      expect(service.submitResult).toHaveBeenCalledWith('ord-1', dto.items, undefined, 'u-1');
    });
  });

  describe('getResult', () => {
    it('should return lab result', async () => {
      const mockResult = {
        id: 'lab-1',
        orderId: 'ord-1',
        status: LabResultStatus.COMPLETED,
        items: [{ testName: 'WBC', value: '7.5', flag: 'N' }],
        technician: { id: 'tech-1', familyName: '이', givenName: '검사사' },
        patient: { id: 'pat-1', mrn: 'MR001', familyName: '김', givenName: '환자' },
      };

      vi.mocked(service.getResult).mockResolvedValue(mockResult);

      const result = await controller.getResult('ord-1');

      expect(result.data.id).toBe('lab-1');
      expect(result.data.status).toBe(LabResultStatus.COMPLETED);
      expect(service.getResult).toHaveBeenCalledWith('ord-1');
    });
  });

  describe('getPatientResults', () => {
    it('should return patient lab results', async () => {
      const mockResults = [
        {
          id: 'lab-1',
          patientId: 'pat-1',
          status: LabResultStatus.COMPLETED,
          createdAt: new Date('2026-05-13'),
          items: [],
          technician: { id: 'tech-1', familyName: '이', givenName: '검사사' },
        },
        {
          id: 'lab-2',
          patientId: 'pat-1',
          status: LabResultStatus.COMPLETED,
          createdAt: new Date('2026-05-10'),
          items: [],
          technician: { id: 'tech-1', familyName: '이', givenName: '검사사' },
        },
      ];

      vi.mocked(service.getPatientResults).mockResolvedValue(mockResults);

      const result = await controller.getPatientResults('pat-1');

      expect(result.data).toHaveLength(2);
      expect(result.data[0].createdAt > result.data[1].createdAt).toBe(true); // Latest first
      expect(service.getPatientResults).toHaveBeenCalledWith('pat-1', undefined);
    });

    it('🔴 days 를 서비스에 넘긴다 — 종전엔 받지 않아 "최근 3일 위급값"이 전 기간을 그렸다 · 잘못된 값은 400', async () => {
      vi.mocked(service.getPatientResults).mockResolvedValue([]);
      await controller.getPatientResults('pat-1', '3');
      expect(service.getPatientResults).toHaveBeenLastCalledWith('pat-1', 3);
      await expect(controller.getPatientResults('pat-1', 'abc')).rejects.toThrow(/days/);
      await expect(controller.getPatientResults('pat-1', '0')).rejects.toThrow(/days/);
    });

    it('should return empty list for patient with no results', async () => {
      vi.mocked(service.getPatientResults).mockResolvedValue([]);

      const result = await controller.getPatientResults('pat-1');

      expect(result.data).toEqual([]);
    });
  });

  describe('startTesting', () => {
    it('should start testing', async () => {
      const mockLabResult = {
        id: 'lab-1',
        status: LabResultStatus.IN_PROGRESS,
        items: [],
      };

      vi.mocked(service.startTesting).mockResolvedValue(mockLabResult);

      const result = await controller.startTesting('lab-1');

      expect(result.data.status).toBe(LabResultStatus.IN_PROGRESS);
      expect(service.startTesting).toHaveBeenCalledWith('lab-1');
    });
  });

  describe('cancelTesting', () => {
    it('should cancel testing with reason', async () => {
      const body = { reason: '검체 손상' };

      const mockLabResult = {
        id: 'lab-1',
        status: LabResultStatus.PENDING,
        notes: 'Initial note\n취소사유: 검체 손상',
      };

      vi.mocked(service.cancelTesting).mockResolvedValue(mockLabResult);

      const result = await controller.cancelTesting('lab-1', body);

      expect(result.data.status).toBe(LabResultStatus.PENDING);
      expect(service.cancelTesting).toHaveBeenCalledWith('lab-1', '검체 손상');
    });

    it('should cancel testing without reason', async () => {
      const body = {};

      const mockLabResult = {
        id: 'lab-1',
        status: LabResultStatus.PENDING,
      };

      vi.mocked(service.cancelTesting).mockResolvedValue(mockLabResult);

      const result = await controller.cancelTesting('lab-1', body);

      expect(result.data.status).toBe(LabResultStatus.PENDING);
      expect(service.cancelTesting).toHaveBeenCalledWith('lab-1', '');
    });
  });
});
