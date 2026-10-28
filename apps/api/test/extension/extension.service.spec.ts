import { describe, it, expect, beforeEach } from 'vitest';
import { ExtensionService } from '../../src/modules/extension/extension.service';

describe('ExtensionService', () => {
  let service: ExtensionService;

  beforeEach(() => {
    service = new ExtensionService();
  });

  describe('getSlots', () => {
    it('should return all unique slots', () => {
      const result = service.getSlots();

      expect(result).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ slot: 'patient-chart-sidebar' }),
          expect.objectContaining({ slot: 'patient-header' }),
          expect.objectContaining({ slot: 'patient-chart-main' }),
        ])
      );
    });

    it('should include extensions for each slot', () => {
      const result = service.getSlots();

      result.forEach((slot) => {
        expect(slot).toHaveProperty('slot');
        expect(slot).toHaveProperty('extensions');
        expect(Array.isArray(slot.extensions)).toBe(true);
      });
    });

    it('should only include enabled extensions', () => {
      const result = service.getSlots();

      result.forEach((slot) => {
        slot.extensions.forEach((ext) => {
          expect(ext.enabled).toBe(true);
        });
      });
    });

    it('should sort extensions by order', () => {
      const result = service.getSlots();
      const mainSlot = result.find((s) => s.slot === 'patient-chart-main');

      if (mainSlot && mainSlot.extensions.length > 1) {
        for (let i = 0; i < mainSlot.extensions.length - 1; i++) {
          expect(mainSlot.extensions[i].order).toBeLessThanOrEqual(
            mainSlot.extensions[i + 1].order
          );
        }
      }
    });

    it('should return empty extensions array for slots with no enabled items', () => {
      const result = service.getSlots();

      expect(result).toEqual(expect.any(Array));
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe('getExtensionsForSlot', () => {
    it('should return extensions for specific slot', () => {
      const result = service.getExtensionsForSlot('patient-header');

      expect(result).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            slot: 'patient-header',
            name: '알레르기 배너',
          }),
        ])
      );
    });

    it('should filter by enabled status', () => {
      const result = service.getExtensionsForSlot('patient-chart-sidebar');

      result.forEach((ext) => {
        expect(ext.enabled).toBe(true);
      });
    });

    it('should sort by order ascending', () => {
      const result = service.getExtensionsForSlot('patient-chart-main');

      for (let i = 0; i < result.length - 1; i++) {
        expect(result[i].order).toBeLessThanOrEqual(result[i + 1].order);
      }
    });

    it('should return empty array for non-existent slot', () => {
      const result = service.getExtensionsForSlot('non-existent-slot');

      expect(result).toEqual([]);
    });

    it('should include component and config info', () => {
      const result = service.getExtensionsForSlot('patient-header');

      result.forEach((ext) => {
        expect(ext).toHaveProperty('component');
        expect(ext).toHaveProperty('id');
        expect(ext).toHaveProperty('name');
      });
    });
  });

  describe('getAllExtensions', () => {
    it('should return all extensions', () => {
      const result = service.getAllExtensions();

      expect(result.length).toBeGreaterThan(0);
      expect(result).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: expect.any(String) }),
        ])
      );
    });

    it('should include both enabled and disabled', () => {
      const result = service.getAllExtensions();

      expect(result).toEqual(expect.any(Array));
      result.forEach((ext) => {
        expect(ext).toHaveProperty('enabled');
        expect(typeof ext.enabled).toBe('boolean');
      });
    });

    it('should include at least 3 default extensions', () => {
      const result = service.getAllExtensions();

      expect(result.length).toBeGreaterThanOrEqual(3);
    });

    it('should have required properties for each extension', () => {
      const result = service.getAllExtensions();

      result.forEach((ext) => {
        expect(ext).toHaveProperty('id');
        expect(ext).toHaveProperty('name');
        expect(ext).toHaveProperty('slot');
        expect(ext).toHaveProperty('component');
        expect(ext).toHaveProperty('order');
        expect(ext).toHaveProperty('enabled');
      });
    });
  });

  describe('toggleExtension', () => {
    it('should toggle extension enabled status', () => {
      const ext = service.getAllExtensions()[0];
      const initialStatus = ext.enabled;

      const result = service.toggleExtension(ext.id);

      expect(result?.enabled).toBe(!initialStatus);
    });

    it('should return toggled extension', () => {
      const ext = service.getAllExtensions()[0];

      const result = service.toggleExtension(ext.id);

      expect(result).toBeDefined();
      expect(result?.id).toBe(ext.id);
      expect(result?.name).toBe(ext.name);
    });

    it('should toggle back to original state', () => {
      const ext = service.getAllExtensions()[0];
      const originalStatus = ext.enabled;

      service.toggleExtension(ext.id);
      const result = service.toggleExtension(ext.id);

      expect(result?.enabled).toBe(originalStatus);
    });

    it('should return undefined for non-existent extension', () => {
      const result = service.toggleExtension('non-existent-id');

      expect(result).toBeUndefined();
    });

    it('should persist state changes across calls', () => {
      const ext = service.getAllExtensions()[0];
      const originalSlot = ext.slot;

      service.toggleExtension(ext.id);
      const afterFirstToggle = service.getExtensionsForSlot(originalSlot);
      const toggledExt = afterFirstToggle.find((e) => e.id === ext.id);

      expect(toggledExt).toBeUndefined();
    });
  });

  describe('registerExtension', () => {
    it('should register new extension', () => {
      const newExt = {
        name: '새 위젯',
        slot: 'custom-slot',
        component: '@custom/widget',
        order: 1,
        enabled: true,
      };

      const result = service.registerExtension(newExt);

      expect(result.id).toBeDefined();
      expect(result.name).toBe('새 위젯');
      expect(result.slot).toBe('custom-slot');
    });

    it('should generate ID with ext- prefix', () => {
      const newExt = {
        name: '테스트',
        slot: 'test-slot',
        component: '@test/widget',
        order: 1,
        enabled: true,
      };

      const result = service.registerExtension(newExt);

      expect(result.id).toMatch(/^ext-\d+$/);
    });

    it('should add extension to registry', () => {
      const newExt = {
        name: '테스트 위젯',
        slot: 'test-slot',
        component: '@test/comp',
        order: 1,
        enabled: true,
      };

      const registered = service.registerExtension(newExt);
      const all = service.getAllExtensions();

      expect(all).toContainEqual(registered);
    });

    it('should preserve config if provided', () => {
      const newExt = {
        name: '설정 위젯',
        slot: 'config-slot',
        component: '@config/widget',
        order: 1,
        enabled: true,
        config: { theme: 'dark', size: 'large' },
      };

      const result = service.registerExtension(newExt);

      expect(result.config).toEqual({ theme: 'dark', size: 'large' });
    });

    it('should allow retrieval of newly registered extension', () => {
      const newExt = {
        name: '조회테스트',
        slot: 'query-slot',
        component: '@query/widget',
        order: 1,
        enabled: true,
      };

      const registered = service.registerExtension(newExt);
      const forSlot = service.getExtensionsForSlot('query-slot');

      expect(forSlot).toContainEqual(registered);
    });

    it('should return extension with all properties', () => {
      const newExt = {
        name: '테스트',
        slot: 'slot',
        component: '@test/comp',
        order: 2,
        enabled: false,
      };

      const result = service.registerExtension(newExt);

      expect(result.name).toBe('테스트');
      expect(result.slot).toBe('slot');
      expect(result.component).toBe('@test/comp');
      expect(result.order).toBe(2);
      expect(result.enabled).toBe(false);
    });
  });
});
