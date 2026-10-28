import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WaitingQueueController } from '../../src/modules/waiting-queue/waiting-queue.controller';

describe('WaitingQueueController', () => {
  let controller: WaitingQueueController;
  let mockService: any;

  beforeEach(() => {
    mockService = {
      checkIn: vi.fn(),
      findAll: vi.fn(),
      findMyQueue: vi.fn(),
      getStats: vi.fn(),
      callNext: vi.fn(),
      startConsultation: vi.fn(),
      complete: vi.fn(),
      cancel: vi.fn(),
      noShow: vi.fn(),
    };

    controller = new WaitingQueueController(mockService);
  });

  describe('POST /check-in', () => {
    it('should check in patient', async () => {
      const body = {
        patientId: 'p-1',
        departmentName: '내과',
      };

      const mockQueue = {
        id: 'queue-1',
        queueNumber: 1,
        patient: { familyName: '김', givenName: '영수' },
      };

      vi.mocked(mockService.checkIn).mockResolvedValue(mockQueue);

      const result = await controller.checkIn(body);

      expect(result.data).toEqual(mockQueue);
      expect(mockService.checkIn).toHaveBeenCalledWith(body);
    });

    it('should pass optional doctorId', async () => {
      const body = {
        patientId: 'p-1',
        departmentName: '신경과',
        doctorId: 'dr-1',
      };

      vi.mocked(mockService.checkIn).mockResolvedValue({ id: 'queue-1' });

      await controller.checkIn(body);

      expect(mockService.checkIn).toHaveBeenCalledWith(
        expect.objectContaining({ doctorId: 'dr-1' })
      );
    });

    it('should handle appointmentId', async () => {
      const body = {
        patientId: 'p-1',
        departmentName: '내과',
        appointmentId: 'apt-1',
      };

      vi.mocked(mockService.checkIn).mockResolvedValue({ id: 'queue-1' });

      await controller.checkIn(body);

      expect(mockService.checkIn).toHaveBeenCalledWith(
        expect.objectContaining({ appointmentId: 'apt-1' })
      );
    });

    it('should wrap response in data object', async () => {
      vi.mocked(mockService.checkIn).mockResolvedValue({
        id: 'queue-1',
      });

      const result = await controller.checkIn({
        patientId: 'p-1',
        departmentName: '내과',
      });

      expect(result).toHaveProperty('data');
    });
  });

  describe('GET /', () => {
    it('should return all queues', async () => {
      const mockQueues = [
        { id: 'queue-1', queueNumber: 1 },
        { id: 'queue-2', queueNumber: 2 },
      ];

      vi.mocked(mockService.findAll).mockResolvedValue({
        data: mockQueues,
      });

      const result = await controller.findAll();

      expect(result.data.data).toHaveLength(2);
    });

    it('should filter by department', async () => {
      vi.mocked(mockService.findAll).mockResolvedValue({ data: [] });

      await controller.findAll('내과');

      expect(mockService.findAll).toHaveBeenCalledWith(
        expect.objectContaining({ department: '내과' })
      );
    });

    it('should filter by doctorId', async () => {
      vi.mocked(mockService.findAll).mockResolvedValue({ data: [] });

      await controller.findAll(undefined, 'doctor-1');

      expect(mockService.findAll).toHaveBeenCalledWith(
        expect.objectContaining({ doctorId: 'doctor-1' })
      );
    });

    it('should filter by status', async () => {
      vi.mocked(mockService.findAll).mockResolvedValue({ data: [] });

      await controller.findAll(undefined, undefined, 'WAITING');

      expect(mockService.findAll).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'WAITING' })
      );
    });

    it('should filter by date', async () => {
      vi.mocked(mockService.findAll).mockResolvedValue({ data: [] });

      await controller.findAll(undefined, undefined, undefined, '2026-05-13');

      expect(mockService.findAll).toHaveBeenCalledWith(
        expect.objectContaining({ date: '2026-05-13' })
      );
    });

    it('should combine multiple filters', async () => {
      vi.mocked(mockService.findAll).mockResolvedValue({ data: [] });

      await controller.findAll('신경과', 'doctor-1', 'CALLED');

      expect(mockService.findAll).toHaveBeenCalledWith({
        department: '신경과',
        doctorId: 'doctor-1',
        status: 'CALLED',
        date: undefined,
      });
    });

    it('should wrap response in data object', async () => {
      vi.mocked(mockService.findAll).mockResolvedValue({
        data: [{ id: 'queue-1' }],
      });

      const result = await controller.findAll();

      expect(result).toHaveProperty('data');
    });
  });

  describe('GET /my', () => {
    it('should return doctor\'s queue', async () => {
      const mockQueues = [
        { id: 'queue-1', queueNumber: 1 },
        { id: 'queue-2', queueNumber: 2 },
      ];

      vi.mocked(mockService.findMyQueue).mockResolvedValue({
        data: mockQueues,
      });

      const result = await controller.findMyQueue('doctor-1');

      expect(result.data.data).toHaveLength(2);
    });

    it('should pass userId from CurrentUser', async () => {
      vi.mocked(mockService.findMyQueue).mockResolvedValue({ data: [] });

      await controller.findMyQueue('doctor-123');

      expect(mockService.findMyQueue).toHaveBeenCalledWith('doctor-123');
    });

    it('should wrap response in data object', async () => {
      vi.mocked(mockService.findMyQueue).mockResolvedValue({
        data: [{ id: 'queue-1' }],
      });

      const result = await controller.findMyQueue('doctor-1');

      expect(result).toHaveProperty('data');
    });
  });

  describe('GET /stats', () => {
    it('should return queue statistics', async () => {
      const mockStats = {
        statusCounts: [
          { departmentName: '내과', status: 'WAITING', _count: 5 },
        ],
        avgWaitMinutes: { '내과': 12 },
      };

      vi.mocked(mockService.getStats).mockResolvedValue({
        data: mockStats,
      });

      const result = await controller.getStats();

      expect(result.data.data.statusCounts).toBeDefined();
      expect(result.data.data.avgWaitMinutes).toBeDefined();
    });

    it('should wrap response in data object', async () => {
      vi.mocked(mockService.getStats).mockResolvedValue({
        data: { statusCounts: [], avgWaitMinutes: {} },
      });

      const result = await controller.getStats();

      expect(result).toHaveProperty('data');
    });

    it('should include department breakdown', async () => {
      const mockStats = {
        statusCounts: [
          { departmentName: '내과', status: 'WAITING', _count: 3 },
          { departmentName: '내과', status: 'CALLED', _count: 1 },
          { departmentName: '신경과', status: 'WAITING', _count: 2 },
        ],
        avgWaitMinutes: { '내과': 10, '신경과': 8 },
      };

      vi.mocked(mockService.getStats).mockResolvedValue({
        data: mockStats,
      });

      const result = await controller.getStats();

      expect(result.data.data.statusCounts).toHaveLength(3);
    });
  });

  describe('PATCH /:id/call', () => {
    it('should call next patient', async () => {
      const mockResult = {
        id: 'queue-1',
        status: 'CALLED',
        queueNumber: 5,
        ttsText: '내과 5번 김○수님 진료실 1번으로 오세요',
      };

      vi.mocked(mockService.callNext).mockResolvedValue({
        data: mockResult,
      });

      const result = await controller.callNext('queue-1');

      expect(result.data.data.status).toBe('CALLED');
      expect(result.data.data.ttsText).toBeDefined();
    });

    it('should pass queue ID', async () => {
      vi.mocked(mockService.callNext).mockResolvedValue({ data: { id: 'queue-1' } });

      await controller.callNext('queue-123');

      // 환자 앱 푸시는 **명시 옵트인**이다 — 본문이 없으면 false 로 넘어간다(몰래 나가지 않는다)
      expect(mockService.callNext).toHaveBeenCalledWith('queue-123', { notifyPatient: false });
    });

    it('should wrap response in data object', async () => {
      vi.mocked(mockService.callNext).mockResolvedValue({
        data: { id: 'queue-1' },
      });

      const result = await controller.callNext('queue-1');

      expect(result).toHaveProperty('data');
    });

    it('should handle re-call with updated callCount', async () => {
      const mockResult = {
        id: 'queue-1',
        callCount: 2,
        ttsText: '내과 5번 김○수님 (재호출)',
      };

      vi.mocked(mockService.callNext).mockResolvedValue({
        data: mockResult,
      });

      const result = await controller.callNext('queue-1');

      expect(result.data.data.callCount).toBe(2);
      expect(result.data.data.ttsText).toContain('재호출');
    });
  });

  describe('PATCH /:id/start', () => {
    it('should start consultation', async () => {
      const mockResult = {
        id: 'queue-1',
        status: 'IN_CONSULTATION',
        encounterId: 'enc-1',
      };

      vi.mocked(mockService.startConsultation).mockResolvedValue(mockResult);

      const result = await controller.startConsultation('queue-1');

      expect(result.data.status).toBe('IN_CONSULTATION');
    });

    it('should include encounter information', async () => {
      const mockResult = {
        id: 'queue-1',
        status: 'IN_CONSULTATION',
        encounter: { id: 'enc-1', patientId: 'p-1', doctorId: 'dr-1' },
      };

      vi.mocked(mockService.startConsultation).mockResolvedValue(mockResult);

      const result = await controller.startConsultation('queue-1');

      expect(result.data.encounter).toBeDefined();
    });

    it('should wrap response in data object', async () => {
      vi.mocked(mockService.startConsultation).mockResolvedValue({
        id: 'queue-1',
      });

      const result = await controller.startConsultation('queue-1');

      expect(result).toHaveProperty('data');
    });
  });

  describe('PATCH /:id/complete', () => {
    it('should complete consultation', async () => {
      const mockResult = {
        id: 'queue-1',
        status: 'COMPLETED',
        completedAt: new Date(),
      };

      vi.mocked(mockService.complete).mockResolvedValue(mockResult);

      const result = await controller.complete('queue-1');

      expect(result.data.status).toBe('COMPLETED');
    });

    it('should set completedAt timestamp', async () => {
      const now = new Date();
      const mockResult = {
        id: 'queue-1',
        status: 'COMPLETED',
        completedAt: now,
      };

      vi.mocked(mockService.complete).mockResolvedValue(mockResult);

      const result = await controller.complete('queue-1');

      expect(result.data.completedAt).toBeDefined();
    });

    it('should wrap response in data object', async () => {
      vi.mocked(mockService.complete).mockResolvedValue({
        id: 'queue-1',
      });

      const result = await controller.complete('queue-1');

      expect(result).toHaveProperty('data');
    });
  });

  describe('PATCH /:id/cancel', () => {
    it('should cancel queue entry', async () => {
      const mockResult = {
        id: 'queue-1',
        status: 'CANCELLED',
        completedAt: new Date(),
      };

      vi.mocked(mockService.cancel).mockResolvedValue(mockResult);

      const result = await controller.cancel('queue-1');

      expect(result.data.status).toBe('CANCELLED');
    });

    it('should pass queue ID', async () => {
      vi.mocked(mockService.cancel).mockResolvedValue({ id: 'queue-1' });

      await controller.cancel('queue-456');

      expect(mockService.cancel).toHaveBeenCalledWith('queue-456');
    });

    it('should wrap response in data object', async () => {
      vi.mocked(mockService.cancel).mockResolvedValue({
        id: 'queue-1',
      });

      const result = await controller.cancel('queue-1');

      expect(result).toHaveProperty('data');
    });
  });

  describe('PATCH /:id/no-show', () => {
    it('should mark patient as no-show', async () => {
      const mockResult = {
        id: 'queue-1',
        status: 'NO_SHOW',
        completedAt: new Date(),
      };

      vi.mocked(mockService.noShow).mockResolvedValue(mockResult);

      const result = await controller.noShow('queue-1');

      expect(result.data.status).toBe('NO_SHOW');
    });

    it('should pass queue ID', async () => {
      vi.mocked(mockService.noShow).mockResolvedValue({ id: 'queue-1' });

      await controller.noShow('queue-789');

      expect(mockService.noShow).toHaveBeenCalledWith('queue-789');
    });

    it('should wrap response in data object', async () => {
      vi.mocked(mockService.noShow).mockResolvedValue({
        id: 'queue-1',
      });

      const result = await controller.noShow('queue-1');

      expect(result).toHaveProperty('data');
    });
  });
});
