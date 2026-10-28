import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PediatricsService } from '../../src/modules/pediatrics/pediatrics.service';

describe('PediatricsService', () => {
  let service: PediatricsService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      // 전문과 '오늘 현황' 정본 = Appointment(2026-08-13 W4)
      appointment: { findMany: vi.fn().mockResolvedValue([]), groupBy: vi.fn().mockResolvedValue([]) },
      pediatricGrowth: { findMany: vi.fn(), create: vi.fn(), count: vi.fn() },
      // 월령 대조(2026-10-10) — 생년월일 없음이면 입력 월령 그대로
      patient: { findUnique: vi.fn().mockResolvedValue({ dateOfBirth: null }) },
      pediatricImmunization: { findMany: vi.fn(), create: vi.fn(), count: vi.fn(), findFirst: vi.fn().mockResolvedValue(null) },
      developmentalAssessment: { findMany: vi.fn(), create: vi.fn(), count: vi.fn() },
    };
    service = new PediatricsService(mockPrisma);
  });

  /* ───── getPatients ───── */

  describe('getPatients', () => {
    // 2026-10-10 정본 specialtyRecordPatients — 환자별 최근 기록(groupBy) · 상한 · 전체 수(상세는 test/specialty/specialty-review-2026-10-10c)
    it('환자별 최근 기록 · 전체 수 · 잘림 여부', async () => {
      mockPrisma.pediatricGrowth.groupBy = vi.fn().mockResolvedValue([{ patientId: 'p-1', _max: { measuredAt: new Date('2026-05-20') } }]);
      mockPrisma.patient = { findMany: vi.fn().mockResolvedValue([{ id: 'p-1', familyName: '박', givenName: '환자', mrn: 'MRN001' }]) };
      const r = await service.getPatients();
      expect(mockPrisma.pediatricGrowth.groupBy.mock.calls[0][0]).toMatchObject({ by: ['patientId'], orderBy: { _max: { measuredAt: 'desc' } } });
      expect(r).toMatchObject({ total: 1, truncated: false });
      expect(r.items[0]).toMatchObject({ patientId: 'p-1', mrn: 'MRN001', lastDate: new Date('2026-05-20') });
    });
  });

  /* ───── getGrowth ───── */

  describe('getGrowth', () => {
    it('should return growth records for a patient', async () => {
      const data = [{ id: 'g-1', patientId: 'p-1', height: 75, weight: 9.5 }];
      mockPrisma.pediatricGrowth.findMany.mockResolvedValue(data);
      const result = await service.getGrowth('p-1');
      // 백분위 근거(2026-10-10) — 백분위가 없으면 null
      expect(result).toEqual(data.map((d) => ({ ...d, percentileBasis: null })));
      expect(mockPrisma.pediatricGrowth.findMany).toHaveBeenCalledWith({
        where: { patientId: 'p-1' },
        include: {
          measurer: { select: { familyName: true, givenName: true } },
          // 🔴 성별을 함께 준다 — 성장곡선 백분위 참조선은 성별로 다르고, 종전엔 화면이 `gender="male"`
          //    을 하드코딩해 **여아도 남아 곡선** 위에 그려졌다(2026-08-26). 민감 식별자는 담지 않는다.
          patient: { select: { gender: true } },
        },
        orderBy: { measuredAt: 'desc' },
      });
    });

    it('🔴 성별 외의 환자 필드를 응답에 싣지 않는다 — 성장곡선에 필요한 최소 항목만', async () => {
      mockPrisma.pediatricGrowth.findMany.mockResolvedValue([]);
      await service.getGrowth('p-1');
      const call = mockPrisma.pediatricGrowth.findMany.mock.calls.at(-1)?.[0] as
        | { include?: { patient?: { select?: Record<string, unknown> } } }
        | undefined;
      expect(Object.keys(call?.include?.patient?.select ?? {})).toEqual(['gender']);
    });

    it('should return empty array for patient with no growth data', async () => {
      mockPrisma.pediatricGrowth.findMany.mockResolvedValue([]);
      const result = await service.getGrowth('p-none');
      expect(result).toEqual([]);
    });
  });

  /* ───── createGrowth ───── */

  describe('createGrowth', () => {
    it('should create a growth record with required fields', async () => {
      const input = { patientId: 'p-1', ageMonths: 12, measuredBy: 'doc-1' };
      mockPrisma.pediatricGrowth.create.mockResolvedValue({ id: 'g-new', ...input });
      const result = await service.createGrowth(input);
      expect(result.id).toBe('g-new');
    });

    it('should create growth with all measurements', async () => {
      // 백분위는 입력받지 않는다(2026-10-10 · 기준표 미등록 — growth-percentile-honesty.spec)
      const input = {
        patientId: 'p-1', ageMonths: 24,
        height: 85, weight: 12, headCirc: 48,
        bmi: 16.5, measuredBy: 'doc-1',
      };
      mockPrisma.pediatricGrowth.create.mockResolvedValue({ id: 'g-full', ...input });
      const result = await service.createGrowth(input);
      expect(result.id).toBe('g-full');
    });

    it('should include patient in response', async () => {
      const input = { patientId: 'p-1', ageMonths: 6, measuredBy: 'doc-1' };
      mockPrisma.pediatricGrowth.create.mockResolvedValue({ id: 'g-2' });
      await service.createGrowth(input);
      expect(mockPrisma.pediatricGrowth.create).toHaveBeenCalledWith(
        expect.objectContaining({
          include: { patient: { select: { familyName: true, givenName: true, mrn: true } } },
        }),
      );
    });
  });

  /* ───── getImmunizations ───── */

  describe('getImmunizations', () => {
    it('should return immunization records for a patient', async () => {
      const data = [{ id: 'i-1', vaccineName: 'DTaP' }];
      mockPrisma.pediatricImmunization.findMany.mockResolvedValue(data);
      const result = await service.getImmunizations('p-1');
      expect(result).toEqual(data);
      expect(mockPrisma.pediatricImmunization.findMany).toHaveBeenCalledWith({
        where: { patientId: 'p-1' },
        include: { giver: { select: { familyName: true, givenName: true } } },
        orderBy: { givenAt: 'desc' },
      });
    });

    it('should return empty array for patient with no immunizations', async () => {
      mockPrisma.pediatricImmunization.findMany.mockResolvedValue([]);
      const result = await service.getImmunizations('p-none');
      expect(result).toEqual([]);
    });
  });

  /* ───── createImmunization ───── */

  describe('createImmunization', () => {
    it('should create immunization with required fields', async () => {
      const input = { patientId: 'p-1', vaccineName: 'MMR', doseNumber: 1, givenBy: 'doc-1' };
      mockPrisma.pediatricImmunization.create.mockResolvedValue({ id: 'i-new', ...input });
      const result = await service.createImmunization(input);
      expect(result.id).toBe('i-new');
    });

    it('should convert givenAt string to Date', async () => {
      const input = { patientId: 'p-1', vaccineName: 'BCG', doseNumber: 1, givenAt: '2026-05-20', givenBy: 'doc-1' };
      mockPrisma.pediatricImmunization.create.mockResolvedValue({ id: 'i-2' });
      await service.createImmunization(input);
      const callArg = mockPrisma.pediatricImmunization.create.mock.calls[0][0];
      expect(callArg.data.givenAt).toBeInstanceOf(Date);
    });

    it('should use current date when givenAt not provided', async () => {
      const input = { patientId: 'p-1', vaccineName: 'HepB', doseNumber: 2, givenBy: 'doc-1' };
      mockPrisma.pediatricImmunization.create.mockResolvedValue({ id: 'i-3' });
      await service.createImmunization(input);
      const callArg = mockPrisma.pediatricImmunization.create.mock.calls[0][0];
      expect(callArg.data.givenAt).toBeInstanceOf(Date);
    });

    it('should convert nextDueDate string to Date', async () => {
      const input = { patientId: 'p-1', vaccineName: 'IPV', doseNumber: 1, nextDueDate: '2026-07-20', givenBy: 'doc-1' };
      mockPrisma.pediatricImmunization.create.mockResolvedValue({ id: 'i-4' });
      await service.createImmunization(input);
      const callArg = mockPrisma.pediatricImmunization.create.mock.calls[0][0];
      expect(callArg.data.nextDueDate).toBeInstanceOf(Date);
    });
  });

  /* ───── getDevelopmental ───── */

  describe('getDevelopmental', () => {
    it('should return developmental assessments', async () => {
      const data = [{ id: 'd-1', tool: 'K-DST' }];
      mockPrisma.developmentalAssessment.findMany.mockResolvedValue(data);
      const result = await service.getDevelopmental('p-1');
      expect(result).toEqual(data);
      expect(mockPrisma.developmentalAssessment.findMany).toHaveBeenCalledWith({
        where: { patientId: 'p-1' },
        include: { assessor: { select: { familyName: true, givenName: true } } },
        orderBy: { assessedAt: 'desc' },
      });
    });
  });

  /* ───── createDevelopmental ───── */

  describe('createDevelopmental', () => {
    it('should create developmental assessment', async () => {
      const input = {
        patientId: 'p-1', ageMonths: 18, tool: 'K-DST',
        grossMotor: 'NORMAL', fineMotor: 'NORMAL',
        language: 'NORMAL', socialPersonal: 'NORMAL',
        overallResult: 'NORMAL', assessedBy: 'doc-1',
      };
      mockPrisma.developmentalAssessment.create.mockResolvedValue({ id: 'd-new', ...input });
      const result = await service.createDevelopmental(input);
      expect(result.id).toBe('d-new');
    });

    it('should pass details as JSON', async () => {
      const input = {
        patientId: 'p-1', ageMonths: 24, tool: 'Denver',
        grossMotor: 'DELAY', fineMotor: 'NORMAL',
        language: 'NORMAL', socialPersonal: 'NORMAL',
        overallResult: 'SUSPECT', details: { notes: 'follow up needed' },
        assessedBy: 'doc-1',
      };
      mockPrisma.developmentalAssessment.create.mockResolvedValue({ id: 'd-2' });
      await service.createDevelopmental(input);
      const callArg = mockPrisma.developmentalAssessment.create.mock.calls[0][0];
      expect(callArg.data.details).toEqual({ notes: 'follow up needed' });
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
    it('should return combined stats from all three models', async () => {
      mockPrisma.pediatricGrowth.count.mockResolvedValue(10);
      mockPrisma.pediatricImmunization.count.mockResolvedValue(20);
      mockPrisma.developmentalAssessment.count.mockResolvedValue(5);

      const result = await service.getStats();
      expect(result.totalExams).toBe(35);
      expect(result.totalGrowth).toBe(10);
      expect(result.totalImmunizations).toBe(20);
      expect(result.totalAssessments).toBe(5);
    });

    it('should return zero totals when all empty', async () => {
      mockPrisma.pediatricGrowth.count.mockResolvedValue(0);
      mockPrisma.pediatricImmunization.count.mockResolvedValue(0);
      mockPrisma.developmentalAssessment.count.mockResolvedValue(0);

      const result = await service.getStats();
      expect(result.totalExams).toBe(0);
    });
  });
});
