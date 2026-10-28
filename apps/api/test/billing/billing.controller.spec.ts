import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BillingController } from '../../src/modules/billing/billing.controller';

describe('BillingController', () => {
  let controller: BillingController;
  let mockService: any;

  const mockBilling = {
    id: 'bill-1',
    encounterId: 'enc-1',
    patientId: 'pat-1',
    totalAmount: 30000,
    patientCopay: 9000,
    status: 'PENDING',
  };

  beforeEach(() => {
    mockService = {
      createFromEncounter: vi.fn(),
      findAll: vi.fn(),
      findById: vi.fn(),
      pay: vi.fn(),
      cancel: vi.fn(),
      refund: vi.fn(),
      defer: vi.fn(),
      getCashierQueue: vi.fn(),
      getCashierStats: vi.fn(),
      getDailySummary: vi.fn(),
      getDeferred: vi.fn(),
    };
    controller = new BillingController(mockService);
  });

  // ─── getCashierQueue ──────────────────────────────────

  describe('getCashierQueue', () => {
    it('should return cashier queue from service', async () => {
      const queue = { data: [mockBilling] };
      mockService.getCashierQueue.mockResolvedValue(queue);

      const result = await controller.getCashierQueue();

      expect(result).toEqual(queue);
    });
  });

  // ─── getCashierStats ──────────────────────────────────

  describe('getCashierStats', () => {
    it('should return cashier stats from service', async () => {
      const stats = { data: { pendingCount: 5, completedCount: 10 } };
      mockService.getCashierStats.mockResolvedValue(stats);

      const result = await controller.getCashierStats();

      expect(result).toEqual(stats);
    });
  });

  // ─── getDailySummary ──────────────────────────────────

  describe('getDailySummary', () => {
    it('should pass date to service', async () => {
      const summary = { data: { date: '2026-05-20' } };
      mockService.getDailySummary.mockResolvedValue(summary);

      const result = await controller.getDailySummary('2026-05-20');

      expect(mockService.getDailySummary).toHaveBeenCalledWith('2026-05-20');
      expect(result).toEqual(summary);
    });

    it('should handle undefined date', async () => {
      mockService.getDailySummary.mockResolvedValue({ data: {} });

      await controller.getDailySummary(undefined);

      expect(mockService.getDailySummary).toHaveBeenCalledWith(undefined);
    });
  });

  // ─── getDeferred ──────────────────────────────────────

  describe('getDeferred', () => {
    it('should return deferred list from service', async () => {
      const deferred = { data: [] };
      mockService.getDeferred.mockResolvedValue(deferred);

      const result = await controller.getDeferred();

      expect(result).toEqual(deferred);
    });
  });

  // ─── findAll ──────────────────────────────────────────

  describe('findAll', () => {
    it('should pass parsed params to service', async () => {
      const list = { data: [], pagination: { total: 0, page: 2, limit: 10, hasMore: false } };
      mockService.findAll.mockResolvedValue(list);

      const result = await controller.findAll('PAID', '2', '10');

      expect(mockService.findAll).toHaveBeenCalledWith({ status: 'PAID', page: 2, limit: 10 });
      expect(result).toEqual(list);
    });

    it('should handle undefined params', async () => {
      mockService.findAll.mockResolvedValue({ data: [], pagination: {} });

      await controller.findAll(undefined, undefined, undefined);

      expect(mockService.findAll).toHaveBeenCalledWith({
        status: undefined,
        page: undefined,
        limit: undefined,
      });
    });

    it('should convert string page to number', async () => {
      mockService.findAll.mockResolvedValue({ data: [], pagination: {} });

      await controller.findAll(undefined, '3');

      expect(mockService.findAll).toHaveBeenCalledWith(
        expect.objectContaining({ page: 3 }),
      );
    });

    it('should convert string limit to number', async () => {
      mockService.findAll.mockResolvedValue({ data: [], pagination: {} });

      await controller.findAll(undefined, undefined, '50');

      expect(mockService.findAll).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 50 }),
      );
    });

    it('should include pagination info in response', async () => {
      const mockResult = {
        data: [],
        pagination: { total: 100, page: 1, limit: 20, hasMore: true },
      };
      mockService.findAll.mockResolvedValue(mockResult);

      const result = await controller.findAll();

      expect(result.pagination).toBeDefined();
      expect(result.pagination.hasMore).toBe(true);
    });
  });

  // ─── findOne ──────────────────────────────────────────

  describe('findOne', () => {
    it('should wrap billing in { data }', async () => {
      mockService.findById.mockResolvedValue(mockBilling);

      const result = await controller.findOne('bill-1');

      expect(result).toEqual({ data: mockBilling });
    });

    it('should pass id to service', async () => {
      mockService.findById.mockResolvedValue(mockBilling);

      await controller.findOne('bill-123');

      expect(mockService.findById).toHaveBeenCalledWith('bill-123');
    });

    it('should include patient and items in response', async () => {
      const billingWithDetails = {
        ...mockBilling,
        patient: { id: 'p-1', mrn: '12345', familyName: 'Kim', givenName: 'John', insuranceType: 'NHI' },
        items: [{ codeName: '초진료', amount: 15000 }],
      };
      mockService.findById.mockResolvedValue(billingWithDetails);

      const result = await controller.findOne('bill-1');

      expect(result.data.patient).toBeDefined();
      expect(result.data.items[0].codeName).toBe('초진료');
    });
  });

  // ─── create ───────────────────────────────────────────

  describe('create', () => {
    it('should wrap created billing in { data }', async () => {
      mockService.createFromEncounter.mockResolvedValue(mockBilling);

      const result = await controller.create('enc-1');

      // 환자 앱 "수납 대기" 푸시는 명시 옵트인 — 본문 미지정이면 false
      expect(mockService.createFromEncounter).toHaveBeenCalledWith('enc-1', { notifyPatient: false });
      expect(result).toEqual({ data: mockBilling });
    });

    it('should include items in response', async () => {
      const billingWithItems = {
        ...mockBilling,
        items: [
          { codeName: '초진료', amount: 15000 },
          { codeName: '아스피린', quantity: 30, amount: 15000 },
        ],
      };
      mockService.createFromEncounter.mockResolvedValue(billingWithItems);

      const result = await controller.create('enc-1');

      expect(result.data.items).toHaveLength(2);
    });
  });

  // ─── pay ──────────────────────────────────────────────

  describe('pay', () => {
    it('should wrap paid billing in { data }', async () => {
      const paid = { ...mockBilling, status: 'PAID', paidAmount: 9000 };
      mockService.pay.mockResolvedValue(paid);
      const dto = { amount: 9000, paymentMethod: 'CARD' };

      const result = await controller.pay('bill-1', dto as any);

      expect(mockService.pay).toHaveBeenCalledWith('bill-1', dto);
      expect(result).toEqual({ data: paid });
    });

    it('should pass DTO with cardApprovalNo to service', async () => {
      mockService.pay.mockResolvedValue({ ...mockBilling, status: 'PAID' });
      const dto = { amount: 9000, paymentMethod: 'CARD', cardApprovalNo: 'AP-123' };

      await controller.pay('bill-1', dto as any);

      expect(mockService.pay).toHaveBeenCalledWith('bill-1', dto);
    });

    it('should handle partial payment', async () => {
      const partial = { ...mockBilling, status: 'PARTIAL' };
      mockService.pay.mockResolvedValue(partial);

      const result = await controller.pay('bill-1', { amount: 5000, paymentMethod: 'CASH' } as any);

      expect(result.data.status).toBe('PARTIAL');
    });
  });

  // ─── cancel ───────────────────────────────────────────

  describe('cancel', () => {
    it('should wrap cancelled billing in { data }', async () => {
      const cancelled = { ...mockBilling, status: 'CANCELLED' };
      mockService.cancel.mockResolvedValue(cancelled);

      const result = await controller.cancel('bill-1', { reason: '환자 요청' } as any, 'staff-1');

      // P5-6: 처리자 = 로그인 직원
      expect(mockService.cancel).toHaveBeenCalledWith('bill-1', '환자 요청', 'staff-1');
      expect(result).toEqual({ data: cancelled });
    });
  });

  // ─── refund ───────────────────────────────────────────

  describe('refund', () => {
    it('should wrap refunded billing in { data }', async () => {
      const refunded = { ...mockBilling, status: 'REFUNDED' };
      mockService.refund.mockResolvedValue(refunded);
      const dto = { amount: 9000, reason: '전액 환불' };

      const result = await controller.refund('bill-1', dto as any);

      expect(mockService.refund).toHaveBeenCalledWith('bill-1', dto);
      expect(result).toEqual({ data: refunded });
    });
  });

  // ─── defer ────────────────────────────────────────────

  describe('defer', () => {
    it('should wrap deferred billing in { data }', async () => {
      const deferred = { ...mockBilling, status: 'DEFERRED' };
      mockService.defer.mockResolvedValue(deferred);
      const dto = { reason: '보험 확인 중' };

      const result = await controller.defer('bill-1', dto as any);

      expect(mockService.defer).toHaveBeenCalledWith('bill-1', dto);
      expect(result).toEqual({ data: deferred });
    });
  });

  // ─── Response Format ──────────────────────────────────

  describe('Response Format', () => {
    it('should wrap findOne response in { data }', async () => {
      mockService.findById.mockResolvedValue(mockBilling);

      const result = await controller.findOne('bill-1');

      expect(result).toEqual({ data: mockBilling });
    });

    it('should wrap create response in { data }', async () => {
      mockService.createFromEncounter.mockResolvedValue(mockBilling);

      const result = await controller.create('enc-1');

      expect(result).toEqual({ data: mockBilling });
    });

    it('should wrap pay response in { data }', async () => {
      mockService.pay.mockResolvedValue({ ...mockBilling, status: 'PAID' });

      const result = await controller.pay('bill-1', { amount: 9000, paymentMethod: 'CARD' } as any);

      expect(result).toHaveProperty('data');
    });

    it('should wrap cancel response in { data }', async () => {
      mockService.cancel.mockResolvedValue({ ...mockBilling, status: 'CANCELLED' });

      const result = await controller.cancel('bill-1', { reason: 'r' } as any);

      expect(result).toHaveProperty('data');
    });

    it('should wrap refund response in { data }', async () => {
      mockService.refund.mockResolvedValue({ ...mockBilling, status: 'REFUNDED' });

      const result = await controller.refund('bill-1', { amount: 9000, reason: 'r' } as any);

      expect(result).toHaveProperty('data');
    });

    it('should wrap defer response in { data }', async () => {
      mockService.defer.mockResolvedValue({ ...mockBilling, status: 'DEFERRED' });

      const result = await controller.defer('bill-1', { reason: 'r' } as any);

      expect(result).toHaveProperty('data');
    });
  });

  describe('환자 격리(PHI 교차 노출 방지)', () => {
    it('patientId 를 서비스로 전달한다 — 무시하면 타 환자 수납이 차트에 렌더됨', async () => {
      const pid = '11111111-1111-1111-1111-111111111111';
      await controller.findAll(undefined, undefined, undefined, pid);
      expect(mockService.findAll).toHaveBeenCalledWith(expect.objectContaining({ patientId: pid }));
    });

    it('patientId 미지정 시에는 필터 없이(전체 수납 목록) 전달', async () => {
      await controller.findAll();
      expect(mockService.findAll).toHaveBeenCalledWith(expect.objectContaining({ patientId: undefined }));
    });
  });
});
