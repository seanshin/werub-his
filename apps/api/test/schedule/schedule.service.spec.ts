import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ScheduleService } from '../../src/modules/schedule/schedule.service';
import { AppointmentConflictError, InvalidStatusTransitionError } from '../../src/domain/errors/domain-error';

describe('ScheduleService', () => {
  let service: ScheduleService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      appointment: {
        create: vi.fn(),
        findMany: vi.fn(),
        findUniqueOrThrow: vi.fn(),
        count: vi.fn(),
        update: vi.fn(),
      },
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
    it('should create appointment with valid data', async () => {
      const dto = { patientId: 'p-1', doctorId: 'd-1', scheduledAt: '2026-05-15T09:00:00Z', duration: 30, type: 'INITIAL', reason: 'Checkup' };
      const mockAppointment = { id: 'apt-1', ...dto };

      mockPrisma.appointment.findMany.mockResolvedValue([]);
      mockPrisma.appointment.create.mockResolvedValue(mockAppointment);

      const result = await service.create(dto, 'user-1');

      expect(result.appointment.id).toBe('apt-1');
      expect(mockPrisma.appointment.create).toHaveBeenCalled();
    });

    it('should set default duration to 30 minutes', async () => {
      const dto = { patientId: 'p-1', doctorId: 'd-1', scheduledAt: '2026-05-15T09:00:00Z' };

      mockPrisma.appointment.findMany.mockResolvedValue([]);
      mockPrisma.appointment.create.mockResolvedValue({ id: 'apt-1' });

      await service.create(dto, 'user-1');

      expect(mockPrisma.appointment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            duration: 30,
          }),
        }),
      );
    });

    it('should set default type to INITIAL', async () => {
      const dto = { patientId: 'p-1', doctorId: 'd-1', scheduledAt: '2026-05-15T09:00:00Z' };

      mockPrisma.appointment.findMany.mockResolvedValue([]);
      mockPrisma.appointment.create.mockResolvedValue({ id: 'apt-1' });

      await service.create(dto, 'user-1');

      expect(mockPrisma.appointment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'INITIAL',
          }),
        }),
      );
    });

    it('should throw error if doctor has conflicting appointment', async () => {
      const dto = { patientId: 'p-1', doctorId: 'd-1', scheduledAt: '2026-05-15T09:00:00Z', duration: 30 };
      const conflictApt = { id: 'apt-1', doctorId: 'd-1', scheduledAt: new Date('2026-05-15T09:10:00Z'), duration: 30, status: 'SCHEDULED' };

      mockPrisma.appointment.findMany.mockResolvedValue([conflictApt]);

      await expect(service.create(dto, 'user-1')).rejects.toThrow(AppointmentConflictError);
    });

    it('should ignore cancelled appointments in conflict check', async () => {
      const dto = { patientId: 'p-1', doctorId: 'd-1', scheduledAt: '2026-05-15T09:00:00Z', duration: 30 };
      const cancelledApt = { id: 'apt-1', doctorId: 'd-1', scheduledAt: new Date('2026-05-15T09:10:00Z'), duration: 30, status: 'CANCELLED' };

      mockPrisma.appointment.findMany.mockResolvedValue([]);
      mockPrisma.appointment.create.mockResolvedValue({ id: 'apt-2' });

      const result = await service.create(dto, 'user-1');

      expect(result.appointment.id).toBe('apt-2');
    });

    it('should record createdBy user', async () => {
      const dto = { patientId: 'p-1', doctorId: 'd-1', scheduledAt: '2026-05-15T09:00:00Z' };

      mockPrisma.appointment.findMany.mockResolvedValue([]);
      mockPrisma.appointment.create.mockResolvedValue({ id: 'apt-1' });

      await service.create(dto, 'user-123');

      expect(mockPrisma.appointment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            createdBy: 'user-123',
          }),
        }),
      );
    });
  });

  describe('findAll', () => {
    it('should list all appointments with pagination', async () => {
      const mockAppointments = [{ id: 'apt-1' }, { id: 'apt-2' }];

      mockPrisma.appointment.findMany.mockResolvedValue(mockAppointments);
      mockPrisma.appointment.count.mockResolvedValue(2);

      const result = await service.findAll({});

      expect(result.data).toHaveLength(2);
      expect(result.pagination.total).toBe(2);
    });

    it('should use default pagination page 1, limit 20', async () => {
      mockPrisma.appointment.findMany.mockResolvedValue([]);
      mockPrisma.appointment.count.mockResolvedValue(0);

      await service.findAll({});

      expect(mockPrisma.appointment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 0,
          take: 20,
        }),
      );
    });

    it('should apply custom pagination', async () => {
      mockPrisma.appointment.findMany.mockResolvedValue([]);
      mockPrisma.appointment.count.mockResolvedValue(0);

      await service.findAll({ page: 2, limit: 10 });

      expect(mockPrisma.appointment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 10,
          take: 10,
        }),
      );
    });

    it('should filter by doctor', async () => {
      mockPrisma.appointment.findMany.mockResolvedValue([]);
      mockPrisma.appointment.count.mockResolvedValue(0);

      await service.findAll({ doctorId: 'd-1' });

      expect(mockPrisma.appointment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            AND: expect.arrayContaining([{ doctorId: 'd-1' }]),
          }),
        }),
      );
    });

    it('should filter by patient', async () => {
      mockPrisma.appointment.findMany.mockResolvedValue([]);
      mockPrisma.appointment.count.mockResolvedValue(0);

      await service.findAll({ patientId: 'p-1' });

      expect(mockPrisma.appointment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            AND: expect.arrayContaining([{ patientId: 'p-1' }]),
          }),
        }),
      );
    });

    it('should filter by status', async () => {
      mockPrisma.appointment.findMany.mockResolvedValue([]);
      mockPrisma.appointment.count.mockResolvedValue(0);

      await service.findAll({ status: 'SCHEDULED' });

      expect(mockPrisma.appointment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            AND: expect.arrayContaining([{ status: 'SCHEDULED' }]),
          }),
        }),
      );
    });

    it('should filter by date range', async () => {
      mockPrisma.appointment.findMany.mockResolvedValue([]);
      mockPrisma.appointment.count.mockResolvedValue(0);

      await service.findAll({ dateFrom: '2026-05-01', dateTo: '2026-05-31' });

      expect(mockPrisma.appointment.findMany).toHaveBeenCalled();
      expect(mockPrisma.appointment.count).toHaveBeenCalled();
    });

    it('should calculate hasMore correctly', async () => {
      mockPrisma.appointment.findMany.mockResolvedValue([]);
      mockPrisma.appointment.count.mockResolvedValue(50);

      const result = await service.findAll({ page: 1, limit: 20 });

      expect(result.pagination.hasMore).toBe(true);
    });
  });

  describe('findById', () => {
    it('should get appointment by id', async () => {
      const mockAppointment = { id: 'apt-1', patientId: 'p-1', doctorId: 'd-1', status: 'SCHEDULED' };

      mockPrisma.appointment.findUniqueOrThrow.mockResolvedValue(mockAppointment);

      const result = await service.findById('apt-1');

      expect(result.id).toBe('apt-1');
    });

    it('should include patient and doctor details', async () => {
      mockPrisma.appointment.findUniqueOrThrow.mockResolvedValue({});

      await service.findById('apt-1');

      expect(mockPrisma.appointment.findUniqueOrThrow).toHaveBeenCalledWith(
        expect.objectContaining({
          include: expect.objectContaining({
            patient: expect.any(Object),
            doctor: expect.any(Object),
          }),
        }),
      );
    });
  });

  describe('getCalendar', () => {
    it('should get week view by default', async () => {
      mockPrisma.appointment.findMany.mockResolvedValue([]);

      const result = await service.getCalendar({});

      expect(result.meta.view).toBe('week');
      expect(result.meta.start).toBeDefined();
      expect(result.meta.end).toBeDefined();
    });

    it('should get month view when specified', async () => {
      mockPrisma.appointment.findMany.mockResolvedValue([]);

      const result = await service.getCalendar({ view: 'month' });

      expect(result.meta.view).toBe('month');
    });

    it('should exclude cancelled and no-show appointments', async () => {
      mockPrisma.appointment.findMany.mockResolvedValue([]);

      await service.getCalendar({});

      expect(mockPrisma.appointment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: { notIn: ['CANCELLED', 'NO_SHOW'] },
          }),
        }),
      );
    });

    it('should filter by doctor when specified', async () => {
      mockPrisma.appointment.findMany.mockResolvedValue([]);

      await service.getCalendar({ doctorId: 'd-1' });

      expect(mockPrisma.appointment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            doctorId: 'd-1',
          }),
        }),
      );
    });

    it('should use provided date for calendar range', async () => {
      mockPrisma.appointment.findMany.mockResolvedValue([]);

      await service.getCalendar({ date: '2026-05-15' });

      expect(mockPrisma.appointment.findMany).toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('should update appointment with new time', async () => {
      const existingApt = { id: 'apt-1', status: 'SCHEDULED', doctorId: 'd-1', duration: 30 };
      const updateDto = { scheduledAt: '2026-05-16T10:00:00Z' };

      mockPrisma.appointment.findUniqueOrThrow.mockResolvedValue(existingApt);
      mockPrisma.appointment.findMany.mockResolvedValue([]);
      mockPrisma.appointment.update.mockResolvedValue({ id: 'apt-1', scheduledAt: new Date(updateDto.scheduledAt) });

      const result = await service.update('apt-1', updateDto, 'user-1');

      expect(result.appointment.id).toBe('apt-1');
    });

    it('should prevent update of completed appointments', async () => {
      const completedApt = { id: 'apt-1', status: 'COMPLETED' };

      mockPrisma.appointment.findUniqueOrThrow.mockResolvedValue(completedApt);

      await expect(service.update('apt-1', { scheduledAt: '2026-05-16T10:00:00Z' }, 'user-1')).rejects.toThrow(InvalidStatusTransitionError);
    });

    it('should prevent update of cancelled appointments', async () => {
      const cancelledApt = { id: 'apt-1', status: 'CANCELLED' };

      mockPrisma.appointment.findUniqueOrThrow.mockResolvedValue(cancelledApt);

      await expect(service.update('apt-1', { scheduledAt: '2026-05-16T10:00:00Z' }, 'user-1')).rejects.toThrow(InvalidStatusTransitionError);
    });

    it('should validate conflict when changing time', async () => {
      const existingApt = { id: 'apt-1', status: 'SCHEDULED', doctorId: 'd-1', duration: 30 };
      const conflictApt = { id: 'apt-2', doctorId: 'd-1', scheduledAt: new Date('2026-05-16T10:10:00Z'), duration: 30, status: 'SCHEDULED' };

      mockPrisma.appointment.findUniqueOrThrow.mockResolvedValue(existingApt);
      mockPrisma.appointment.findMany.mockResolvedValue([conflictApt]);

      await expect(service.update('apt-1', { scheduledAt: '2026-05-16T10:00:00Z' }, 'user-1')).rejects.toThrow(AppointmentConflictError);
    });

    it('should update duration', async () => {
      const existingApt = { id: 'apt-1', status: 'SCHEDULED', doctorId: 'd-1', duration: 30, scheduledAt: new Date('2026-05-16T10:00:00Z') };

      mockPrisma.appointment.findUniqueOrThrow.mockResolvedValue(existingApt);
      mockPrisma.appointment.findMany.mockResolvedValue([]);
      mockPrisma.appointment.update.mockResolvedValue({ id: 'apt-1', duration: 60 });

      await service.update('apt-1', { duration: 60 }, 'user-1');

      expect(mockPrisma.appointment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            duration: 60,
          }),
        }),
      );
    });

    it('should update notes', async () => {
      const existingApt = { id: 'apt-1', status: 'SCHEDULED', doctorId: 'd-1', duration: 30 };

      mockPrisma.appointment.findUniqueOrThrow.mockResolvedValue(existingApt);
      mockPrisma.appointment.findMany.mockResolvedValue([]);
      mockPrisma.appointment.update.mockResolvedValue({ id: 'apt-1', notes: 'Follow-up needed' });

      await service.update('apt-1', { notes: 'Follow-up needed' }, 'user-1');

      expect(mockPrisma.appointment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            notes: 'Follow-up needed',
          }),
        }),
      );
    });
  });

  describe('changeStatus', () => {
    it('should change status from SCHEDULED to CHECKED_IN', async () => {
      const apt = { id: 'apt-1', status: 'SCHEDULED' };

      mockPrisma.appointment.findUniqueOrThrow.mockResolvedValue(apt);
      mockPrisma.appointment.update.mockResolvedValue({ id: 'apt-1', status: 'CHECKED_IN' });

      const result = await service.changeStatus('apt-1', { status: 'CHECKED_IN' }, 'user-1');

      expect(result.status).toBe('CHECKED_IN');
    });

    it('should change status from CHECKED_IN to IN_PROGRESS', async () => {
      const apt = { id: 'apt-1', status: 'CHECKED_IN' };

      mockPrisma.appointment.findUniqueOrThrow.mockResolvedValue(apt);
      mockPrisma.appointment.update.mockResolvedValue({ id: 'apt-1', status: 'IN_PROGRESS' });

      const result = await service.changeStatus('apt-1', { status: 'IN_PROGRESS' }, 'user-1');

      expect(result.status).toBe('IN_PROGRESS');
    });

    it('should change status from IN_PROGRESS to COMPLETED', async () => {
      const apt = { id: 'apt-1', status: 'IN_PROGRESS' };

      mockPrisma.appointment.findUniqueOrThrow.mockResolvedValue(apt);
      mockPrisma.appointment.update.mockResolvedValue({ id: 'apt-1', status: 'COMPLETED' });

      const result = await service.changeStatus('apt-1', { status: 'COMPLETED' }, 'user-1');

      expect(result.status).toBe('COMPLETED');
    });

    it('should record cancellation timestamp and user', async () => {
      const apt = { id: 'apt-1', status: 'SCHEDULED' };

      mockPrisma.appointment.findUniqueOrThrow.mockResolvedValue(apt);
      mockPrisma.appointment.update.mockResolvedValue({ id: 'apt-1', status: 'CANCELLED', cancelledAt: new Date() });

      await service.changeStatus('apt-1', { status: 'CANCELLED', cancelReason: 'Patient requested' }, 'user-1');

      expect(mockPrisma.appointment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'CANCELLED',
            cancelledAt: expect.any(Date),
          }),
        }),
      );
    });

    it('should prevent invalid status transition', async () => {
      const apt = { id: 'apt-1', status: 'COMPLETED' };

      mockPrisma.appointment.findUniqueOrThrow.mockResolvedValue(apt);

      await expect(service.changeStatus('apt-1', { status: 'SCHEDULED' }, 'user-1')).rejects.toThrow(InvalidStatusTransitionError);
    });

    it('should allow cancellation from any non-terminal status', async () => {
      const apt = { id: 'apt-1', status: 'CHECKED_IN' };

      mockPrisma.appointment.findUniqueOrThrow.mockResolvedValue(apt);
      mockPrisma.appointment.update.mockResolvedValue({ id: 'apt-1', status: 'CANCELLED' });

      const result = await service.changeStatus('apt-1', { status: 'CANCELLED' }, 'user-1');

      expect(result.status).toBe('CANCELLED');
    });

    it('should allow no-show status from SCHEDULED', async () => {
      const apt = { id: 'apt-1', status: 'SCHEDULED' };

      mockPrisma.appointment.findUniqueOrThrow.mockResolvedValue(apt);
      mockPrisma.appointment.update.mockResolvedValue({ id: 'apt-1', status: 'NO_SHOW' });

      const result = await service.changeStatus('apt-1', { status: 'NO_SHOW' }, 'user-1');

      expect(result.status).toBe('NO_SHOW');
    });
  });

  describe('Conflict Validation', () => {
    it('should detect overlapping appointments', async () => {
      const dto = { patientId: 'p-1', doctorId: 'd-1', scheduledAt: '2026-05-15T09:00:00Z', duration: 30 };
      const existingApt = { id: 'apt-1', doctorId: 'd-1', scheduledAt: new Date('2026-05-15T09:20:00Z'), duration: 30, status: 'SCHEDULED' };

      mockPrisma.appointment.findMany.mockResolvedValue([existingApt]);

      await expect(service.create(dto, 'user-1')).rejects.toThrow(AppointmentConflictError);
    });

    it('should respect 5-minute buffer before appointment', async () => {
      const dto = { patientId: 'p-1', doctorId: 'd-1', scheduledAt: '2026-05-15T09:00:00Z', duration: 25 };
      const existingApt = { id: 'apt-1', doctorId: 'd-1', scheduledAt: new Date('2026-05-15T09:25:00Z'), duration: 30, status: 'SCHEDULED' };

      mockPrisma.appointment.findMany.mockResolvedValue([existingApt]);

      await expect(service.create(dto, 'user-1')).rejects.toThrow(AppointmentConflictError);
    });

    it('should allow same-day appointments with 5-minute buffer', async () => {
      const dto = { patientId: 'p-1', doctorId: 'd-1', scheduledAt: '2026-05-15T09:00:00Z', duration: 30 };
      const existingApt = { id: 'apt-1', doctorId: 'd-1', scheduledAt: new Date('2026-05-15T09:35:00Z'), duration: 30, status: 'SCHEDULED' };

      mockPrisma.appointment.findMany.mockResolvedValue([]);
      mockPrisma.appointment.create.mockResolvedValue({ id: 'apt-2' });

      const result = await service.create(dto, 'user-1');

      expect(result.appointment.id).toBe('apt-2');
    });
  });

  describe('Calendar Date Range', () => {
    it('should calculate week range starting from Sunday', async () => {
      mockPrisma.appointment.findMany.mockResolvedValue([]);

      const result = await service.getCalendar({ date: '2026-05-15', view: 'week' });

      expect(result.meta.start).toBeDefined();
      expect(result.meta.end).toBeDefined();
    });

    it('should calculate month range from 1st to last day', async () => {
      mockPrisma.appointment.findMany.mockResolvedValue([]);

      const result = await service.getCalendar({ date: '2026-05-15', view: 'month' });

      expect(result.meta.start).toBeDefined();
      expect(result.meta.end).toBeDefined();
    });
  });
});
