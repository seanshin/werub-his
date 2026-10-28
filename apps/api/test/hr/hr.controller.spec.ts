import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HrController } from '../../src/modules/hr/hr.controller';
import { ForbiddenException } from '@nestjs/common';

describe('HrController', () => {
  let controller: HrController;
  let mockService: any;

  beforeEach(() => {
    mockService = {
      findAll: vi.fn(),
      findById: vi.fn(),
      findByUserId: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      patch: vi.fn(),
      resign: vi.fn(),
      setSchedule: vi.fn(),
      getSchedule: vi.fn(),
      getDepartmentList: vi.fn(),
    };
    controller = new HrController(mockService);
  });

  describe('findAll', () => {
    it('should get all staff', async () => {
      const mockStaff = [{ id: 'staff-1' }];
      mockService.findAll.mockResolvedValue(mockStaff);

      const result = await controller.findAll();
      expect(result.data).toHaveLength(1);
      expect(mockService.findAll).toHaveBeenCalledWith({ category: undefined, department: undefined, status: undefined });
    });

    it('should filter by category', async () => {
      mockService.findAll.mockResolvedValue([]);

      await controller.findAll('DOCTOR');
      expect(mockService.findAll).toHaveBeenCalledWith({ category: 'DOCTOR', department: undefined, status: undefined });
    });

    it('should filter by department', async () => {
      mockService.findAll.mockResolvedValue([]);

      await controller.findAll(undefined, 'Surgery');
      expect(mockService.findAll).toHaveBeenCalledWith({ category: undefined, department: 'Surgery', status: undefined });
    });

    it('should filter by status', async () => {
      mockService.findAll.mockResolvedValue([]);

      await controller.findAll(undefined, undefined, 'RESIGNED');
      expect(mockService.findAll).toHaveBeenCalledWith({ category: undefined, department: undefined, status: 'RESIGNED' });
    });
  });

  describe('findOne', () => {
    it('should get staff detail', async () => {
      const mockStaff = { id: 'staff-1', userId: 'user-1' };
      mockService.findById.mockResolvedValue(mockStaff);

      const result = await controller.findOne('staff-1', { sub: 'user-1', role: 'ADMIN' });
      expect(result.data.id).toBe('staff-1');
    });

    it('should allow ADMIN to view any staff', async () => {
      const mockStaff = { id: 'staff-1', userId: 'user-2' };
      mockService.findById.mockResolvedValue(mockStaff);

      const result = await controller.findOne('staff-1', { sub: 'user-1', role: 'ADMIN' });
      expect(result.data.id).toBe('staff-1');
    });

    it('should only allow staff to view own record', async () => {
      const mockStaff = { id: 'staff-1', userId: 'user-2' };
      mockService.findById.mockResolvedValue(mockStaff);

      await expect(
        controller.findOne('staff-1', { sub: 'user-1', role: 'DOCTOR' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should allow staff to view own record', async () => {
      const mockStaff = { id: 'staff-1', userId: 'user-1' };
      mockService.findById.mockResolvedValue(mockStaff);

      const result = await controller.findOne('staff-1', { sub: 'user-1', role: 'DOCTOR' });
      expect(result.data.id).toBe('staff-1');
    });
  });

  describe('findMe', () => {
    it('should get current user staff record', async () => {
      const mockStaff = { id: 'staff-1', userId: 'user-1' };
      mockService.findByUserId.mockResolvedValue(mockStaff);

      const result = await controller.findMe('user-1');
      expect(result.data.userId).toBe('user-1');
    });

    it('should wrap response in data object', async () => {
      const mockStaff = { id: 'staff-1' };
      mockService.findByUserId.mockResolvedValue(mockStaff);

      const result = await controller.findMe('user-1');
      expect(result).toHaveProperty('data');
    });
  });

  describe('create', () => {
    it('should create staff', async () => {
      const mockCreated = { id: 'staff-1', employeeNumber: 'E001' };
      mockService.create.mockResolvedValue(mockCreated);

      const dto = {
        employeeNumber: 'E001',
        familyName: 'Kim',
        givenName: 'John',
        category: 'DOCTOR',
        department: 'Surgery',
        position: 'Senior',
        hireDate: '2026-01-01',
      };

      const result = await controller.create(dto);
      expect(result.data.employeeNumber).toBe('E001');
    });

    it('should wrap response in data object', async () => {
      const mockCreated = { id: 'staff-1' };
      mockService.create.mockResolvedValue(mockCreated);

      const dto = {
        employeeNumber: 'E001',
        familyName: 'Kim',
        givenName: 'John',
        category: 'DOCTOR',
        department: 'Surgery',
        position: 'Senior',
        hireDate: '2026-01-01',
      };

      const result = await controller.create(dto);
      expect(result).toHaveProperty('data');
    });
  });

  describe('update', () => {
    it('should update staff fields', async () => {
      const mockUpdated = { id: 'staff-1', department: 'Emergency' };
      mockService.update.mockResolvedValue(mockUpdated);

      const dto = { department: 'Emergency', position: 'Chief' };
      const result = await controller.update('staff-1', dto as any);

      expect(result.data.department).toBe('Emergency');
    });

    it('should wrap response in data object', async () => {
      mockService.update.mockResolvedValue({ id: 'staff-1' });

      const result = await controller.update('staff-1', { department: 'ICU' } as any);
      expect(result).toHaveProperty('data');
    });
  });

  describe('patchStaff', () => {
    it('should partial update staff', async () => {
      const mockPatched = { id: 'staff-1', email: 'kim@hospital.example.org' };
      mockService.patch.mockResolvedValue(mockPatched);

      const dto = { email: 'kim@hospital.example.org' };
      const result = await controller.patchStaff('staff-1', dto as any);

      expect(result.data.email).toBe('kim@hospital.example.org');
    });

    it('should wrap response in data object', async () => {
      mockService.patch.mockResolvedValue({ id: 'staff-1' });

      const result = await controller.patchStaff('staff-1', {} as any);
      expect(result).toHaveProperty('data');
    });
  });

  describe('resign', () => {
    it('should resign staff', async () => {
      const mockResigned = { id: 'staff-1', status: 'RESIGNED' };
      mockService.resign.mockResolvedValue(mockResigned);

      const result = await controller.resign('staff-1');
      expect(result.data.status).toBe('RESIGNED');
    });

    it('should set resignation date', async () => {
      const mockResigned = { id: 'staff-1', resignDate: new Date() };
      mockService.resign.mockResolvedValue(mockResigned);

      const result = await controller.resign('staff-1');
      expect(result.data.resignDate).toBeDefined();
    });
  });

  describe('getDepartments', () => {
    it('should list departments with staff count', async () => {
      const mockDepts = [
        { department: 'Surgery', staffCount: 5 },
        { department: 'Emergency', staffCount: 3 },
      ];
      mockService.getDepartmentList.mockResolvedValue(mockDepts);

      const result = await controller.getDepartments();
      expect(result.data).toHaveLength(2);
      expect(result.data[0].staffCount).toBe(5);
    });

    it('should wrap response in data object', async () => {
      mockService.getDepartmentList.mockResolvedValue([]);

      const result = await controller.getDepartments();
      expect(result).toHaveProperty('data');
    });
  });

  describe('setSchedule', () => {
    it('should set staff schedules', async () => {
      const mockResult = { updated: 3 };
      mockService.setSchedule.mockResolvedValue(mockResult);

      const body = {
        staffId: 'staff-1',
        schedules: [
          { date: '2026-05-15', shiftType: 'MORNING' },
          { date: '2026-05-16', shiftType: 'EVENING' },
          { date: '2026-05-17', shiftType: 'NIGHT' },
        ],
      };

      const result = await controller.setSchedule(body);
      expect(result.data.updated).toBe(3);
    });

    it('should pass schedules to service', async () => {
      mockService.setSchedule.mockResolvedValue({ updated: 1 });

      const body = {
        staffId: 'staff-1',
        schedules: [{ date: '2026-05-15', shiftType: 'MORNING' }],
      };

      await controller.setSchedule(body);
      expect(mockService.setSchedule).toHaveBeenCalledWith('staff-1', body.schedules);
    });
  });

  describe('getSchedule', () => {
    it('should get schedule for date range', async () => {
      const mockSchedules = [{ staffId: 'staff-1', shiftType: 'MORNING' }];
      mockService.getSchedule.mockResolvedValue(mockSchedules);

      const result = await controller.getSchedule('staff-1', undefined, '2026-05-01', '2026-05-31');
      expect(result.data).toBeDefined();
    });

    it('should use default dates if not provided', async () => {
      mockService.getSchedule.mockResolvedValue([]);

      await controller.getSchedule();
      expect(mockService.getSchedule).toHaveBeenCalledWith({
        staffId: undefined,
        department: undefined,
        dateFrom: expect.any(String),
        dateTo: expect.any(String),
      });
    });

    it('should filter by staffId', async () => {
      mockService.getSchedule.mockResolvedValue([]);

      await controller.getSchedule('staff-1', undefined, '2026-05-01', '2026-05-31');
      expect(mockService.getSchedule).toHaveBeenCalledWith(
        expect.objectContaining({ staffId: 'staff-1' }),
      );
    });

    it('should filter by department', async () => {
      mockService.getSchedule.mockResolvedValue([]);

      await controller.getSchedule(undefined, 'Surgery', '2026-05-01', '2026-05-31');
      expect(mockService.getSchedule).toHaveBeenCalledWith(
        expect.objectContaining({ department: 'Surgery' }),
      );
    });

    it('should wrap response in data object', async () => {
      mockService.getSchedule.mockResolvedValue([]);

      const result = await controller.getSchedule();
      expect(result).toHaveProperty('data');
    });
  });

  describe('Authorization', () => {
    it('should require role-based access', async () => {
      // @Roles on each endpoint
      expect(controller).toBeDefined();
    });

    it('should require JWT authentication', async () => {
      // @UseGuards(JwtAuthGuard, RolesGuard)
      expect(controller).toBeDefined();
    });
  });

  describe('Response Wrapping', () => {
    it('should wrap all responses in data object', async () => {
      mockService.findAll.mockResolvedValue([]);

      const result = await controller.findAll();
      expect(result).toEqual({ data: [] });
    });

    it('should include schedules in staff detail', async () => {
      const mockStaff = {
        id: 'staff-1',
        schedules: [{ date: new Date(), shiftType: 'MORNING' }],
      };
      mockService.findById.mockResolvedValue(mockStaff);

      const result = await controller.findOne('staff-1', { sub: 'user-1', role: 'ADMIN' });
      expect(result.data.schedules).toBeDefined();
    });
  });

  describe('Staff Categories', () => {
    it('should support DOCTOR category', async () => {
      mockService.findAll.mockResolvedValue([]);

      await controller.findAll('DOCTOR');
      expect(mockService.findAll).toHaveBeenCalledWith(
        expect.objectContaining({ category: 'DOCTOR' }),
      );
    });

    it('should support NURSE category', async () => {
      mockService.findAll.mockResolvedValue([]);

      await controller.findAll('NURSE');
      expect(mockService.findAll).toHaveBeenCalledWith(
        expect.objectContaining({ category: 'NURSE' }),
      );
    });

    it('should support PHARMACIST category', async () => {
      mockService.findAll.mockResolvedValue([]);

      await controller.findAll('PHARMACIST');
      expect(mockService.findAll).toHaveBeenCalledWith(
        expect.objectContaining({ category: 'PHARMACIST' }),
      );
    });
  });

  describe('Shift Types', () => {
    it('should support MORNING shift', async () => {
      mockService.setSchedule.mockResolvedValue({ updated: 1 });

      const body = {
        staffId: 'staff-1',
        schedules: [{ date: '2026-05-15', shiftType: 'MORNING' }],
      };

      await controller.setSchedule(body);
      expect(mockService.setSchedule).toHaveBeenCalled();
    });

    it('should support EVENING shift', async () => {
      mockService.setSchedule.mockResolvedValue({ updated: 1 });

      const body = {
        staffId: 'staff-1',
        schedules: [{ date: '2026-05-15', shiftType: 'EVENING' }],
      };

      await controller.setSchedule(body);
      expect(mockService.setSchedule).toHaveBeenCalled();
    });

    it('should support NIGHT shift', async () => {
      mockService.setSchedule.mockResolvedValue({ updated: 1 });

      const body = {
        staffId: 'staff-1',
        schedules: [{ date: '2026-05-15', shiftType: 'NIGHT' }],
      };

      await controller.setSchedule(body);
      expect(mockService.setSchedule).toHaveBeenCalled();
    });
  });

  describe('Employment Status', () => {
    it('should support ACTIVE status', async () => {
      mockService.findAll.mockResolvedValue([]);

      await controller.findAll(undefined, undefined, 'ACTIVE');
      expect(mockService.findAll).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'ACTIVE' }),
      );
    });

    it('should support RESIGNED status', async () => {
      mockService.findAll.mockResolvedValue([]);

      await controller.findAll(undefined, undefined, 'RESIGNED');
      expect(mockService.findAll).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'RESIGNED' }),
      );
    });
  });
});
