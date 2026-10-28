import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UserController } from '../../src/modules/user/user.controller';
import { UserService } from '../../src/modules/user/user.service';

describe('UserController', () => {
  let controller: UserController;
  let service: UserService;

  beforeEach(() => {
    service = {
      findAll: vi.fn(),
      findById: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      resetPassword: vi.fn(),
      deactivate: vi.fn(),
      activate: vi.fn(),
      getOrgChart: vi.fn(),
    } as any;

    controller = new UserController(service);
  });

  describe('GET / (findAll)', () => {
    it('should return all users', async () => {
      const mockUsers = [
        {
          id: 'user-1',
          email: 'lee@hospital.example',
          familyName: '이',
          givenName: '의사',
          role: 'DOCTOR',
          department: 'INTERNAL_MEDICINE',
          isActive: true,
        },
        {
          id: 'user-2',
          email: 'kim@hospital.example',
          familyName: '김',
          givenName: '간호',
          role: 'NURSE',
          department: 'INTERNAL_MEDICINE',
          isActive: true,
        },
      ];

      vi.mocked(service.findAll).mockResolvedValue(mockUsers);

      const result = await controller.findAll();

      expect(result.data).toHaveLength(2);
      expect(result.data[0].id).toBe('user-1');
      expect(service.findAll).toHaveBeenCalled();
    });

    it('should return empty list', async () => {
      vi.mocked(service.findAll).mockResolvedValue([]);

      const result = await controller.findAll();

      expect(result.data).toEqual([]);
    });
  });

  describe('GET /doctors', () => {
    it('should return only doctors', async () => {
      const mockUsers = [
        {
          id: 'user-1',
          email: 'lee@hospital.example',
          familyName: '이',
          givenName: '의사',
          role: 'DOCTOR',
          department: 'INTERNAL_MEDICINE',
        },
        {
          id: 'user-2',
          email: 'kim@hospital.example',
          familyName: '김',
          givenName: '간호',
          role: 'NURSE',
          department: 'INTERNAL_MEDICINE',
        },
      ];

      vi.mocked(service.findAll).mockResolvedValue(mockUsers);

      const result = await controller.findDoctors();

      expect(result.data).toHaveLength(1);
      expect(result.data[0].role).toBe('DOCTOR');
      expect(service.findAll).toHaveBeenCalled();
    });
  });

  describe('GET /:id (findOne)', () => {
    it('should return user by id', async () => {
      const mockUser = {
        id: 'user-1',
        email: 'lee@hospital.example',
        familyName: '이',
        givenName: '의사',
        role: 'DOCTOR',
        department: 'INTERNAL_MEDICINE',
        isActive: true,
      };

      vi.mocked(service.findById).mockResolvedValue(mockUser);

      const result = await controller.findOne('user-1');

      expect(result.data.id).toBe('user-1');
      expect(result.data.familyName).toBe('이');
      expect(service.findById).toHaveBeenCalledWith('user-1');
    });
  });

  describe('create', () => {
    it('should create new user', async () => {
      const dto = {
        email: 'newdoctor@hospital.example',
        password: 'securePassword123',
        familyName: '박',
        givenName: '의사',
        role: 'DOCTOR',
        department: 'SURGERY',
      };

      const mockCreatedUser = {
        id: 'user-3',
        ...dto,
        createdAt: new Date(),
      };

      vi.mocked(service.create).mockResolvedValue(mockCreatedUser);

      const result = await controller.create(dto);

      expect(result.data.id).toBe('user-3');
      expect(result.data.email).toBe('newdoctor@hospital.example');
      expect(service.create).toHaveBeenCalledWith(dto);
    });
  });

  describe('update', () => {
    it('should update user information', async () => {
      const updateDto = {
        givenName: '의사(수정)',
        specialty: 'Cardiology',
      };

      const mockUpdatedUser = {
        id: 'user-1',
        email: 'lee@hospital.example',
        familyName: '이',
        givenName: '의사(수정)',
        role: 'DOCTOR',
        department: 'INTERNAL_MEDICINE',
        specialty: 'Cardiology',
        isActive: true,
      };

      vi.mocked(service.update).mockResolvedValue(mockUpdatedUser);

      const result = await controller.update('user-1', updateDto);

      expect(result.data.givenName).toBe('의사(수정)');
      expect(service.update).toHaveBeenCalledWith('user-1', updateDto);
    });
  });

  describe('resetPassword', () => {
    it('should reset user password', async () => {
      const dto = { newPassword: 'tempPassword123' };

      vi.mocked(service.resetPassword).mockResolvedValue({ message: 'Password reset successfully' });

      const result = await controller.resetPassword('user-1', dto);

      expect(result.data.message).toBe('Password reset successfully');
      expect(service.resetPassword).toHaveBeenCalledWith('user-1', dto.newPassword);
    });
  });

  describe('PATCH /:id/deactivate', () => {
    it('should deactivate user', async () => {
      vi.mocked(service.deactivate).mockResolvedValue(undefined);

      const result = await controller.deactivate('user-1');

      expect(result.data.message).toBe('User deactivated');
      expect(service.deactivate).toHaveBeenCalledWith('user-1');
    });
  });

  describe('PATCH /:id/activate', () => {
    it('should activate user', async () => {
      vi.mocked(service.activate).mockResolvedValue(undefined);

      const result = await controller.activate('user-1');

      expect(result.data.message).toBe('User activated');
      expect(service.activate).toHaveBeenCalledWith('user-1');
    });
  });

  describe('getOrgChart', () => {
    it('should return organization chart', async () => {
      const mockOrgChart = [
        {
          department: 'INTERNAL_MEDICINE',
          members: [
            {
              id: 'user-1',
              familyName: '이',
              givenName: '의사',
              role: 'DOCTOR',
              department: 'INTERNAL_MEDICINE',
            },
          ],
          count: 1,
        },
      ];

      vi.mocked(service.getOrgChart).mockResolvedValue(mockOrgChart);

      const result = await controller.getOrgChart();

      expect(result.data).toHaveLength(1);
      expect(result.data[0]).toHaveProperty('department');
      expect(result.data[0]).toHaveProperty('members');
      expect(result.data[0]).toHaveProperty('count');
      expect(service.getOrgChart).toHaveBeenCalled();
    });
  });
});
