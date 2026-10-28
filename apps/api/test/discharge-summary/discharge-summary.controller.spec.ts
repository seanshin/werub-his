import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DischargeSummaryController } from '../../src/modules/discharge-summary/discharge-summary.controller';
import { DischargeSummaryService } from '../../src/modules/discharge-summary/discharge-summary.service';

describe('DischargeSummaryController', () => {
  let controller: DischargeSummaryController;
  let service: DischargeSummaryService;

  beforeEach(() => {
    service = {
      create: vi.fn(),
      findByAdmission: vi.fn(),
      update: vi.fn(),
      sign: vi.fn(),
      prefill: vi.fn(),
    } as any;

    controller = new DischargeSummaryController(service);
  });

  describe('create', () => {
    it('should create discharge summary', async () => {
      const dto = {
        admitDate: '2026-05-01',
        dischargeDate: '2026-05-10',
        admitDiagnosis: '급성 폐렴',
        dischargeDiagnosis: '폐렴 회복',
        diagnosisCodes: [{ code: 'J18.9', name: '폐렴' }],
        hospitalCourse: '환자는 안정적으로 회복됨',
        procedures: '항생제 치료',
        significantFindings: '흉부 X선 정상화',
        conditionAtDischarge: '양호',
        dischargeMedications: [{ code: 'AMX', name: '아목시실린', dosage: '500mg' }],
        followUpPlan: '1주 후 외래 재진',
      };

      const mockSummary = {
        id: 'ds-1',
        admissionId: 'adm-1',
        doctorId: 'doc-1',
        status: 'DRAFT',
        ...dto,
      };

      vi.mocked(service.create).mockResolvedValue(mockSummary);

      const result = await controller.create('adm-1', dto, 'doc-1');

      expect(result.data).toEqual(mockSummary);
      expect(service.create).toHaveBeenCalledWith('adm-1', dto, 'doc-1');
    });
  });

  describe('findByAdmission', () => {
    it('should return discharge summary', async () => {
      const mockSummary = {
        id: 'ds-1',
        admissionId: 'adm-1',
        doctorId: 'doc-1',
        status: 'DRAFT',
        admitDiagnosis: '급성 폐렴',
        dischargeDate: new Date('2026-05-10'),
      };

      vi.mocked(service.findByAdmission).mockResolvedValue(mockSummary);

      const result = await controller.findByAdmission('adm-1');

      expect(result.data).toEqual(mockSummary);
      expect(service.findByAdmission).toHaveBeenCalledWith('adm-1');
    });
  });

  describe('update', () => {
    it('should update discharge summary', async () => {
      const dto = {
        admitDiagnosis: '폐렴 의심',
      };

      const mockUpdated = {
        id: 'ds-1',
        admissionId: 'adm-1',
        status: 'DRAFT',
        ...dto,
      };

      vi.mocked(service.update).mockResolvedValue(mockUpdated);

      const result = await controller.update('adm-1', dto, 'doc-1');

      expect(result.data).toEqual(mockUpdated);
      expect(service.update).toHaveBeenCalledWith('adm-1', dto, 'doc-1'); // 정정한 사람(2026-10-03 서명본 보존)
    });
  });

  describe('sign', () => {
    it('should sign discharge summary', async () => {
      const mockSigned = {
        id: 'ds-1',
        admissionId: 'adm-1',
        status: 'SIGNED',
        signedBy: 'doc-1',
        signedAt: new Date(),
      };

      vi.mocked(service.sign).mockResolvedValue(mockSigned);

      const result = await controller.sign('adm-1', 'doc-1');

      expect(result.data.status).toBe('SIGNED');
      expect(result.data.signedBy).toBe('doc-1');
      expect(service.sign).toHaveBeenCalledWith('adm-1', 'doc-1', undefined);
    });
  });

  describe('prefill', () => {
    it('should return prefilled discharge summary data', async () => {
      const mockPrefilled = {
        admitDate: new Date('2026-05-01'),
        dischargeDate: new Date('2026-05-10'),
        admitDiagnosis: '급성 폐렴',
        diagnosisCodes: [{ code: 'J18.9', name: '폐렴', type: 'PRIMARY' }],
        procedures: '흉부 엑스레이 (CXR)',
        significantFindings: 'CRP: 2.3 mg/dL (H)',
        dischargeMedications: [
          { code: 'AMX', name: '아목시실린', dosage: '500mg', frequency: '3회', duration: '7일' },
        ],
        patient: { id: 'pat-1', familyName: '김', givenName: '환자' },
      };

      vi.mocked(service.prefill).mockResolvedValue(mockPrefilled);

      const result = await controller.prefill('adm-1');

      expect(result.data).toEqual(mockPrefilled);
      expect(result.data.admitDiagnosis).toBe('급성 폐렴');
      expect(result.data.diagnosisCodes).toHaveLength(1);
      expect(service.prefill).toHaveBeenCalledWith('adm-1');
    });
  });
});
