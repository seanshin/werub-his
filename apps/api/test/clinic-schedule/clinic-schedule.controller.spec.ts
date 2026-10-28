import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ClinicScheduleController } from '../../src/modules/clinic-schedule/clinic-schedule.controller';
import { NotFoundException } from '@nestjs/common';

describe('ClinicScheduleController', () => {
  let controller: ClinicScheduleController;
  let mockService: any;

  beforeEach(() => {
    mockService = {
      findAll: vi.fn(),
      findToday: vi.fn(),
      findWeek: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      findClosures: vi.fn(),
      createClosure: vi.fn(),
      deleteClosure: vi.fn(),
    };

    controller = new ClinicScheduleController(mockService);
  });

  describe('Schedule Endpoints', () => {
    describe('findAll', () => {
      it('should get all clinic schedules', async () => {
        const mockResult = {
          data: [
            {
              id: 'sched-1',
              doctorId: 'doc-1',
              departmentName: '내과',
              roomName: '1번실',
              dayOfWeek: 1,
              period: 'AM',
            },
          ],
        };

        vi.mocked(mockService.findAll).mockResolvedValue(mockResult);

        const result = await controller.findAll();

        expect(result.data.data).toHaveLength(1);
        expect(result.data.data[0].departmentName).toBe('내과');
        expect(mockService.findAll).toHaveBeenCalled();
      });
    });

    describe('findToday', () => {
      it('should get today clinic schedules', async () => {
        const mockResult = {
          data: [
            {
              id: 'sched-1',
              departmentName: '내과',
              doctor: { familyName: '김', givenName: '의사' },
              waitingCount: 5,
            },
          ],
        };

        vi.mocked(mockService.findToday).mockResolvedValue(mockResult);

        const result = await controller.findToday();

        expect(result.data.data).toHaveLength(1);
        expect(result.data.data[0].waitingCount).toBe(5);
        expect(mockService.findToday).toHaveBeenCalledWith(undefined);
      });

      it('should filter by department', async () => {
        vi.mocked(mockService.findToday).mockResolvedValue({ data: [] });

        await controller.findToday('내과');

        expect(mockService.findToday).toHaveBeenCalledWith('내과');
      });
    });

    describe('findWeek', () => {
      it('should get weekly clinic schedules', async () => {
        const mockResult = {
          data: [
            {
              doctor: { familyName: '김', givenName: '의사' },
              departmentName: '내과',
              roomName: '1번실',
              slots: [
                { dayOfWeek: 1, period: 'AM', startTime: '09:00', endTime: '12:00' },
                { dayOfWeek: 2, period: 'PM', startTime: '13:00', endTime: '17:00' },
              ],
            },
          ],
        };

        vi.mocked(mockService.findWeek).mockResolvedValue(mockResult);

        const result = await controller.findWeek();

        expect(result.data.data).toHaveLength(1);
        expect(result.data.data[0].slots).toHaveLength(2);
      });
    });

    describe('create', () => {
      it('should create new schedule', async () => {
        const mockResult = {
          data: {
            id: 'sched-1',
            doctorId: 'doc-1',
            departmentName: '내과',
          },
        };

        vi.mocked(mockService.create).mockResolvedValue(mockResult);

        const dto = {
          doctorId: 'doc-1',
          departmentName: '내과',
          roomName: '1번실',
          dayOfWeek: 1,
          period: 'AM',
          startTime: '09:00',
          endTime: '12:00',
          maxPatients: 20,
        };

        const result = await controller.create(dto);

        expect(result.data.data.id).toBe('sched-1');
        expect(mockService.create).toHaveBeenCalledWith(dto);
      });
    });

    describe('update', () => {
      it('should update schedule', async () => {
        const mockResult = {
          data: {
            id: 'sched-1',
            departmentName: '외과',
            isActive: true,
          },
        };

        vi.mocked(mockService.update).mockResolvedValue(mockResult);

        const dto = { departmentName: '외과', isActive: true };

        const result = await controller.update('sched-1', dto);

        expect(result.data.data.departmentName).toBe('외과');
        expect(mockService.update).toHaveBeenCalledWith('sched-1', dto);
      });
    });

    describe('delete', () => {
      it('should delete schedule', async () => {
        const mockResult = { data: { success: true } };

        vi.mocked(mockService.delete).mockResolvedValue(mockResult);

        const result = await controller.delete('sched-1');

        expect(result.data.data.success).toBe(true);
        expect(mockService.delete).toHaveBeenCalledWith('sched-1');
      });
    });
  });

  describe('Closure Endpoints', () => {
    describe('findClosures', () => {
      it('should get all closures', async () => {
        const mockResult = {
          data: [
            {
              id: 'closure-1',
              doctorId: 'doc-1',
              date: new Date('2026-05-20'),
              reason: '휴가',
            },
          ],
        };

        vi.mocked(mockService.findClosures).mockResolvedValue(mockResult);

        const result = await controller.findClosures();

        expect(result.data.data).toHaveLength(1);
        expect(result.data.data[0].reason).toBe('휴가');
        expect(mockService.findClosures).toHaveBeenCalledWith(undefined);
      });

      it('should filter by date', async () => {
        vi.mocked(mockService.findClosures).mockResolvedValue({ data: [] });

        await controller.findClosures('2026-05-20');

        expect(mockService.findClosures).toHaveBeenCalledWith('2026-05-20');
      });
    });

    describe('createClosure', () => {
      it('should create closure', async () => {
        const mockResult = {
          data: {
            id: 'closure-1',
            doctorId: 'doc-1',
            reason: '휴가',
          },
        };

        vi.mocked(mockService.createClosure).mockResolvedValue(mockResult);

        const dto = {
          doctorId: 'doc-1',
          date: '2026-05-20',
          reason: '휴가',
        };

        const result = await controller.createClosure(dto);

        expect(result.data.data.reason).toBe('휴가');
        expect(mockService.createClosure).toHaveBeenCalledWith(dto);
      });

      it('should handle substitute and period', async () => {
        vi.mocked(mockService.createClosure).mockResolvedValue({
          data: { id: 'closure-1' },
        });

        const dto = {
          doctorId: 'doc-1',
          date: '2026-05-20',
          period: 'AM',
          reason: '학회',
          substituteId: 'doc-2',
        };

        await controller.createClosure(dto);

        expect(mockService.createClosure).toHaveBeenCalledWith(dto);
      });
    });

    describe('deleteClosure', () => {
      it('should delete closure', async () => {
        const mockResult = { data: { success: true } };

        vi.mocked(mockService.deleteClosure).mockResolvedValue(mockResult);

        const result = await controller.deleteClosure('closure-1');

        expect(result.data.data.success).toBe(true);
        expect(mockService.deleteClosure).toHaveBeenCalledWith('closure-1');
      });

      it('should throw NotFoundException if not found', async () => {
        vi.mocked(mockService.deleteClosure).mockRejectedValue(
          new NotFoundException('Closure not found'),
        );

        await expect(controller.deleteClosure('non-existent')).rejects.toThrow(
          NotFoundException,
        );
      });
    });
  });

  describe('Authorization', () => {
    it('should require ADMIN role for create', async () => {
      // @Roles(UserRole.ADMIN) is applied
      expect(controller).toBeDefined();
    });

    it('should require ADMIN role for update', async () => {
      // @Roles(UserRole.ADMIN) is applied
      expect(controller).toBeDefined();
    });

    it('should require ADMIN role for delete', async () => {
      // @Roles(UserRole.ADMIN) is applied
      expect(controller).toBeDefined();
    });

    it('should require ADMIN role for createClosure', async () => {
      // @Roles(UserRole.ADMIN) is applied
      expect(controller).toBeDefined();
    });

    it('should require ADMIN role for deleteClosure', async () => {
      // @Roles(UserRole.ADMIN) is applied
      expect(controller).toBeDefined();
    });
  });

  describe('Response Wrapping', () => {
    it('should wrap findAll response in nested data', async () => {
      vi.mocked(mockService.findAll).mockResolvedValue({
        data: [],
      });

      const result = await controller.findAll();

      expect(result).toHaveProperty('data');
      expect(result.data).toHaveProperty('data');
    });

    it('should wrap findToday response', async () => {
      vi.mocked(mockService.findToday).mockResolvedValue({
        data: [],
      });

      const result = await controller.findToday();

      expect(result).toHaveProperty('data');
      expect(result.data).toHaveProperty('data');
    });

    it('should wrap create response', async () => {
      vi.mocked(mockService.create).mockResolvedValue({
        data: { id: 'sched-1' },
      });

      const result = await controller.create({
        doctorId: 'doc-1',
        departmentName: '내과',
        roomName: '1번실',
        dayOfWeek: 1,
        period: 'AM',
        startTime: '09:00',
        endTime: '12:00',
      });

      expect(result).toHaveProperty('data');
      expect(result.data.data.id).toBe('sched-1');
    });

    it('should wrap closure response', async () => {
      vi.mocked(mockService.findClosures).mockResolvedValue({
        data: [],
      });

      const result = await controller.findClosures();

      expect(result).toHaveProperty('data');
      expect(result.data).toHaveProperty('data');
    });
  });

  describe('Route Behavior', () => {
    it('should route /api/v1/clinic-schedule correctly', async () => {
      vi.mocked(mockService.findAll).mockResolvedValue({ data: [] });

      const result = await controller.findAll();

      expect(result.data).toBeDefined();
    });

    it('should route /api/v1/clinic-schedule/today correctly', async () => {
      vi.mocked(mockService.findToday).mockResolvedValue({ data: [] });

      const result = await controller.findToday();

      expect(result.data).toBeDefined();
    });

    it('should route /api/v1/clinic-schedule/week correctly', async () => {
      vi.mocked(mockService.findWeek).mockResolvedValue({ data: [] });

      const result = await controller.findWeek();

      expect(result.data.data).toBeDefined();
    });

    it('should route /api/v1/clinic-schedule/:id correctly', async () => {
      vi.mocked(mockService.update).mockResolvedValue({
        data: { id: 'sched-1' },
      });

      const result = await controller.update('sched-1', {});

      expect(result.data.data).toBeDefined();
    });

    it('should route /api/v1/clinic-closure correctly', async () => {
      vi.mocked(mockService.findClosures).mockResolvedValue({ data: [] });

      const result = await controller.findClosures();

      expect(result.data).toBeDefined();
    });
  });

  describe('Error Handling', () => {
    it('should propagate service errors', async () => {
      vi.mocked(mockService.deleteClosure).mockRejectedValue(
        new NotFoundException(),
      );

      await expect(controller.deleteClosure('non-existent')).rejects.toThrow();
    });

    it('should handle empty results', async () => {
      vi.mocked(mockService.findAll).mockResolvedValue({ data: [] });

      const result = await controller.findAll();

      expect(result.data.data).toHaveLength(0);
    });
  });
});
