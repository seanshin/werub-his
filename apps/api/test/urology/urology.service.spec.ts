import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UrologyService } from '../../src/modules/urology/urology.service';

describe('UrologyService', () => {
  let service: UrologyService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      // 전문과 '오늘 현황' 정본 = Appointment(2026-08-13 W4)
      appointment: { findMany: vi.fn().mockResolvedValue([]), groupBy: vi.fn().mockResolvedValue([]) },
      urologyExam: {
        findMany: vi.fn(),
        create: vi.fn(),
        count: vi.fn(),
      },
    };
    service = new UrologyService(mockPrisma);
  });

  /* ───── getPatients ───── */

  describe('getPatients', () => {
    // 2026-10-10 정본 specialtyRecordPatients — 환자별 최근 기록(groupBy) · 상한 · 전체 수(상세는 test/specialty/specialty-review-2026-10-10c)
    it('환자별 최근 기록 · 전체 수 · 잘림 여부', async () => {
      mockPrisma.urologyExam.groupBy = vi.fn().mockResolvedValue([{ patientId: 'p-1', _max: { examinedAt: new Date('2026-05-20') } }]);
      mockPrisma.patient = { findMany: vi.fn().mockResolvedValue([{ id: 'p-1', familyName: '박', givenName: '환자', mrn: 'MRN001' }]) };
      const r = await service.getPatients();
      expect(mockPrisma.urologyExam.groupBy.mock.calls[0][0]).toMatchObject({ by: ['patientId'], orderBy: { _max: { examinedAt: 'desc' } } });
      expect(r).toMatchObject({ total: 1, truncated: false });
      expect(r.items[0]).toMatchObject({ patientId: 'p-1', mrn: 'MRN001', lastDate: new Date('2026-05-20') });
    });
  });

  /* ───── getExams ───── */

  describe('getExams', () => {
    it('should return exams for a patient', async () => {
      const exams = [{ id: 'e-1', ipssScore: 15, psaValue: 4.5 }];
      mockPrisma.urologyExam.findMany.mockResolvedValue(exams);
      const result = await service.getExams('p-1');
      // PSA 밀도(2026-10-10) — 용적이 없으면 null + 이유
      expect(result).toEqual(exams.map((e) => ({ ...e, psaDensity: null, psaDensityUnavailable: 'NO_VOLUME' })));
      expect(mockPrisma.urologyExam.findMany).toHaveBeenCalledWith({
        where: { patientId: 'p-1' },
        include: { examiner: { select: { familyName: true, givenName: true } } },
        orderBy: { examinedAt: 'desc' },
      });
    });

    it('should return empty array for no exams', async () => {
      mockPrisma.urologyExam.findMany.mockResolvedValue([]);
      const result = await service.getExams('p-none');
      expect(result).toEqual([]);
    });
  });

  /* ───── createExam ───── */

  describe('createExam', () => {
    it('should create a urology exam with IPSS and PSA', async () => {
      const input = {
        patientId: 'p-1', ipssScore: 20, ipssQol: 4, psaValue: 6.2,
        prostateVolume: 45, examinedBy: 'doc-1',
      };
      mockPrisma.urologyExam.create.mockResolvedValue({ id: 'e-new', ...input });
      const result = await service.createExam(input);
      expect(result.id).toBe('e-new');
    });

    it('should create exam with urodynamics data', async () => {
      const input = {
        patientId: 'p-1',
        urodynamics: { maxFlow: 12, residual: 50 },
        examinedBy: 'doc-1',
      };
      mockPrisma.urologyExam.create.mockResolvedValue({ id: 'e-uro' });
      await service.createExam(input);
      const callArg = mockPrisma.urologyExam.create.mock.calls[0][0];
      expect(callArg.data.urodynamics).toEqual({ maxFlow: 12, residual: 50 });
    });

    it('should create exam with minimal fields', async () => {
      const input = { patientId: 'p-1', examinedBy: 'doc-1' };
      mockPrisma.urologyExam.create.mockResolvedValue({ id: 'e-min' });
      await service.createExam(input);
      const callArg = mockPrisma.urologyExam.create.mock.calls[0][0];
      expect(callArg.data.patientId).toBe('p-1');
      expect(callArg.data.examinedBy).toBe('doc-1');
    });

    it('should include patient in response', async () => {
      const input = { patientId: 'p-1', examinedBy: 'doc-1' };
      mockPrisma.urologyExam.create.mockResolvedValue({ id: 'e-inc' });
      await service.createExam(input);
      expect(mockPrisma.urologyExam.create).toHaveBeenCalledWith(
        expect.objectContaining({
          include: { patient: { select: { familyName: true, givenName: true, mrn: true } } },
        }),
      );
    });
  });

  /* ───── getPsaTrend ───── */

  describe('getPsaTrend', () => {
    it('should return PSA trend data', async () => {
      const exams = [
        { examinedAt: new Date('2026-01-01'), psaValue: 3.5 },
        { examinedAt: new Date('2026-04-01'), psaValue: 4.2 },
      ];
      mockPrisma.urologyExam.findMany.mockResolvedValue(exams);
      const result = await service.getPsaTrend('p-1');
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ date: exams[0].examinedAt, psa: 3.5, psaDensity: null });
      expect(result[1]).toEqual({ date: exams[1].examinedAt, psa: 4.2, psaDensity: null });
    });

    it('should filter by non-null PSA values', async () => {
      mockPrisma.urologyExam.findMany.mockResolvedValue([]);
      await service.getPsaTrend('p-1');
      expect(mockPrisma.urologyExam.findMany).toHaveBeenCalledWith({
        where: { patientId: 'p-1', psaValue: { not: null } },
        select: { examinedAt: true, psaValue: true, prostateVolume: true },
        orderBy: { examinedAt: 'asc' },
      });
    });

    it('should return empty array when no PSA data', async () => {
      mockPrisma.urologyExam.findMany.mockResolvedValue([]);
      const result = await service.getPsaTrend('p-1');
      expect(result).toEqual([]);
    });
  });

  /* ───── getIpssTrend ───── */

  describe('getIpssTrend', () => {
    it('should return IPSS trend data', async () => {
      const exams = [
        { examinedAt: new Date('2026-01-01'), ipssScore: 20 },
        { examinedAt: new Date('2026-04-01'), ipssScore: 15 },
      ];
      mockPrisma.urologyExam.findMany.mockResolvedValue(exams);
      const result = await service.getIpssTrend('p-1');
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ date: exams[0].examinedAt, ipss: 20 });
      expect(result[1]).toEqual({ date: exams[1].examinedAt, ipss: 15 });
    });

    it('should filter by non-null IPSS scores', async () => {
      mockPrisma.urologyExam.findMany.mockResolvedValue([]);
      await service.getIpssTrend('p-1');
      expect(mockPrisma.urologyExam.findMany).toHaveBeenCalledWith({
        where: { patientId: 'p-1', ipssScore: { not: null } },
        select: { examinedAt: true, ipssScore: true },
        orderBy: { examinedAt: 'asc' },
      });
    });

    it('should return empty array when no IPSS data', async () => {
      mockPrisma.urologyExam.findMany.mockResolvedValue([]);
      const result = await service.getIpssTrend('p-1');
      expect(result).toEqual([]);
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
    it('should return stats with total count', async () => {
      mockPrisma.urologyExam.count.mockResolvedValue(35);
      const result = await service.getStats();
      expect(result).toMatchObject({ totalExams: 35 });
      // 오늘 값은 리터럴 0 이 아니라 실제 집계에서 온다(표본이 없으면 0 이 사실이다)
      expect(mockPrisma.appointment.groupBy).toHaveBeenCalled();
    });

    it('should return zero when empty', async () => {
      mockPrisma.urologyExam.count.mockResolvedValue(0);
      const result = await service.getStats();
      expect(result.totalExams).toBe(0);
    });
  });

  describe('procedures (시술 모듈 신설)', () => {
    it('createProcedure persists', async () => {
      mockPrisma.urologyProcedure = {
        create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'up-1', ...data })),
        findMany: vi.fn().mockResolvedValue([]),
      };
      const r: any = await service.createProcedure({
        patientId: 'p-1', procedureType: 'CYSTOSCOPY', indication: '혈뇨', specimenTaken: false, performedBy: 'doc-1',
      });
      expect(r.id).toBe('up-1');
      expect(mockPrisma.urologyProcedure.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ procedureType: 'CYSTOSCOPY', performedBy: 'doc-1' }) }),
      );
    });
  });
});
