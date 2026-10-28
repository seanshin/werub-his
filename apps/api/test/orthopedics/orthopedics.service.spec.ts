import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OrthopedicsService } from '../../src/modules/orthopedics/orthopedics.service';

describe('OrthopedicsService', () => {
  let service: OrthopedicsService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      // 전문과 '오늘 현황' 정본 = Appointment(2026-08-13 W4)
      appointment: { findMany: vi.fn().mockResolvedValue([]), groupBy: vi.fn().mockResolvedValue([]) },
      orthoExam: {
        findMany: vi.fn(),
        create: vi.fn(),
        count: vi.fn(),
      },
    };
    service = new OrthopedicsService(mockPrisma);
  });

  /* ───── getPatients ───── */

  describe('getPatients', () => {
    // 2026-10-10 정본 specialtyRecordPatients — 환자별 최근 기록(groupBy) · 상한 · 전체 수(상세는 test/specialty/specialty-review-2026-10-10c)
    it('환자별 최근 기록 · 전체 수 · 잘림 여부', async () => {
      mockPrisma.orthoExam.groupBy = vi.fn().mockResolvedValue([{ patientId: 'p-1', _max: { examinedAt: new Date('2026-05-20') } }]);
      mockPrisma.patient = { findMany: vi.fn().mockResolvedValue([{ id: 'p-1', familyName: '박', givenName: '환자', mrn: 'MRN001' }]) };
      const r = await service.getPatients();
      expect(mockPrisma.orthoExam.groupBy.mock.calls[0][0]).toMatchObject({ by: ['patientId'], orderBy: { _max: { examinedAt: 'desc' } } });
      expect(r).toMatchObject({ total: 1, truncated: false });
      expect(r.items[0]).toMatchObject({ patientId: 'p-1', mrn: 'MRN001', lastDate: new Date('2026-05-20') });
    });
  });

  /* ───── getExams ───── */

  describe('getExams', () => {
    it('should return exams for a patient', async () => {
      const exams = [
        { id: 'e-1', patientId: 'p-1', bodyPart: 'Knee', examiner: { familyName: '김', givenName: '의사' } },
      ];
      mockPrisma.orthoExam.findMany.mockResolvedValue(exams);

      const result = await service.getExams('p-1');
      expect(result).toEqual(exams);
      expect(mockPrisma.orthoExam.findMany).toHaveBeenCalledWith({
        where: { patientId: 'p-1' },
        include: { examiner: { select: { familyName: true, givenName: true } } },
        orderBy: { examinedAt: 'desc' },
      });
    });

    it('should return empty array when patient has no exams', async () => {
      mockPrisma.orthoExam.findMany.mockResolvedValue([]);
      const result = await service.getExams('nonexistent');
      expect(result).toEqual([]);
    });

    it('should return multiple exams ordered by date desc', async () => {
      const exams = [
        { id: 'e-2', patientId: 'p-1', examinedAt: new Date('2026-05-20') },
        { id: 'e-1', patientId: 'p-1', examinedAt: new Date('2026-05-19') },
      ];
      mockPrisma.orthoExam.findMany.mockResolvedValue(exams);
      const result = await service.getExams('p-1');
      expect(result).toHaveLength(2);
    });
  });

  /* ───── createExam ───── */

  describe('createExam', () => {
    it('should create exam with required fields', async () => {
      const input = { patientId: 'p-1', bodyPart: 'Knee', examinedBy: 'doc-1' };
      const created = { id: 'e-new', ...input, patient: { familyName: '김', givenName: '환자', mrn: 'MRN001' } };
      mockPrisma.orthoExam.create.mockResolvedValue(created);

      const result = await service.createExam(input);
      expect(result.id).toBe('e-new');
      expect(mockPrisma.orthoExam.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          patientId: 'p-1',
          bodyPart: 'Knee',
          examinedBy: 'doc-1',
        }),
        include: { patient: { select: { familyName: true, givenName: true, mrn: true } } },
      });
    });

    it('should create exam with all optional fields', async () => {
      const input = {
        patientId: 'p-1', encounterId: 'enc-1', bodyPart: 'Shoulder', side: 'LEFT',
        diagnosis: 'Rotator cuff tear', plan: 'Surgery', rom: { flexion: 120 },
        mmt: { grade: 4 }, specialTests: { neer: true }, imagingFindings: { xray: 'normal' },
        fractureClass: 'AO-A1', painVas: 7, painLocation: 'anterior',
        painPattern: 'constant', examinedBy: 'doc-1',
      };
      const created = { id: 'e-full', ...input };
      mockPrisma.orthoExam.create.mockResolvedValue(created);

      const result = await service.createExam(input);
      expect(result.id).toBe('e-full');
    });

    it('should pass rom and mmt as JSON data', async () => {
      const input = {
        patientId: 'p-1', bodyPart: 'Hip',
        rom: { flexion: 90, extension: 10 },
        mmt: { hip_flexion: 5 },
        examinedBy: 'doc-1',
      };
      mockPrisma.orthoExam.create.mockResolvedValue({ id: 'e-json', ...input });
      await service.createExam(input);
      const callArg = mockPrisma.orthoExam.create.mock.calls[0][0];
      expect(callArg.data.rom).toEqual({ flexion: 90, extension: 10 });
      expect(callArg.data.mmt).toEqual({ hip_flexion: 5 });
    });

    it('should handle undefined optional fields gracefully', async () => {
      const input = { patientId: 'p-1', bodyPart: 'Ankle', examinedBy: 'doc-1' };
      mockPrisma.orthoExam.create.mockResolvedValue({ id: 'e-min', ...input });
      await service.createExam(input);
      const callArg = mockPrisma.orthoExam.create.mock.calls[0][0];
      expect(callArg.data.side).toBeUndefined();
      expect(callArg.data.diagnosis).toBeUndefined();
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
    it('should return stats with total exam count', async () => {
      mockPrisma.orthoExam.count.mockResolvedValue(42);
      const result = await service.getStats();
      expect(result).toEqual({
        totalExams: 42,
        todayAppointments: 0,
        completed: 0,
        inProgress: 0,
        waiting: 0,
        // 🔴 2026-08-26 — 노쇼는 총계에는 들어가는데 완료·진행·대기 어디에도 없어 화면이
        //    "예약 1 / 나머지 0" 을 그렸다. 정본 SpecialtyTodayStats 에 칸을 추가(4칸 합 + 노쇼 = 총계).
        noShow: 0,
      });
    });

    it('should return zero total when no exams exist', async () => {
      mockPrisma.orthoExam.count.mockResolvedValue(0);
      const result = await service.getStats();
      expect(result.totalExams).toBe(0);
    });

    it('should call prisma count', async () => {
      mockPrisma.orthoExam.count.mockResolvedValue(10);
      await service.getStats();
      expect(mockPrisma.orthoExam.count).toHaveBeenCalled();
    });
  });
});
