import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SurgeryController } from '../../src/modules/surgery/surgery.controller';
import { SurgeryService } from '../../src/modules/surgery/surgery.service';

describe('SurgeryController', () => {
  let controller: SurgeryController;
  let service: SurgeryService;

  beforeEach(() => {
    service = {
      schedule: vi.fn(),
      getSchedule: vi.fn(),
      start: vi.fn(),
      complete: vi.fn(),
      findById: vi.fn(),
    } as any;

    controller = new SurgeryController(service);
  });

  describe('schedule', () => {
    it('should schedule a new surgery', async () => {
      const dto = {
        patientId: 'pat-1',
        surgeonId: 'doc-1',
        scheduledAt: new Date('2026-05-20T10:00:00').toISOString(),
        procedureName: '충수절제술',
        procedureCode: 'APP001',
        anesthesiaType: 'GA',
      };

      const mockSurgery = {
        id: 'surg-1',
        ...dto,
        status: 'SCHEDULED',
      };

      vi.mocked(service.schedule).mockResolvedValue(mockSurgery);

      const result = await controller.schedule(dto);

      expect(result.data).toEqual(mockSurgery);
      expect(service.schedule).toHaveBeenCalledWith(dto);
    });
  });

  describe('getSchedule', () => {
    it('should return surgery schedule without date filter', async () => {
      const mockSurgeries = [
        {
          id: 'surg-1',
          procedureName: '충수절제술',
          status: 'SCHEDULED',
          scheduledAt: new Date(),
        },
      ];

      vi.mocked(service.getSchedule).mockResolvedValue(mockSurgeries);

      const result = await controller.getSchedule('DOCTOR');

      expect(result.data).toEqual(mockSurgeries);
      expect(service.getSchedule).toHaveBeenCalledWith(undefined, undefined, undefined);
    });

    it('should return schedule with date filtering', async () => {
      const mockSurgeries = [
        {
          id: 'surg-1',
          procedureName: '충수절제술',
          status: 'SCHEDULED',
          scheduledAt: new Date('2026-05-20'),
        },
      ];

      vi.mocked(service.getSchedule).mockResolvedValue(mockSurgeries);

      const result = await controller.getSchedule('DOCTOR', '2026-05-01', '2026-05-31');

      expect(result.data).toEqual(mockSurgeries);
      expect(result.data).toHaveLength(1);
      expect(service.getSchedule).toHaveBeenCalledWith('2026-05-01', '2026-05-31', undefined);
    });

    /**
     * 🔴 2026-10-02 — 환자 차트 '수술 이력' 탭이 간호사에게 403 이었다. 환자를 지정한 조회만 연다(병원 전체 일정은 계속 막는다).
     */
    it('🔴 간호사는 환자 지정 조회만 — 지정 없으면 403', async () => {
      vi.mocked(service.getSchedule).mockResolvedValue([]);
      await expect(controller.getSchedule('NURSE')).rejects.toThrow(/환자를 지정한/);
      await controller.getSchedule('NURSE', undefined, undefined, 'pat-1');
      expect(service.getSchedule).toHaveBeenCalledWith(undefined, undefined, 'pat-1');
      // 대조군: 의사는 지정 없이도 본다
      await expect(controller.getSchedule('DOCTOR')).resolves.toBeDefined();
    });
  });

  describe('findOne', () => {
    it('should return surgery detail with related data', async () => {
      const mockSurgery = {
        id: 'surg-1',
        patientId: 'pat-1',
        procedureName: '충수절제술',
        status: 'COMPLETED',
        opNote: '정상적으로 완료됨',
        patient: { id: 'pat-1', familyName: '김', givenName: '환자' },
        surgeon: { id: 'doc-1', familyName: '이', givenName: '의사' },
      };

      vi.mocked(service.findById).mockResolvedValue(mockSurgery);

      const result = await controller.findOne('surg-1');

      expect(result.data).toEqual(mockSurgery);
      expect(service.findById).toHaveBeenCalledWith('surg-1');
    });
  });

  describe('start', () => {
    it('should start surgery and transition to IN_PROGRESS', async () => {
      const mockResult = {
        id: 'surg-1',
        status: 'IN_PROGRESS',
        startedAt: new Date(),
      };

      vi.mocked(service.start).mockResolvedValue(mockResult);

      const result = await controller.start('surg-1');

      expect(result.data.status).toBe('IN_PROGRESS');
      expect(service.start).toHaveBeenCalledWith('surg-1');
    });
  });

  describe('complete', () => {
    it('should complete surgery with Op Note', async () => {
      const dto = {
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

      const mockResult = {
        id: 'surg-1',
        status: 'COMPLETED',
        endedAt: new Date(),
        ...dto,
      };

      vi.mocked(service.complete).mockResolvedValue(mockResult);

      const result = await controller.complete('surg-1', dto);

      expect(result.data.status).toBe('COMPLETED');
      expect(result.data.opNote).toBe('표준적인 개복 충수절제술');
      expect(service.complete).toHaveBeenCalledWith('surg-1', dto);
    });

    it('should allow minimal Op Note fields', async () => {
      const dto = {
        opNote: '수술 진행 정상',
      };

      const mockResult = {
        id: 'surg-1',
        status: 'COMPLETED',
        opNote: '수술 진행 정상',
      };

      vi.mocked(service.complete).mockResolvedValue(mockResult);

      const result = await controller.complete('surg-1', dto);

      expect(result.data.opNote).toBe('수술 진행 정상');
    });
  });
});
