import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ExtensionController } from '../../src/modules/extension/extension.controller';
import { ExtensionService } from '../../src/modules/extension/extension.service';

describe('ExtensionController', () => {
  let controller: ExtensionController;
  let service: ExtensionService;

  beforeEach(() => {
    service = {
      getSlots: vi.fn(),
      getExtensionsForSlot: vi.fn(),
      getAllExtensions: vi.fn(),
      toggleExtension: vi.fn(),
      registerExtension: vi.fn(),
      // 🔴 목록 응답은 '이 레지스트리가 실제로 동작하는가'를 함께 실어야 한다(W8·P16)
      registryStatus: vi.fn().mockReturnValue({ persisted: false, storage: 'IN_MEMORY', total: 3, installed: 0, rendererWired: false, note: 'x' }),
    } as any;

    controller = new ExtensionController(service);
  });

  describe('GET /api/v1/extensions (getAll)', () => {
    it('should return all extensions', async () => {
      const mockExtensions = [
        {
          id: 'ext-vital-widget',
          name: '바이탈 위젯',
          slot: 'patient-chart-sidebar',
          component: '@hospital-run/ext-vitals',
          order: 1,
          enabled: true,
        },
        {
          id: 'ext-allergy-banner',
          name: '알레르기 배너',
          slot: 'patient-header',
          component: '@hospital-run/ext-allergy',
          order: 1,
          enabled: true,
        },
      ];

      vi.mocked(service.getAllExtensions).mockReturnValue(mockExtensions);

      const result = await controller.getAll();

      expect(result.data).toHaveLength(2);
      expect(result.data[0].name).toBe('바이탈 위젯');
      expect(service.getAllExtensions).toHaveBeenCalled();
    });

    it('should include both enabled and disabled extensions', async () => {
      const mockExtensions = [
        {
          id: 'ext-1',
          enabled: true,
          name: '활성화',
          slot: 'slot1',
          component: '@comp1',
          order: 1,
        },
        {
          id: 'ext-2',
          enabled: false,
          name: '비활성화',
          slot: 'slot2',
          component: '@comp2',
          order: 1,
        },
      ];

      vi.mocked(service.getAllExtensions).mockReturnValue(mockExtensions);

      const result = await controller.getAll();

      expect(result.data).toHaveLength(2);
      expect(result.data[1].enabled).toBe(false);
    });

    it('should include component information', async () => {
      const mockExtensions = [
        {
          id: 'ext-1',
          component: '@hospital-run/custom',
          name: '커스텀',
          slot: 'custom-slot',
          order: 1,
          enabled: true,
        },
      ];

      vi.mocked(service.getAllExtensions).mockReturnValue(mockExtensions);

      const result = await controller.getAll();

      expect(result.data[0].component).toBe('@hospital-run/custom');
    });
  });

  describe('GET /api/v1/extensions/slots (getSlots)', () => {
    it('should return slots with their extensions', async () => {
      const mockSlots = [
        {
          slot: 'patient-chart-sidebar',
          extensions: [
            {
              id: 'ext-vital',
              name: '바이탈 위젯',
              component: '@vitals',
              order: 1,
              enabled: true,
            },
          ],
        },
        {
          slot: 'patient-header',
          extensions: [
            {
              id: 'ext-allergy',
              name: '알레르기 배너',
              component: '@allergy',
              order: 1,
              enabled: true,
            },
          ],
        },
      ];

      vi.mocked(service.getSlots).mockReturnValue(mockSlots);

      const result = await controller.getSlots();

      expect(result.data).toHaveLength(2);
      expect(result.data[0].slot).toBe('patient-chart-sidebar');
      expect(service.getSlots).toHaveBeenCalled();
    });

    it('should include extensions array for each slot', async () => {
      const mockSlots = [
        {
          slot: 'test-slot',
          extensions: [
            {
              id: 'ext-1',
              name: 'ext1',
              component: '@comp1',
              order: 1,
              enabled: true,
            },
            {
              id: 'ext-2',
              name: 'ext2',
              component: '@comp2',
              order: 2,
              enabled: true,
            },
          ],
        },
      ];

      vi.mocked(service.getSlots).mockReturnValue(mockSlots);

      const result = await controller.getSlots();

      expect(result.data[0].extensions).toHaveLength(2);
    });
  });

  describe('GET /api/v1/extensions/slots/:slot (getForSlot)', () => {
    it('should return extensions for specific slot', async () => {
      const mockExtensions = [
        {
          id: 'ext-vital',
          name: '바이탈 위젯',
          slot: 'patient-chart-sidebar',
          component: '@vitals',
          order: 1,
          enabled: true,
        },
      ];

      vi.mocked(service.getExtensionsForSlot).mockReturnValue(mockExtensions);

      const result = await controller.getForSlot('patient-chart-sidebar');

      expect(result.data).toHaveLength(1);
      expect(result.data[0].slot).toBe('patient-chart-sidebar');
      expect(service.getExtensionsForSlot).toHaveBeenCalledWith(
        'patient-chart-sidebar'
      );
    });

    it('should return empty array for slot with no extensions', async () => {
      vi.mocked(service.getExtensionsForSlot).mockReturnValue([]);

      const result = await controller.getForSlot('empty-slot');

      expect(result.data).toEqual([]);
    });

    it('should preserve order of extensions', async () => {
      const mockExtensions = [
        { id: 'ext-1', order: 1, name: 'first', slot: 'slot', component: '@1', enabled: true },
        { id: 'ext-2', order: 2, name: 'second', slot: 'slot', component: '@2', enabled: true },
        { id: 'ext-3', order: 3, name: 'third', slot: 'slot', component: '@3', enabled: true },
      ];

      vi.mocked(service.getExtensionsForSlot).mockReturnValue(mockExtensions);

      const result = await controller.getForSlot('slot');

      expect(result.data[0].order).toBe(1);
      expect(result.data[1].order).toBe(2);
      expect(result.data[2].order).toBe(3);
    });
  });

  describe('POST /api/v1/extensions (register)', () => {
    it('should register new extension', async () => {
      const dto = {
        name: '새 위젯',
        slot: 'new-slot',
        component: '@new/widget',
        order: 1,
        enabled: true,
      };

      const mockRegistered = {
        id: 'ext-1234567890',
        ...dto,
      };

      vi.mocked(service.registerExtension).mockReturnValue(mockRegistered);

      const result = await controller.register(dto);

      expect(result.data.id).toBe('ext-1234567890');
      expect(result.data.name).toBe('새 위젯');
      expect(service.registerExtension).toHaveBeenCalledWith(dto);
    });

    it('should return registered extension with ID', async () => {
      const dto = {
        name: '테스트',
        slot: 'test',
        component: '@test',
        order: 1,
        enabled: true,
      };

      const mockRegistered = {
        id: 'ext-9999',
        ...dto,
      };

      vi.mocked(service.registerExtension).mockReturnValue(mockRegistered);

      const result = await controller.register(dto);

      expect(result.data.id).toBeDefined();
      expect(result.data.slot).toBe('test');
    });

    it('should include config if provided', async () => {
      const dto = {
        name: '설정 위젯',
        slot: 'config-slot',
        component: '@config',
        order: 1,
        enabled: true,
        config: { theme: 'dark' },
      };

      const mockRegistered = {
        id: 'ext-5555',
        ...dto,
      };

      vi.mocked(service.registerExtension).mockReturnValue(mockRegistered);

      const result = await controller.register(dto);

      expect(result.data.config).toEqual({ theme: 'dark' });
    });
  });

  describe('PATCH /api/v1/extensions/:id/toggle (toggle)', () => {
    it('should toggle extension enabled status', async () => {
      const mockToggled = {
        id: 'ext-vital',
        name: '바이탈 위젯',
        slot: 'patient-chart-sidebar',
        component: '@vitals',
        order: 1,
        enabled: false,
      };

      vi.mocked(service.toggleExtension).mockReturnValue(mockToggled);

      const result = await controller.toggle('ext-vital');

      expect(result.data.enabled).toBe(false);
      expect(service.toggleExtension).toHaveBeenCalledWith('ext-vital');
    });

    it('should return toggled extension details', async () => {
      const mockToggled = {
        id: 'ext-1',
        name: 'Widget',
        slot: 'slot',
        component: '@comp',
        order: 1,
        enabled: true,
      };

      vi.mocked(service.toggleExtension).mockReturnValue(mockToggled);

      const result = await controller.toggle('ext-1');

      expect(result.data.id).toBe('ext-1');
      expect(result.data.name).toBe('Widget');
      expect(result.data.enabled).toBe(true);
    });

    it('should work for disabling enabled extension', async () => {
      const mockToggled = {
        id: 'ext-allergy',
        enabled: false,
        name: '알레르기 배너',
        slot: 'patient-header',
        component: '@allergy',
        order: 1,
      };

      vi.mocked(service.toggleExtension).mockReturnValue(mockToggled);

      const result = await controller.toggle('ext-allergy');

      expect(result.data.enabled).toBe(false);
    });

    it('should work for enabling disabled extension', async () => {
      const mockToggled = {
        id: 'ext-disabled',
        enabled: true,
        name: 'Previously Disabled',
        slot: 'slot',
        component: '@comp',
        order: 1,
      };

      vi.mocked(service.toggleExtension).mockReturnValue(mockToggled);

      const result = await controller.toggle('ext-disabled');

      expect(result.data.enabled).toBe(true);
    });
  });
});
