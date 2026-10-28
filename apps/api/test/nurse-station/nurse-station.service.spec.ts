import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { NurseStationService } from '../../src/modules/nurse-station/nurse-station.service';

describe('NurseStationService', () => {
  let service: NurseStationService;
  let mockPrisma: any;
  let mockNotification: any;
  let mockSafety: any;

  const mockQueue = { id: 'wq-1', patientId: 'p-1', doctorId: 'doc-1', status: 'WAITING', patient: { id: 'p-1', mrn: 'MRN-001' } };
  const mockTask = { id: 'nt-1', queueId: 'wq-1', phase: 'PRE_VISIT', status: 'PENDING', taskName: '바이탈 측정' };

  beforeEach(() => {
    mockPrisma = {
      careTeam: { findMany: vi.fn().mockResolvedValue([{ doctorId: 'doc-1', departmentName: '내과' }]) },
      waitingQueue: {
        findMany: vi.fn().mockResolvedValue([mockQueue]),
        findUnique: vi.fn().mockResolvedValue(mockQueue),
      },
      nurseTask: {
        findMany: vi.fn().mockResolvedValue([mockTask]),
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue(mockTask),
        createMany: vi.fn().mockResolvedValue({ count: 5 }),
        findUnique: vi.fn().mockResolvedValue(mockTask),
        update: vi.fn().mockResolvedValue({ ...mockTask, status: 'COMPLETED' }),
        groupBy: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(5),
      },
      vitalSign: {
        create: vi.fn().mockResolvedValue({ id: 'vs-1' }),
        findMany: vi.fn().mockResolvedValue([]),
        findFirst: vi.fn().mockResolvedValue(null),
      },
      nursePatientAssignment: {
        findMany: vi.fn().mockResolvedValue([]),
        create: vi.fn().mockResolvedValue({ id: 'npa-1' }),
        update: vi.fn().mockResolvedValue({ id: 'npa-1' }),
      },
      patientEducation: { create: vi.fn().mockResolvedValue({ id: 'pe-1' }) },
      questionnaireToken: { findFirst: vi.fn().mockResolvedValue(null) },
      surgery: { findFirst: vi.fn().mockResolvedValue(null) },
      allergy: { findMany: vi.fn().mockResolvedValue([]) },
      encounter: { findUnique: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
    };
    mockNotification = { create: vi.fn(), pushNotification: vi.fn() };
    mockSafety = { reportIncident: vi.fn() };
    service = new NurseStationService(mockPrisma, mockNotification, mockSafety);
  });

  describe('getQueue', () => {
    it('담당 의사의 대기 환자 조회', async () => {
      const result = await service.getQueue('nurse-1');
      expect(result).toHaveLength(1);
      expect(mockPrisma.careTeam.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { nurseId: 'nurse-1', isActive: true },
      }));
    });

    it('케어팀 없으면 빈 배열', async () => {
      mockPrisma.careTeam.findMany.mockResolvedValue([]);
      const result = await service.getQueue('nurse-1');
      expect(result).toEqual([]);
    });
  });

  describe('getTasks', () => {
    it('대기열 항목의 업무 목록', async () => {
      const result = await service.getTasks('wq-1');
      expect(result).toHaveLength(1);
    });
  });

  describe('generateTasks', () => {
    it('진료 전 업무 자동 생성', async () => {
      await service.generateTasks('wq-1', 'nurse-1');
      expect(mockPrisma.nurseTask.createMany).toHaveBeenCalled();
    });

    it('대기열 없으면 NotFoundException', async () => {
      mockPrisma.waitingQueue.findUnique.mockResolvedValue(null);
      await expect(service.generateTasks('x', 'nurse-1')).rejects.toThrow(NotFoundException);
    });

    it('이미 생성된 태스크 있으면 중복 방지', async () => {
      mockPrisma.nurseTask.findFirst.mockResolvedValue(mockTask);
      await service.generateTasks('wq-1', 'nurse-1');
      // create가 호출되지 않아야 함 (기존 태스크 반환)
      expect(mockPrisma.nurseTask.create).not.toHaveBeenCalled();
    });
  });

  describe('completeTask', () => {
    it('업무 완료', async () => {
      await service.completeTask('nt-1');
      expect(mockPrisma.nurseTask.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ status: 'COMPLETED', completedAt: expect.any(Date) }),
      }));
    });
  });

  describe('getStats', () => {
    it('오늘 간호 업무 통계', async () => {
      mockPrisma.nurseTask.count
        .mockResolvedValueOnce(3)  // pending
        .mockResolvedValueOnce(10) // completed
        .mockResolvedValueOnce(1)  // skipped
        .mockResolvedValueOnce(14); // total
      const result = await service.getStats('nurse-1');
      expect(result).toBeDefined();
    });
  });
});
