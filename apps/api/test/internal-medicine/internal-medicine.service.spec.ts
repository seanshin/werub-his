import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InternalMedicineService } from '../../src/modules/internal-medicine/internal-medicine.service';

describe('InternalMedicineService', () => {
  let service: InternalMedicineService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      // 전문과 '오늘 현황' 정본 = Appointment(2026-08-13 W4)
      appointment: { findMany: vi.fn().mockResolvedValue([]), groupBy: vi.fn().mockResolvedValue([]) },
      internalMedicineExam: {
        findMany: vi.fn(),
        create: vi.fn(),
        count: vi.fn(),
        groupBy: vi.fn(),
      },
    };
    service = new InternalMedicineService(mockPrisma);
  });

  /* ───── getPatients ───── */

  describe('getPatients', () => {
    // 2026-10-10 정본 specialtyRecordPatients — 환자별 최근 기록(groupBy) · 상한 · 전체 수(상세는 test/specialty/specialty-review-2026-10-10c)
    it('환자별 최근 기록 · 전체 수 · 잘림 여부', async () => {
      mockPrisma.internalMedicineExam.groupBy = vi.fn();
      mockPrisma.internalMedicineExam.groupBy.mockResolvedValueOnce([{ patientId: 'p-1', _max: { examinedAt: new Date('2026-05-20') } }]).mockResolvedValueOnce([{ patientId: 'p-1', subspecialty: 'CARDIOLOGY' }]);
      mockPrisma.patient = { findMany: vi.fn().mockResolvedValue([{ id: 'p-1', familyName: '박', givenName: '환자', mrn: 'MRN001' }]) };
      const r = await service.getPatients();
      expect(mockPrisma.internalMedicineExam.groupBy.mock.calls[0][0]).toMatchObject({ by: ['patientId'], orderBy: { _max: { examinedAt: 'desc' } } });
      expect(r).toMatchObject({ total: 1, truncated: false });
      expect(r.items[0]).toMatchObject({ patientId: 'p-1', mrn: 'MRN001', lastDate: new Date('2026-05-20') }); expect((r.items[0] as any).subspecialties).toEqual(['CARDIOLOGY']);
    });
  });

  /* ───── getExams ───── */

  describe('getExams', () => {
    it('should return all exams for a patient without filter', async () => {
      const exams = [{ id: 'e-1', subspecialty: 'CARDIOLOGY' }];
      mockPrisma.internalMedicineExam.findMany.mockResolvedValue(exams);
      const result = await service.getExams('p-1');
      expect(result).toEqual(exams);
      expect(mockPrisma.internalMedicineExam.findMany).toHaveBeenCalledWith({
        where: { patientId: 'p-1' },
        include: { examiner: { select: { familyName: true, givenName: true } } },
        orderBy: { examinedAt: 'desc' },
      });
    });

    it('should filter by subspecialty when provided', async () => {
      mockPrisma.internalMedicineExam.findMany.mockResolvedValue([]);
      await service.getExams('p-1', 'NEPHROLOGY');
      expect(mockPrisma.internalMedicineExam.findMany).toHaveBeenCalledWith({
        where: { patientId: 'p-1', subspecialty: 'NEPHROLOGY' },
        include: { examiner: { select: { familyName: true, givenName: true } } },
        orderBy: { examinedAt: 'desc' },
      });
    });

    it('should not include subspecialty filter when undefined', async () => {
      mockPrisma.internalMedicineExam.findMany.mockResolvedValue([]);
      await service.getExams('p-1', undefined);
      const callArg = mockPrisma.internalMedicineExam.findMany.mock.calls[0][0];
      expect(callArg.where).toEqual({ patientId: 'p-1' });
    });
  });

  /* ───── createExam ───── */

  describe('createExam', () => {
    it('should create a cardiology exam', async () => {
      const input = {
        patientId: 'p-1', subspecialty: 'CARDIOLOGY',
        nyhaClass: 2, lvef: 55, heartRhythm: 'NSR',
        examinedBy: 'doc-1',
      };
      mockPrisma.internalMedicineExam.create.mockResolvedValue({ id: 'e-new', ...input });
      const result = await service.createExam(input);
      expect(result.id).toBe('e-new');
    });

    it('should create a pulmonology exam', async () => {
      const input = {
        patientId: 'p-1', subspecialty: 'PULMONOLOGY',
        fev1: 2.5, fvc: 3.5, fev1Fvc: 71.4, goldStage: 2,
        examinedBy: 'doc-1',
      };
      mockPrisma.internalMedicineExam.create.mockResolvedValue({ id: 'e-pulm' });
      const result = await service.createExam(input);
      expect(result.id).toBe('e-pulm');
    });

    it('should create a gastroenterology exam', async () => {
      const input = {
        patientId: 'p-1', subspecialty: 'GASTRO',
        childPughScore: 7, childPughClass: 'B', meldScore: 15,
        examinedBy: 'doc-1',
      };
      mockPrisma.internalMedicineExam.create.mockResolvedValue({ id: 'e-gi' });
      const result = await service.createExam(input);
      expect(result.id).toBe('e-gi');
    });

    it('should include patient in response', async () => {
      const input = { patientId: 'p-1', subspecialty: 'ENDOCRINE', examinedBy: 'doc-1' };
      mockPrisma.internalMedicineExam.create.mockResolvedValue({ id: 'e-endo' });
      await service.createExam(input);
      expect(mockPrisma.internalMedicineExam.create).toHaveBeenCalledWith(
        expect.objectContaining({
          include: { patient: { select: { familyName: true, givenName: true, mrn: true } } },
        }),
      );
    });
  });

  /* ───── getToday ───── */

  describe('getToday', () => {
    it('🔴 오늘 예약(Appointment)을 조회한다 — 종전 `return []` 스텁은 영구 공집합이었다(W4)', async () => {
      const result = await service.getToday();
      expect(mockPrisma.appointment.findMany).toHaveBeenCalled();
      const where = mockPrisma.appointment.findMany.mock.calls[0][0].where;
      expect(where.doctor?.department?.in, '전문과↔진료과 매핑이 빠지면 남의 과 예약이 섞인다').toBeTruthy();
      expect(where.scheduledAt, "'오늘'은 상·하한을 모두 갖는다").toBeTruthy();
      expect(result).toEqual([]);
    });
  });

  /* ───── getStats ───── */

  describe('getStats', () => {
    it('should return stats with total and by subspecialty', async () => {
      mockPrisma.internalMedicineExam.count.mockResolvedValue(100);
      mockPrisma.internalMedicineExam.groupBy.mockResolvedValue([
        { subspecialty: 'CARDIOLOGY', _count: 40 },
        { subspecialty: 'GASTRO', _count: 30 },
      ]);
      const result = await service.getStats();
      expect(result.totalExams).toBe(100);
      expect(result.bySubspecialty).toHaveLength(2);
      expect(result.bySubspecialty[0]).toEqual({ subspecialty: 'CARDIOLOGY', count: 40 });
    });

    it('should return zero total when no exams', async () => {
      mockPrisma.internalMedicineExam.count.mockResolvedValue(0);
      mockPrisma.internalMedicineExam.groupBy.mockResolvedValue([]);
      const result = await service.getStats();
      expect(result.totalExams).toBe(0);
      expect(result.bySubspecialty).toEqual([]);
    });
  });

  /* ───── getScoreTrend ───── */

  describe('getScoreTrend', () => {
    it('should return trend data for specific subspecialty', async () => {
      mockPrisma.internalMedicineExam.findMany.mockResolvedValue([]);
      await service.getScoreTrend('p-1', 'CARDIOLOGY');
      expect(mockPrisma.internalMedicineExam.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { patientId: 'p-1', subspecialty: 'CARDIOLOGY' },
          orderBy: { examinedAt: 'asc' },
        }),
      );
    });

    it('should return generic trend when no subspecialty', async () => {
      mockPrisma.internalMedicineExam.findMany.mockResolvedValue([]);
      await service.getScoreTrend('p-1');
      expect(mockPrisma.internalMedicineExam.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { patientId: 'p-1' },
        }),
      );
    });

    it('should return empty array when no data', async () => {
      mockPrisma.internalMedicineExam.findMany.mockResolvedValue([]);
      const result = await service.getScoreTrend('p-1', 'PULMONOLOGY');
      expect(result).toEqual([]);
    });
  });

  /* ───── Score Calculators ───── */

  describe('calculateCha2ds2vasc', () => {
    it('should calculate score correctly: age 75, female, chf, htn, diabetes = 6', () => {
      const result = service.calculateCha2ds2vasc({
        age: 75, female: true, chf: true, hypertension: true,
        stroke: false, vascular: false, diabetes: true,
      });
      expect(result).toBe(6);
    });

    it('should return 0 for no risk factors', () => {
      const result = service.calculateCha2ds2vasc({
        age: 50, female: false, chf: false, hypertension: false,
        stroke: false, vascular: false, diabetes: false,
      });
      expect(result).toBe(0);
    });

    it('should add 2 for stroke history', () => {
      const result = service.calculateCha2ds2vasc({
        age: 50, female: false, chf: false, hypertension: false,
        stroke: true, vascular: false, diabetes: false,
      });
      expect(result).toBe(2);
    });

    it('should add 1 for age 65-74', () => {
      const result = service.calculateCha2ds2vasc({
        age: 70, female: false, chf: false, hypertension: false,
        stroke: false, vascular: false, diabetes: false,
      });
      expect(result).toBe(1);
    });

    it('should add 2 for age >= 75', () => {
      const result = service.calculateCha2ds2vasc({
        age: 80, female: false, chf: false, hypertension: false,
        stroke: false, vascular: false, diabetes: false,
      });
      expect(result).toBe(2);
    });
  });

  describe('calculateCurb65', () => {
    it('should calculate max score of 5', () => {
      const result = service.calculateCurb65({
        confusion: true, urea: 8, respiratoryRate: 32,
        systolicBp: 85, diastolicBp: 50, age: 70,
      });
      expect(result).toBe(5);
    });

    it('should return 0 for no criteria met', () => {
      const result = service.calculateCurb65({
        confusion: false, urea: 5, respiratoryRate: 18,
        systolicBp: 120, diastolicBp: 80, age: 50,
      });
      expect(result).toBe(0);
    });

    it('should add 1 for urea > 7', () => {
      const result = service.calculateCurb65({
        confusion: false, urea: 8, respiratoryRate: 18,
        systolicBp: 120, diastolicBp: 80, age: 50,
      });
      expect(result).toBe(1);
    });

    it('should add 1 for diastolic <= 60', () => {
      const result = service.calculateCurb65({
        confusion: false, urea: 5, respiratoryRate: 18,
        systolicBp: 120, diastolicBp: 60, age: 50,
      });
      expect(result).toBe(1);
    });
  });

  describe('calculateChildPugh', () => {
    it('should calculate class B with expected input', () => {
      const result = service.calculateChildPugh({
        bilirubin: 3.5, albumin: 2.5, inr: 2.0,
        ascites: 'MODERATE', encephalopathy: 'MILD',
      });
      // bilirubin 3.5 -> 3, albumin 2.5 -> 3, inr 2.0 -> 2, ascites MODERATE -> 3, encephalopathy MILD -> 3
      // Non-standard values: MILD is not NONE or GRADE_1_2, so it gets 3
      // MODERATE is not NONE or MILD, so it gets 3
      // Total: 3+3+2+3+3 = 14 -> class C
      expect(result.score).toBeGreaterThanOrEqual(9);
      expect(['B', 'C']).toContain(result.class);
    });

    it('should return class A for good liver function', () => {
      const result = service.calculateChildPugh({
        bilirubin: 1.5, albumin: 4.0, inr: 1.2,
        ascites: 'NONE', encephalopathy: 'NONE',
      });
      expect(result.score).toBe(5);
      expect(result.class).toBe('A');
    });

    it('should return class C for severe liver disease', () => {
      const result = service.calculateChildPugh({
        bilirubin: 5.0, albumin: 2.0, inr: 3.0,
        ascites: 'SEVERE', encephalopathy: 'GRADE_3_4',
      });
      expect(result.score).toBe(15);
      expect(result.class).toBe('C');
    });

    it('should return class B for intermediate scores (7-9)', () => {
      const result = service.calculateChildPugh({
        bilirubin: 2.5, albumin: 3.0, inr: 1.8,
        ascites: 'MILD', encephalopathy: 'NONE',
      });
      // bilirubin 2-3 -> 2, albumin 2.8-3.5 -> 2, inr 1.7-2.3 -> 2, ascites MILD -> 2, encephalopathy NONE -> 1
      expect(result.score).toBe(9);
      expect(result.class).toBe('B');
    });
  });

  describe('calculateMeld', () => {
    it('should calculate MELD score', () => {
      const result = service.calculateMeld({
        bilirubin: 2.0, creatinine: 1.5, inr: 1.5,
      });
      expect(result).toBeGreaterThanOrEqual(6);
      expect(result).toBeLessThanOrEqual(40);
    });

    it('should clamp minimum values to 1', () => {
      const result = service.calculateMeld({
        bilirubin: 0.5, creatinine: 0.5, inr: 0.8,
      });
      expect(result).toBeGreaterThanOrEqual(6);
    });

    it('should cap creatinine at 4', () => {
      const result = service.calculateMeld({
        bilirubin: 1.0, creatinine: 10.0, inr: 1.0,
      });
      const resultCapped = service.calculateMeld({
        bilirubin: 1.0, creatinine: 4.0, inr: 1.0,
      });
      expect(result).toBe(resultCapped);
    });

    it('should apply MELD-Na correction when sodium provided', () => {
      const meld = service.calculateMeld({ bilirubin: 2.0, creatinine: 1.5, inr: 1.5 });
      const meldNa = service.calculateMeld({ bilirubin: 2.0, creatinine: 1.5, inr: 1.5, sodium: 130 });
      expect(meldNa).not.toBe(meld);
    });
  });

  describe('calculateEgfr', () => {
    it('should calculate eGFR for male patient', () => {
      const result = service.calculateEgfr({ creatinine: 1.2, age: 60, female: false });
      expect(result).toBeGreaterThan(60);
      expect(result).toBeLessThan(80);
    });

    it('should return higher eGFR for lower creatinine', () => {
      const low = service.calculateEgfr({ creatinine: 0.8, age: 40, female: false });
      const high = service.calculateEgfr({ creatinine: 2.0, age: 40, female: false });
      expect(low).toBeGreaterThan(high);
    });

    it('should apply female factor', () => {
      const male = service.calculateEgfr({ creatinine: 1.0, age: 50, female: false });
      const female = service.calculateEgfr({ creatinine: 1.0, age: 50, female: true });
      expect(female).not.toBe(male);
    });

    it('should decrease with age', () => {
      const young = service.calculateEgfr({ creatinine: 1.0, age: 30, female: false });
      const old = service.calculateEgfr({ creatinine: 1.0, age: 70, female: false });
      expect(young).toBeGreaterThan(old);
    });
  });

  describe('calculateQsofa', () => {
    it('should return 3 for all criteria met', () => {
      const result = service.calculateQsofa({
        mentalStatus: true, respiratoryRate: 25, systolicBp: 90,
      });
      expect(result).toBe(3);
    });

    it('should return 0 for no criteria met', () => {
      const result = service.calculateQsofa({
        mentalStatus: false, respiratoryRate: 18, systolicBp: 120,
      });
      expect(result).toBe(0);
    });

    it('should add 1 for respiratory rate >= 22', () => {
      const result = service.calculateQsofa({
        mentalStatus: false, respiratoryRate: 22, systolicBp: 120,
      });
      expect(result).toBe(1);
    });

    it('should add 1 for systolic BP <= 100', () => {
      const result = service.calculateQsofa({
        mentalStatus: false, respiratoryRate: 18, systolicBp: 100,
      });
      expect(result).toBe(1);
    });
  });

  describe('calculateDas28', () => {
    it('should calculate DAS28 score', () => {
      const result = service.calculateDas28({
        tenderJoints: 5, swollenJoints: 3, esr: 30, patientGlobalVas: 50,
      });
      expect(result).toBeGreaterThan(0);
      expect(typeof result).toBe('number');
    });

    it('should return higher score for more active disease', () => {
      const mild = service.calculateDas28({
        tenderJoints: 1, swollenJoints: 0, esr: 10, patientGlobalVas: 10,
      });
      const severe = service.calculateDas28({
        tenderJoints: 20, swollenJoints: 15, esr: 80, patientGlobalVas: 80,
      });
      expect(severe).toBeGreaterThan(mild);
    });

    it('should round to 2 decimal places', () => {
      const result = service.calculateDas28({
        tenderJoints: 5, swollenJoints: 3, esr: 30, patientGlobalVas: 50,
      });
      const decimalPlaces = result.toString().split('.')[1]?.length || 0;
      expect(decimalPlaces).toBeLessThanOrEqual(2);
    });
  });

  describe('getEcogDescription', () => {
    it('should return description for score 0', () => {
      const desc = service.getEcogDescription(0);
      expect(desc).toContain('완전히 활동적');
    });

    it('should return description for score 4', () => {
      const desc = service.getEcogDescription(4);
      expect(desc).toContain('전혀 활동 불가');
    });

    it('should return invalid message for unknown score', () => {
      const desc = service.getEcogDescription(5);
      expect(desc).toContain('유효하지 않은');
    });
  });

  /* ───── calculate (router) ───── */

  describe('calculate', () => {
    it('should route cha2ds2vasc calculation', async () => {
      const result = await service.calculate('cha2ds2vasc', {
        age: 75, female: true, chf: true, hypertension: true,
        stroke: false, vascular: false, diabetes: true,
      });
      expect(result.score).toBe(6);
      expect(result.interpretation).toContain('고위험');
    });

    it('should route curb65 calculation', async () => {
      const result = await service.calculate('curb65', {
        confusion: false, urea: 5, respiratoryRate: 18,
        systolicBp: 120, diastolicBp: 80, age: 50,
      });
      expect(result.score).toBe(0);
      expect(result.interpretation).toContain('외래');
    });

    it('should route child-pugh calculation', async () => {
      const result = await service.calculate('child-pugh', {
        bilirubin: 1.5, albumin: 4.0, inr: 1.2,
        ascites: 'NONE', encephalopathy: 'NONE',
      });
      expect(result.score).toBe(5);
      expect(result.class).toBe('A');
    });

    it('should route meld calculation', async () => {
      const result = await service.calculate('meld', {
        bilirubin: 2.0, creatinine: 1.5, inr: 1.5,
      });
      expect(result.score).toBeGreaterThanOrEqual(6);
    });

    it('should route egfr calculation', async () => {
      const result = await service.calculate('egfr', {
        creatinine: 1.2, age: 60, female: false,
      });
      expect(result.score).toBeGreaterThan(0);
    });

    it('should route qsofa calculation', async () => {
      const result = await service.calculate('qsofa', {
        mentalStatus: true, respiratoryRate: 25, systolicBp: 90,
      });
      expect(result.score).toBe(3);
    });

    it('should route das28 calculation', async () => {
      const result = await service.calculate('das28', {
        tenderJoints: 5, swollenJoints: 3, esr: 30, patientGlobalVas: 50,
      });
      expect(result.score).toBeGreaterThan(0);
    });

    it('should route ecog calculation', async () => {
      const result = await service.calculate('ecog', { score: 2 });
      expect(result.score).toBe(2);
      expect(result.interpretation).toContain('자가 관리 가능');
    });

    it('should throw BadRequestException for unknown calculator', async () => {
      await expect(service.calculate('unknown', {})).rejects.toThrow();
    });
  });
});
