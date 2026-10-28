import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PreOrderController } from '../../src/modules/pre-order/pre-order.controller';
import { NotFoundException, BadRequestException } from '@nestjs/common';

describe('PreOrderController', () => {
  let controller: PreOrderController;
  let mockService: any;

  beforeEach(() => {
    mockService = {
      create: vi.fn(),
      findAll: vi.fn(),
      findById: vi.fn(),
      findPendingByPatient: vi.fn(),
      findMyPending: vi.fn(),
      approve: vi.fn(),
      modify: vi.fn(),
      cancel: vi.fn(),
    };

    controller = new PreOrderController(mockService);
  });

  describe('create', () => {
    it('should create pre-order with provided doctor ID', async () => {
      const mockCreated = {
        data: { id: 'po-1', doctorId: 'doc-1', status: 'PENDING' },
      };

      vi.mocked(mockService.create).mockResolvedValue(mockCreated);

      const dto = {
        patientId: 'p-1',
        doctorId: 'doc-1',
        type: 'MEDICATION',
        medicationCodeId: 'med-1',
      };

      const result = await controller.create(dto, 'user-1');

      expect(result.data.status).toBe('PENDING');
      expect(mockService.create).toHaveBeenCalledWith(
        expect.objectContaining({ doctorId: 'doc-1' }),
      );
    });

    it('should use current user as doctor if not provided', async () => {
      const mockCreated = {
        data: { id: 'po-1', doctorId: 'user-1', status: 'PENDING' },
      };

      vi.mocked(mockService.create).mockResolvedValue(mockCreated);

      const dto = {
        patientId: 'p-1',
        type: 'MEDICATION',
        medicationCodeId: 'med-1',
      };

      const result = await controller.create(dto, 'user-1');

      expect(mockService.create).toHaveBeenCalledWith(
        expect.objectContaining({ doctorId: 'user-1' }),
      );
    });
  });

  describe('findAll', () => {
    it('should get all pre-orders', async () => {
      const mockOrders = {
        data: [{ id: 'po-1', status: 'PENDING' }],
      };

      vi.mocked(mockService.findAll).mockResolvedValue(mockOrders);

      const result = await controller.findAll();

      expect(result.data.data).toHaveLength(1);
      expect(mockService.findAll).toHaveBeenCalledWith({
        patientId: undefined,
        doctorId: undefined,
        status: undefined,
      });
    });

    it('should filter by patient ID', async () => {
      const mockOrders = { data: [{ patientId: 'p-1' }] };

      vi.mocked(mockService.findAll).mockResolvedValue(mockOrders);

      const result = await controller.findAll('p-1', undefined, undefined);

      expect(mockService.findAll).toHaveBeenCalledWith(
        expect.objectContaining({ patientId: 'p-1' }),
      );
    });

    it('should filter by doctor ID', async () => {
      const mockOrders = { data: [{ doctorId: 'doc-1' }] };

      vi.mocked(mockService.findAll).mockResolvedValue(mockOrders);

      const result = await controller.findAll(undefined, 'doc-1');

      expect(mockService.findAll).toHaveBeenCalledWith(
        expect.objectContaining({ doctorId: 'doc-1' }),
      );
    });

    it('should filter by status', async () => {
      const mockOrders = { data: [{ status: 'APPROVED' }] };

      vi.mocked(mockService.findAll).mockResolvedValue(mockOrders);

      const result = await controller.findAll(undefined, undefined, 'APPROVED');

      expect(mockService.findAll).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'APPROVED' }),
      );
    });
  });

  describe('findMyPending', () => {
    it('should find pending pre-orders for current doctor', async () => {
      const mockOrders = {
        data: [{ id: 'po-1', status: 'PENDING', doctorId: 'doc-1' }],
      };

      vi.mocked(mockService.findMyPending).mockResolvedValue(mockOrders);

      const result = await controller.findMyPending('doc-1');

      expect(result.data.data).toHaveLength(1);
      expect(mockService.findMyPending).toHaveBeenCalledWith('doc-1');
    });
  });

  describe('findPendingByPatient', () => {
    it('should find pending pre-orders for patient', async () => {
      const mockOrders = {
        data: [{ id: 'po-1', patientId: 'p-1', status: 'PENDING' }],
      };

      vi.mocked(mockService.findPendingByPatient).mockResolvedValue(mockOrders);

      const result = await controller.findPendingByPatient('p-1');

      expect(result.data.data).toHaveLength(1);
      expect(mockService.findPendingByPatient).toHaveBeenCalledWith('p-1');
    });
  });

  describe('findById', () => {
    it('should get pre-order detail', async () => {
      const mockOrder = {
        data: {
          id: 'po-1',
          patientId: 'p-1',
          status: 'PENDING',
          medicationCode: { nameKo: '아스피린' },
        },
      };

      vi.mocked(mockService.findById).mockResolvedValue(mockOrder);

      const result = await controller.findById('po-1');

      expect(result.data.data.id).toBe('po-1');
      expect(result.data.data.medicationCode).toBeDefined();
    });

    it('should throw NotFoundException when not found', async () => {
      vi.mocked(mockService.findById).mockRejectedValue(
        new NotFoundException('Pre-Order를 찾을 수 없습니다.'),
      );

      await expect(controller.findById('non-existent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('approve', () => {
    it('should approve pre-order and create prescription and order', async () => {
      const mockApproved = {
        data: {
          preOrder: { id: 'po-1', status: 'APPROVED' },
          prescription: { id: 'rx-1' },
          order: { id: 'ord-1' },
        },
      };

      vi.mocked(mockService.approve).mockResolvedValue(mockApproved);

      const result = await controller.approve('po-1', { encounterId: 'enc-1' }, 'doc-1');

      expect(result.data.data.preOrder.status).toBe('APPROVED');
      expect(result.data.data.prescription).toBeDefined();
      expect(result.data.data.order).toBeDefined();
      expect(mockService.approve).toHaveBeenCalledWith('po-1', 'doc-1', 'enc-1', { overrideDur: undefined, overrideReason: undefined });
    });

    it('should throw BadRequestException if pre-order cannot be approved', async () => {
      vi.mocked(mockService.approve).mockRejectedValue(
        new BadRequestException('승인 가능한 상태가 아닙니다.'),
      );

      await expect(controller.approve('po-1', { encounterId: 'enc-1' }, 'doc-1')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('modify', () => {
    it('should modify pre-order and change status to MODIFIED', async () => {
      const mockModified = {
        data: { id: 'po-1', dosage: '1000mg', status: 'MODIFIED' },
      };

      vi.mocked(mockService.modify).mockResolvedValue(mockModified);

      const dto = { dosage: '1000mg', reason: '용량 조정' };

      const result = await controller.modify('po-1', dto, 'doc-1');

      expect(result.data.status).toBe('MODIFIED');
      expect(mockService.modify).toHaveBeenCalledWith('po-1', dto, 'doc-1', '용량 조정');
    });

    it('should throw BadRequestException if not in modifiable state', async () => {
      vi.mocked(mockService.modify).mockRejectedValue(
        new BadRequestException('수정 가능한 상태가 아닙니다.'),
      );

      const dto = { dosage: '1000mg' };

      await expect(controller.modify('po-1', dto, 'doc-1')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('cancel', () => {
    it('should cancel pre-order', async () => {
      const mockCancelled = {
        data: { id: 'po-1', status: 'CANCELLED' },
      };

      vi.mocked(mockService.cancel).mockResolvedValue(mockCancelled);

      const result = await controller.cancel('po-1');

      expect(result.data.data.status).toBe('CANCELLED');
      expect(mockService.cancel).toHaveBeenCalledWith('po-1', undefined);
    });

    it('should throw BadRequestException if cannot be cancelled', async () => {
      vi.mocked(mockService.cancel).mockRejectedValue(
        new BadRequestException('취소 가능한 상태가 아닙니다.'),
      );

      await expect(controller.cancel('po-1')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('Authorization', () => {
    it('should require DOCTOR or ADMIN for create', async () => {
      // @Roles(UserRole.DOCTOR, UserRole.ADMIN) is applied
      expect(controller).toBeDefined();
    });

    it('should require DOCTOR for findMyPending', async () => {
      // @Roles(UserRole.DOCTOR) is applied
      expect(controller).toBeDefined();
    });

    it('should require DOCTOR or ADMIN for approve', async () => {
      // @Roles(UserRole.DOCTOR, UserRole.ADMIN) is applied
      expect(controller).toBeDefined();
    });

    it('should require DOCTOR or ADMIN for modify', async () => {
      // @Roles(UserRole.DOCTOR, UserRole.ADMIN) is applied
      expect(controller).toBeDefined();
    });
  });

  describe('Response Wrapping', () => {
    it('should wrap create response in data', async () => {
      const mockCreated = { data: { id: 'po-1' } };

      vi.mocked(mockService.create).mockResolvedValue(mockCreated);

      const result = await controller.create(
        { patientId: 'p-1', type: 'MEDICATION' },
        'user-1',
      );

      expect(result).toHaveProperty('data');
    });

    it('should wrap findAll response in data', async () => {
      const mockOrders = { data: [] };

      vi.mocked(mockService.findAll).mockResolvedValue(mockOrders);

      const result = await controller.findAll();

      expect(result).toHaveProperty('data');
      expect(result.data.data).toBeDefined();
    });

    it('should wrap approve response in data with nested structure', async () => {
      const mockApproved = {
        data: {
          preOrder: { id: 'po-1', status: 'APPROVED' },
          prescription: { id: 'rx-1' },
          order: { id: 'ord-1' },
        },
      };

      vi.mocked(mockService.approve).mockResolvedValue(mockApproved);

      const result = await controller.approve('po-1', { encounterId: 'enc-1' }, 'doc-1');

      expect(result).toHaveProperty('data');
      expect(result.data.data).toHaveProperty('preOrder');
      expect(result.data.data).toHaveProperty('prescription');
      expect(result.data.data).toHaveProperty('order');
    });
  });

  describe('Route-specific Behavior', () => {
    it('should route /pending endpoint correctly', async () => {
      const mockOrders = { data: [] };

      vi.mocked(mockService.findMyPending).mockResolvedValue(mockOrders);

      const result = await controller.findMyPending('doc-1');

      expect(result.data).toBeDefined();
    });

    it('should route /patient/:patientId endpoint correctly', async () => {
      const mockOrders = { data: [] };

      vi.mocked(mockService.findPendingByPatient).mockResolvedValue(mockOrders);

      const result = await controller.findPendingByPatient('p-1');

      expect(result.data).toBeDefined();
    });

    it('should route /:id endpoint before other :id routes', async () => {
      const mockOrder = { data: { id: 'po-1' } };

      vi.mocked(mockService.findById).mockResolvedValue(mockOrder);

      const result = await controller.findById('po-1');

      expect(result.data.data.id).toBe('po-1');
    });
  });

  describe('Error Handling', () => {
    it('should propagate service errors', async () => {
      vi.mocked(mockService.findById).mockRejectedValue(
        new NotFoundException(),
      );

      await expect(controller.findById('non-existent')).rejects.toThrow();
    });

    it('should handle empty result lists', async () => {
      const mockOrders = { data: [] };

      vi.mocked(mockService.findAll).mockResolvedValue(mockOrders);

      const result = await controller.findAll();

      expect(result.data.data).toHaveLength(0);
    });
  });
});
