import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NutritionService } from '../../src/modules/nutrition/nutrition.service';

describe('NutritionService', () => {
  let service: NutritionService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      mealOrder: { create: vi.fn(), findMany: vi.fn(), update: vi.fn(), upsert: vi.fn() },
      admission: { findMany: vi.fn() },
      // 🔴 2026-08-21: 식사 생성이 **활성 식이 처방**을 정본으로 쓰게 되면서 목에도 추가한다
      //    (목은 정본의 실제 접근 모양을 따라간다 — 가정한 모양을 테스트하면 가드가 헛돈다).
      dietOrder: { findMany: vi.fn().mockResolvedValue([]) },
      // 🔴 2026-09-02: 급식 목록이 **배식 확인(5-Rights) 기록**을 함께 돌려주게 되면서 목에도 추가한다.
      //    종전엔 그 원장을 쓰기만 하고 읽는 코드가 없어 화면·보고서 어디에도 나오지 않았다.
      mealDeliveryCheck: { findMany: vi.fn().mockResolvedValue([]) },
      user: { findMany: vi.fn().mockResolvedValue([]) },
    };
    service = new NutritionService(mockPrisma);
  });

  describe('createMealOrder', () => {
    it('should create a meal order with parsed date', async () => {
      const dto = { admissionId: 'a-1', patientId: 'p-1', date: '2026-05-19', mealType: 'LUNCH', dietType: '일반식' };
      mockPrisma.mealOrder.create.mockResolvedValue({ id: 'mo-1', ...dto, date: new Date('2026-05-19') });
      const result = await service.createMealOrder(dto);
      expect(result.id).toBe('mo-1');
      expect(mockPrisma.mealOrder.create).toHaveBeenCalledWith({ data: expect.objectContaining({ date: expect.any(Date) }) });
    });
  });

  describe('getMealOrders', () => {
    it('should return orders for a date', async () => {
      mockPrisma.mealOrder.findMany.mockResolvedValue([{ id: 'mo-1', mealType: 'BREAKFAST' }]);
      const result = await service.getMealOrders('2026-05-19');
      expect(result).toHaveLength(1);
    });

    it('should default to today if no date', async () => {
      mockPrisma.mealOrder.findMany.mockResolvedValue([]);
      await service.getMealOrders();
      expect(mockPrisma.mealOrder.findMany).toHaveBeenCalled();
    });

    it('should filter by status', async () => {
      mockPrisma.mealOrder.findMany.mockResolvedValue([]);
      await service.getMealOrders('2026-05-19', 'DELIVERED');
      expect(mockPrisma.mealOrder.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ status: 'DELIVERED' }) }),
      );
    });
  });

  describe('updateStatus', () => {
    it('should update meal order status', async () => {
      mockPrisma.mealOrder.update.mockResolvedValue({ id: 'mo-1', status: 'DELIVERED' });
      const result = await service.updateStatus('mo-1', 'DELIVERED');
      expect(result.status).toBe('DELIVERED');
    });
  });

  describe('generateDailyOrders', () => {
    it('should generate 3 meals per admitted patient', async () => {
      mockPrisma.admission.findMany.mockResolvedValue([
        { id: 'a-1', patientId: 'p-1', dietType: '일반식', patient: { id: 'p-1', allergies: [] } },
        { id: 'a-2', patientId: 'p-2', dietType: '당뇨식', patient: { id: 'p-2', allergies: [] } },
      ]);
      mockPrisma.mealOrder.findMany.mockResolvedValue([]);
      mockPrisma.mealOrder.upsert.mockResolvedValue({});
      const result = await service.generateDailyOrders('2026-05-19');
      expect(result.generated).toBe(6); // 2 patients × 3 meals
    });

    it('should return 0 if no admitted patients', async () => {
      mockPrisma.admission.findMany.mockResolvedValue([]);
      mockPrisma.mealOrder.findMany.mockResolvedValue([]);
      const result = await service.generateDailyOrders('2026-05-19');
      expect(result.generated).toBe(0);
    });
  });
});
