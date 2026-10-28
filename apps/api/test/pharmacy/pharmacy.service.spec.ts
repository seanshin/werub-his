import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PharmacyService } from '../../src/modules/pharmacy/pharmacy.service';
import { NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { DispensingStatus } from '@prisma/client';

describe('PharmacyService', () => {
  let service: PharmacyService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      order: {
        findMany: vi.fn(),
        findUnique: vi.fn(),
        update: vi.fn(),
      },
      dispensing: {
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      dispensingItem: {
        deleteMany: vi.fn(),
      },
      user: {
        findUnique: vi.fn().mockResolvedValue({ isActive: true, role: 'PHARMACIST' }),
      },
      // careType 분기(재원 중=INPATIENT) — 기본은 외래(재원 0건)
      admission: {
        count: vi.fn().mockResolvedValue(0),
      },
      medicationAdministration: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    };
    // $transaction: 콜백에 mockPrisma(tx) 전달
    mockPrisma.$transaction = vi.fn().mockImplementation((cb: any) => cb(mockPrisma));

    const mockEventEmitter = { emit: vi.fn() };
    const mockOutbox = { enqueue: vi.fn().mockResolvedValue(undefined) };
    // DUR 시행 게이트 기본 OFF(false) — 게이트 비활성 시 기존 조제 플로우 유지
    const mockConfigRuntime = { get: vi.fn().mockResolvedValue('false') };
    service = new PharmacyService(mockPrisma, mockEventEmitter as any, mockOutbox as any, mockConfigRuntime as any);
  });

  describe('getQueue', () => {
    it('should return pending pharmacy orders', async () => {
      const mockOrders = [
        {
          id: 'order-1',
          status: 'ORDERED',
          prescription: {
            medicationCode: { code: 'M001', nameKo: '로사르탄정' },
            encounter: { patient: { id: 'pat-1', mrn: 'MRN001', familyName: '김', givenName: '환자' } },
          },
        },
      ];

      mockPrisma.order.findMany.mockResolvedValue(mockOrders);

      const result = await service.getQueue();

      expect(result).toEqual(mockOrders);
      // 🔴 큐는 조제 단계뿐 아니라 **검수 대기(DISPENSED)·불출 대기(VERIFIED)** 도 포함한다 —
      //    조제가 끝나면 오더가 COMPLETED 로 닫혀서, 단일 status 필터로는 검수·불출 단계가
      //    통째로 빠진다(2026-08-12/13 봉합). 그리고 **약(MEDICATION)만** 올린다 —
      //    department='PHARMACY' 에는 제 부서가 없는 처방(DIET·ACTIVITY·NURSING·LAB)이
      //    대체 저장돼 실측 14건 중 8건이 비약물이었다(2026-08-13).
      expect(mockPrisma.order.findMany).toHaveBeenCalledWith({
        where: {
          department: 'PHARMACY',
          // 🔴 2026-08-26: `status: 'ACTIVE'` 가 최상위에서 내려왔다. 최상위에 있으면
          //    처방 취소 순간 **조제 중·검수 대기·불출 대기 건이 통지 없이 큐에서 사라진다.**
          //    이제 ACTIVE 는 "아직 조제 전" 절에만 걸리고, 이미 조제가 시작된 것은 남는다.
          prescription: { type: 'MEDICATION' },
          OR: [
            // 2026-09-30 중단(DISCONTINUED) 처방의 접수·진행 중 오더도 남는다(접수 전은 중단 때 취소됨)
            { prescription: { status: { in: ['ACTIVE', 'DISCONTINUED'] } }, status: { in: ['ORDERED', 'RECEIVED', 'IN_PROGRESS'] } },
            { dispensing: { status: { in: ['PENDING', 'DISPENSED', 'VERIFIED'] } } },
          ],
        },
        orderBy: { createdAt: 'asc' },
        include: expect.any(Object),
      });
    });

    it('should return empty array when no orders exist', async () => {
      mockPrisma.order.findMany.mockResolvedValue([]);

      const result = await service.getQueue();

      expect(result).toEqual([]);
    });
  });

  describe('startDispensing', () => {
    const orderId = 'order-1';
    const pharmacistId = 'pharm-1';

    it('should create dispensing record when order is ORDERED', async () => {
      const mockOrder = {
        id: orderId,
        status: 'ORDERED',
        prescription: {
          medicationCodeId: 'med-1',
          quantity: 30,
          encounter: { patientId: 'pat-1' },
          medicationCode: { code: 'M001', nameKo: '로사르탄정' },
        },
      };

      const mockDispensing = {
        id: 'disp-1',
        orderId,
        patientId: 'pat-1',
        pharmacistId,
        status: 'PENDING',
        items: [{ medicationCodeId: 'med-1', prescribedQty: 30, dispensedQty: 30 }],
      };

      mockPrisma.order.findUnique.mockResolvedValue(mockOrder);
      mockPrisma.order.update.mockResolvedValue({ ...mockOrder, status: 'IN_PROGRESS' });
      mockPrisma.dispensing.create.mockResolvedValue(mockDispensing);

      const result = await service.startDispensing(orderId, pharmacistId);

      expect(result).toEqual(mockDispensing);
      expect(mockPrisma.order.update).toHaveBeenCalledWith({
        where: { id: orderId },
        data: { status: 'IN_PROGRESS', startedAt: expect.any(Date), startedById: expect.any(String) },
      });
    });

    it('should start dispensing with notes', async () => {
      const mockOrder = {
        id: orderId,
        status: 'RECEIVED',
        prescription: {
          medicationCodeId: 'med-1',
          quantity: 10,
          encounter: { patientId: 'pat-1' },
        },
      };

      mockPrisma.order.findUnique.mockResolvedValue(mockOrder);
      mockPrisma.order.update.mockResolvedValue({ ...mockOrder, status: 'IN_PROGRESS' });
      mockPrisma.dispensing.create.mockResolvedValue({ id: 'disp-1' });

      const notes = '주의사항: 냉동 보관 필요';
      await service.startDispensing(orderId, pharmacistId, notes);

      expect(mockPrisma.dispensing.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          notes,
        }),
        include: expect.any(Object),
      });
    });

    it('should set careType INPATIENT when patient has active admission', async () => {
      mockPrisma.order.findUnique.mockResolvedValue({
        id: orderId,
        status: 'ORDERED',
        prescription: { medicationCodeId: 'med-1', quantity: 30, encounter: { patientId: 'pat-1' } },
      });
      mockPrisma.order.update.mockResolvedValue({});
      mockPrisma.admission.count.mockResolvedValue(1); // 재원 중
      mockPrisma.dispensing.create.mockResolvedValue({ id: 'disp-1' });

      await service.startDispensing(orderId, pharmacistId);

      expect(mockPrisma.dispensing.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ careType: 'INPATIENT' }) }),
      );
    });

    it('should default careType OUTPATIENT without active admission', async () => {
      mockPrisma.order.findUnique.mockResolvedValue({
        id: orderId,
        status: 'ORDERED',
        prescription: { medicationCodeId: 'med-1', quantity: 30, encounter: { patientId: 'pat-1' } },
      });
      mockPrisma.order.update.mockResolvedValue({});
      mockPrisma.dispensing.create.mockResolvedValue({ id: 'disp-1' });

      await service.startDispensing(orderId, pharmacistId);

      expect(mockPrisma.dispensing.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ careType: 'OUTPATIENT' }) }),
      );
    });

    it('should throw NotFoundException when order not found', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(null);

      await expect(service.startDispensing(orderId, pharmacistId)).rejects.toThrow(NotFoundException);
    });

    it('should throw ConflictException when order is already dispensed', async () => {
      const mockOrder = {
        id: orderId,
        status: 'COMPLETED',
        prescription: { medicationCodeId: 'med-1' },
      };

      mockPrisma.order.findUnique.mockResolvedValue(mockOrder);

      await expect(service.startDispensing(orderId, pharmacistId)).rejects.toThrow(ConflictException);
    });
  });

  describe('completeDispensing', () => {
    const dispensingId = 'disp-1';

    it('should complete dispensing and update order status', async () => {
      const mockDispensing = {
        id: dispensingId,
        orderId: 'order-1',
        status: DispensingStatus.PENDING,
        items: [{ medicationCodeId: 'med-1', prescribedQty: 30, dispensedQty: 30 }],
      };

      mockPrisma.dispensing.findUnique.mockResolvedValue(mockDispensing);
      mockPrisma.order.update.mockResolvedValue({ id: 'order-1', status: 'COMPLETED' });
      mockPrisma.dispensing.update.mockResolvedValue({
        ...mockDispensing,
        status: DispensingStatus.DISPENSED,
        dispensedAt: new Date(),
      });

      const result = await service.completeDispensing(dispensingId);

      expect(result.status).toBe(DispensingStatus.DISPENSED);
      expect(mockPrisma.order.update).toHaveBeenCalledWith({
        where: { id: 'order-1' },
        data: { status: 'COMPLETED', completedAt: expect.any(Date) },
      });
    });

    it('should emit dispensing.completed with prescriptionId (progressive billing)', async () => {
      // prescriptionId 미동봉 시 billing-accrual 리스너가 no-op 되던 결함 회귀 방지
      mockPrisma.dispensing.findUnique.mockResolvedValue({
        id: dispensingId,
        orderId: 'order-1',
        patientId: 'pat-1',
        status: DispensingStatus.PENDING,
        items: [{ medicationCodeId: 'med-1', prescribedQty: 30, dispensedQty: 30 }],
        order: { prescriptionId: 'rx-1' },
      });
      mockPrisma.order.update.mockResolvedValue({});
      mockPrisma.dispensing.update.mockResolvedValue({ id: dispensingId, status: DispensingStatus.DISPENSED, items: [] });

      await service.completeDispensing(dispensingId);

      expect((service as any).eventEmitter.emit).toHaveBeenCalledWith(
        'dispensing.completed',
        expect.objectContaining({ prescriptionId: 'rx-1', dispensingId, orderId: 'order-1' }),
      );
    });

    it('should throw NotFoundException when dispensing not found', async () => {
      mockPrisma.dispensing.findUnique.mockResolvedValue(null);

      await expect(service.completeDispensing(dispensingId)).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when no items', async () => {
      mockPrisma.dispensing.findUnique.mockResolvedValue({
        id: dispensingId,
        status: DispensingStatus.PENDING,
        items: [],
      });

      await expect(service.completeDispensing(dispensingId)).rejects.toThrow(BadRequestException);
    });

    it('should throw ConflictException when already dispensed', async () => {
      mockPrisma.dispensing.findUnique.mockResolvedValue({
        id: dispensingId,
        status: DispensingStatus.DISPENSED,
        items: [{}],
      });

      await expect(service.completeDispensing(dispensingId)).rejects.toThrow(ConflictException);
    });

    it('[P0] should block high-alert dispense completion without an independent second checker', async () => {
      mockPrisma.dispensing.findUnique.mockResolvedValue({
        id: dispensingId, orderId: 'order-1', pharmacistId: 'pharm-1', status: DispensingStatus.PENDING,
        items: [{ medicationCodeId: 'm1', medicationCode: { nameKo: '헤파린', highAlertFlag: true, controlSchedule: null } }],
      });
      // gate BLOCK
      (service as any).configRuntime.get = vi.fn().mockResolvedValue('BLOCK');
      await expect(service.completeDispensing(dispensingId)).rejects.toThrow(ConflictException);
      // 같은 약사가 2차확인자면 여전히 거부
      await expect(service.completeDispensing(dispensingId, 'pharm-1')).rejects.toThrow(ConflictException);
    });

    it('[P0] high-alert completes with a valid independent second checker', async () => {
      mockPrisma.dispensing.findUnique.mockResolvedValue({
        id: dispensingId, orderId: 'order-1', pharmacistId: 'pharm-1', status: DispensingStatus.PENDING, notes: '',
        items: [{ medicationCodeId: 'm1', medicationCode: { nameKo: '헤파린', highAlertFlag: true, controlSchedule: null } }],
      });
      (service as any).configRuntime.get = vi.fn().mockResolvedValue('BLOCK');
      mockPrisma.dispensing.update.mockResolvedValue({ id: dispensingId, status: DispensingStatus.DISPENSED, items: [] });
      const res = await service.completeDispensing(dispensingId, 'pharm-2');
      expect(res.status).toBe(DispensingStatus.DISPENSED);
      expect(mockPrisma.dispensing.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ secondCheckBy: 'pharm-2', secondCheckAt: expect.any(Date) }),
      }));
    });

    it('[P1] TOCTOU: rejects when atomic claim finds no PENDING row', async () => {
      mockPrisma.dispensing.findUnique.mockResolvedValue({
        id: dispensingId, orderId: 'order-1', pharmacistId: 'pharm-1', status: DispensingStatus.PENDING,
        items: [{ medicationCodeId: 'm1', medicationCode: { nameKo: '타이레놀', highAlertFlag: false, controlSchedule: null } }],
      });
      mockPrisma.dispensing.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.completeDispensing(dispensingId)).rejects.toThrow(ConflictException);
    });
  });

  describe('verifyDispensing', () => {
    const dispensingId = 'disp-1';

    it('should verify dispensing when status is DISPENSED', async () => {
      const mockDispensing = {
        id: dispensingId,
        status: DispensingStatus.DISPENSED,
      };

      mockPrisma.dispensing.findUnique.mockResolvedValue(mockDispensing);
      mockPrisma.dispensing.update.mockResolvedValue({
        ...mockDispensing,
        status: DispensingStatus.VERIFIED,
        verifiedAt: new Date(),
      });

      const result = await service.verifyDispensing(dispensingId);

      expect(result.status).toBe(DispensingStatus.VERIFIED);
      expect(mockPrisma.dispensing.update).toHaveBeenCalledWith({
        where: { id: dispensingId },
        data: { status: DispensingStatus.VERIFIED, verifiedAt: expect.any(Date) },
        include: expect.any(Object),
      });
    });

    it('should throw ConflictException when status is not DISPENSED', async () => {
      mockPrisma.dispensing.findUnique.mockResolvedValue({
        id: dispensingId,
        status: DispensingStatus.PENDING,
      });

      await expect(service.verifyDispensing(dispensingId)).rejects.toThrow(ConflictException);
    });

    it('[P1] rejects self-verification (verifier == dispensing pharmacist)', async () => {
      mockPrisma.dispensing.findUnique.mockResolvedValue({
        id: dispensingId, status: DispensingStatus.DISPENSED, pharmacistId: 'pharm-1',
      });
      await expect(service.verifyDispensing(dispensingId, 'pharm-1')).rejects.toThrow(ConflictException);
    });
  });

  describe('issueDispensing', () => {
    const dispensingId = 'disp-1';

    it('should issue VERIFIED dispensing with receiver record', async () => {
      mockPrisma.dispensing.findUnique
        .mockResolvedValueOnce({
          id: dispensingId, orderId: 'order-1', patientId: 'pat-1',
          status: DispensingStatus.VERIFIED, careType: 'OUTPATIENT',
          order: { prescriptionId: 'rx-1' },
        })
        .mockResolvedValueOnce({ id: dispensingId, status: DispensingStatus.ISSUED, items: [] });
      mockPrisma.dispensing.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.issueDispensing(dispensingId, 'pharm-1', '환자 본인');

      expect(result?.status).toBe(DispensingStatus.ISSUED);
      expect(mockPrisma.dispensing.updateMany).toHaveBeenCalledWith({
        where: { id: dispensingId, status: DispensingStatus.VERIFIED },
        data: expect.objectContaining({
          status: DispensingStatus.ISSUED,
          issuedBy: 'pharm-1',
          issuedTo: '환자 본인',
          issuedAt: expect.any(Date),
        }),
      });
      // 외래는 MAR 연결 없음
      expect(mockPrisma.medicationAdministration.updateMany).not.toHaveBeenCalled();
    });

    it('should link unlinked MAR rows on INPATIENT issue', async () => {
      mockPrisma.dispensing.findUnique
        .mockResolvedValueOnce({
          id: dispensingId, orderId: 'order-1', patientId: 'pat-1',
          status: DispensingStatus.VERIFIED, careType: 'INPATIENT',
          order: { prescriptionId: 'rx-1' },
        })
        .mockResolvedValueOnce({ id: dispensingId, status: DispensingStatus.ISSUED, items: [] });
      mockPrisma.dispensing.updateMany.mockResolvedValue({ count: 1 });

      await service.issueDispensing(dispensingId, 'pharm-1', '5병동 김간호');

      expect(mockPrisma.medicationAdministration.updateMany).toHaveBeenCalledWith({
        where: { prescriptionId: 'rx-1', dispensingId: null },
        data: { dispensingId },
      });
    });

    it('should reject non-VERIFIED dispensing (검수 전 불출 금지)', async () => {
      mockPrisma.dispensing.findUnique.mockResolvedValue({
        id: dispensingId, status: DispensingStatus.DISPENSED, order: { prescriptionId: 'rx-1' },
      });

      await expect(service.issueDispensing(dispensingId, 'pharm-1')).rejects.toThrow(ConflictException);
    });

    it('should reject concurrent double issue (원자 클레임)', async () => {
      mockPrisma.dispensing.findUnique.mockResolvedValue({
        id: dispensingId, status: DispensingStatus.VERIFIED, careType: 'OUTPATIENT',
        order: { prescriptionId: 'rx-1' },
      });
      mockPrisma.dispensing.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.issueDispensing(dispensingId, 'pharm-1')).rejects.toThrow(ConflictException);
    });
  });

  describe('getDispensingDetail', () => {
    it('should return detailed dispensing information', async () => {
      const mockDispensing = {
        id: 'disp-1',
        items: [{ medicationCode: { nameKo: '로사르탄정' } }],
        patient: { id: 'pat-1', mrn: 'MRN001', familyName: '김', givenName: '환자' },
        pharmacist: { id: 'pharm-1', familyName: '이', givenName: '약사' },
        order: { prescription: {} },
      };

      mockPrisma.dispensing.findUnique.mockResolvedValue(mockDispensing);

      const result = await service.getDispensingDetail('disp-1');

      // FE 계약: dispensing 경로도 최상위 prescription 을 준다(2026-08-13 — 없으면 상세 패널 빈칸).
      expect(result).toEqual({ ...mockDispensing, prescription: mockDispensing.order.prescription });
      expect(result.patient).toBeDefined();
      expect(result.pharmacist).toBeDefined();
    });

    it('should throw NotFoundException when dispensing not found', async () => {
      mockPrisma.dispensing.findUnique.mockResolvedValue(null);
      mockPrisma.dispensing.findFirst = vi.fn().mockResolvedValue(null);
      mockPrisma.order.findUnique.mockResolvedValue(null);

      await expect(service.getDispensingDetail('disp-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateDispensingItems', () => {
    const dispensingId = 'disp-1';
    const newItems = [
      { medicationCodeId: 'med-1', prescribedQty: 30, dispensedQty: 28 },
      { medicationCodeId: 'med-2', prescribedQty: 10, dispensedQty: 10 },
    ];

    it('should update items when dispensing is PENDING', async () => {
      mockPrisma.dispensing.findUnique.mockResolvedValue({
        id: dispensingId,
        status: DispensingStatus.PENDING,
        items: [],
      });
      mockPrisma.dispensingItem.deleteMany.mockResolvedValue({ count: 1 });
      mockPrisma.dispensing.update.mockResolvedValue({
        id: dispensingId,
        items: newItems,
      });

      const result = await service.updateDispensingItems(dispensingId, newItems);

      expect(mockPrisma.dispensingItem.deleteMany).toHaveBeenCalledWith({
        where: { dispensingId },
      });
      expect(result.items).toEqual(newItems);
    });

    it('should throw ConflictException when dispensing is already dispensed', async () => {
      mockPrisma.dispensing.findUnique.mockResolvedValue({
        id: dispensingId,
        status: DispensingStatus.DISPENSED,
      });

      await expect(service.updateDispensingItems(dispensingId, newItems)).rejects.toThrow(
        ConflictException
      );
    });
  });

  describe('cancelDispensing', () => {
    const dispensingId = 'disp-1';
    const reason = '약물 부족';

    it('should cancel dispensing when status is PENDING', async () => {
      mockPrisma.dispensing.findUnique.mockResolvedValue({
        id: dispensingId,
        status: DispensingStatus.PENDING,
        orderId: 'order-1',
        notes: null,
      });
      mockPrisma.order.update.mockResolvedValue({ id: 'order-1', status: 'RECEIVED' });
      mockPrisma.dispensing.update.mockResolvedValue({
        id: dispensingId,
        status: DispensingStatus.CANCELLED,
      });

      await service.cancelDispensing(dispensingId, reason);

      expect(mockPrisma.order.update).toHaveBeenCalledWith({
        where: { id: 'order-1' },
        data: { status: 'RECEIVED', startedAt: null },
      });
    });

    it('should throw ConflictException when status is VERIFIED', async () => {
      mockPrisma.dispensing.findUnique.mockResolvedValue({
        id: dispensingId,
        status: DispensingStatus.VERIFIED,
        orderId: 'order-1',
      });

      await expect(service.cancelDispensing(dispensingId, reason)).rejects.toThrow(ConflictException);
    });
  });
});
