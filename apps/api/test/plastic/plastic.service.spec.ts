import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PlasticService } from '../../src/modules/plastic/plastic.service';

describe('PlasticService', () => {
  let service: PlasticService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      // 전문과 '오늘 현황' 정본 = Appointment(2026-08-13 W4)
      appointment: { findMany: vi.fn().mockResolvedValue([]), groupBy: vi.fn().mockResolvedValue([]) },
      plasticExam: {
        findMany: vi.fn(),
        create: vi.fn(),
        count: vi.fn(),
      },
    };
    service = new PlasticService(mockPrisma);
  });

  /* ───── getPatients ───── */

  describe('getPatients', () => {
    // 2026-10-10 정본 specialtyRecordPatients — 환자별 최근 기록(groupBy) · 상한 · 전체 수(상세는 test/specialty/specialty-review-2026-10-10c)
    it('환자별 최근 기록 · 전체 수 · 잘림 여부', async () => {
      mockPrisma.plasticExam.groupBy = vi.fn().mockResolvedValue([{ patientId: 'p-1', _max: { examinedAt: new Date('2026-05-20') } }]);
      mockPrisma.patient = { findMany: vi.fn().mockResolvedValue([{ id: 'p-1', familyName: '박', givenName: '환자', mrn: 'MRN001' }]) };
      const r = await service.getPatients();
      expect(mockPrisma.plasticExam.groupBy.mock.calls[0][0]).toMatchObject({ by: ['patientId'], orderBy: { _max: { examinedAt: 'desc' } } });
      expect(r).toMatchObject({ total: 1, truncated: false });
      expect(r.items[0]).toMatchObject({ patientId: 'p-1', mrn: 'MRN001', lastDate: new Date('2026-05-20') });
    });
  });

  /* ───── getExams ───── */

  describe('getExams', () => {
    it('should return exams for a patient', async () => {
      const exams = [{ id: 'e-1', bodyPart: 'Nose', procedure: 'Rhinoplasty' }];
      mockPrisma.plasticExam.findMany.mockResolvedValue(exams);
      const result = await service.getExams('p-1');
      expect(result).toEqual(exams);
      expect(mockPrisma.plasticExam.findMany).toHaveBeenCalledWith({
        where: { patientId: 'p-1' },
        include: { examiner: { select: { familyName: true, givenName: true } } },
        orderBy: { examinedAt: 'desc' },
      });
    });

    it('should return empty array for no exams', async () => {
      mockPrisma.plasticExam.findMany.mockResolvedValue([]);
      const result = await service.getExams('p-none');
      expect(result).toEqual([]);
    });
  });

  /* ───── createExam ───── */

  describe('createExam', () => {
    it('should create a plastic surgery exam', async () => {
      const input = {
        patientId: 'p-1', bodyPart: 'Eyelid', procedure: 'Blepharoplasty',
        anesthesiaType: 'LOCAL', examinedBy: 'doc-1',
      };
      mockPrisma.plasticExam.create.mockResolvedValue({ id: 'e-new', ...input });
      const result = await service.createExam(input);
      expect(result.id).toBe('e-new');
    });

    it('should create exam with fitzpatrick type and skin data', async () => {
      const input = {
        patientId: 'p-1', bodyPart: 'Face', procedure: 'Facelift',
        fitzpatrickType: 3, skinElasticity: 'GOOD', scarTendency: 'NORMAL',
        examinedBy: 'doc-1',
      };
      mockPrisma.plasticExam.create.mockResolvedValue({ id: 'e-skin' });
      await service.createExam(input);
      const callArg = mockPrisma.plasticExam.create.mock.calls[0][0];
      expect(callArg.data.fitzpatrickType).toBe(3);
      expect(callArg.data.skinElasticity).toBe('GOOD');
    });

    it('should create exam with photo URLs', async () => {
      const input = {
        patientId: 'p-1', bodyPart: 'Nose', procedure: 'Rhinoplasty',
        beforePhotoUrls: ['/photos/before1.jpg'],
        afterPhotoUrls: ['/photos/after1.jpg'],
        examinedBy: 'doc-1',
      };
      mockPrisma.plasticExam.create.mockResolvedValue({ id: 'e-photo' });
      await service.createExam(input);
      const callArg = mockPrisma.plasticExam.create.mock.calls[0][0];
      expect(callArg.data.beforePhotoUrls).toEqual(['/photos/before1.jpg']);
    });

    it('should include patient in response', async () => {
      const input = { patientId: 'p-1', bodyPart: 'Ear', procedure: 'Otoplasty', examinedBy: 'doc-1' };
      mockPrisma.plasticExam.create.mockResolvedValue({ id: 'e-ear' });
      await service.createExam(input);
      expect(mockPrisma.plasticExam.create).toHaveBeenCalledWith(
        expect.objectContaining({
          include: { patient: { select: { familyName: true, givenName: true, mrn: true } } },
        }),
      );
    });

    it('should handle duration and complications', async () => {
      const input = {
        patientId: 'p-1', bodyPart: 'Chin', procedure: 'Genioplasty',
        duration: 90, complications: 'Mild swelling',
        examinedBy: 'doc-1',
      };
      mockPrisma.plasticExam.create.mockResolvedValue({ id: 'e-dur' });
      await service.createExam(input);
      const callArg = mockPrisma.plasticExam.create.mock.calls[0][0];
      expect(callArg.data.duration).toBe(90);
      expect(callArg.data.complications).toBe('Mild swelling');
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
      mockPrisma.plasticExam.count.mockResolvedValue(22);
      const result = await service.getStats();
      expect(result).toMatchObject({ totalExams: 22 });
      // 오늘 값은 리터럴 0 이 아니라 실제 집계에서 온다(표본이 없으면 0 이 사실이다)
      expect(mockPrisma.appointment.groupBy).toHaveBeenCalled();
    });

    it('should return zero when empty', async () => {
      mockPrisma.plasticExam.count.mockResolvedValue(0);
      const result = await service.getStats();
      expect(result.totalExams).toBe(0);
    });
  });
});
