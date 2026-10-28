import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InpatientService } from '../../src/modules/inpatient/inpatient.service';

describe('InpatientService — 바이탈/간호 API', () => {
  let service: InpatientService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      flowSheetEntry: { findMany: vi.fn(), findFirst: vi.fn() },
      preVisitVitals: { findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn().mockResolvedValue(null) },
      intakeOutput: { findMany: vi.fn() },
      nursingNote: { findMany: vi.fn() },
      nursingAssessment: { findMany: vi.fn() },
      medicationAdministration: { findMany: vi.fn() },
      admission: { findUnique: vi.fn(), findMany: vi.fn() },
    };
    service = new InpatientService(mockPrisma);
  });

  // 입원 활력 읽기 정본(2026-10-10) — 플로시트 + 재원 기간 안 외래 원장(간호 스테이션 입력) · 행마다 ledger
  const ADM = { id: 'adm-1', patientId: 'p-1', admitDate: new Date('2026-10-01T00:00:00Z'), dischargeDate: null };
  describe('getVitals', () => {
    it('🔴 두 원장을 합쳐 최근 순 — 외래 원장은 재원 기간 안만 · 종전 응답 키 recordedAt 유지', async () => {
      mockPrisma.admission.findUnique.mockResolvedValue(ADM);
      mockPrisma.flowSheetEntry.findMany.mockResolvedValue([
        { id: 'fs-1', admissionId: 'adm-1', nurseId: 'n1', systolicBp: 120, recordedAt: new Date('2026-10-05T01:00:00Z') },
      ]);
      mockPrisma.preVisitVitals.findMany.mockResolvedValue([
        { id: 'pv-1', patientId: 'p-1', nurseId: 'n2', systolicBp: 140, measuredAt: new Date('2026-10-06T01:00:00Z') },
      ]);
      const result = await service.getVitals('adm-1');
      expect(result.map((r) => [r.id, r.ledger])).toEqual([['pv-1', 'PREVISIT'], ['fs-1', 'FLOWSHEET']]);
      expect(result[0].recordedAt).toEqual(new Date('2026-10-06T01:00:00Z'));
      expect(mockPrisma.preVisitVitals.findMany.mock.calls[0][0].where.OR[0]).toEqual({ patientId: 'p-1', measuredAt: { gte: ADM.admitDate } });
    });

    it('기록이 없으면 빈 목록', async () => {
      mockPrisma.admission.findUnique.mockResolvedValue(ADM);
      mockPrisma.flowSheetEntry.findMany.mockResolvedValue([]);
      mockPrisma.preVisitVitals.findMany.mockResolvedValue([]);
      expect(await service.getVitals('adm-1')).toEqual([]);
    });

    it('없는 입원은 404', async () => {
      mockPrisma.admission.findUnique.mockResolvedValue(null);
      await expect(service.getVitals('nope')).rejects.toThrow('Admission not found');
    });
  });

  describe('getLatestVitals', () => {
    it('두 원장 중 더 최근 것 · 없으면 null', async () => {
      mockPrisma.admission.findUnique.mockResolvedValue(ADM);
      mockPrisma.flowSheetEntry.findMany.mockResolvedValue([{ id: 'fs-1', admissionId: 'adm-1', nurseId: 'n1', heartRate: 74, recordedAt: new Date('2026-10-07T01:00:00Z') }]);
      mockPrisma.preVisitVitals.findFirst.mockResolvedValue({ id: 'pv-1', patientId: 'p-1', nurseId: 'n2', heartRate: 90, measuredAt: new Date('2026-10-06T01:00:00Z') });
      expect(await service.getLatestVitals('adm-1')).toMatchObject({ id: 'fs-1', ledger: 'FLOWSHEET', heartRate: 74 });
      mockPrisma.flowSheetEntry.findMany.mockResolvedValue([]);
      mockPrisma.preVisitVitals.findFirst.mockResolvedValue(null);
      expect(await service.getLatestVitals('adm-1')).toBeNull();
    });
  });

  describe('getIntakeOutputs', () => {
    it('🔴 두 원장(I/O 원장 + 플로시트 I/O 칸)을 행으로 합쳐 최근 순 · 행마다 ledger(2026-10-10)', async () => {
      mockPrisma.intakeOutput.findMany.mockResolvedValue([{ id: 'io-1', admissionId: 'adm-1', recordedAt: new Date('2026-10-10T01:00:00Z'), intakeType: 'ORAL', intakeAmount: 500, outputType: 'URINE', outputAmount: 400, nurse: null }]);
      mockPrisma.flowSheetEntry.findMany.mockResolvedValue([{ id: 'fs-1', admissionId: 'adm-1', recordedAt: new Date('2026-10-10T03:00:00Z'), intakeOral: null, intakeIv: 250, intakeOther: null, outputUrine: 0, outputDrain: null, outputOther: null, nurse: null }]);
      const result = await service.getIntakeOutputs('adm-1');
      expect(result.map((r) => [r.id, r.ledger, r.intakeAmount, r.outputAmount])).toEqual([
        ['fs:fs-1:outputUrine', 'FLOWSHEET', null, 0], // 🔴 측정한 0 mL 도 행이다
        ['fs:fs-1:intakeIv', 'FLOWSHEET', 250, null],
        ['io-1', 'IO', 500, 400],
      ]);
      expect(mockPrisma.intakeOutput.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ admissionId: { in: ['adm-1'] } }) }));
    });
  });

  describe('getNursingNotes', () => {
    it('should return nursing notes with nurse info', async () => {
      const mockNotes = [
        { id: 'nn-1', noteType: 'SOAP', subjective: '통증 호소', nurse: { familyName: '조', givenName: '간호' } },
      ];
      mockPrisma.nursingNote.findMany.mockResolvedValue(mockNotes);

      const result = await service.getNursingNotes('adm-1');
      expect(result).toEqual(mockNotes);
      expect(result[0].nurse.familyName).toBe('조');
    });
  });

  describe('getMedicationAdministrations', () => {
    it('should return MAR records for admission patient', async () => {
      mockPrisma.admission.findUnique.mockResolvedValue({ patientId: 'p-1' });
      const mockMAR = [{ id: 'mar-1', dose: 'Amlodipine 5mg', status: 'ADMINISTERED' }];
      mockPrisma.medicationAdministration.findMany.mockResolvedValue(mockMAR);

      const result = await service.getMedicationAdministrations('adm-1');
      expect(result).toEqual(mockMAR);
    });

    it('should return empty array if admission not found', async () => {
      mockPrisma.admission.findUnique.mockResolvedValue(null);
      const result = await service.getMedicationAdministrations('adm-none');
      expect(result).toEqual([]);
    });
  });

  describe('getVitalUncheckedPatients', () => {
    it('should return patients without today vitals', async () => {
      mockPrisma.admission.findMany.mockResolvedValue([
        { id: 'adm-1', patientId: 'p-1', admitDate: new Date('2026-10-01T00:00:00Z'), patient: { id: 'p-1', mrn: 'MRN001', familyName: '김', givenName: '영수' }, bed: { roomNumber: '401', bedNumber: 'A' } },
        { id: 'adm-2', patientId: 'p-2', admitDate: new Date('2026-10-01T00:00:00Z'), patient: { id: 'p-2', mrn: 'MRN002', familyName: '이', givenName: '미숙' }, bed: { roomNumber: '402', bedNumber: 'B' } },
        { id: 'adm-3', patientId: 'p-3', admitDate: new Date('2026-10-01T00:00:00Z'), patient: { id: 'p-3', mrn: 'MRN003', familyName: '박', givenName: '셋' }, bed: { roomNumber: '403', bedNumber: 'C' } },
      ]);
      // adm-2 는 플로시트에 오늘 기록 · adm-3 은 간호 스테이션(외래 원장)에 오늘 기록 — 🔴 종전엔 adm-3 이 '미체크'였다
      mockPrisma.flowSheetEntry.findMany.mockResolvedValue([{ id: 'fs-1', admissionId: 'adm-2', nurseId: 'n1', recordedAt: new Date() }]);
      mockPrisma.preVisitVitals.findFirst.mockImplementation(async (a: any) => (a.where.patientId === 'p-3' ? { id: 'pv-1', patientId: 'p-3', nurseId: 'n1', measuredAt: new Date() } : null));

      const result = await service.getVitalUncheckedPatients();
      expect(result).toHaveLength(1);
      expect(result[0].patient?.familyName).toBe('김');
    });
  });

  describe('getUpcomingMedications', () => {
    it('should return scheduled medications for today', async () => {
      const mockMeds = [{ id: 'mar-1', scheduledAt: new Date(), dose: 'Cefazolin 1g', route: 'IV', status: 'SCHEDULED' }];
      mockPrisma.medicationAdministration.findMany.mockResolvedValue(mockMeds);

      const result = await service.getUpcomingMedications();
      expect(result).toEqual(mockMeds);
    });
  });
});
