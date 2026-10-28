import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ScheduleService } from '../../src/modules/schedule/schedule.service';

describe('ScheduleService', () => {
  let service: ScheduleService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      appointment: { create: vi.fn(), findMany: vi.fn(), findUniqueOrThrow: vi.fn(), count: vi.fn(), update: vi.fn() },
      clinicSchedule: { findMany: vi.fn().mockResolvedValue([]) },
      clinicClosure: { findMany: vi.fn().mockResolvedValue([]) },
      // advisory lock 트랜잭션(withDoctorLock) — tx 는 동일 목을 재사용
      $executeRaw: vi.fn(),
      $queryRaw: vi.fn().mockResolvedValue([]),
      $transaction: vi.fn(async (arg: any) =>
        typeof arg === 'function' ? arg(mockPrisma) : Promise.all(arg),
      ),
    };
    service = new ScheduleService(mockPrisma);
  });

  describe('create', () => {
    it('should create appointment when no conflict', async () => {
      mockPrisma.appointment.findMany.mockResolvedValue([]); // no conflicts
      mockPrisma.appointment.create.mockResolvedValue({ id: 'a-1', patientId: 'p-1', doctorId: 'd-1', status: 'SCHEDULED' });
      const result = await service.create({ patientId: 'p-1', doctorId: 'd-1', scheduledAt: '2026-05-20T10:00:00Z' }, 'u-1');
      expect(result.appointment.id).toBe('a-1');
    });

    it('should throw on scheduling conflict', async () => {
      const conflictTime = new Date('2026-05-20T10:00:00Z');
      mockPrisma.appointment.findMany.mockResolvedValue([
        { id: 'a-existing', doctorId: 'd-1', scheduledAt: conflictTime, duration: 30, status: 'SCHEDULED' },
      ]);
      await expect(service.create({ patientId: 'p-1', doctorId: 'd-1', scheduledAt: '2026-05-20T10:15:00Z' }, 'u-1')).rejects.toThrow();
    });
  });

  describe('findAll', () => {
    it('should return paginated appointments', async () => {
      mockPrisma.appointment.findMany.mockResolvedValue([{ id: 'a-1' }]);
      mockPrisma.appointment.count.mockResolvedValue(1);
      const result = await service.findAll({ page: 1, limit: 20 });
      expect(result.data).toHaveLength(1);
      expect(result.pagination.total).toBe(1);
    });

    it('should filter by doctorId', async () => {
      mockPrisma.appointment.findMany.mockResolvedValue([]);
      mockPrisma.appointment.count.mockResolvedValue(0);
      await service.findAll({ doctorId: 'd-1' });
      expect(mockPrisma.appointment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ AND: expect.arrayContaining([{ doctorId: 'd-1' }]) }) }),
      );
    });
  });

  describe('changeStatus', () => {
    it('should allow SCHEDULED → CHECKED_IN', async () => {
      mockPrisma.appointment.findUniqueOrThrow.mockResolvedValue({ id: 'a-1', status: 'SCHEDULED' });
      mockPrisma.appointment.update.mockResolvedValue({ id: 'a-1', status: 'CHECKED_IN' });
      const result = await service.changeStatus('a-1', { status: 'CHECKED_IN' as any }, 'u-1');
      expect(result.status).toBe('CHECKED_IN');
    });

    it('should allow SCHEDULED → CANCELLED with reason', async () => {
      mockPrisma.appointment.findUniqueOrThrow.mockResolvedValue({ id: 'a-1', status: 'SCHEDULED' });
      mockPrisma.appointment.update.mockResolvedValue({ id: 'a-1', status: 'CANCELLED' });
      await service.changeStatus('a-1', { status: 'CANCELLED' as any, cancelReason: '환자 요청' }, 'u-1');
      expect(mockPrisma.appointment.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'CANCELLED', cancelReason: '환자 요청' }) }),
      );
    });

    it('should reject invalid transition COMPLETED → SCHEDULED', async () => {
      mockPrisma.appointment.findUniqueOrThrow.mockResolvedValue({ id: 'a-1', status: 'COMPLETED' });
      await expect(service.changeStatus('a-1', { status: 'SCHEDULED' as any }, 'u-1')).rejects.toThrow();
    });

    it('should reject CANCELLED → any', async () => {
      mockPrisma.appointment.findUniqueOrThrow.mockResolvedValue({ id: 'a-1', status: 'CANCELLED' });
      await expect(service.changeStatus('a-1', { status: 'CHECKED_IN' as any }, 'u-1')).rejects.toThrow();
    });
  });

  describe('update', () => {
    it('should update appointment', async () => {
      mockPrisma.appointment.findUniqueOrThrow.mockResolvedValue({ id: 'a-1', status: 'SCHEDULED', doctorId: 'd-1', duration: 30 });
      mockPrisma.appointment.findMany.mockResolvedValue([]); // no conflicts
      mockPrisma.appointment.update.mockResolvedValue({ id: 'a-1', reason: '두통' });
      const result = await service.update('a-1', { reason: '두통' }, 'u-1');
      expect(result.appointment.reason).toBe('두통');
    });

    it('should reject update on COMPLETED appointment', async () => {
      mockPrisma.appointment.findUniqueOrThrow.mockResolvedValue({ id: 'a-1', status: 'COMPLETED' });
      await expect(service.update('a-1', { reason: 'test' }, 'u-1')).rejects.toThrow();
    });
  });

  describe('getCalendar', () => {
    it('should return week view by default', async () => {
      mockPrisma.appointment.findMany.mockResolvedValue([]);
      const result = await service.getCalendar({ date: '2026-05-19' });
      expect(result.meta.view).toBe('week');
    });

    it('should support month view', async () => {
      mockPrisma.appointment.findMany.mockResolvedValue([]);
      const result = await service.getCalendar({ date: '2026-05-19', view: 'month' });
      expect(result.meta.view).toBe('month');
    });
  });
});
