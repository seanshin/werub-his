import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ChartTemplateController } from '../../src/modules/chart-template/chart-template.controller';
import { ChartTemplateService } from '../../src/modules/chart-template/chart-template.service';

describe('ChartTemplateController', () => {
  let controller: ChartTemplateController;
  let service: ChartTemplateService;

  beforeEach(() => {
    service = {
      findAll: vi.fn(),
      findById: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      clone: vi.fn(),
      getPresets: vi.fn(),
      createFromPreset: vi.fn(),
      getForMe: vi.fn(),
      createPersonal: vi.fn(),
      getMySettings: vi.fn(),
      setDefaultTemplate: vi.fn(),
      toggleFavorite: vi.fn(),
      recordUsage: vi.fn(),
      findMyPersonal: vi.fn(),
    } as any;

    controller = new ChartTemplateController(service);
  });

  describe('findAll', () => {
    it('should return all templates', async () => {
      const mockTemplates = [
        { id: 'tpl-1', name: '내과 외래' },
        { id: 'tpl-2', name: '응급실' },
      ];

      vi.mocked(service.findAll).mockResolvedValue(mockTemplates);

      const result = await controller.findAll();

      expect(result.data).toEqual(mockTemplates);
      expect(service.findAll).toHaveBeenCalledWith({});
    });

    it('should filter by department', async () => {
      const mockTemplates = [{ id: 'tpl-1', name: '내과 외래', department: '내과' }];

      vi.mocked(service.findAll).mockResolvedValue(mockTemplates);

      await controller.findAll('내과');

      expect(service.findAll).toHaveBeenCalledWith({ department: '내과', role: undefined, category: undefined });
    });
  });

  describe('findById', () => {
    it('should return template by id', async () => {
      const mockTemplate = {
        id: 'tpl-1',
        name: '내과 외래',
        department: '내과',
        sections: [{ id: 's1', title: '주관적' }],
      };

      vi.mocked(service.findById).mockResolvedValue(mockTemplate);

      // 🔴 rollback IDOR 봉합 — 상세 조회도 호출자 userId 를 넘겨 남의 개인 템플릿이면 404 로 답한다
      const result = await controller.findById('tpl-1', 'user-1');

      expect(result.data).toEqual(mockTemplate);
      expect(service.findById).toHaveBeenCalledWith('tpl-1', 'user-1');
    });
  });

  describe('create', () => {
    it('should create new template', async () => {
      const body = {
        name: '수술기록',
        department: '외과',
        category: 'SURGERY',
        layout: 'single-page',
        sections: [{ id: 's1', title: '수술정보', fields: [] }],
      };

      const mockCreated = {
        id: 'tpl-1',
        ...body,
        version: '1.0',
        createdBy: 'doc-1',
      };

      vi.mocked(service.create).mockResolvedValue(mockCreated);

      const result = await controller.create(body, 'doc-1');

      expect(result.data).toEqual(mockCreated);
      expect(service.create).toHaveBeenCalledWith(body, 'doc-1');
    });
  });

  describe('getPresets', () => {
    it('should return list of presets', async () => {
      const mockPresets = [
        { key: 'internal-outpatient', name: '내과 외래 진료', sectionCount: 4, fieldCount: 10 },
        { key: 'surgery-opnote', name: '외과 수술기록', sectionCount: 3, fieldCount: 11 },
      ];

      vi.mocked(service.getPresets).mockReturnValue(mockPresets as any);

      const result = await controller.getPresets();

      expect(result.data).toHaveLength(2);
      expect(result.data[0]).toHaveProperty('key');
      expect(result.data[0]).toHaveProperty('sectionCount');
    });
  });

  describe('createFromPreset', () => {
    it('should create template from preset', async () => {
      const body = { presetKey: 'internal-outpatient' };
      const mockCreated = {
        id: 'tpl-1',
        name: '내과 외래 진료',
        createdBy: 'doc-1',
      };

      vi.mocked(service.createFromPreset).mockResolvedValue(mockCreated);

      const result = await controller.createFromPreset(body, 'doc-1');

      expect(result.data).toEqual(mockCreated);
      expect(service.createFromPreset).toHaveBeenCalledWith('internal-outpatient', 'doc-1', body);
    });
  });

  describe('getForMe', () => {
    it('should return templates matching user role and preference', async () => {
      const mockResult = {
        templates: [{ id: 'tpl-1', name: '내과 외래' }],
        preference: {
          defaultTemplateId: 'tpl-1',
          favoriteTemplateIds: ['tpl-1'],
          recentTemplateIds: ['tpl-1'],
        },
      };

      vi.mocked(service.getForMe).mockResolvedValue(mockResult);

      const result = await controller.getForMe({
        id: 'user-1',
        role: 'DOCTOR',
        department: '내과',
      });

      expect(result.data.templates).toHaveLength(1);
      expect(result.data.preference).toHaveProperty('defaultTemplateId');
    });
  });

  describe('getMySettings', () => {
    it('should return user settings', async () => {
      const mockSettings = {
        defaultTemplateId: 'tpl-1',
        favoriteTemplateIds: ['tpl-1', 'tpl-2'],
        recentTemplateIds: ['tpl-2', 'tpl-1'],
      };

      vi.mocked(service.getMySettings).mockResolvedValue(mockSettings);

      const result = await controller.getMySettings('user-1');

      expect(result.data).toEqual(mockSettings);
      expect(service.getMySettings).toHaveBeenCalledWith('user-1');
    });
  });

  describe('setDefaultTemplate', () => {
    it('should set default template', async () => {
      const body = { templateId: 'tpl-1' };
      const mockUpdated = {
        userId: 'user-1',
        defaultTemplateId: 'tpl-1',
      };

      vi.mocked(service.setDefaultTemplate).mockResolvedValue(mockUpdated);

      const result = await controller.setDefaultTemplate(body, 'user-1');

      expect(result.data).toEqual(mockUpdated);
      expect(service.setDefaultTemplate).toHaveBeenCalledWith('user-1', 'tpl-1');
    });
  });

  describe('toggleFavorite', () => {
    it('should toggle favorite status', async () => {
      const body = { templateId: 'tpl-1' };
      const mockUpdated = {
        userId: 'user-1',
        favoriteTemplateIds: ['tpl-1'],
      };

      vi.mocked(service.toggleFavorite).mockResolvedValue(mockUpdated);

      const result = await controller.toggleFavorite(body, 'user-1');

      expect(result.data.favoriteTemplateIds).toContain('tpl-1');
      expect(service.toggleFavorite).toHaveBeenCalledWith('user-1', 'tpl-1');
    });
  });

  describe('findMyPersonal', () => {
    it('should return user personal templates', async () => {
      const mockPersonals = [
        { id: 'tpl-1', name: '내 템플릿 1', isPersonal: true },
        { id: 'tpl-2', name: '내 템플릿 2', isPersonal: true },
      ];

      vi.mocked(service.findMyPersonal).mockResolvedValue(mockPersonals);

      const result = await controller.findMyPersonal('user-1');

      expect(result.data).toHaveLength(2);
      expect(result.data[0].isPersonal).toBe(true);
      expect(service.findMyPersonal).toHaveBeenCalledWith('user-1');
    });
  });

  describe('update', () => {
    it('should update template', async () => {
      const body = { sections: [{ id: 's1', title: '수정된 섹션' }] };
      const mockUpdated = {
        id: 'tpl-1',
        version: '1.1',
        ...body,
      };

      vi.mocked(service.update).mockResolvedValue(mockUpdated);

      const result = await controller.update('tpl-1', body, 'user-1');

      expect(result.data.version).toBe('1.1');
      expect(service.update).toHaveBeenCalledWith('tpl-1', body, 'user-1');
    });
  });

  describe('delete', () => {
    it('should delete template', async () => {
      const mockDeleted = { id: 'tpl-1', isActive: false };

      vi.mocked(service.delete).mockResolvedValue(mockDeleted);

      const result = await controller.delete('tpl-1');

      expect(result.data.isActive).toBe(false);
      expect(service.delete).toHaveBeenCalledWith('tpl-1');
    });
  });

  describe('clone', () => {
    it('should clone template', async () => {
      const mockCloned = {
        id: 'tpl-2',
        name: '내과 외래 (복사)',
        createdBy: 'user-1',
      };

      vi.mocked(service.clone).mockResolvedValue(mockCloned);

      const result = await controller.clone('tpl-1', 'user-1');

      expect(result.data.name).toContain('(복사)');
      expect(service.clone).toHaveBeenCalledWith('tpl-1', 'user-1');
    });
  });

  describe('personalize', () => {
    it('should create personal template from public template', async () => {
      const body = { name: '내 개인 템플릿', sections: [] };
      const mockPersonal = {
        id: 'tpl-2',
        name: '내 개인 템플릿',
        isPersonal: true,
        ownerId: 'user-1',
      };

      vi.mocked(service.createPersonal).mockResolvedValue(mockPersonal);

      const result = await controller.personalize('tpl-1', body, 'user-1');

      expect(result.data.isPersonal).toBe(true);
      expect(result.data.ownerId).toBe('user-1');
      expect(service.createPersonal).toHaveBeenCalledWith('tpl-1', 'user-1', body);
    });
  });

  describe('recordUsage', () => {
    it('should record template usage', async () => {
      const mockResult = {
        id: 'tpl-1',
        usageCount: 5,
        lastUsedAt: new Date(),
      };

      vi.mocked(service.recordUsage).mockResolvedValue(mockResult);

      const result = await controller.recordUsage('tpl-1', 'user-1');

      expect(result.data.usageCount).toBe(5);
      expect(service.recordUsage).toHaveBeenCalledWith('tpl-1', 'user-1');
    });
  });
});
