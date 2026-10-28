import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { UserService } from '../../src/modules/user/user.service';

describe('UserService', () => {
  let service: UserService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      user: {
        findMany: vi.fn(),
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
    };

    service = new UserService(mockPrisma);
  });

  describe('findAll', () => {
    it('should return all users sorted by department and role', async () => {
      const mockUsers = [
        {
          id: 'user-1',
          email: 'lee@hospital.example',
          familyName: '이',
          givenName: '의사',
          role: 'DOCTOR',
          department: 'INTERNAL_MEDICINE',
          specialty: 'Cardiology',
          isActive: true,
          lastLoginAt: new Date(),
          createdAt: new Date(),
        },
        {
          id: 'user-2',
          email: 'kim@hospital.example',
          familyName: '김',
          givenName: '간호',
          role: 'NURSE',
          department: 'INTERNAL_MEDICINE',
          specialty: null,
          isActive: true,
          lastLoginAt: new Date(),
          createdAt: new Date(),
        },
      ];

      mockPrisma.user.findMany.mockResolvedValue(mockUsers);

      const result = await service.findAll();

      expect(result).toHaveLength(2);
      expect(result[0].familyName).toBe('이');
      expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: expect.arrayContaining([{ department: 'asc' }]),
        })
      );
    });

    it('should return empty list when no users exist', async () => {
      mockPrisma.user.findMany.mockResolvedValue([]);

      const result = await service.findAll();

      expect(result).toEqual([]);
    });
  });

  describe('findById', () => {
    it('should return user by id', async () => {
      const mockUser = {
        id: 'user-1',
        email: 'lee@hospital.example',
        familyName: '이',
        givenName: '의사',
        role: 'DOCTOR',
        department: 'INTERNAL_MEDICINE',
        specialty: 'Cardiology',
        isActive: true,
        lastLoginAt: new Date(),
        createdAt: new Date(),
      };

      mockPrisma.user.findUnique.mockResolvedValue(mockUser);

      const result = await service.findById('user-1');

      expect(result.id).toBe('user-1');
      expect(result.familyName).toBe('이');
      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-1' },
        })
      );
    });

    it('should throw NotFoundException if user not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(service.findById('invalid-id')).rejects.toThrow(NotFoundException);
    });
  });

  describe('create', () => {
    it('should create new user with hashed password', async () => {
      const dto = {
        email: 'newdoctor@hospital.example',
        password: 'securePassword123!',
        familyName: '박',
        givenName: '의사',
        role: 'DOCTOR',
        department: 'SURGERY',
        specialty: 'General Surgery',
      };

      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue({
        id: 'user-3',
        email: dto.email,
        familyName: dto.familyName,
        givenName: dto.givenName,
        role: dto.role,
        department: dto.department,
        specialty: dto.specialty,
        createdAt: new Date(),
      });

      const result = await service.create(dto);

      expect(result.id).toBe('user-3');
      expect(result.email).toBe('newdoctor@hospital.example');
      expect(mockPrisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            email: dto.email,
            familyName: dto.familyName,
            role: dto.role,
          }),
        })
      );
    });

    it('should throw ConflictException if email already exists', async () => {
      const dto = {
        email: 'existing@hospital.example',
        password: 'TempPassw0rd!23',
        familyName: '이',
        givenName: '의사',
        role: 'DOCTOR',
      };

      mockPrisma.user.findUnique.mockResolvedValue({ id: 'user-1', email: dto.email });

      await expect(service.create(dto)).rejects.toThrow(ConflictException);
    });

    it('should create user without optional fields', async () => {
      const dto = {
        email: 'admin@hospital.example',
        password: 'adminPassword123!',
        familyName: '관',
        givenName: '리자',
        role: 'ADMIN',
      };

      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue({
        id: 'user-4',
        email: dto.email,
        familyName: dto.familyName,
        givenName: dto.givenName,
        role: dto.role,
        department: null,
        specialty: null,
        createdAt: new Date(),
      });

      const result = await service.create(dto);

      expect(result.email).toBe('admin@hospital.example');
    });
  });

  describe('update', () => {
    it('should update user information', async () => {
      const updateDto = {
        givenName: '의사(수정)',
        specialty: 'Cardiology',
      };

      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'lee@hospital.example',
      });

      mockPrisma.user.update.mockResolvedValue({
        id: 'user-1',
        email: 'lee@hospital.example',
        familyName: '이',
        givenName: '의사(수정)',
        role: 'DOCTOR',
        department: 'INTERNAL_MEDICINE',
        specialty: 'Cardiology',
        isActive: true,
      });

      const result = await service.update('user-1', updateDto);

      expect(result.givenName).toBe('의사(수정)');
      expect(result.specialty).toBe('Cardiology');
    });

    it('should hash new password when updating', async () => {
      // 정책 정본(12자+대소문자·숫자·특수문자) 통과 비밀번호 — update 뒷문 봉합(R9-④) 후에도 해시된다
      const updateDto = {
        password: 'newPassword123!',
      };

      mockPrisma.user.findUnique.mockResolvedValue({ id: 'user-1', email: 'lee@hospital.example' });
      mockPrisma.user.update.mockResolvedValue({
        id: 'user-1',
        email: 'lee@hospital.example',
        familyName: '이',
        givenName: '의사',
        role: 'DOCTOR',
        department: 'INTERNAL_MEDICINE',
        specialty: 'Cardiology',
        isActive: true,
      });

      await service.update('user-1', updateDto);

      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-1' },
          data: expect.objectContaining({
            passwordHash: expect.any(String),
          }),
        })
      );
    });

    it('update 도 비밀번호 정책 정본을 지난다 — 약한 비밀번호는 400 (R9-④ 뒷문 봉합)', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'user-1', email: 'lee@hospital.example' });
      await expect(service.update('user-1', { password: 'short1!' } as never)).rejects.toThrow('비밀번호 정책 위반');
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException if user not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(service.update('invalid-id', { givenName: 'new' })).rejects.toThrow(
        NotFoundException
      );
    });
  });

  /**
   * 🔴 픽스처를 정책에 맞추는 것만으로는 아무것도 보증하지 않는다 —
   *    **약한 비밀번호가 실제로 거부되는지**를 함께 센다(2026-08-28 정책 정본화).
   */
  describe('🔴 비밀번호 정책 — 생성·초기화가 선언 기준 아래로 새지 않는다', () => {
    const WEAK = [
      ['짧다', 'Ab1!efg'],
      ['특수문자 없음', 'securePassword123'],
      ['대문자 없음', 'securepassword123!'],
      ['숫자 없음', 'securePassword!!'],
      ['동일문자 3회', 'Aaaa1234567!'],
    ] as const;

    for (const [why, pw] of WEAK) {
      it(`생성 거부 — ${why}`, async () => {
        mockPrisma.user.findUnique.mockResolvedValue(null);
        await expect(service.create({ email: 'x@y.example', password: pw, name: 'x', role: 'DOCTOR' } as never))
          .rejects.toThrow(/비밀번호 정책/);
      });

      it(`초기화 거부 — ${why}`, async () => {
        mockPrisma.user.findUnique.mockResolvedValue({ id: 'user-1', email: 'x@y.example' });
        await expect(service.resetPassword('user-1', pw)).rejects.toThrow(/비밀번호 정책/);
      });
    }
  });

  describe('resetPassword', () => {
    it('should reset user password', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'user-1', email: 'lee@hospital.example' });
      mockPrisma.user.update.mockResolvedValue({ id: 'user-1' });

      const result = await service.resetPassword('user-1', 'newTempPassword123!');

      expect(result).toHaveProperty('message');
      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-1' },
          data: expect.objectContaining({
            passwordHash: expect.any(String),
          }),
        })
      );
    });

    it('should throw NotFoundException if user not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(service.resetPassword('invalid-id', 'newPassword')).rejects.toThrow(
        NotFoundException
      );
    });
  });

  describe('deactivate', () => {
    it('should deactivate user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'user-1', email: 'lee@hospital.example' });
      mockPrisma.user.update.mockResolvedValue({ id: 'user-1', isActive: false });

      const result = await service.deactivate('user-1');

      expect(result.isActive).toBe(false);
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { isActive: false },
      });
    });

    it('should throw NotFoundException if user not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(service.deactivate('invalid-id')).rejects.toThrow(NotFoundException);
    });
  });

  describe('activate', () => {
    it('should activate deactivated user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'user-1', email: 'lee@hospital.example' });
      mockPrisma.user.update.mockResolvedValue({ id: 'user-1', isActive: true });

      const result = await service.activate('user-1');

      expect(result.isActive).toBe(true);
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { isActive: true },
      });
    });
  });

  describe('getOrgChart', () => {
    it('should return organization structure', async () => {
      const mockUsers = [
        {
          id: 'user-1',
          familyName: '이',
          givenName: '의사',
          role: 'DOCTOR',
          department: 'INTERNAL_MEDICINE',
          specialty: 'Cardiology',
        },
        {
          id: 'user-2',
          familyName: '김',
          givenName: '간호',
          role: 'NURSE',
          department: 'INTERNAL_MEDICINE',
          specialty: null,
        },
        {
          id: 'user-3',
          familyName: '박',
          givenName: '의사',
          role: 'DOCTOR',
          department: 'SURGERY',
          specialty: 'General Surgery',
        },
      ];

      mockPrisma.user.findMany.mockResolvedValue(mockUsers);

      const result = await service.getOrgChart();

      expect(result).toHaveLength(2); // 2 departments
      expect(result[0]).toHaveProperty('department');
      expect(result[0]).toHaveProperty('members');
      expect(result[0]).toHaveProperty('count');
      expect(result.find((d: any) => d.department === 'INTERNAL_MEDICINE').count).toBe(2);
    });

    it('should exclude inactive users', async () => {
      mockPrisma.user.findMany.mockResolvedValue([]);

      const result = await service.getOrgChart();

      expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { isActive: true },
        })
      );
    });
  });
});
