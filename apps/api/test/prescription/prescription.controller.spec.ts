import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PrescriptionController } from '../../src/modules/prescription/prescription.controller';
import { PrescriptionService } from '../../src/modules/prescription/prescription.service';

describe('PrescriptionController', () => {
  let controller: PrescriptionController;
  let service: PrescriptionService;

  beforeEach(() => {
    service = {
      create: vi.fn(),
      findByEncounter: vi.fn(),
      cancel: vi.fn(),
      copyFromEncounter: vi.fn(),
      copyPrescriptions: vi.fn(),
      repeatPrescription: vi.fn(),
      checkDur: vi.fn(),
    } as any;

    controller = new PrescriptionController(service);
  });

  describe('create', () => {
    it('should create medication prescription', async () => {
      const dto = {
        type: 'MEDICATION',
        medicationCodeId: 'med-001',
        dosage: '500mg',
        frequency: '1일 3회',
        duration: 7,
        route: 'PO',
        priority: 'ROUTINE',
      };

      const mockPrescription = {
        id: 'rx-1',
        encounterId: 'enc-1',
        ...dto,
      };

      vi.mocked(service.create).mockResolvedValue({
        prescription: mockPrescription,
        durWarnings: [],
      });

      const result = await controller.create('enc-1', dto as any, 'doc-1');

      expect(result.data).toEqual(mockPrescription);
      expect(result.durWarnings).toEqual([]);
      expect(service.create).toHaveBeenCalledWith('enc-1', dto, 'doc-1', undefined, { prescriberId: undefined, prescriberStepUpToken: undefined });
    });

    it('should return DUR warnings if present', async () => {
      const dto = {
        type: 'MEDICATION',
        medicationCodeId: 'med-001',
        dosage: '500mg',
        frequency: '1일 3회',
        duration: 7,
      };

      const durWarning = { severity: 'WARNING', message: '부작용 주의' };

      vi.mocked(service.create).mockResolvedValue({
        prescription: { id: 'rx-1' },
        durWarnings: [durWarning],
      });

      const result = await controller.create('enc-1', dto as any, 'doc-1');

      expect(result.durWarnings).toHaveLength(1);
      expect(result.durWarnings[0].severity).toBe('WARNING');
    });
  });

  describe('findByEncounter', () => {
    it('should return prescriptions for encounter', async () => {
      const mockPrescriptions = [
        {
          id: 'rx-1',
          type: 'MEDICATION',
          dosage: '500mg',
          medicationCode: { code: 'MED001', nameKo: '약물' },
          orders: [{ id: 'ord-1', department: 'PHARMACY', status: 'PENDING' }],
        },
      ];

      vi.mocked(service.findByEncounter).mockResolvedValue(mockPrescriptions);

      const result = await controller.findByEncounter('enc-1');

      expect(result.data).toEqual(mockPrescriptions);
      expect(result.data).toHaveLength(1);
      expect(service.findByEncounter).toHaveBeenCalledWith('enc-1');
    });
  });

  describe('cancel', () => {
    it('should cancel prescription', async () => {
      const mockCancelled = {
        id: 'rx-1',
        status: 'CANCELLED',
      };

      vi.mocked(service.cancel).mockResolvedValue(mockCancelled);

      const result = await controller.cancel('rx-1', 'doc-1');

      expect(result.data.status).toBe('CANCELLED');
      expect(service.cancel).toHaveBeenCalledWith('rx-1', 'doc-1');
    });
  });

  describe('copy', () => {
    it('should copy prescriptions from source encounter', async () => {
      const body = {
        sourceEncounterId: 'enc-1',
        prescriptionIds: ['rx-1'],
      };

      const mockResult = {
        data: [{ id: 'rx-2', source: 'COPY' }],
        count: 1,
      };

      vi.mocked(service.copyFromEncounter).mockResolvedValue(mockResult);

      const result = await controller.copy('enc-2', body, 'doc-1');

      expect(result.count).toBe(1);
      expect(service.copyFromEncounter).toHaveBeenCalledWith('enc-2', 'enc-1', 'doc-1', ['rx-1'], { overrideDur: undefined, overrideReason: undefined });
    });

    it('should copy without prescriptionIds filter', async () => {
      const body = {
        sourceEncounterId: 'enc-1',
      };

      vi.mocked(service.copyFromEncounter).mockResolvedValue({
        data: [],
        count: 0,
      });

      await controller.copy('enc-2', body, 'doc-1');

      expect(service.copyFromEncounter).toHaveBeenCalledWith('enc-2', 'enc-1', 'doc-1', undefined, { overrideDur: undefined, overrideReason: undefined });
    });
  });

  describe('copyPrescriptions', () => {
    it('should copy prescriptions with type filter', async () => {
      const body = {
        sourceEncounterId: 'enc-1',
        targetEncounterId: 'enc-2',
        types: ['MEDICATION'],
      };

      const mockResult = {
        prescriptions: [
          {
            prescription: { id: 'rx-2', source: 'COPY' },
            durWarnings: [],
          },
        ],
        count: 1,
      };

      vi.mocked(service.copyPrescriptions).mockResolvedValue(mockResult as any);

      const result = await controller.copyPrescriptions(body, 'doc-1');

      expect(result.data.count).toBe(1);
      expect(service.copyPrescriptions).toHaveBeenCalledWith('enc-1', 'enc-2', 'doc-1', ['MEDICATION'], { overrideDur: undefined, overrideReason: undefined });
    });

    it('should copy without type filter', async () => {
      const body = {
        sourceEncounterId: 'enc-1',
        targetEncounterId: 'enc-2',
      };

      vi.mocked(service.copyPrescriptions).mockResolvedValue({
        prescriptions: [],
        count: 0,
      } as any);

      await controller.copyPrescriptions(body, 'doc-1');

      expect(service.copyPrescriptions).toHaveBeenCalledWith('enc-1', 'enc-2', 'doc-1', undefined, { overrideDur: undefined, overrideReason: undefined });
    });
  });

  describe('repeatPrescription', () => {
    it('should repeat prescription in same encounter', async () => {
      const mockResult = {
        prescription: { id: 'rx-2', encounterId: 'enc-1', source: 'COPY' },
        durWarnings: [],
      };

      vi.mocked(service.repeatPrescription).mockResolvedValue(mockResult);

      const result = await controller.repeatPrescription('rx-1', 'doc-1');

      expect(result.data.prescription.id).toBe('rx-2');
      expect(result.data.durWarnings).toEqual([]);
      expect(service.repeatPrescription).toHaveBeenCalledWith('rx-1', 'doc-1', { overrideDur: undefined, overrideReason: undefined });
    });

    it('should include DUR warnings in repeat result', async () => {
      const mockResult = {
        prescription: { id: 'rx-2', source: 'COPY' },
        durWarnings: [{ severity: 'WARNING', message: '주의' }],
      };

      vi.mocked(service.repeatPrescription).mockResolvedValue(mockResult);

      const result = await controller.repeatPrescription('rx-1', 'doc-1');

      expect(result.data.durWarnings).toHaveLength(1);
    });
  });

  describe('checkDur', () => {
    it('should perform manual DUR check', async () => {
      const mockResult = {
        durWarnings: [],
        safe: true,
      };

      vi.mocked(service.checkDur).mockResolvedValue(mockResult);

      const result = await controller.checkDur('enc-1', 'med-001');

      expect(result.data.safe).toBe(true);
      expect(service.checkDur).toHaveBeenCalledWith('enc-1', 'med-001');
    });

    it('should return DUR warnings if unsafe', async () => {
      const mockResult = {
        durWarnings: [
          { severity: 'ERROR', message: '약물 상호작용 위험' },
        ],
        safe: false,
      };

      vi.mocked(service.checkDur).mockResolvedValue(mockResult);

      const result = await controller.checkDur('enc-1', 'med-001');

      expect(result.data.safe).toBe(false);
      expect(result.data.durWarnings).toHaveLength(1);
    });
  });
});
