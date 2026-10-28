import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SurgeryService } from '../../src/modules/surgery/surgery.service';
import { NotFoundException, BadRequestException } from '@nestjs/common';

describe('SurgeryService', () => {
  let service: SurgeryService;
  let mockPrisma: any;
  let mockJourney: any;
  let mockAdvanced: any;

  beforeEach(() => {
    mockPrisma = {
      patient: {
        findUnique: vi.fn(),
      },
      user: {
        findUnique: vi.fn(),
      },
      surgery: {
        create: vi.fn(),
        findMany: vi.fn(),
        findUnique: vi.fn(),
        update: vi.fn(),
      },
      // getSchedule 이 수술방 배정(OrSchedule)을 병합 조회 — 빈 배열=배정 없음
      orSchedule: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    };

    mockJourney = {
      emit: vi.fn(),
    };

    mockAdvanced = {
      assertChecklistReadyForStart: vi.fn().mockResolvedValue(undefined),
      assertChecklistReadyForClose: vi.fn().mockResolvedValue(undefined),
    };

    service = new SurgeryService(mockPrisma, mockAdvanced, mockJourney);
  });

  describe('schedule', () => {
    it('should create a new surgery', async () => {
      const data = {
        patientId: 'pat-1',
        surgeonId: 'doc-1',
        scheduledAt: new Date('2026-05-20T10:00:00'),
        procedureName: '충수절제술',
        procedureCode: 'APP001',
        anesthesiaType: 'GA',
      };

      mockPrisma.surgery.create.mockResolvedValue({
        id: 'surg-1',
        ...data,
        status: 'SCHEDULED',
      });

      const result = await service.schedule(data);

      expect(result.id).toBe('surg-1');
      expect(result.status).toBe('SCHEDULED');
      expect(mockPrisma.surgery.create).toHaveBeenCalled();
    });

    // 🔴 화면은 '수술 전 진단'을 입력받는데 DTO·서비스에 배선이 없어 whitelist 가 버렸다(컬럼은 존재).
    //    되돌리면 이 단언이 깨진다.
    it('수술 전 진단을 저장한다 — 화면이 받은 값이 원장에 남아야 한다', async () => {
      mockPrisma.surgery.create.mockResolvedValue({ id: 'surg-2', status: 'SCHEDULED' });

      await service.schedule({
        patientId: 'pat-1',
        surgeonId: 'doc-1',
        scheduledAt: '2026-05-20T10:00:00.000Z',
        procedureName: '충수절제술',
        preOpDiagnosis: '급성 충수염',
      });

      expect(mockPrisma.surgery.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ preOpDiagnosis: '급성 충수염' }) }),
      );
    });
  });

  describe('getSchedule', () => {
    it('should return scheduled surgeries without date filter', async () => {
      const mockSurgeries = [
        {
          id: 'surg-1',
          procedureName: '충수절제술',
          status: 'SCHEDULED',
          scheduledAt: new Date(),
        },
        {
          id: 'surg-2',
          procedureName: '담낭절제술',
          status: 'SCHEDULED',
          scheduledAt: new Date(),
        },
      ];

      mockPrisma.surgery.findMany.mockResolvedValue(mockSurgeries);

      const result = await service.getSchedule();

      expect(result).toHaveLength(2);
      expect(mockPrisma.surgery.findMany).toHaveBeenCalled();
    });

    it('should filter surgeries by date range', async () => {
      const mockSurgeries = [
        {
          id: 'surg-1',
          procedureName: '충수절제술',
          status: 'SCHEDULED',
          scheduledAt: new Date('2026-05-20'),
        },
      ];

      mockPrisma.surgery.findMany.mockResolvedValue(mockSurgeries);

      const startDate = new Date('2026-05-01');
      const endDate = new Date('2026-05-31');
      const result = await service.getSchedule(startDate, endDate);

      expect(result).toHaveLength(1);
    });

    it('should exclude CANCELLED surgeries', async () => {
      mockPrisma.surgery.findMany.mockResolvedValue([]);

      await service.getSchedule();

      expect(mockPrisma.surgery.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: { not: 'CANCELLED' },
          }),
        }),
      );
    });
  });

  describe('start', () => {
    it('should transition surgery from SCHEDULED to IN_PROGRESS', async () => {
      const mockSurgery = {
        id: 'surg-1',
        status: 'SCHEDULED',
        procedureName: '충수절제술',
      };

      mockPrisma.surgery.findUnique.mockResolvedValue(mockSurgery);
      mockPrisma.surgery.update.mockResolvedValue({
        ...mockSurgery,
        status: 'IN_PROGRESS',
        startedAt: new Date(),
      });

      const result = await service.start('surg-1');

      expect(result.status).toBe('IN_PROGRESS');
      expect(mockPrisma.surgery.update).toHaveBeenCalled();
    });

    it('should throw NotFoundException if surgery not found', async () => {
      mockPrisma.surgery.findUnique.mockResolvedValue(null);

      await expect(service.start('surg-1')).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException if not in SCHEDULED status', async () => {
      mockPrisma.surgery.findUnique.mockResolvedValue({
        id: 'surg-1',
        status: 'COMPLETED',
      });

      await expect(service.start('surg-1')).rejects.toThrow(BadRequestException);
    });
  });

  describe('complete', () => {
    it('should complete surgery with Op Note', async () => {
      const mockSurgery = {
        id: 'surg-1',
        status: 'IN_PROGRESS',
        procedureName: '충수절제술',
        patientId: 'pat-1',
        surgeonId: 'doc-1',
        startedAt: new Date(),
      };

      const opNote = {
        preOpDiagnosis: '급성 충수염',
        postOpDiagnosis: '급성 충수염',
        opNote: '표준적인 개복 충수절제술',
        findings: '충수 기저부 천공',
        complications: '없음',
        specimens: '충수',
        ebl: 100,
        fluidsGiven: '생식염수 1500mL',
        implants: '없음',
        drains: 'JP 드레인 1개',
        anesthesiaType: 'GA',
        anesthesiaNote: '자격있는 마취과 의사',
      };

      mockPrisma.surgery.findUnique.mockResolvedValue(mockSurgery);
      mockPrisma.surgery.update.mockResolvedValue({
        ...mockSurgery,
        status: 'COMPLETED',
        endedAt: new Date(),
        ...opNote,
      });

      const result = await service.complete('surg-1', opNote);

      expect(result.status).toBe('COMPLETED');
      expect(result.opNote).toBe('표준적인 개복 충수절제술');
      expect(mockJourney.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'SURGERY_COMPLETE',
          patientId: 'pat-1',
          refType: 'SURGERY',
          refId: 'surg-1',
        }),
      );
    });

    it('should throw NotFoundException if surgery not found', async () => {
      mockPrisma.surgery.findUnique.mockResolvedValue(null);

      await expect(service.complete('surg-1', {})).rejects.toThrow(NotFoundException);
    });

    it('[P1] SCHEDULED→COMPLETED 직행 차단(시작게이트 우회 방지)', async () => {
      mockPrisma.surgery.findUnique.mockResolvedValue({
        id: 'surg-1', status: 'SCHEDULED', procedureName: '수술', patientId: 'pat-1', surgeonId: 'doc-1', startedAt: null,
      });
      await expect(service.complete('surg-1', { opNote: '수술 진행 정상' }))
        .rejects.toMatchObject({ response: { code: 'SURGERY_NOT_IN_PROGRESS' } });
      expect(mockPrisma.surgery.update).not.toHaveBeenCalled();
    });

    it('[P0] Sign-Out 미완료 시 종료 차단', async () => {
      mockPrisma.surgery.findUnique.mockResolvedValue({
        id: 'surg-1', status: 'IN_PROGRESS', procedureName: '수술', patientId: 'pat-1', surgeonId: 'doc-1', startedAt: new Date(),
      });
      mockAdvanced.assertChecklistReadyForClose.mockRejectedValue(new BadRequestException({ code: 'SURGERY_SIGNOUT_INCOMPLETE', message: 'x' }));
      await expect(service.complete('surg-1', { opNote: 'x' }))
        .rejects.toMatchObject({ response: { code: 'SURGERY_SIGNOUT_INCOMPLETE' } });
    });
  });

  describe('findById', () => {
    it('should return surgery detail with related data', async () => {
      const mockSurgery = {
        id: 'surg-1',
        patientId: 'pat-1',
        surgeonId: 'doc-1',
        procedureName: '충수절제술',
        status: 'COMPLETED',
        opNote: '정상적으로 완료됨',
        patient: { id: 'pat-1', mrn: 'MR001', familyName: '김', givenName: '환자' },
        surgeon: { familyName: '이', givenName: '의사' },
      };

      mockPrisma.surgery.findUnique.mockResolvedValue(mockSurgery);

      const result = await service.findById('surg-1');

      expect(result.id).toBe('surg-1');
      expect(result.procedureName).toBe('충수절제술');
      expect(result.patient.familyName).toBe('김');
      expect(mockPrisma.surgery.findUnique).toHaveBeenCalledWith({
        where: { id: 'surg-1' },
        include: {
          patient: { select: { id: true, mrn: true, familyName: true, givenName: true } },
          surgeon: { select: { familyName: true, givenName: true } },
        },
      });
    });

    it('should throw NotFoundException if surgery not found', async () => {
      mockPrisma.surgery.findUnique.mockResolvedValue(null);

      await expect(service.findById('surg-1')).rejects.toThrow(NotFoundException);
    });
  });
});
