import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NeurosurgeryService } from '../../src/modules/neurosurgery/neurosurgery.service';

describe('NeurosurgeryService', () => {
  let service: NeurosurgeryService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      // 전문과 '오늘 현황' 정본 = Appointment(2026-08-13 W4)
      appointment: { findMany: vi.fn().mockResolvedValue([]), groupBy: vi.fn().mockResolvedValue([]) },
      neuroExam: {
        findMany: vi.fn(),
        create: vi.fn(),
        count: vi.fn(),
      },
    };
    service = new NeurosurgeryService(mockPrisma);
  });

  /* ───── getPatients ───── */

  describe('getPatients', () => {
    // 2026-10-10 정본 specialtyRecordPatients — 환자별 최근 기록(groupBy) · 상한 · 전체 수(상세는 test/specialty/specialty-review-2026-10-10c)
    it('환자별 최근 기록 · 전체 수 · 잘림 여부', async () => {
      mockPrisma.neuroExam.groupBy = vi.fn().mockResolvedValue([{ patientId: 'p-1', _max: { examinedAt: new Date('2026-05-20') } }]);
      mockPrisma.patient = { findMany: vi.fn().mockResolvedValue([{ id: 'p-1', familyName: '박', givenName: '환자', mrn: 'MRN001' }]) };
      const r = await service.getPatients();
      expect(mockPrisma.neuroExam.groupBy.mock.calls[0][0]).toMatchObject({ by: ['patientId'], orderBy: { _max: { examinedAt: 'desc' } } });
      expect(r).toMatchObject({ total: 1, truncated: false });
      expect(r.items[0]).toMatchObject({ patientId: 'p-1', mrn: 'MRN001', lastDate: new Date('2026-05-20') });
    });
  });

  /* ───── getExams ───── */

  describe('getExams', () => {
    it('should return exams for a patient', async () => {
      const exams = [{ id: 'e-1', gcsTotal: 15, examiner: { familyName: '김', givenName: '의사' } }];
      mockPrisma.neuroExam.findMany.mockResolvedValue(exams);
      const result = await service.getExams('p-1');
      expect(result).toEqual(exams);
      expect(mockPrisma.neuroExam.findMany).toHaveBeenCalledWith({
        where: { patientId: 'p-1' },
        include: { examiner: { select: { familyName: true, givenName: true } } },
        orderBy: { examinedAt: 'desc' },
      });
    });

    it('should return empty array for no exams', async () => {
      mockPrisma.neuroExam.findMany.mockResolvedValue([]);
      const result = await service.getExams('p-none');
      expect(result).toEqual([]);
    });
  });

  /* ───── createExam ───── */

  describe('createExam', () => {
    it('should create a neuro exam with GCS', async () => {
      const input = {
        patientId: 'p-1', gcsEye: 4, gcsVerbal: 5, gcsMotor: 6, gcsTotal: 15,
        examinedBy: 'doc-1',
      };
      mockPrisma.neuroExam.create.mockResolvedValue({ id: 'e-new', ...input });
      const result = await service.createExam(input);
      expect(result.id).toBe('e-new');
    });

    it('should create exam with pupil data', async () => {
      const input = {
        patientId: 'p-1',
        pupilRight: { size: 3, reactive: true },
        pupilLeft: { size: 3, reactive: true },
        anisocoria: false,
        examinedBy: 'doc-1',
      };
      mockPrisma.neuroExam.create.mockResolvedValue({ id: 'e-pupil' });
      await service.createExam(input);
      const callArg = mockPrisma.neuroExam.create.mock.calls[0][0];
      expect(callArg.data.pupilRight).toEqual({ size: 3, reactive: true });
    });

    it('should create exam with NIHSS and ASIA scale', async () => {
      const input = {
        patientId: 'p-1', nihss: 8, asiaScale: 'C',
        diagnosis: 'Spinal cord injury', examinedBy: 'doc-1',
      };
      mockPrisma.neuroExam.create.mockResolvedValue({ id: 'e-asia' });
      await service.createExam(input);
      const callArg = mockPrisma.neuroExam.create.mock.calls[0][0];
      expect(callArg.data.nihss).toBe(8);
      expect(callArg.data.asiaScale).toBe('C');
    });

    it('should include patient in response', async () => {
      const input = { patientId: 'p-1', examinedBy: 'doc-1' };
      mockPrisma.neuroExam.create.mockResolvedValue({ id: 'e-inc' });
      await service.createExam(input);
      expect(mockPrisma.neuroExam.create).toHaveBeenCalledWith(
        expect.objectContaining({
          include: { patient: { select: { familyName: true, givenName: true, mrn: true } } },
        }),
      );
    });
  });

  /* ───── getGcsTrend ───── */

  describe('getGcsTrend', () => {
    it('should return mapped GCS trend data', async () => {
      const exams = [
        { examinedAt: new Date('2026-01-01'), gcsEye: 3, gcsVerbal: 4, gcsMotor: 5, gcsTotal: 12 },
        { examinedAt: new Date('2026-03-01'), gcsEye: 4, gcsVerbal: 5, gcsMotor: 6, gcsTotal: 15 },
      ];
      mockPrisma.neuroExam.findMany.mockResolvedValue(exams);
      const result = await service.getGcsTrend('p-1');
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ date: exams[0].examinedAt, eye: 3, verbal: 4, motor: 5, total: 12 });
      expect(result[1]).toEqual({ date: exams[1].examinedAt, eye: 4, verbal: 5, motor: 6, total: 15 });
    });

    it('should return empty array when no exams', async () => {
      mockPrisma.neuroExam.findMany.mockResolvedValue([]);
      const result = await service.getGcsTrend('p-1');
      expect(result).toEqual([]);
    });

    it('should call findMany with asc order', async () => {
      mockPrisma.neuroExam.findMany.mockResolvedValue([]);
      await service.getGcsTrend('p-1');
      expect(mockPrisma.neuroExam.findMany).toHaveBeenCalledWith({
        where: { patientId: 'p-1' },
        select: { examinedAt: true, gcsEye: true, gcsVerbal: true, gcsMotor: true, gcsTotal: true },
        orderBy: { examinedAt: 'asc' },
      });
    });

    it('should handle null GCS values', async () => {
      mockPrisma.neuroExam.findMany.mockResolvedValue([
        { examinedAt: new Date(), gcsEye: null, gcsVerbal: null, gcsMotor: null, gcsTotal: null },
      ]);
      const result = await service.getGcsTrend('p-1');
      expect(result[0].eye).toBeNull();
      expect(result[0].total).toBeNull();
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
      mockPrisma.neuroExam.count.mockResolvedValue(18);
      const result = await service.getStats();
      expect(result).toMatchObject({ totalExams: 18 });
      // 오늘 값은 리터럴 0 이 아니라 실제 집계에서 온다(표본이 없으면 0 이 사실이다)
      expect(mockPrisma.appointment.groupBy).toHaveBeenCalled();
    });

    it('should return zero when empty', async () => {
      mockPrisma.neuroExam.count.mockResolvedValue(0);
      const result = await service.getStats();
      expect(result.totalExams).toBe(0);
    });
  });
});
