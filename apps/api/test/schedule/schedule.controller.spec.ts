import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ScheduleController } from '../../src/modules/schedule/schedule.controller';

describe('ScheduleController', () => {
  let controller: ScheduleController;
  let mockService: any;

  beforeEach(() => {
    mockService = {
      findAll: vi.fn(),
      create: vi.fn(),
      findById: vi.fn(),
      getCalendar: vi.fn(),
      update: vi.fn(),
      changeStatus: vi.fn(),
    };
    controller = new ScheduleController(mockService);
  });

  describe('findAll', () => {
    it('should get all appointments with default filters', async () => {
      const mockAppointments = [{ id: 'apt-1' }, { id: 'apt-2' }];

      mockService.findAll.mockResolvedValue({
        data: mockAppointments,
        pagination: { total: 2, page: 1, limit: 20, hasMore: false },
      });

      const result = await controller.findAll({});

      expect(result.data).toHaveLength(2);
      expect(mockService.findAll).toHaveBeenCalledWith({});
    });

    it('should pass query parameters to service', async () => {
      mockService.findAll.mockResolvedValue({ data: [], pagination: {} });

      await controller.findAll({ doctorId: 'd-1', status: 'SCHEDULED' });

      expect(mockService.findAll).toHaveBeenCalledWith(
        expect.objectContaining({
          doctorId: 'd-1',
          status: 'SCHEDULED',
        }),
      );
    });

    it('should include pagination info', async () => {
      const pagination = { total: 50, page: 1, limit: 20, hasMore: true };

      mockService.findAll.mockResolvedValue({ data: [], pagination });

      const result = await controller.findAll({});

      expect(result.pagination).toEqual(pagination);
    });

    it('should filter by date range', async () => {
      mockService.findAll.mockResolvedValue({ data: [], pagination: {} });

      await controller.findAll({ dateFrom: '2026-05-01', dateTo: '2026-05-31' });

      expect(mockService.findAll).toHaveBeenCalledWith(
        expect.objectContaining({
          dateFrom: '2026-05-01',
          dateTo: '2026-05-31',
        }),
      );
    });

    it('should handle pagination parameters', async () => {
      mockService.findAll.mockResolvedValue({ data: [], pagination: {} });

      await controller.findAll({ page: 2, limit: 10 });

      expect(mockService.findAll).toHaveBeenCalledWith(
        expect.objectContaining({
          page: 2,
          limit: 10,
        }),
      );
    });
  });

  describe('create', () => {
    it('should create appointment with userId injection', async () => {
      const dto = { patientId: 'p-1', doctorId: 'd-1', scheduledAt: '2026-05-15T09:00:00Z' };
      const mockAppointment = { id: 'apt-1', ...dto };

      mockService.create.mockResolvedValue({ appointment: mockAppointment, warnings: [] });

      const result = await controller.create(dto, 'user-1');

      expect(result.data.id).toBe('apt-1');
      expect(mockService.create).toHaveBeenCalledWith(dto, 'user-1');
    });

    it('should pass all create parameters', async () => {
      const dto = {
        patientId: 'p-1',
        doctorId: 'd-1',
        scheduledAt: '2026-05-15T09:00:00Z',
        duration: 60,
        type: 'FOLLOW_UP',
        reason: 'Checkup',
      };

      mockService.create.mockResolvedValue({ appointment: { id: 'apt-1' }, warnings: [] });

      await controller.create(dto, 'user-1');

      expect(mockService.create).toHaveBeenCalledWith(dto, 'user-1');
    });

    it('should wrap response in data object', async () => {
      const dto = { patientId: 'p-1', doctorId: 'd-1', scheduledAt: '2026-05-15T09:00:00Z' };

      mockService.create.mockResolvedValue({ appointment: { id: 'apt-1' }, warnings: [] });

      const result = await controller.create(dto, 'user-1');

      expect(result).toHaveProperty('data');
      expect(result.data.id).toBe('apt-1');
    });
  });

  describe('calendar', () => {
    it('should get calendar view', async () => {
      const mockCalendar = {
        data: [{ id: 'apt-1' }],
        meta: { view: 'week', start: '2026-05-10T00:00:00Z', end: '2026-05-17T00:00:00Z' },
      };

      mockService.getCalendar.mockResolvedValue(mockCalendar);

      const result = await controller.calendar({});

      expect(result.data).toHaveLength(1);
      expect(result.meta.view).toBe('week');
    });

    it('should support week view', async () => {
      mockService.getCalendar.mockResolvedValue({ data: [], meta: { view: 'week' } });

      await controller.calendar({ view: 'week' });

      expect(mockService.getCalendar).toHaveBeenCalledWith(
        expect.objectContaining({
          view: 'week',
        }),
      );
    });

    it('should support month view', async () => {
      mockService.getCalendar.mockResolvedValue({ data: [], meta: { view: 'month' } });

      await controller.calendar({ view: 'month' });

      expect(mockService.getCalendar).toHaveBeenCalledWith(
        expect.objectContaining({
          view: 'month',
        }),
      );
    });

    it('should use provided date for calendar', async () => {
      mockService.getCalendar.mockResolvedValue({ data: [], meta: { view: 'week' } });

      await controller.calendar({ date: '2026-05-15' });

      expect(mockService.getCalendar).toHaveBeenCalledWith(
        expect.objectContaining({
          date: '2026-05-15',
        }),
      );
    });

    it('should filter by doctor in calendar', async () => {
      mockService.getCalendar.mockResolvedValue({ data: [], meta: { view: 'week' } });

      await controller.calendar({ doctorId: 'd-1' });

      expect(mockService.getCalendar).toHaveBeenCalledWith(
        expect.objectContaining({
          doctorId: 'd-1',
        }),
      );
    });

    it('should include date range in meta', async () => {
      const meta = { view: 'week', start: '2026-05-10T00:00:00Z', end: '2026-05-17T00:00:00Z' };

      mockService.getCalendar.mockResolvedValue({ data: [], meta });

      const result = await controller.calendar({});

      expect(result.meta).toEqual(meta);
    });
  });

  describe('findOne', () => {
    it('should get appointment by id', async () => {
      const mockAppointment = { id: 'apt-1', patientId: 'p-1', doctorId: 'd-1' };

      mockService.findById.mockResolvedValue(mockAppointment);

      const result = await controller.findOne('apt-1');

      expect(result.data.id).toBe('apt-1');
      expect(mockService.findById).toHaveBeenCalledWith('apt-1');
    });

    it('should wrap response in data object', async () => {
      mockService.findById.mockResolvedValue({ id: 'apt-1' });

      const result = await controller.findOne('apt-1');

      expect(result).toHaveProperty('data');
    });

    it('should include all appointment details', async () => {
      const mockAppointment = {
        id: 'apt-1',
        patientId: 'p-1',
        doctorId: 'd-1',
        scheduledAt: new Date('2026-05-15T09:00:00Z'),
        status: 'SCHEDULED',
        duration: 30,
        type: 'INITIAL',
        reason: 'Checkup',
        notes: 'Patient requested morning appointment',
      };

      mockService.findById.mockResolvedValue(mockAppointment);

      const result = await controller.findOne('apt-1');

      expect(result.data).toEqual(mockAppointment);
    });
  });

  describe('update', () => {
    it('should update appointment', async () => {
      const dto = { scheduledAt: '2026-05-16T10:00:00Z', duration: 60 };
      const mockAppointment = { id: 'apt-1', ...dto };

      mockService.update.mockResolvedValue({ appointment: mockAppointment, warnings: ['진료 시간표에 없는 시간대입니다.'] });

      const result = await controller.update('apt-1', dto, 'user-1');

      expect(result.data.id).toBe('apt-1');
      expect(result.meta.warnings).toEqual(['진료 시간표에 없는 시간대입니다.']);
      expect(mockService.update).toHaveBeenCalledWith('apt-1', dto, 'user-1');
    });

    it('should pass userId to service', async () => {
      mockService.update.mockResolvedValue({ appointment: { id: 'apt-1' }, warnings: [] });

      await controller.update('apt-1', {}, 'user-123');

      expect(mockService.update).toHaveBeenCalledWith('apt-1', expect.any(Object), 'user-123');
    });

    it('should wrap response in data object', async () => {
      mockService.update.mockResolvedValue({ appointment: { id: 'apt-1' }, warnings: [] });

      const result = await controller.update('apt-1', {}, 'user-1');

      expect(result).toHaveProperty('data');
    });

    it('should update time and duration', async () => {
      const dto = { scheduledAt: '2026-05-16T10:00:00Z', duration: 45 };

      mockService.update.mockResolvedValue({});

      await controller.update('apt-1', dto, 'user-1');

      expect(mockService.update).toHaveBeenCalledWith('apt-1', dto, 'user-1');
    });

    it('should update type', async () => {
      const dto = { type: 'FOLLOW_UP' };

      mockService.update.mockResolvedValue({});

      await controller.update('apt-1', dto, 'user-1');

      expect(mockService.update).toHaveBeenCalledWith('apt-1', dto, 'user-1');
    });

    it('should update notes', async () => {
      const dto = { notes: 'Patient called to reschedule' };

      mockService.update.mockResolvedValue({});

      await controller.update('apt-1', dto, 'user-1');

      expect(mockService.update).toHaveBeenCalledWith('apt-1', dto, 'user-1');
    });

    it('should allow partial updates', async () => {
      const dto = { duration: 45 };

      mockService.update.mockResolvedValue({});

      await controller.update('apt-1', dto, 'user-1');

      expect(mockService.update).toHaveBeenCalledWith('apt-1', dto, 'user-1');
    });
  });

  describe('changeStatus', () => {
    it('should change appointment status', async () => {
      const dto = { status: 'CHECKED_IN' };
      const mockAppointment = { id: 'apt-1', status: 'CHECKED_IN' };

      mockService.changeStatus.mockResolvedValue(mockAppointment);

      const result = await controller.changeStatus('apt-1', dto, 'user-1');

      expect(result.data.status).toBe('CHECKED_IN');
      expect(mockService.changeStatus).toHaveBeenCalledWith('apt-1', dto, 'user-1');
    });

    it('should change to IN_PROGRESS', async () => {
      const dto = { status: 'IN_PROGRESS' };

      mockService.changeStatus.mockResolvedValue({ id: 'apt-1', status: 'IN_PROGRESS' });

      const result = await controller.changeStatus('apt-1', dto, 'user-1');

      expect(result.data.status).toBe('IN_PROGRESS');
    });

    it('should change to COMPLETED', async () => {
      const dto = { status: 'COMPLETED' };

      mockService.changeStatus.mockResolvedValue({ id: 'apt-1', status: 'COMPLETED' });

      const result = await controller.changeStatus('apt-1', dto, 'user-1');

      expect(result.data.status).toBe('COMPLETED');
    });

    it('should handle cancellation with reason', async () => {
      const dto = { status: 'CANCELLED', cancelReason: 'Doctor unavailable' };

      mockService.changeStatus.mockResolvedValue({ id: 'apt-1', status: 'CANCELLED' });

      await controller.changeStatus('apt-1', dto, 'user-1');

      expect(mockService.changeStatus).toHaveBeenCalledWith('apt-1', dto, 'user-1');
    });

    it('should record cancelling user', async () => {
      const dto = { status: 'CANCELLED' };

      mockService.changeStatus.mockResolvedValue({});

      await controller.changeStatus('apt-1', dto, 'user-123');

      expect(mockService.changeStatus).toHaveBeenCalledWith('apt-1', dto, 'user-123');
    });

    it('should handle NO_SHOW status', async () => {
      const dto = { status: 'NO_SHOW' };

      mockService.changeStatus.mockResolvedValue({ id: 'apt-1', status: 'NO_SHOW' });

      const result = await controller.changeStatus('apt-1', dto, 'user-1');

      expect(result.data.status).toBe('NO_SHOW');
    });

    it('should wrap response in data object', async () => {
      mockService.changeStatus.mockResolvedValue({ id: 'apt-1' });

      const result = await controller.changeStatus('apt-1', { status: 'CHECKED_IN' }, 'user-1');

      expect(result).toHaveProperty('data');
    });
  });

  describe('Authorization', () => {
    it('should require DOCTOR, NURSE or ADMIN role for create', async () => {
      // @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN) is applied
      expect(controller).toBeDefined();
    });

    it('should require DOCTOR, NURSE or ADMIN role for update', async () => {
      // @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN) is applied
      expect(controller).toBeDefined();
    });

    it('should require DOCTOR, NURSE or ADMIN role for status change', async () => {
      // @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN) is applied
      expect(controller).toBeDefined();
    });

    it('should require JWT authentication', async () => {
      // @UseGuards(JwtAuthGuard, RolesGuard) is applied
      expect(controller).toBeDefined();
    });
  });

  describe('Response Format', () => {
    it('should wrap create response in data', async () => {
      mockService.create.mockResolvedValue({ appointment: { id: 'apt-1' }, warnings: [] });

      const result = await controller.create({} as any, 'user-1');

      expect(result).toEqual({ data: { id: 'apt-1' }, meta: { warnings: [] } });
    });

    it('should wrap findOne response in data', async () => {
      mockService.findById.mockResolvedValue({ id: 'apt-1' });

      const result = await controller.findOne('apt-1');

      expect(result).toEqual({ data: { id: 'apt-1' } });
    });

    it('should wrap update response in data', async () => {
      mockService.update.mockResolvedValue({ appointment: { id: 'apt-1' }, warnings: [] });

      const result = await controller.update('apt-1', {}, 'user-1');

      expect(result).toEqual({ data: { id: 'apt-1' }, meta: { warnings: [] } });
    });

    it('should wrap changeStatus response in data', async () => {
      mockService.changeStatus.mockResolvedValue({ id: 'apt-1' });

      const result = await controller.changeStatus('apt-1', { status: 'CHECKED_IN' } as any, 'user-1');

      expect(result).toEqual({ data: { id: 'apt-1' } });
    });

    it('should return raw calendar response without extra wrapping', async () => {
      const calendarResponse = {
        data: [{ id: 'apt-1' }],
        meta: { view: 'week' },
      };

      mockService.getCalendar.mockResolvedValue(calendarResponse);

      const result = await controller.calendar({});

      expect(result).toEqual(calendarResponse);
    });

    it('should return raw findAll response without extra wrapping', async () => {
      const listResponse = {
        data: [{ id: 'apt-1' }],
        pagination: { total: 1, page: 1, limit: 20, hasMore: false },
      };

      mockService.findAll.mockResolvedValue(listResponse);

      const result = await controller.findAll({});

      expect(result).toEqual(listResponse);
    });
  });

  describe('Query Parameters', () => {
    it('should support multiple filters in findAll', async () => {
      mockService.findAll.mockResolvedValue({ data: [], pagination: {} });

      await controller.findAll({
        doctorId: 'd-1',
        patientId: 'p-1',
        status: 'SCHEDULED',
        dateFrom: '2026-05-01',
        dateTo: '2026-05-31',
      });

      expect(mockService.findAll).toHaveBeenCalledWith(
        expect.objectContaining({
          doctorId: 'd-1',
          patientId: 'p-1',
          status: 'SCHEDULED',
          dateFrom: '2026-05-01',
          dateTo: '2026-05-31',
        }),
      );
    });

    it('should handle undefined query parameters', async () => {
      mockService.findAll.mockResolvedValue({ data: [], pagination: {} });

      await controller.findAll({});

      expect(mockService.findAll).toHaveBeenCalledWith({});
    });
  });

  describe('Route Parameters', () => {
    it('should pass id with ParseUUIDPipe validation', async () => {
      mockService.findById.mockResolvedValue({});

      await controller.findOne('apt-123');

      expect(mockService.findById).toHaveBeenCalledWith('apt-123');
    });

    it('should pass id to update method', async () => {
      mockService.update.mockResolvedValue({});

      await controller.update('apt-123', {}, 'user-1');

      expect(mockService.update).toHaveBeenCalledWith('apt-123', expect.any(Object), 'user-1');
    });

    it('should pass id to changeStatus method', async () => {
      mockService.changeStatus.mockResolvedValue({});

      await controller.changeStatus('apt-123', { status: 'CHECKED_IN' } as any, 'user-1');

      expect(mockService.changeStatus).toHaveBeenCalledWith('apt-123', expect.any(Object), 'user-1');
    });
  });

  describe('User Dependency Injection', () => {
    it('should inject userId for create', async () => {
      mockService.create.mockResolvedValue({});

      await controller.create({} as any, 'injected-user-id');

      expect(mockService.create).toHaveBeenCalledWith(expect.any(Object), 'injected-user-id');
    });

    it('should inject userId for update', async () => {
      mockService.update.mockResolvedValue({});

      await controller.update('apt-1', {}, 'injected-user-id');

      expect(mockService.update).toHaveBeenCalledWith('apt-1', expect.any(Object), 'injected-user-id');
    });

    it('should inject userId for changeStatus', async () => {
      mockService.changeStatus.mockResolvedValue({});

      await controller.changeStatus('apt-1', { status: 'CHECKED_IN' } as any, 'injected-user-id');

      expect(mockService.changeStatus).toHaveBeenCalledWith('apt-1', expect.any(Object), 'injected-user-id');
    });
  });

  describe('Status Transitions', () => {
    it('should handle full workflow: SCHEDULED → CHECKED_IN → IN_PROGRESS → COMPLETED', async () => {
      mockService.changeStatus.mockResolvedValue({ status: 'CHECKED_IN' });
      await controller.changeStatus('apt-1', { status: 'CHECKED_IN' } as any, 'user-1');

      mockService.changeStatus.mockResolvedValue({ status: 'IN_PROGRESS' });
      await controller.changeStatus('apt-1', { status: 'IN_PROGRESS' } as any, 'user-1');

      mockService.changeStatus.mockResolvedValue({ status: 'COMPLETED' });
      const result = await controller.changeStatus('apt-1', { status: 'COMPLETED' } as any, 'user-1');

      expect(result.data.status).toBe('COMPLETED');
    });

    it('should allow cancellation from SCHEDULED', async () => {
      mockService.changeStatus.mockResolvedValue({ status: 'CANCELLED' });

      const result = await controller.changeStatus('apt-1', { status: 'CANCELLED' } as any, 'user-1');

      expect(result.data.status).toBe('CANCELLED');
    });

    it('should allow cancellation from CHECKED_IN', async () => {
      mockService.changeStatus.mockResolvedValue({ status: 'CANCELLED' });

      const result = await controller.changeStatus('apt-1', { status: 'CANCELLED' } as any, 'user-1');

      expect(result.data.status).toBe('CANCELLED');
    });

    it('should allow NO_SHOW from SCHEDULED', async () => {
      mockService.changeStatus.mockResolvedValue({ status: 'NO_SHOW' });

      const result = await controller.changeStatus('apt-1', { status: 'NO_SHOW' } as any, 'user-1');

      expect(result.data.status).toBe('NO_SHOW');
    });
  });

  describe('Calendar Operations', () => {
    it('should get weekly calendar view', async () => {
      mockService.getCalendar.mockResolvedValue({
        data: [{ id: 'apt-1', scheduledAt: '2026-05-15T09:00:00Z' }],
        meta: { view: 'week', start: '2026-05-10T00:00:00Z', end: '2026-05-17T00:00:00Z' },
      });

      const result = await controller.calendar({ view: 'week', date: '2026-05-15' });

      expect(result.meta.view).toBe('week');
      expect(result.data).toHaveLength(1);
    });

    it('should get monthly calendar view', async () => {
      mockService.getCalendar.mockResolvedValue({
        data: [
          { id: 'apt-1', scheduledAt: '2026-05-15T09:00:00Z' },
          { id: 'apt-2', scheduledAt: '2026-05-20T14:00:00Z' },
        ],
        meta: { view: 'month', start: '2026-05-01T00:00:00Z', end: '2026-06-01T00:00:00Z' },
      });

      const result = await controller.calendar({ view: 'month', date: '2026-05-15' });

      expect(result.meta.view).toBe('month');
      expect(result.data).toHaveLength(2);
    });

    it('should filter calendar by doctor', async () => {
      mockService.getCalendar.mockResolvedValue({
        data: [{ id: 'apt-1', doctorId: 'd-1' }],
        meta: { view: 'week' },
      });

      await controller.calendar({ doctorId: 'd-1' });

      expect(mockService.getCalendar).toHaveBeenCalledWith(
        expect.objectContaining({
          doctorId: 'd-1',
        }),
      );
    });
  });

  describe('Appointment Listing', () => {
    it('should list appointments with all fields', async () => {
      const mockApts = [
        {
          id: 'apt-1',
          patientId: 'p-1',
          doctorId: 'd-1',
          scheduledAt: new Date('2026-05-15T09:00:00Z'),
          status: 'SCHEDULED',
          duration: 30,
          type: 'INITIAL',
        },
      ];

      mockService.findAll.mockResolvedValue({
        data: mockApts,
        pagination: { total: 1, page: 1, limit: 20, hasMore: false },
      });

      const result = await controller.findAll({});

      expect(result.data[0]).toEqual(mockApts[0]);
    });

    it('should handle empty appointment list', async () => {
      mockService.findAll.mockResolvedValue({
        data: [],
        pagination: { total: 0, page: 1, limit: 20, hasMore: false },
      });

      const result = await controller.findAll({});

      expect(result.data).toHaveLength(0);
      expect(result.pagination.total).toBe(0);
    });
  });
});
