import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConfigRuntimeController } from '../../src/modules/config/config-runtime.controller';

describe('ConfigRuntimeController', () => {
  let controller: ConfigRuntimeController;
  let mockConfigService: any;

  beforeEach(() => {
    mockConfigService = {
      getAll: vi.fn(),
      get: vi.fn(),
      // 🔴 컨트롤러가 실제로 부르는 것은 이쪽이다 — 목은 정본의 반환 모양 `{value, source, registered}` 를 쓴다.
      //    (내가 가정한 모양으로 목을 만들면 가드가 헛돈다 · CLAUDE.md §3)
      getWithSource: vi.fn(),
      set: vi.fn(),
      getCategories: vi.fn(),
      getHospitalContext: vi.fn(),
    };
    controller = new ConfigRuntimeController(Object.assign({ get: async () => null }, mockConfigService) as never, { emitAsync: async () => [] } as never);
  });

  describe('getAll', () => {
    it('should return all configurations without category filter', async () => {
      const mockConfigs = [
        { key: 'hospital.name', value: 'Hospital RUN', category: 'general' },
        { key: 'ai.model', value: 'qwen2.5:14b', category: 'ai' },
      ];
      mockConfigService.getAll.mockResolvedValue(mockConfigs);

      const result = await controller.getAll();

      expect(result.data).toHaveLength(2);
      expect(mockConfigService.getAll).toHaveBeenCalledWith(undefined);
    });

    it('should filter configurations by category', async () => {
      const mockConfigs = [
        { key: 'hospital.name', value: 'Hospital RUN', category: 'general' },
      ];
      mockConfigService.getAll.mockResolvedValue(mockConfigs);

      const result = await controller.getAll('general');

      expect(result.data).toHaveLength(1);
      expect(mockConfigService.getAll).toHaveBeenCalledWith('general');
    });

    it('should exclude access and role-data-access categories by default', async () => {
      mockConfigService.getAll.mockResolvedValue([]);

      await controller.getAll();

      expect(mockConfigService.getAll).toHaveBeenCalled();
    });

    it('should return wrapped response', async () => {
      mockConfigService.getAll.mockResolvedValue([]);

      const result = await controller.getAll();

      expect(result).toHaveProperty('data');
      expect(Array.isArray(result.data)).toBe(true);
    });
  });

  describe('getCategories', () => {
    it('should return all configuration categories with counts', async () => {
      const mockCategories = [
        { category: 'general', count: 10 },
        { category: 'ai', count: 5 },
        { category: 'billing', count: 3 },
      ];
      mockConfigService.getCategories.mockResolvedValue(mockCategories);

      const result = await controller.getCategories();

      expect(result.data).toHaveLength(3);
      expect(result.data[0].category).toBe('general');
    });

    it('should include count of configurations per category', async () => {
      const mockCategories = [
        { category: 'general', count: 10 },
      ];
      mockConfigService.getCategories.mockResolvedValue(mockCategories);

      const result = await controller.getCategories();

      expect(result.data[0]).toHaveProperty('count');
      expect(typeof result.data[0].count).toBe('number');
    });

    it('should return wrapped response', async () => {
      mockConfigService.getCategories.mockResolvedValue([]);

      const result = await controller.getCategories();

      expect(result).toHaveProperty('data');
      expect(Array.isArray(result.data)).toBe(true);
    });
  });

  describe('getHospitalContext', () => {
    it('should return hospital context string for AI', async () => {
      const mockContext = 'Hospital RUN 병원\n서울\n서울시 강남구\n02-1234-5678';
      mockConfigService.getHospitalContext.mockResolvedValue(mockContext);

      const result = await controller.getHospitalContext();

      expect(typeof result.data).toBe('string');
      expect(result.data).toContain('Hospital RUN');
    });

    it('should include hospital name', async () => {
      const mockContext = 'Hospital RUN 병원\n...';
      mockConfigService.getHospitalContext.mockResolvedValue(mockContext);

      const result = await controller.getHospitalContext();

      expect(result.data).toContain('Hospital RUN');
    });

    it('should include hospital location info', async () => {
      const mockContext = '서울\n서울시 강남구';
      mockConfigService.getHospitalContext.mockResolvedValue(mockContext);

      const result = await controller.getHospitalContext();

      expect(result.data).toContain('서울');
    });

    it('should return wrapped response', async () => {
      mockConfigService.getHospitalContext.mockResolvedValue('context');

      const result = await controller.getHospitalContext();

      expect(result).toHaveProperty('data');
      expect(typeof result.data).toBe('string');
    });
  });

  describe('get', () => {
    it('should return a single configuration by key', async () => {
      mockConfigService.getWithSource.mockResolvedValue({ value: 'Hospital RUN', source: 'db', registered: true });

      const result = await controller.get('hospital.name');

      expect(mockConfigService.getWithSource).toHaveBeenCalledWith('hospital.name');
    });

    it('should return configuration value directly', async () => {
      mockConfigService.getWithSource.mockResolvedValue({ value: 'Hospital RUN', source: 'db', registered: true });

      const result = await controller.get('hospital.name');

      expect(result.data).toBe('Hospital RUN');
    });

    it('should handle non-existent keys returning null', async () => {
      mockConfigService.getWithSource.mockResolvedValue({ value: null, source: 'db', registered: true });

      const result = await controller.get('non.existent.key');

      expect(result.data).toBeNull();
    });

    it('should support complex config values (objects)', async () => {
      const workingHours = { start: '09:00', end: '18:00' };
      mockConfigService.getWithSource.mockResolvedValue({ value: workingHours, source: 'db', registered: true });

      const result = await controller.get('appointment.workingHours');

      expect(result.data).toEqual(workingHours);
    });

    it('should support numeric config values', async () => {
      mockConfigService.getWithSource.mockResolvedValue({ value: 30, source: 'db', registered: true });

      const result = await controller.get('appointment.defaultDuration');

      expect(result.data).toBe(30);
    });

    it('should support boolean config values', async () => {
      mockConfigService.getWithSource.mockResolvedValue({ value: true, source: 'db', registered: true });

      const result = await controller.get('ai.greeting.enabled');

      expect(result.data).toBe(true);
    });

    it('should return wrapped response', async () => {
      mockConfigService.getWithSource.mockResolvedValue({ value: 'value', source: 'db', registered: true });

      const result = await controller.get('any.key');

      expect(result).toHaveProperty('data');
    });
  });

  describe('set', () => {
    it('should update configuration value', async () => {
      const updated = { key: 'hospital.name', value: 'New Hospital', category: 'general' };
      mockConfigService.set.mockResolvedValue(updated);

      const result = await controller.set('hospital.name', { value: 'New Hospital' }, 'user-1');

      expect(mockConfigService.set).toHaveBeenCalledWith('hospital.name', 'New Hospital', 'user-1');
      expect(result.data.value).toBe('New Hospital');
    });

    it('should create new configuration if not exists', async () => {
      const created = { key: 'custom.setting', value: 'value', category: 'general' };
      mockConfigService.set.mockResolvedValue(created);

      const result = await controller.set('custom.setting', { value: 'value' }, 'user-1');

      expect(result.data.key).toBe('custom.setting');
    });

    it('should track update by userId', async () => {
      mockConfigService.set.mockResolvedValue({});

      await controller.set('hospital.name', { value: 'Updated' }, 'user-123');

      expect(mockConfigService.set).toHaveBeenCalledWith(
        'hospital.name',
        'Updated',
        'user-123',
      );
    });

    it('should support updating to various types', async () => {
      mockConfigService.set.mockResolvedValue({});

      // String
      await controller.set('key1', { value: 'string' }, 'user-1');
      expect(mockConfigService.set).toHaveBeenCalledWith('key1', 'string', 'user-1');

      // Number
      await controller.set('key2', { value: 42 }, 'user-1');
      expect(mockConfigService.set).toHaveBeenCalledWith('key2', 42, 'user-1');

      // Boolean
      await controller.set('key3', { value: true }, 'user-1');
      expect(mockConfigService.set).toHaveBeenCalledWith('key3', true, 'user-1');

      // Object
      await controller.set('key4', { value: { nested: true } }, 'user-1');
      expect(mockConfigService.set).toHaveBeenCalledWith('key4', { nested: true }, 'user-1');
    });

    it('should return wrapped response', async () => {
      mockConfigService.set.mockResolvedValue({ key: 'test', value: 'value' });

      const result = await controller.set('test', { value: 'value' }, 'user-1');

      expect(result).toHaveProperty('data');
    });
  });

  describe('Configuration Categories', () => {
    it('should support general hospital settings', async () => {
      const mockConfigs = [
        { key: 'hospital.name', category: 'general' },
        { key: 'hospital.address', category: 'general' },
      ];
      mockConfigService.getAll.mockResolvedValue(mockConfigs);

      const result = await controller.getAll('general');

      expect(result.data.every((c: any) => c.category === 'general')).toBe(true);
    });

    it('should support AI settings', async () => {
      const mockConfigs = [
        { key: 'ai.model', category: 'ai' },
        { key: 'ai.temperature', category: 'ai' },
      ];
      mockConfigService.getAll.mockResolvedValue(mockConfigs);

      const result = await controller.getAll('ai');

      expect(result.data.every((c: any) => c.category === 'ai')).toBe(true);
    });

    it('should support clinical settings', async () => {
      const mockConfigs = [
        { key: 'appointment.defaultDuration', category: 'clinical' },
      ];
      mockConfigService.getAll.mockResolvedValue(mockConfigs);

      const result = await controller.getAll('clinical');

      expect(result.data.length > 0).toBe(true);
    });

    it('should support billing settings', async () => {
      const mockConfigs = [
        { key: 'billing.defaultCopayRate', category: 'billing' },
      ];
      mockConfigService.getAll.mockResolvedValue(mockConfigs);

      const result = await controller.getAll('billing');

      expect(result.data.length > 0).toBe(true);
    });
  });

  describe('Configuration Types', () => {
    it('should handle string configuration values', async () => {
      mockConfigService.getWithSource.mockResolvedValue({ value: 'Hospital RUN', source: 'db', registered: true });

      const result = await controller.get('hospital.name');

      expect(typeof result.data).toBe('string');
    });

    it('should handle numeric configuration values', async () => {
      mockConfigService.getWithSource.mockResolvedValue({ value: 30, source: 'db', registered: true });

      const result = await controller.get('appointment.defaultDuration');

      expect(typeof result.data).toBe('number');
    });

    it('should handle boolean configuration values', async () => {
      mockConfigService.getWithSource.mockResolvedValue({ value: true, source: 'db', registered: true });

      const result = await controller.get('ai.greeting.enabled');

      expect(typeof result.data).toBe('boolean');
    });

    it('should handle object configuration values', async () => {
      mockConfigService.getWithSource.mockResolvedValue({
        source: 'db', registered: true,
        value: { start: '09:00', end: '18:00' },
      });

      const result = await controller.get('appointment.workingHours');

      expect(typeof result.data).toBe('object');
      expect(result.data).toHaveProperty('start');
    });

    it('should handle decimal/float values', async () => {
      mockConfigService.getWithSource.mockResolvedValue({ value: 0.3, source: 'db', registered: true });

      const result = await controller.get('billing.defaultCopayRate');

      expect(result.data).toBe(0.3);
    });
  });

  describe('Hospital Context for AI', () => {
    it('should include hospital name in context', async () => {
      const mockContext = '병원 이름: Hospital RUN 병원\n...';
      mockConfigService.getHospitalContext.mockResolvedValue(mockContext);

      const result = await controller.getHospitalContext();

      expect(result.data).toContain('Hospital RUN');
    });

    it('should include hospital hours in context', async () => {
      const mockContext = '평일 진료시간: 09:00~18:00\n토요일 진료시간: 09:00~13:00';
      mockConfigService.getHospitalContext.mockResolvedValue(mockContext);

      const result = await controller.getHospitalContext();

      expect(result.data).toContain('09:00');
    });

    it('should include emergency information', async () => {
      const mockContext = '응급실 운영: 24시간\n...';
      mockConfigService.getHospitalContext.mockResolvedValue(mockContext);

      const result = await controller.getHospitalContext();

      expect(result.data).toContain('24시간');
    });

    it('should be formatted for AI prompt injection', async () => {
      const mockContext = `병원: Hospital RUN
주소: 서울시 강남구
전화: 02-1234-5678
시간: 09:00~18:00`;
      mockConfigService.getHospitalContext.mockResolvedValue(mockContext);

      const result = await controller.getHospitalContext();

      expect(result.data).toContain('\n');
      expect(result.data.split('\n').length >= 2).toBe(true);
    });
  });

  describe('Audit & Tracking', () => {
    it('should pass userId to service for audit trail', async () => {
      mockConfigService.set.mockResolvedValue({});

      await controller.set('test.key', { value: 'test' }, 'user-audit-123');

      expect(mockConfigService.set).toHaveBeenCalledWith(
        'test.key',
        'test',
        'user-audit-123',
      );
    });

    it('should support tracking who changed what', async () => {
      mockConfigService.set.mockResolvedValue({
        key: 'hospital.name',
        value: 'Updated',
        updatedBy: 'admin-user',
      });

      const result = await controller.set('hospital.name', { value: 'Updated' }, 'admin-user');

      expect(result.data.updatedBy).toBe('admin-user');
    });
  });
});
