import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NotFoundException, ConflictException } from '@nestjs/common';
import { VipPatientService } from '../../src/modules/audit-enhanced/vip-patient.service';

/**
 * 🔴 W8 — 이 스펙은 종전에 **폐지된 정본**(`vip_patients`)을 계약으로 굳혀두고 있었다.
 * 실제 화면(`/admin/patient-flags`)은 `patient_flags(flagType='VIP')` 에 쓰고 있었고
 * 이상탐지는 `vip_patients`(운영 0행)를 읽어, **VIP 접근 경보가 구조적으로 불가능**했다.
 * 정본을 `patient_flags` 하나로 모으고(vip-canonical.ts) 스펙을 그 정본으로 갱신한다.
 */
describe('VipPatientService (정본 = patient_flags flagType=VIP)', () => {
  let service: VipPatientService;
  let mockPrisma: any;

  const mockFlag = {
    id: 'flag-1',
    patientId: 'patient-1',
    flagType: 'VIP',
    reason: 'VIP status',
    flaggedBy: 'user-1',
    isActive: true,
    createdAt: new Date('2026-05-14T10:00:00Z'),
    patient: { id: 'patient-1', mrn: 'MRN001', familyName: '박', givenName: '환자' },
  };

  beforeEach(() => {
    mockPrisma = {
      patientFlag: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
        upsert: vi.fn(),
        updateMany: vi.fn(),
        count: vi.fn(),
      },
      user: {
        findMany: vi.fn().mockResolvedValue([{ id: 'user-1', familyName: '김', givenName: '의사' }]),
      },
    };

    service = new VipPatientService(mockPrisma);
  });

  describe('designate', () => {
    it('should designate patient as VIP', async () => {
      mockPrisma.patientFlag.findFirst.mockResolvedValue(null);
      mockPrisma.patientFlag.upsert.mockResolvedValue(mockFlag);

      const result = await service.designate('patient-1', 'Important patient', 'user-1');

      expect(result.patientId).toBe('patient-1');
      expect(result.designator?.id).toBe('user-1');
    });

    it('🔴 정본 테이블(patient_flags)에 쓴다 — 화면·이상탐지와 같은 곳', async () => {
      mockPrisma.patientFlag.findFirst.mockResolvedValue(null);
      mockPrisma.patientFlag.upsert.mockResolvedValue(mockFlag);

      await service.designate('patient-1', 'reason', 'user-1');

      const arg = mockPrisma.patientFlag.upsert.mock.calls[0][0];
      expect(arg.create).toEqual(
        expect.objectContaining({ patientId: 'patient-1', flagType: 'VIP', isActive: true }),
      );
      expect(mockPrisma.vipPatient).toBeUndefined(); // 폐지된 정본에 쓰지 않는다
    });

    it('should throw ConflictException if already VIP', async () => {
      mockPrisma.patientFlag.findFirst.mockResolvedValue(mockFlag);

      await expect(service.designate('patient-1', 'reason', 'user-1')).rejects.toThrow(
        ConflictException,
      );
    });

    it('should include patient and designator details', async () => {
      mockPrisma.patientFlag.findFirst.mockResolvedValue(null);
      mockPrisma.patientFlag.upsert.mockResolvedValue(mockFlag);

      const result = await service.designate('patient-1', 'reason', 'user-1');

      expect(result.patient).toBeDefined();
      expect(result.designator).toBeDefined();
    });

    it('should allow empty reason', async () => {
      mockPrisma.patientFlag.findFirst.mockResolvedValue(null);
      mockPrisma.patientFlag.upsert.mockResolvedValue({ ...mockFlag, reason: null });

      const result = await service.designate('patient-1', undefined, 'user-1');

      expect(result.patientId).toBe('patient-1');
      expect(result.reason).toBeNull();
    });
  });

  describe('findAll', () => {
    it('should return all VIP patients', async () => {
      mockPrisma.patientFlag.findMany.mockResolvedValue([mockFlag]);

      const result = await service.findAll();

      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(1);
    });

    it('should include patient and designator details', async () => {
      mockPrisma.patientFlag.findMany.mockResolvedValue([mockFlag]);

      const result = await service.findAll();

      expect(result[0].patient).toBeDefined();
      expect(result[0].designator).toBeDefined();
    });

    it('should only read active VIP flags, ordered by createdAt desc', async () => {
      mockPrisma.patientFlag.findMany.mockResolvedValue([mockFlag]);

      await service.findAll();

      expect(mockPrisma.patientFlag.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { flagType: 'VIP', isActive: true },
          orderBy: { createdAt: 'desc' },
        }),
      );
    });

    it('should return empty array if no VIPs', async () => {
      mockPrisma.patientFlag.findMany.mockResolvedValue([]);

      const result = await service.findAll();

      expect(result).toEqual([]);
    });
  });

  describe('remove', () => {
    it('should remove VIP designation', async () => {
      mockPrisma.patientFlag.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.remove('patient-1');

      expect(result.patientId).toBe('patient-1');
    });

    it('여러 직원이 찍은 표식을 모두 내린다', async () => {
      mockPrisma.patientFlag.updateMany.mockResolvedValue({ count: 3 });

      const result = await service.remove('patient-1');

      expect(result.removed).toBe(3);
      expect(mockPrisma.patientFlag.updateMany).toHaveBeenCalledWith({
        where: { flagType: 'VIP', isActive: true, patientId: 'patient-1' },
        data: { isActive: false },
      });
    });

    it('should throw NotFoundException if not VIP', async () => {
      mockPrisma.patientFlag.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.remove('nonexistent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('isVip', () => {
    it('should return true if patient is VIP', async () => {
      mockPrisma.patientFlag.count.mockResolvedValue(1);

      expect(await service.isVip('patient-1')).toBe(true);
    });

    it('should return false if patient is not VIP', async () => {
      mockPrisma.patientFlag.count.mockResolvedValue(0);

      expect(await service.isVip('patient-1')).toBe(false);
    });

    it('🔴 이상탐지와 같은 조건식을 쓴다(정본 단일)', async () => {
      mockPrisma.patientFlag.count.mockResolvedValue(0);

      await service.isVip('patient-123');

      expect(mockPrisma.patientFlag.count).toHaveBeenCalledWith({
        where: { flagType: 'VIP', isActive: true, patientId: 'patient-123' },
      });
    });
  });
});
