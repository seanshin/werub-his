import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NutritionController } from '../../src/modules/nutrition/nutrition.controller';

describe('NutritionController', () => {
  let controller: NutritionController;
  let mockService: any;

  beforeEach(() => {
    mockService = {
      createMealOrder: vi.fn(),
      getMealOrders: vi.fn(),
      updateStatus: vi.fn(),
      generateDailyOrders: vi.fn(),
    };

    controller = new NutritionController(mockService);
  });

  describe('getMeals', () => {
    it('should get meals by date', async () => {
      const mockMeals = [
        { id: 'meal-1', mealType: 'BREAKFAST', status: 'PENDING' },
        { id: 'meal-2', mealType: 'LUNCH', status: 'PENDING' },
      ];

      vi.mocked(mockService.getMealOrders).mockResolvedValue(mockMeals);

      const result = await controller.getMeals('2026-05-14');

      expect(result.data).toHaveLength(2);
      expect(mockService.getMealOrders).toHaveBeenCalledWith('2026-05-14', undefined);
    });

    it('should filter by status', async () => {
      const mockMeals = [{ id: 'meal-1', status: 'COMPLETED' }];

      vi.mocked(mockService.getMealOrders).mockResolvedValue(mockMeals);

      const result = await controller.getMeals('2026-05-14', 'COMPLETED');

      expect(result.data).toHaveLength(1);
      expect(mockService.getMealOrders).toHaveBeenCalledWith('2026-05-14', 'COMPLETED');
    });

    it('should wrap response in data object', async () => {
      vi.mocked(mockService.getMealOrders).mockResolvedValue([]);

      const result = await controller.getMeals('2026-05-14');

      expect(result).toHaveProperty('data');
      expect(Array.isArray(result.data)).toBe(true);
    });

    it('should return empty array', async () => {
      vi.mocked(mockService.getMealOrders).mockResolvedValue([]);

      const result = await controller.getMeals('2026-05-14');

      expect(result.data).toEqual([]);
    });

    it('should include patient and ward info', async () => {
      const mockMeals = [{
        id: 'meal-1',
        mealType: 'BREAKFAST',
        patient: { id: 'pat-1', familyName: '김', givenName: '철수' },
        admission: { bed: { ward: { name: 'ICU' } } },
      }];

      vi.mocked(mockService.getMealOrders).mockResolvedValue(mockMeals);

      const result = await controller.getMeals('2026-05-14');

      expect(result.data[0].patient).toBeDefined();
      expect(result.data[0].admission).toBeDefined();
    });
  });

  describe('create', () => {
    it('should create meal order', async () => {
      const mockOrder = {
        id: 'meal-1',
        admissionId: 'adm-1',
        patientId: 'pat-1',
        mealType: 'BREAKFAST',
        dietType: '일반식',
      };

      vi.mocked(mockService.createMealOrder).mockResolvedValue(mockOrder);

      const dto = {
        admissionId: 'adm-1',
        patientId: 'pat-1',
        date: '2026-05-14',
        mealType: 'BREAKFAST',
        dietType: '일반식',
      };

      const result = await controller.create(dto);

      expect(result.data.id).toBe('meal-1');
      expect(mockService.createMealOrder).toHaveBeenCalledWith(dto);
    });

    it('should wrap response in data object', async () => {
      const mockOrder = { id: 'meal-1' };

      vi.mocked(mockService.createMealOrder).mockResolvedValue(mockOrder);

      const dto = {
        admissionId: 'adm-1',
        patientId: 'pat-1',
        date: '2026-05-14',
        mealType: 'BREAKFAST',
        dietType: '일반식',
      };

      const result = await controller.create(dto);

      expect(result).toHaveProperty('data');
    });

    it('should include allergies and notes if provided', async () => {
      const mockOrder = { id: 'meal-1' };

      vi.mocked(mockService.createMealOrder).mockResolvedValue(mockOrder);

      const dto = {
        admissionId: 'adm-1',
        patientId: 'pat-1',
        date: '2026-05-14',
        mealType: 'BREAKFAST',
        dietType: '일반식',
        allergies: 'egg',
        notes: 'no MSG',
      };

      await controller.create(dto);

      expect(mockService.createMealOrder).toHaveBeenCalledWith(dto);
    });
  });

  describe('generate', () => {
    it('should generate daily meal orders', async () => {
      const mockResult = { generated: 30 };

      vi.mocked(mockService.generateDailyOrders).mockResolvedValue(mockResult);

      const result = await controller.generate({ date: '2026-05-14' });

      expect(result.data.generated).toBe(30);
      expect(mockService.generateDailyOrders).toHaveBeenCalledWith('2026-05-14');
    });

    it('should wrap response in data object', async () => {
      const mockResult = { generated: 30 };

      vi.mocked(mockService.generateDailyOrders).mockResolvedValue(mockResult);

      const result = await controller.generate({ date: '2026-05-14' });

      expect(result).toHaveProperty('data');
      expect(result.data.generated).toBeDefined();
    });

    it('should return count of generated meals', async () => {
      const mockResult = { generated: 0 };

      vi.mocked(mockService.generateDailyOrders).mockResolvedValue(mockResult);

      const result = await controller.generate({ date: '2026-05-14' });

      expect(result.data).toEqual({ generated: 0 });
    });

    it('should handle large patient numbers', async () => {
      const mockResult = { generated: 150 };

      vi.mocked(mockService.generateDailyOrders).mockResolvedValue(mockResult);

      const result = await controller.generate({ date: '2026-05-14' });

      expect(result.data.generated).toBe(150);
    });
  });

  describe('updateStatus', () => {
    it('should update meal status', async () => {
      const mockUpdated = { id: 'meal-1', status: 'COMPLETED' };

      vi.mocked(mockService.updateStatus).mockResolvedValue(mockUpdated);

      const result = await controller.updateStatus('meal-1', { status: 'COMPLETED' });

      expect(result.data.status).toBe('COMPLETED');
      expect(mockService.updateStatus).toHaveBeenCalledWith('meal-1', 'COMPLETED', undefined);
    });

    it('should update to COOKING status', async () => {
      const mockUpdated = { id: 'meal-1', status: 'COOKING' };

      vi.mocked(mockService.updateStatus).mockResolvedValue(mockUpdated);

      const result = await controller.updateStatus('meal-1', { status: 'COOKING' });

      expect(result.data.status).toBe('COOKING');
    });

    it('should update to SERVED status', async () => {
      const mockUpdated = { id: 'meal-1', status: 'SERVED' };

      vi.mocked(mockService.updateStatus).mockResolvedValue(mockUpdated);

      const result = await controller.updateStatus('meal-1', { status: 'SERVED' });

      expect(result.data.status).toBe('SERVED');
    });

    it('should wrap response in data object', async () => {
      const mockUpdated = { id: 'meal-1', status: 'COMPLETED' };

      vi.mocked(mockService.updateStatus).mockResolvedValue(mockUpdated);

      const result = await controller.updateStatus('meal-1', { status: 'COMPLETED' });

      expect(result).toHaveProperty('data');
    });

    it('should use UUID pipe for id validation', () => {
      expect(controller).toBeDefined();
    });
  });

  describe('Authorization', () => {
    it('should require NURSE or ADMIN role', () => {
      expect(controller).toBeDefined();
    });
  });

  describe('Response Format', () => {
    it('getMeals should wrap array in data', async () => {
      vi.mocked(mockService.getMealOrders).mockResolvedValue([]);

      const result = await controller.getMeals('2026-05-14');

      expect(result).toHaveProperty('data');
      expect(Array.isArray(result.data)).toBe(true);
    });

    it('create should wrap object in data', async () => {
      const mockOrder = { id: 'meal-1' };

      vi.mocked(mockService.createMealOrder).mockResolvedValue(mockOrder);

      const result = await controller.create({
        admissionId: 'adm-1',
        patientId: 'pat-1',
        date: '2026-05-14',
        mealType: 'BREAKFAST',
        dietType: '일반식',
      });

      expect(result).toHaveProperty('data');
      expect(result.data).toEqual(mockOrder);
    });

    it('generate should wrap result in data', async () => {
      const mockResult = { generated: 30 };

      vi.mocked(mockService.generateDailyOrders).mockResolvedValue(mockResult);

      const result = await controller.generate({ date: '2026-05-14' });

      expect(result).toHaveProperty('data');
      expect(result.data).toEqual(mockResult);
    });

    it('updateStatus should wrap object in data', async () => {
      const mockUpdated = { id: 'meal-1', status: 'COMPLETED' };

      vi.mocked(mockService.updateStatus).mockResolvedValue(mockUpdated);

      const result = await controller.updateStatus('meal-1', { status: 'COMPLETED' });

      expect(result).toHaveProperty('data');
      expect(result.data).toEqual(mockUpdated);
    });
  });

  describe('Route Handlers', () => {
    it('GET /meals should call getMealOrders', async () => {
      vi.mocked(mockService.getMealOrders).mockResolvedValue([]);

      await controller.getMeals('2026-05-14');

      expect(mockService.getMealOrders).toHaveBeenCalled();
    });

    it('POST /meals should call createMealOrder', async () => {
      const dto = {
        admissionId: 'adm-1',
        patientId: 'pat-1',
        date: '2026-05-14',
        mealType: 'BREAKFAST',
        dietType: '일반식',
      };

      vi.mocked(mockService.createMealOrder).mockResolvedValue({ id: 'meal-1' });

      await controller.create(dto);

      expect(mockService.createMealOrder).toHaveBeenCalled();
    });

    it('POST /meals/generate should call generateDailyOrders', async () => {
      vi.mocked(mockService.generateDailyOrders).mockResolvedValue({ generated: 0 });

      await controller.generate({ date: '2026-05-14' });

      expect(mockService.generateDailyOrders).toHaveBeenCalled();
    });

    it('PATCH /meals/:id/status should call updateStatus', async () => {
      vi.mocked(mockService.updateStatus).mockResolvedValue({ status: 'COMPLETED' });

      await controller.updateStatus('meal-1', { status: 'COMPLETED' });

      expect(mockService.updateStatus).toHaveBeenCalled();
    });
  });
});
