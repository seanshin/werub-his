import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PreOrderService } from '../../src/modules/pre-order/pre-order.service';
import { NotFoundException, BadRequestException } from '@nestjs/common';

describe('PreOrderService', () => {
  let service: PreOrderService;
  let mockPrisma: any;
  let mockDur: any;
  let mockConfig: any;

  beforeEach(() => {
    mockPrisma = {
      preOrder: {
        create: vi.fn(),
        findMany: vi.fn(),
        findUnique: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      prescription: { create: vi.fn() },
      order: { create: vi.fn() },
      appointment: { findUnique: vi.fn().mockResolvedValue({ patientId: 'p-1', status: 'SCHEDULED' }) },
      preOrderRevision: { create: vi.fn().mockResolvedValue({ id: 'rev-1' }), findMany: vi.fn().mockResolvedValue([]) },
    };
    // 정본의 실제 호출 모양 — 배열형과 콜백형 둘 다(승인 경로는 콜백형 tx 를 쓴다)
    mockPrisma.$transaction = vi.fn((arg: any) => (typeof arg === 'function' ? arg(mockPrisma) : Promise.all(arg)));
    mockPrisma.encounter = { findFirst: vi.fn().mockResolvedValue({ id: 'enc-today' }) };
    mockDur = { checkInteractions: vi.fn().mockResolvedValue([]) };
    mockConfig = { get: vi.fn().mockResolvedValue('false') }; // ON_CHECKIN 게이트 기본 OFF

    service = new PreOrderService(mockPrisma, mockDur, { emit: vi.fn() } as any, mockConfig);
  });

  describe('create', () => {
    it('should create pre-order with medication type', async () => {
      const mockCreated = {
        id: 'po-1',
        patientId: 'p-1',
        doctorId: 'doc-1',
        type: 'MEDICATION',
        medicationCodeId: 'med-1',
        status: 'PENDING',
        priority: 'ROUTINE',
      };

      vi.mocked(mockPrisma.preOrder.create).mockResolvedValue(mockCreated);

      const dto = {
        patientId: 'p-1',
        doctorId: 'doc-1',
        type: 'MEDICATION',
        medicationCodeId: 'med-1',
        dosage: '500mg',
        frequency: 'TID',
        duration: 7,
      };

      const result = await service.create(dto);

      expect(result.data.status).toBe('PENDING');
      expect(mockPrisma.preOrder.create).toHaveBeenCalled();
    });

    it('should set default priority to ROUTINE', async () => {
      const mockCreated = { id: 'po-1', priority: 'ROUTINE' };

      vi.mocked(mockPrisma.preOrder.create).mockResolvedValue(mockCreated);

      const dto = {
        patientId: 'p-1',
        doctorId: 'doc-1',
        type: 'MEDICATION',
      };

      const result = await service.create(dto);

      expect(result.data.priority).toBe('ROUTINE');
    });

    it('should handle date fields for scheduling', async () => {
      const mockCreated = {
        id: 'po-1',
        scheduledDate: new Date('2026-05-20'),
        scheduledTime: '10:00',
      };

      vi.mocked(mockPrisma.preOrder.create).mockResolvedValue(mockCreated);

      const dto = {
        patientId: 'p-1',
        doctorId: 'doc-1',
        type: 'PROCEDURE',
        scheduledDate: '2026-05-20',
        scheduledTime: '10:00',
      };

      const result = await service.create(dto);

      expect(result.data.scheduledDate).toBeDefined();
    });
  });

  describe('findAll', () => {
    it('should find all pre-orders', async () => {
      const mockOrders = [
        { id: 'po-1', type: 'MEDICATION', status: 'PENDING' },
      ];

      vi.mocked(mockPrisma.preOrder.findMany).mockResolvedValue(mockOrders);

      const result = await service.findAll({});

      expect(result.data).toHaveLength(1);
    });

    it('should filter by patient ID', async () => {
      const mockOrders = [{ patientId: 'p-1' }];

      vi.mocked(mockPrisma.preOrder.findMany).mockResolvedValue(mockOrders);

      const result = await service.findAll({ patientId: 'p-1' });

      expect(mockPrisma.preOrder.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ patientId: 'p-1' }),
        }),
      );
    });

    it('should filter by status', async () => {
      const mockOrders = [{ status: 'APPROVED' }];

      vi.mocked(mockPrisma.preOrder.findMany).mockResolvedValue(mockOrders);

      const result = await service.findAll({ status: 'APPROVED' });

      expect(result.data[0].status).toBe('APPROVED');
    });

    it('should order by priority ascending then by creation date descending', async () => {
      vi.mocked(mockPrisma.preOrder.findMany).mockResolvedValue([]);

      await service.findAll({});

      expect(mockPrisma.preOrder.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [{ priority: 'asc' }, { createdAt: 'desc' }],
        }),
      );
    });
  });

  describe('findById', () => {
    it('should find pre-order by ID with related data', async () => {
      const mockOrder = {
        id: 'po-1',
        patientId: 'p-1',
        medicationCode: { nameKo: '아스피린' },
      };

      vi.mocked(mockPrisma.preOrder.findUnique).mockResolvedValue(mockOrder);

      const result = await service.findById('po-1');

      expect(result.data.id).toBe('po-1');
    });

    it('should throw NotFoundException when not found', async () => {
      vi.mocked(mockPrisma.preOrder.findUnique).mockResolvedValue(null);

      await expect(service.findById('non-existent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('findPendingByPatient', () => {
    it('should find pending pre-orders for patient', async () => {
      const mockOrders = [
        { id: 'po-1', status: 'PENDING', patientId: 'p-1' },
      ];

      vi.mocked(mockPrisma.preOrder.findMany).mockResolvedValue(mockOrders);

      const result = await service.findPendingByPatient('p-1');

      expect(result.data).toHaveLength(1);
      expect(mockPrisma.preOrder.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: 'PENDING' }),
        }),
      );
    });
  });

  describe('findMyPending', () => {
    it('should find pending pre-orders for doctor', async () => {
      const mockOrders = [
        { id: 'po-1', status: 'PENDING', doctorId: 'doc-1' },
      ];

      vi.mocked(mockPrisma.preOrder.findMany).mockResolvedValue(mockOrders);

      const result = await service.findMyPending('doc-1');

      expect(result.data).toHaveLength(1);
      expect(mockPrisma.preOrder.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ doctorId: 'doc-1' }),
        }),
      );
    });
  });

  describe('approve', () => {
    it('should approve PENDING pre-order and create prescription + order', async () => {
      const mockPreOrder = {
        id: 'po-1',
        status: 'PENDING',
        type: 'MEDICATION',
        priority: 'ROUTINE',
        medicationCodeId: 'med-1',
        dosage: '500mg',
      };

      const mockPrescription = {
        id: 'rx-1',
        type: 'MEDICATION',
        source: 'PRE_ORDER',
      };

      const mockOrder = {
        id: 'ord-1',
        department: 'PHARMACY',
        status: 'ORDERED',
      };

      const mockUpdated = {
        id: 'po-1',
        status: 'APPROVED',
        approvedBy: 'doc-1',
      };

      vi.mocked(mockPrisma.preOrder.findUnique).mockResolvedValue(mockPreOrder);
      vi.mocked(mockPrisma.prescription.create).mockResolvedValue(mockPrescription);
      vi.mocked(mockPrisma.order.create).mockResolvedValue(mockOrder);
      vi.mocked(mockPrisma.preOrder.update).mockResolvedValue(mockUpdated);

      const result = await service.approve('po-1', 'doc-1', 'enc-1');

      expect(result.data.preOrder.status).toBe('APPROVED');
      expect(result.data.prescription).toBeDefined();
      expect(result.data.order).toBeDefined();
      expect(mockPrisma.prescription.create).toHaveBeenCalled();
      expect(mockPrisma.order.create).toHaveBeenCalled();
    });

    it('should throw NotFoundException if pre-order not found', async () => {
      vi.mocked(mockPrisma.preOrder.findUnique).mockResolvedValue(null);

      await expect(
        service.approve('non-existent', 'doc-1', 'enc-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException if status is not approvable', async () => {
      const mockPreOrder = {
        id: 'po-1',
        status: 'CANCELLED',
      };

      vi.mocked(mockPrisma.preOrder.findUnique).mockResolvedValue(mockPreOrder);

      await expect(
        service.approve('po-1', 'doc-1', 'enc-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should map MEDICATION to PHARMACY department', async () => {
      const mockPreOrder = {
        id: 'po-1',
        status: 'PENDING',
        type: 'MEDICATION',
        priority: 'ROUTINE',
      };

      vi.mocked(mockPrisma.preOrder.findUnique).mockResolvedValue(mockPreOrder);
      vi.mocked(mockPrisma.prescription.create).mockResolvedValue({ id: 'rx-1' });
      vi.mocked(mockPrisma.order.create).mockResolvedValue({ id: 'ord-1' });
      vi.mocked(mockPrisma.preOrder.update).mockResolvedValue({ status: 'APPROVED' });

      await service.approve('po-1', 'doc-1', 'enc-1');

      expect(mockPrisma.order.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ department: 'PHARMACY' }),
        }),
      );
    });

    it('should map LAB to LAB department', async () => {
      const mockPreOrder = {
        id: 'po-1',
        status: 'PENDING',
        type: 'LAB',
        priority: 'ROUTINE',
      };

      vi.mocked(mockPrisma.preOrder.findUnique).mockResolvedValue(mockPreOrder);
      vi.mocked(mockPrisma.prescription.create).mockResolvedValue({ id: 'rx-1' });
      vi.mocked(mockPrisma.order.create).mockResolvedValue({ id: 'ord-1' });
      vi.mocked(mockPrisma.preOrder.update).mockResolvedValue({ status: 'APPROVED' });

      await service.approve('po-1', 'doc-1', 'enc-1');

      expect(mockPrisma.order.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ department: 'LAB' }),
        }),
      );
    });
  });

  describe('modify', () => {
    it('should modify PENDING pre-order and change status to MODIFIED', async () => {
      const mockPreOrder = {
        id: 'po-1',
        status: 'PENDING',
      };

      const mockUpdated = {
        id: 'po-1',
        dosage: '1000mg',
        status: 'MODIFIED',
      };

      vi.mocked(mockPrisma.preOrder.findUnique).mockResolvedValue(mockPreOrder);
      vi.mocked(mockPrisma.preOrder.update).mockResolvedValue(mockUpdated);

      const dto = { dosage: '1000mg' };

      const result = await service.modify('po-1', dto);

      expect(result.data.status).toBe('MODIFIED');
      expect(mockPrisma.preOrder.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'po-1' },
          data: expect.objectContaining({ status: 'MODIFIED' }),
        }),
      );
    });

    it('should throw BadRequestException if status is not PENDING', async () => {
      const mockPreOrder = {
        id: 'po-1',
        status: 'APPROVED',
      };

      vi.mocked(mockPrisma.preOrder.findUnique).mockResolvedValue(mockPreOrder);

      await expect(
        service.modify('po-1', { dosage: '1000mg' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('cancel', () => {
    it('should cancel PENDING pre-order', async () => {
      const mockPreOrder = {
        id: 'po-1',
        status: 'PENDING',
      };

      const mockCancelled = {
        id: 'po-1',
        status: 'CANCELLED',
      };

      vi.mocked(mockPrisma.preOrder.findUnique).mockResolvedValue(mockPreOrder);
      vi.mocked(mockPrisma.preOrder.update).mockResolvedValue(mockCancelled);

      const result = await service.cancel('po-1');

      expect(result.data.status).toBe('CANCELLED');
    });

    it('should throw BadRequestException if status is APPROVED', async () => {
      const mockPreOrder = {
        id: 'po-1',
        status: 'APPROVED',
      };

      vi.mocked(mockPrisma.preOrder.findUnique).mockResolvedValue(mockPreOrder);

      await expect(service.cancel('po-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException if status is CANCELLED', async () => {
      const mockPreOrder = {
        id: 'po-1',
        status: 'CANCELLED',
      };

      vi.mocked(mockPrisma.preOrder.findUnique).mockResolvedValue(mockPreOrder);

      await expect(service.cancel('po-1')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ── P1: 예약 연계·7유형·수정 이력 ──

  describe('P1 예약 연계·수정 이력', () => {
    it('should link appointment (본인 예약·예정 상태만)', async () => {
      mockPrisma.preOrder.create.mockResolvedValue({ id: 'po-1', appointmentId: 'appt-1' });
      await service.create({ patientId: 'p-1', doctorId: 'doc-1', type: 'LAB', procedureCodeId: 'pc-1', appointmentId: 'appt-1' });
      expect(mockPrisma.preOrder.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ appointmentId: 'appt-1' }) }),
      );
    });

    it('should reject appointment of another patient', async () => {
      mockPrisma.appointment.findUnique.mockResolvedValue({ patientId: 'OTHER', status: 'SCHEDULED' });
      await expect(
        service.create({ patientId: 'p-1', doctorId: 'doc-1', type: 'LAB', appointmentId: 'appt-1' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject ended appointment (CANCELLED)', async () => {
      mockPrisma.appointment.findUnique.mockResolvedValue({ patientId: 'p-1', status: 'CANCELLED' });
      await expect(
        service.create({ patientId: 'p-1', doctorId: 'doc-1', type: 'LAB', appointmentId: 'appt-1' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should record revision snapshot on modify (수정 전 값)', async () => {
      mockPrisma.preOrder.findUnique.mockResolvedValue({ id: 'po-1', status: 'PENDING', dosage: '500mg', duration: 5 });
      mockPrisma.preOrder.update.mockResolvedValue({ id: 'po-1', status: 'MODIFIED', dosage: '250mg' });

      await service.modify('po-1', { dosage: '250mg', duration: 7 }, 'doc-2', '용량 조정');

      expect(mockPrisma.preOrderRevision.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          preOrderId: 'po-1',
          snapshot: { dosage: '500mg', duration: 5 }, // 수정 전 값만
          changedBy: 'doc-2',
          reason: '용량 조정',
        }),
      });
    });

    it('should route THERAPY approve to THERAPY department (7유형 deptMap)', async () => {
      mockPrisma.preOrder.findUnique.mockResolvedValue({
        id: 'po-1', status: 'PENDING', type: 'THERAPY', procedureCodeId: 'pc-1', patientId: 'p-1', doctorId: 'doc-1', priority: 'ROUTINE',
      });
      mockPrisma.prescription.create.mockResolvedValue({ id: 'rx-1' });
      mockPrisma.order.create.mockResolvedValue({ id: 'ord-1' });
      mockPrisma.preOrder.update.mockResolvedValue({ id: 'po-1', status: 'APPROVED' });

      await service.approve('po-1', 'doc-2', 'enc-1');

      expect(mockPrisma.order.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ department: 'THERAPY' }) }),
      );
    });
  });

  // ── P3: 반복 사전처방·그룹 취소 ──

  describe('P3 반복 사전처방', () => {
    const base = { patientId: 'p-1', doctorId: 'doc-1', type: 'LAB', procedureCodeId: 'pc-1', scheduledDate: '2026-08-01' };

    it('should create N occurrences with shared group and stepped dates', async () => {
      mockPrisma.preOrder.create.mockResolvedValue({ id: 'po-x', status: 'PENDING' });

      const result = await service.create({ ...base, recurEvery: 28, recurCount: 3 });

      expect(mockPrisma.preOrder.create).toHaveBeenCalledTimes(3);
      const dates = mockPrisma.preOrder.create.mock.calls.map((c: any[]) => c[0].data.scheduledDate.toISOString().slice(0, 10));
      expect(dates).toEqual(['2026-08-01', '2026-08-29', '2026-09-26']); // 매 28일
      const gids = new Set(mockPrisma.preOrder.create.mock.calls.map((c: any[]) => c[0].data.recurringGroupId));
      expect(gids.size).toBe(1); // 동일 그룹
      expect((result as { recurring?: { created: number } }).recurring?.created).toBe(3);
      // 연계 예약은 1회차만
      const appts = mockPrisma.preOrder.create.mock.calls.map((c: any[]) => c[0].data.appointmentId);
      expect(appts.filter(Boolean)).toHaveLength(0);
    });

    it('should reject recurrence without scheduledDate / out-of-range', async () => {
      await expect(service.create({ patientId: 'p-1', doctorId: 'doc-1', type: 'LAB', recurEvery: 7, recurCount: 3 }))
        .rejects.toThrow(/예정일/);
      await expect(service.create({ ...base, recurEvery: 7, recurCount: 20 }))
        .rejects.toThrow(/2~12/);
    });

    it('should reject recurrence combined with ON_CHECKIN', async () => {
      mockConfig.get.mockResolvedValue('true');
      await expect(service.create({ ...base, appointmentId: 'appt-1', activationMode: 'ON_CHECKIN', recurEvery: 7, recurCount: 3 }))
        .rejects.toThrow(/반복/);
    });

    it('should cancel whole group (미결만) with scope=group', async () => {
      mockPrisma.preOrder.findUnique.mockResolvedValue({ id: 'po-1', status: 'PENDING', recurringGroupId: 'grp-1' });
      mockPrisma.preOrder.updateMany.mockResolvedValue({ count: 3 });

      const result = await service.cancel('po-1', 'group');

      expect(mockPrisma.preOrder.updateMany).toHaveBeenCalledWith({
        where: { recurringGroupId: 'grp-1', status: { in: ['PENDING', 'MODIFIED'] } },
        data: { status: 'CANCELLED' },
      });
      expect((result.data as { cancelled: number }).cancelled).toBe(3);
    });
  });

  // ── P2: ON_CHECKIN 자동 활성화 ──

  describe('P2 ON_CHECKIN', () => {
    const base = { patientId: 'p-1', doctorId: 'doc-1', type: 'LAB', procedureCodeId: 'pc-1', appointmentId: 'appt-1' };

    it('should reject ON_CHECKIN when config OFF (기본)', async () => {
      await expect(service.create({ ...base, activationMode: 'ON_CHECKIN' })).rejects.toThrow(/비활성/);
    });

    it('should reject ON_CHECKIN for MEDICATION (약물은 의사 승인 필수)', async () => {
      mockConfig.get.mockResolvedValue('true');
      await expect(
        service.create({ patientId: 'p-1', doctorId: 'doc-1', type: 'MEDICATION', medicationCodeId: 'mc-1', appointmentId: 'appt-1', activationMode: 'ON_CHECKIN' }),
      ).rejects.toThrow(/비약물/);
    });

    it('should reject ON_CHECKIN without linked appointment', async () => {
      mockConfig.get.mockResolvedValue('true');
      await expect(
        service.create({ patientId: 'p-1', doctorId: 'doc-1', type: 'LAB', procedureCodeId: 'pc-1', activationMode: 'ON_CHECKIN' }),
      ).rejects.toThrow(/연계 예약/);
    });

    it('should store ON_CHECKIN when all gates pass', async () => {
      mockConfig.get.mockResolvedValue('true');
      mockPrisma.preOrder.create.mockResolvedValue({ id: 'po-1', activationMode: 'ON_CHECKIN' });
      await service.create({ ...base, activationMode: 'ON_CHECKIN' });
      expect(mockPrisma.preOrder.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ activationMode: 'ON_CHECKIN' }) }),
      );
    });

    it('should auto-approve ON_CHECKIN targets on appointment.checked_in (당일 encounter 귀속)', async () => {
      mockConfig.get.mockResolvedValue('true');
      mockPrisma.preOrder.findMany.mockResolvedValue([
        { id: 'po-1', patientId: 'p-1', doctorId: 'doc-1', type: 'LAB', procedureCodeId: 'pc-1', status: 'PENDING' },
      ]);
      // approve 내부 호출 경로 mock
      mockPrisma.preOrder.findUnique.mockResolvedValue({
        id: 'po-1', status: 'PENDING', type: 'LAB', procedureCodeId: 'pc-1', patientId: 'p-1', doctorId: 'doc-1', priority: 'ROUTINE',
      });
      mockPrisma.prescription.create.mockResolvedValue({ id: 'rx-1' });
      mockPrisma.order.create.mockResolvedValue({ id: 'ord-1' });
      mockPrisma.preOrder.update.mockResolvedValue({ id: 'po-1', status: 'APPROVED' });

      await service.onAppointmentCheckedIn({ id: 'appt-1', patientId: 'p-1' });

      expect(mockPrisma.prescription.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ encounterId: 'enc-today', type: 'LAB' }) }),
      );
    });

    it('should skip activation when no same-day encounter (의사 승인 폴백)', async () => {
      mockConfig.get.mockResolvedValue('true');
      mockPrisma.preOrder.findMany.mockResolvedValue([
        { id: 'po-1', patientId: 'p-1', doctorId: 'doc-1', type: 'LAB', status: 'PENDING' },
      ]);
      mockPrisma.encounter.findFirst.mockResolvedValue(null);

      await service.onAppointmentCheckedIn({ id: 'appt-1', patientId: 'p-1' });

      expect(mockPrisma.prescription.create).not.toHaveBeenCalled();
    });

    it('should do nothing when config OFF at activation time', async () => {
      mockConfig.get.mockResolvedValue('false');
      await service.onAppointmentCheckedIn({ id: 'appt-1', patientId: 'p-1' });
      expect(mockPrisma.preOrder.findMany).not.toHaveBeenCalled();
    });
  });

  // ── P0: DUR 사전체크·승인 재검증 ──

  describe('DUR gate (P0)', () => {
    it('should snapshot DUR warnings at creation (비차단)', async () => {
      mockDur.checkInteractions.mockResolvedValue([{ severity: 'WARNING', type: 'DUPLICATE', message: '동일성분 중복' }]);
      mockPrisma.preOrder.create.mockResolvedValue({ id: 'po-1', durSnapshot: [{ severity: 'WARNING' }] });

      await service.create({ patientId: 'p-1', doctorId: 'doc-1', type: 'MEDICATION', medicationCodeId: 'mc-1' });

      expect(mockDur.checkInteractions).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000000', 'mc-1', 'p-1');
      expect(mockPrisma.preOrder.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ durSnapshot: [expect.objectContaining({ severity: 'WARNING' })] }) }),
      );
    });

    it('should default expiresAt to +90d when not provided (무기한 잔존 방지)', async () => {
      mockPrisma.preOrder.create.mockResolvedValue({ id: 'po-1' });
      await service.create({ patientId: 'p-1', doctorId: 'doc-1', type: 'LAB', procedureCodeId: 'pc-1' });
      const data = mockPrisma.preOrder.create.mock.calls[0][0].data;
      expect(data.expiresAt).toBeInstanceOf(Date);
      const days = (data.expiresAt.getTime() - Date.now()) / 86400_000;
      expect(days).toBeGreaterThan(89);
      expect(days).toBeLessThan(91);
    });

    it('should block approve on DUR ERROR without override reason', async () => {
      mockPrisma.preOrder.findUnique.mockResolvedValue({
        id: 'po-1', status: 'PENDING', type: 'MEDICATION', medicationCodeId: 'mc-1', patientId: 'p-1', doctorId: 'doc-1',
      });
      mockDur.checkInteractions.mockResolvedValue([{ severity: 'ERROR', type: 'PREGNANCY', message: '임부금기 X' }]);

      await expect(service.approve('po-1', 'doc-2', 'enc-1')).rejects.toThrow(BadRequestException);
      expect(mockPrisma.prescription.create).not.toHaveBeenCalled();
    });

    it('should approve with override reason and record DUR audit on prescription', async () => {
      mockPrisma.preOrder.findUnique.mockResolvedValue({
        id: 'po-1', status: 'PENDING', type: 'MEDICATION', medicationCodeId: 'mc-1', patientId: 'p-1', doctorId: 'doc-1', priority: 'ROUTINE',
      });
      mockDur.checkInteractions.mockResolvedValue([{ severity: 'ERROR', type: 'INTERACTION', message: '병용금기' }]);
      mockPrisma.prescription.create.mockResolvedValue({ id: 'rx-1' });
      mockPrisma.order.create.mockResolvedValue({ id: 'ord-1' });
      mockPrisma.preOrder.update.mockResolvedValue({ id: 'po-1', status: 'APPROVED' });

      await service.approve('po-1', 'doc-2', 'enc-1', { overrideDur: true, overrideReason: '검토 후 유익성 우선' });

      expect(mockPrisma.prescription.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            durChecked: true,
            durOverridden: true,
            durOverrideReason: '검토 후 유익성 우선',
            durOverrideBy: 'doc-2',
          }),
        }),
      );
    });

    it('should re-verify DUR at approval with real encounterId', async () => {
      mockPrisma.preOrder.findUnique.mockResolvedValue({
        id: 'po-1', status: 'PENDING', type: 'MEDICATION', medicationCodeId: 'mc-1', patientId: 'p-1', doctorId: 'doc-1', priority: 'ROUTINE',
      });
      mockDur.checkInteractions.mockResolvedValue([]);
      mockPrisma.prescription.create.mockResolvedValue({ id: 'rx-1' });
      mockPrisma.order.create.mockResolvedValue({ id: 'ord-1' });
      mockPrisma.preOrder.update.mockResolvedValue({ id: 'po-1', status: 'APPROVED' });

      await service.approve('po-1', 'doc-2', 'enc-1');

      expect(mockDur.checkInteractions).toHaveBeenCalledWith('enc-1', 'mc-1', 'p-1');
    });
  });

  // ── P0: 만료 크론 ──

  describe('expireOverdue', () => {
    it('should mark overdue PENDING/MODIFIED as EXPIRED', async () => {
      mockPrisma.preOrder.updateMany.mockResolvedValue({ count: 3 });

      const result = await service.expireOverdue();

      expect(result.expired).toBe(3);
      expect(mockPrisma.preOrder.updateMany).toHaveBeenCalledWith({
        where: { status: { in: ['PENDING', 'MODIFIED'] }, expiresAt: { not: null, lt: expect.any(Date) } },
        data: { status: 'EXPIRED' },
      });
    });
  });
});
