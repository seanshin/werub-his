import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DischargeSummaryService } from '../../src/modules/discharge-summary/discharge-summary.service';
import {
  AdmissionNotFoundError, DischargeSummaryExistsError,
  DischargeSummaryNotFoundError, DischargeAlreadySignedError,
} from '../../src/domain/errors/domain-error';

describe('DischargeSummaryService', () => {
  let service: DischargeSummaryService;
  let mockPrisma: any;
  let mockChronic: any;

  beforeEach(() => {
    mockPrisma = {
      admission: {
        findUnique: vi.fn(),
      },
      dischargeSummary: {
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      encounter: {
        findMany: vi.fn(),
      },
      surgery: {
        findMany: vi.fn(),
      },
      labResult: {
        findMany: vi.fn(),
      },
      prescription: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    };

    mockChronic = {
      getProblemNarrative: vi.fn().mockResolvedValue({ text: '' }),
    };

    service = new DischargeSummaryService(mockPrisma, mockChronic);
  });

  describe('create', () => {
    it('should create discharge summary for admission', async () => {
      const dto = {
        admitDate: '2026-05-01',
        dischargeDate: '2026-05-10',
        admitDiagnosis: '급성 폐렴',
        dischargeDiagnosis: '폐렴 회복',
        diagnosisCodes: [{ code: 'J18.9', name: '폐렴' }],
        hospitalCourse: '환자는 입원 기간 안정적으로 회복됨',
        procedures: '항생제 치료',
        significantFindings: '흉부 X선 정상화',
        conditionAtDischarge: '양호',
        dischargeMedications: [{ code: 'AMX', name: '아목시실린', dosage: '500mg' }],
        followUpPlan: '1주 후 외래 재진',
        dietaryInstructions: '일반식 가능',
        activityRestrictions: '과도한 운동 제한',
        patientEducation: '복용약 교육 제공',
      };

      mockPrisma.admission.findUnique.mockResolvedValue({ id: 'adm-1' });
      mockPrisma.dischargeSummary.findUnique.mockResolvedValue(null);
      mockPrisma.dischargeSummary.create.mockResolvedValue({
        id: 'ds-1',
        admissionId: 'adm-1',
        doctorId: 'doc-1',
        status: 'DRAFT',
        ...dto,
        doctor: { id: 'doc-1', familyName: '이', givenName: '의사' },
        admission: { id: 'adm-1', patientId: 'pat-1', status: 'ADMITTED' },
      });

      const result = await service.create('adm-1', dto, 'doc-1');

      expect(result.id).toBe('ds-1');
      expect(result.status).toBe('DRAFT');
      expect(result.admitDiagnosis).toBe('급성 폐렴');
      expect(mockPrisma.dischargeSummary.create).toHaveBeenCalled();
    });

    it('should throw AdmissionNotFoundError if admission not found', async () => {
      mockPrisma.admission.findUnique.mockResolvedValue(null);

      await expect(
        service.create('adm-1', {} as any, 'doc-1'),
      ).rejects.toThrow(AdmissionNotFoundError);
    });

    it('should throw DischargeSummaryExistsError if already exists', async () => {
      mockPrisma.admission.findUnique.mockResolvedValue({ id: 'adm-1' });
      mockPrisma.dischargeSummary.findUnique.mockResolvedValue({ id: 'ds-1' });

      await expect(
        service.create('adm-1', {} as any, 'doc-1'),
      ).rejects.toThrow(DischargeSummaryExistsError);
    });
  });

  describe('findByAdmission', () => {
    it('should return discharge summary by admission', async () => {
      const mockSummary = {
        id: 'ds-1',
        admissionId: 'adm-1',
        doctorId: 'doc-1',
        status: 'DRAFT',
        admitDiagnosis: '급성 폐렴',
        dischargeDate: new Date('2026-05-10'),
        doctor: { id: 'doc-1', familyName: '이', givenName: '의사' },
        admission: { id: 'adm-1', patientId: 'pat-1', status: 'ADMITTED' },
      };

      mockPrisma.dischargeSummary.findUnique.mockResolvedValue(mockSummary);

      const result = await service.findByAdmission('adm-1');

      expect(result.id).toBe('ds-1');
      expect(result.status).toBe('DRAFT');
      expect(result.admissionId).toBe('adm-1');
    });

    it('should throw DischargeSummaryNotFoundError if not found', async () => {
      mockPrisma.dischargeSummary.findUnique.mockResolvedValue(null);

      await expect(service.findByAdmission('adm-1')).rejects.toThrow(
        DischargeSummaryNotFoundError,
      );
    });
  });

  describe('update', () => {
    it('should update draft discharge summary', async () => {
      mockPrisma.dischargeSummary.findUnique.mockResolvedValue({
        id: 'ds-1',
        status: 'DRAFT',
      });

      mockPrisma.dischargeSummary.update.mockResolvedValue({
        id: 'ds-1',
        status: 'DRAFT',
        admitDiagnosis: '폐렴 의심',
        doctor: { id: 'doc-1', familyName: '이', givenName: '의사' },
        admission: { id: 'adm-1', patientId: 'pat-1', status: 'ADMITTED' },
      });

      const result = await service.update('adm-1', { admitDiagnosis: '폐렴 의심' });

      expect(result.status).toBe('DRAFT');
      expect(mockPrisma.dischargeSummary.update).toHaveBeenCalled();
    });

    it('should transition SIGNED to AMENDED when updating', async () => {
      mockPrisma.dischargeSummary.findUnique.mockResolvedValue({
        id: 'ds-1',
        status: 'SIGNED',
        admitDiagnosis: '원래 진단',
        admission: { patientId: 'pat-1' },
      });

      mockPrisma.dischargeSummary.update.mockResolvedValue({
        id: 'ds-1',
        status: 'AMENDED',
        admitDiagnosis: '수정된 진단',
        doctor: { id: 'doc-1', familyName: '이', givenName: '의사' },
        admission: { id: 'adm-1', patientId: 'pat-1', status: 'ADMITTED' },
      });

      // 서명본 정정은 직전 서명본 보존과 한 트랜잭션(2026-10-03)
      (mockPrisma as any).signedRecordVersion = { create: vi.fn(async () => ({})) };
      (mockPrisma as any).$transaction = vi.fn(async (fn: (t: unknown) => unknown) => fn(mockPrisma));
      const result = await service.update('adm-1', { admitDiagnosis: '수정된 진단' });

      expect(result.status).toBe('AMENDED');
      expect(mockPrisma.dischargeSummary.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { admissionId: 'adm-1' },
          data: expect.objectContaining({ status: 'AMENDED' }),
        }),
      );
    });

    it('should throw DischargeSummaryNotFoundError if not found', async () => {
      mockPrisma.dischargeSummary.findUnique.mockResolvedValue(null);

      await expect(service.update('adm-1', {})).rejects.toThrow(
        DischargeSummaryNotFoundError,
      );
    });
  });

  describe('sign', () => {
    it('should sign discharge summary', async () => {
      const now = new Date();
      mockPrisma.dischargeSummary.findUnique.mockResolvedValue({
        id: 'ds-1',
        status: 'DRAFT',
      });

      mockPrisma.dischargeSummary.update.mockResolvedValue({
        id: 'ds-1',
        status: 'SIGNED',
        signedAt: now,
        signedBy: 'doc-1',
        doctor: { id: 'doc-1', familyName: '이', givenName: '의사' },
        admission: { id: 'adm-1', patientId: 'pat-1', status: 'ADMITTED' },
      });

      const result = await service.sign('adm-1', 'doc-1');

      expect(result.status).toBe('SIGNED');
      expect(result.signedBy).toBe('doc-1');
      expect(mockPrisma.dischargeSummary.update).toHaveBeenCalledWith({
        where: { admissionId: 'adm-1' },
        data: { status: 'SIGNED', signedAt: expect.any(Date), signedBy: 'doc-1' },
        include: expect.any(Object),
      });
    });

    it('should throw DischargeAlreadySignedError if already signed', async () => {
      mockPrisma.dischargeSummary.findUnique.mockResolvedValue({
        id: 'ds-1',
        status: 'SIGNED',
      });

      await expect(service.sign('adm-1', 'doc-1')).rejects.toThrow(
        DischargeAlreadySignedError,
      );
    });

    it('should throw DischargeSummaryNotFoundError if not found', async () => {
      mockPrisma.dischargeSummary.findUnique.mockResolvedValue(null);

      await expect(service.sign('adm-1', 'doc-1')).rejects.toThrow(
        DischargeSummaryNotFoundError,
      );
    });
  });

  describe('prefill', () => {
    it('should prefill discharge summary data from admission records', async () => {
      const admitDate = new Date('2026-05-01');
      mockPrisma.admission.findUnique.mockResolvedValue({
        id: 'adm-1',
        patientId: 'pat-1',
        admitDate,
        dischargeDate: new Date('2026-05-10'),
        admitReason: '급성 폐렴',
        patient: { id: 'pat-1', mrn: 'MR001', familyName: '김', givenName: '환자' },
      });

      mockPrisma.encounter.findMany.mockResolvedValue([
        {
          id: 'enc-1',
          patientId: 'pat-1',
          diagnoses: [
            {
              diagnosisCode: { code: 'J18.9', nameKo: '폐렴' },
              type: 'PRIMARY',
            },
          ],
        },
      ]);

      mockPrisma.surgery.findMany.mockResolvedValue([
        {
          procedureName: '흉부 엑스레이',
          procedureCode: 'CXR',
          startedAt: new Date(),
          status: 'COMPLETED',
        },
      ]);

      mockPrisma.labResult.findMany.mockResolvedValue([
        {
          id: 'lab-1',
          items: [
            {
              testName: '백혈구',
              value: '7.5',
              unit: '10^3/uL',
              flag: 'N',
            },
            {
              testName: 'CRP',
              value: '2.3',
              unit: 'mg/dL',
              flag: 'H',
            },
          ],
        },
      ]);

      // 1번째 조회 = 처방 원장의 퇴원약(없음) → 2번째 = 입원 중 활성 약(참고)
      mockPrisma.prescription.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([
        {
          medicationCode: { code: 'AMX', nameKo: '아목시실린' },
          dosage: '500mg',
          frequency: '3회',
          duration: '7일',
        },
      ]);

      const result = await service.prefill('adm-1');

      expect(result.admitDiagnosis).toBe('급성 폐렴');
      expect(result.diagnosisCodes).toHaveLength(1);
      expect(result.significantFindings).toContain('CRP');
      expect(result.dischargeMedications).toHaveLength(1);
      // 퇴원약 오더화(2026-09-30) — 처방 원장에 퇴원약이 없으면 입원 중 약은 '참고'라고 출처를 밝힌다
      expect(result.dischargeMedicationsSource).toBe('INPATIENT_ACTIVE');
      expect(result.patient.familyName).toBe('김');
    });

    it('처방 원장에 퇴원약이 있으면 그것이 정본 — 입원 중 약을 조회하지 않고 name·drugName 을 함께 싣는다', async () => {
      mockPrisma.admission.findUnique.mockResolvedValue({ id: 'adm-1', patientId: 'pat-1', admitDate: new Date('2026-09-01'), admitReason: 'x', patient: { familyName: '김' } });
      mockPrisma.encounter.findMany.mockResolvedValue([]);
      mockPrisma.surgery.findMany.mockResolvedValue([]);
      mockPrisma.labResult.findMany.mockResolvedValue([]);
      mockPrisma.prescription.findMany.mockReset().mockResolvedValueOnce([
        { id: 'rx-d', dosage: '1T', frequency: 'bid', duration: 7, quantity: 14, route: 'PO', dispensingType: 'INTERNAL', medicationCode: { code: 'AMX', nameKo: '아목시실린' } },
      ]);
      const result = await service.prefill('adm-1');
      expect(result.dischargeMedicationsSource).toBe('ORDERS');
      expect(result.dischargeMedications).toEqual([expect.objectContaining({ prescriptionId: 'rx-d', name: '아목시실린', drugName: '아목시실린', quantity: 14 })]);
      expect(mockPrisma.prescription.findMany).toHaveBeenCalledTimes(1);
    });

    it('서명 — 처방 원장의 퇴원약을 서명 순간 요약에 스냅샷 · 없으면 기존 값을 건드리지 않는다', async () => {
      mockPrisma.dischargeSummary.findUnique.mockResolvedValue({ id: 'ds-1', status: 'DRAFT' });
      mockPrisma.dischargeSummary.update.mockResolvedValue({ id: 'ds-1', status: 'SIGNED' });
      mockPrisma.prescription.findMany.mockReset().mockResolvedValueOnce([
        { id: 'rx-d', dosage: '1T', frequency: 'bid', duration: 7, quantity: 14, route: 'PO', dispensingType: 'INTERNAL', medicationCode: { code: 'AMX', nameKo: '아목시실린' } },
      ]).mockResolvedValueOnce([]);
      await service.sign('adm-1', 'doc-1');
      expect(mockPrisma.dischargeSummary.update.mock.calls[0][0].data.dischargeMedications).toEqual([expect.objectContaining({ prescriptionId: 'rx-d', drugName: '아목시실린' })]);
      mockPrisma.dischargeSummary.update.mockClear();
      await service.sign('adm-1', 'doc-1');
      expect(mockPrisma.dischargeSummary.update.mock.calls[0][0].data).not.toHaveProperty('dischargeMedications');
    });

    it('should throw AdmissionNotFoundError if admission not found', async () => {
      mockPrisma.admission.findUnique.mockResolvedValue(null);

      await expect(service.prefill('adm-1')).rejects.toThrow(AdmissionNotFoundError);
    });
  });
});
