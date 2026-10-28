import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ChartTemplateService } from '../../src/modules/chart-template/chart-template.service';
import { NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';

describe('ChartTemplateService', () => {
  let service: ChartTemplateService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      chartTemplate: {
        findMany: vi.fn(),
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      userChartPreference: {
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        upsert: vi.fn(),
      },
      chartTemplateVersion: {
        create: vi.fn(),
        findFirst: vi.fn(),
        findMany: vi.fn(),
      },
    };

    service = new ChartTemplateService(mockPrisma);
  });

  describe('findAll', () => {
    it('should return all active public templates without filter', async () => {
      const mockTemplates = [
        { id: 'tpl-1', name: '내과 외래', department: '내과', role: 'DOCTOR', isActive: true, isPersonal: false },
        { id: 'tpl-2', name: '응급실', department: '응급', role: 'DOCTOR', isActive: true, isPersonal: false },
      ];

      mockPrisma.chartTemplate.findMany.mockResolvedValue(mockTemplates);

      const result = await service.findAll({});

      expect(result).toHaveLength(2);
      expect(mockPrisma.chartTemplate.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ isActive: true, isPersonal: false }),
        }),
      );
    });

    it('should filter templates by department', async () => {
      mockPrisma.chartTemplate.findMany.mockResolvedValue([
        { id: 'tpl-1', name: '내과 외래', department: '내과' },
      ]);

      await service.findAll({ department: '내과' });

      expect(mockPrisma.chartTemplate.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ department: { contains: '내과' } }),
        }),
      );
    });

    it('should filter templates by role', async () => {
      mockPrisma.chartTemplate.findMany.mockResolvedValue([
        { id: 'tpl-1', name: '간호일지', role: 'NURSE' },
      ]);

      await service.findAll({ role: 'NURSE' });

      expect(mockPrisma.chartTemplate.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ role: 'NURSE' }),
        }),
      );
    });
  });

  describe('findById', () => {
    it('should return template by id', async () => {
      const mockTemplate = { id: 'tpl-1', name: '내과 외래' };
      mockPrisma.chartTemplate.findUnique.mockResolvedValue(mockTemplate);

      const result = await service.findById('tpl-1');

      expect(result).toEqual(mockTemplate);
      expect(mockPrisma.chartTemplate.findUnique).toHaveBeenCalledWith({ where: { id: 'tpl-1' } });
    });

    it('should throw NotFoundException if template not found', async () => {
      mockPrisma.chartTemplate.findUnique.mockResolvedValue(null);

      await expect(service.findById('tpl-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('create', () => {
    it('should create new template', async () => {
      const data = {
        name: '수술기록',
        department: '외과',
        role: 'DOCTOR',
        category: 'SURGERY',
        layout: 'single-page',
        sections: [{ id: 's1', title: '수술정보', fields: [] }],
      };

      mockPrisma.chartTemplate.create.mockResolvedValue({
        id: 'tpl-1',
        ...data,
        isDefault: false,
        isPersonal: false,
        version: '1.0',
        createdBy: 'user-1',
      });

      const result = await service.create(data, 'user-1');

      expect(result.id).toBe('tpl-1');
      expect(result.name).toBe('수술기록');
      expect(mockPrisma.chartTemplate.create).toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('should update template and bump version', async () => {
      mockPrisma.chartTemplate.findUnique.mockResolvedValue({
        id: 'tpl-1',
        name: '내과 외래',
        version: '1.0',
        isPersonal: false,
        ownerId: null,
      });

      mockPrisma.chartTemplate.update.mockResolvedValue({
        id: 'tpl-1',
        version: '1.1',
        sections: [{ id: 's1', title: '수정된 섹션' }],
      });

      const result = await service.update('tpl-1', { sections: [{ id: 's1', title: '수정된 섹션' }] });

      expect(result.version).toBe('1.1');
      expect(mockPrisma.chartTemplate.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ version: '1.1' }),
        }),
      );
    });

    it('should throw ForbiddenException if non-owner updates personal template', async () => {
      mockPrisma.chartTemplate.findUnique.mockResolvedValue({
        id: 'tpl-1',
        isPersonal: true,
        ownerId: 'user-1',
      });

      await expect(service.update('tpl-1', {}, 'user-2')).rejects.toThrow(ForbiddenException);
    });

    it('should allow owner to update personal template', async () => {
      mockPrisma.chartTemplate.findUnique.mockResolvedValue({
        id: 'tpl-1',
        version: '1.0',
        isPersonal: true,
        ownerId: 'user-1',
      });

      mockPrisma.chartTemplate.update.mockResolvedValue({
        id: 'tpl-1',
        isPersonal: true,
        sections: [{ id: 's1' }],
      });

      const result = await service.update('tpl-1', { sections: [{ id: 's1' }] }, 'user-1');

      expect(result.id).toBe('tpl-1');
    });
  });

  describe('delete', () => {
    it('should soft delete template', async () => {
      mockPrisma.chartTemplate.update.mockResolvedValue({
        id: 'tpl-1',
        isActive: false,
      });

      const result = await service.delete('tpl-1');

      expect(result.isActive).toBe(false);
      expect(mockPrisma.chartTemplate.update).toHaveBeenCalledWith({
        where: { id: 'tpl-1' },
        data: { isActive: false },
      });
    });
  });

  describe('clone', () => {
    it('should clone template with (복사) suffix', async () => {
      mockPrisma.chartTemplate.findUnique.mockResolvedValue({
        id: 'tpl-1',
        name: '내과 외래',
        department: '내과',
        role: 'DOCTOR',
        category: 'OUTPATIENT',
        layout: 'tabs',
        sections: [{ id: 's1' }],
      });

      mockPrisma.chartTemplate.create.mockResolvedValue({
        id: 'tpl-2',
        name: '내과 외래 (복사)',
        version: '1.0',
      });

      const result = await service.clone('tpl-1', 'user-1');

      expect(result.name).toContain('(복사)');
      expect(mockPrisma.chartTemplate.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: expect.stringContaining('(복사)'),
            createdBy: 'user-1',
          }),
        }),
      );
    });
  });

  describe('getPresets', () => {
    it('should return list of available presets with metadata', () => {
      const presets = service.getPresets();

      expect(presets.length).toBeGreaterThan(0);
      expect(presets[0]).toHaveProperty('key');
      expect(presets[0]).toHaveProperty('name');
      expect(presets[0]).toHaveProperty('department');
      expect(presets[0]).toHaveProperty('sectionCount');
      expect(presets[0]).toHaveProperty('fieldCount');
    });
  });

  describe('createFromPreset', () => {
    it('should create template from preset', async () => {
      mockPrisma.chartTemplate.create.mockResolvedValue({
        id: 'tpl-1',
        name: '내과 외래 진료',
        department: '내과',
        category: 'OUTPATIENT',
        createdBy: 'user-1',
      });

      const result = await service.createFromPreset('internal-outpatient', 'user-1');

      expect(result.id).toBe('tpl-1');
      expect(result.name).toBe('내과 외래 진료');
      expect(mockPrisma.chartTemplate.create).toHaveBeenCalled();
    });

    it('should throw NotFoundException if preset not found', async () => {
      await expect(service.createFromPreset('invalid-preset', 'user-1')).rejects.toThrow(NotFoundException);
    });

    it('should override preset name and department', async () => {
      mockPrisma.chartTemplate.create.mockResolvedValue({
        id: 'tpl-1',
        name: '커스텀 내과',
      });

      await service.createFromPreset('internal-outpatient', 'user-1', { name: '커스텀 내과' });

      expect(mockPrisma.chartTemplate.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ name: '커스텀 내과' }),
        }),
      );
    });
  });

  describe('getForMe', () => {
    it('should return templates matching user role and department', async () => {
      const mockTemplates = [
        { id: 'tpl-1', name: '내과 외래', isDefault: true },
      ];
      const mockPreference = {
        userId: 'user-1',
        defaultTemplateId: 'tpl-1',
        favoriteTemplateIds: ['tpl-1'],
        recentTemplateIds: ['tpl-1'],
      };

      mockPrisma.chartTemplate.findMany.mockResolvedValue(mockTemplates);
      mockPrisma.userChartPreference.findUnique.mockResolvedValue(mockPreference);

      const result = await service.getForMe('user-1', 'DOCTOR', '내과');

      expect(result.templates).toHaveLength(1);
      expect(result.preference).toEqual(mockPreference);
    });

    it('should return default preference if none exists', async () => {
      mockPrisma.chartTemplate.findMany.mockResolvedValue([]);
      mockPrisma.userChartPreference.findUnique.mockResolvedValue(null);

      const result = await service.getForMe('user-1', 'DOCTOR');

      expect(result.preference).toEqual({
        defaultTemplateId: null,
        favoriteTemplateIds: [],
        recentTemplateIds: [],
      });
    });
  });

  describe('createPersonal', () => {
    it('should create personal template from public template', async () => {
      mockPrisma.chartTemplate.findUnique.mockResolvedValue({
        id: 'tpl-1',
        name: '내과 외래',
        department: '내과',
        role: 'DOCTOR',
        category: 'OUTPATIENT',
        layout: 'tabs',
        sections: [{ id: 's1', title: '섹션' }],
      });

      mockPrisma.chartTemplate.create.mockResolvedValue({
        id: 'tpl-2',
        name: '내과 외래 (개인)',
        isPersonal: true,
        ownerId: 'user-1',
        version: '1.0',
      });

      const result = await service.createPersonal('tpl-1', 'user-1');

      expect(result.isPersonal).toBe(true);
      expect(result.ownerId).toBe('user-1');
      expect(result.name).toContain('(개인)');
    });

    it('should use custom name if provided', async () => {
      mockPrisma.chartTemplate.findUnique.mockResolvedValue({
        id: 'tpl-1',
        name: '내과 외래',
        sections: [{ id: 's1' }],
      });

      mockPrisma.chartTemplate.create.mockResolvedValue({
        id: 'tpl-2',
        name: '내 템플릿',
      });

      await service.createPersonal('tpl-1', 'user-1', { name: '내 템플릿' });

      expect(mockPrisma.chartTemplate.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ name: '내 템플릿' }),
        }),
      );
    });
  });

  describe('getMySettings', () => {
    it('should return user preference', async () => {
      const pref = {
        userId: 'user-1',
        defaultTemplateId: 'tpl-1',
        favoriteTemplateIds: ['tpl-1', 'tpl-2'],
        recentTemplateIds: ['tpl-2', 'tpl-1'],
      };

      mockPrisma.userChartPreference.findUnique.mockResolvedValue(pref);

      const result = await service.getMySettings('user-1');

      expect(result).toEqual(pref);
    });

    it('should return default settings if none exists', async () => {
      mockPrisma.userChartPreference.findUnique.mockResolvedValue(null);

      const result = await service.getMySettings('user-1');

      expect(result).toEqual({
        defaultTemplateId: null,
        favoriteTemplateIds: [],
        recentTemplateIds: [],
      });
    });
  });

  describe('setDefaultTemplate', () => {
    it('should set default template', async () => {
      mockPrisma.chartTemplate.findUnique.mockResolvedValue({ id: 'tpl-1' });
      mockPrisma.userChartPreference.upsert.mockResolvedValue({
        userId: 'user-1',
        defaultTemplateId: 'tpl-1',
      });

      const result = await service.setDefaultTemplate('user-1', 'tpl-1');

      expect(result.defaultTemplateId).toBe('tpl-1');
      expect(mockPrisma.userChartPreference.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-1' },
          update: { defaultTemplateId: 'tpl-1' },
        }),
      );
    });
  });

  describe('toggleFavorite', () => {
    it('should add template to favorites', async () => {
      mockPrisma.chartTemplate.findUnique.mockResolvedValue({ id: 'tpl-1' });
      mockPrisma.userChartPreference.findUnique.mockResolvedValue({
        userId: 'user-1',
        favoriteTemplateIds: [],
      });

      mockPrisma.userChartPreference.update.mockResolvedValue({
        userId: 'user-1',
        favoriteTemplateIds: ['tpl-1'],
      });

      const result = await service.toggleFavorite('user-1', 'tpl-1');

      expect(result.favoriteTemplateIds).toContain('tpl-1');
    });

    it('should remove template from favorites', async () => {
      mockPrisma.chartTemplate.findUnique.mockResolvedValue({ id: 'tpl-1' });
      mockPrisma.userChartPreference.findUnique.mockResolvedValue({
        userId: 'user-1',
        favoriteTemplateIds: ['tpl-1', 'tpl-2'],
      });

      mockPrisma.userChartPreference.update.mockResolvedValue({
        userId: 'user-1',
        favoriteTemplateIds: ['tpl-2'],
      });

      const result = await service.toggleFavorite('user-1', 'tpl-1');

      expect(result.favoriteTemplateIds).not.toContain('tpl-1');
    });

    it('should create preference if not exists', async () => {
      mockPrisma.chartTemplate.findUnique.mockResolvedValue({ id: 'tpl-1' });
      mockPrisma.userChartPreference.findUnique.mockResolvedValue(null);

      mockPrisma.userChartPreference.create.mockResolvedValue({
        userId: 'user-1',
        favoriteTemplateIds: ['tpl-1'],
      });

      const result = await service.toggleFavorite('user-1', 'tpl-1');

      expect(result.favoriteTemplateIds).toContain('tpl-1');
    });
  });

  describe('recordUsage', () => {
    it('should increment usage count and update recent templates', async () => {
      // 사용 기록도 접근 가능한 템플릿에만 — 남의 개인 템플릿 카운트를 올릴 수 없다
      mockPrisma.chartTemplate.findUnique.mockResolvedValue({ id: 'tpl-1', isPersonal: false, ownerId: null });
      mockPrisma.chartTemplate.update.mockResolvedValue({
        id: 'tpl-1',
        usageCount: 5,
        lastUsedAt: new Date(),
      });

      mockPrisma.userChartPreference.findUnique.mockResolvedValue({
        userId: 'user-1',
        recentTemplateIds: ['tpl-2', 'tpl-3'],
      });

      mockPrisma.userChartPreference.upsert.mockResolvedValue({
        userId: 'user-1',
        recentTemplateIds: ['tpl-1', 'tpl-2', 'tpl-3'],
      });

      const result = await service.recordUsage('tpl-1', 'user-1');

      expect(mockPrisma.chartTemplate.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'tpl-1' },
          data: expect.objectContaining({
            usageCount: { increment: 1 },
          }),
        }),
      );
    });

    it('should limit recent templates to 5 items', async () => {
      mockPrisma.chartTemplate.findUnique.mockResolvedValue({ id: 'tpl-1', isPersonal: false, ownerId: null });
      mockPrisma.chartTemplate.update.mockResolvedValue({
        id: 'tpl-1',
        usageCount: 1,
      });

      mockPrisma.userChartPreference.findUnique.mockResolvedValue({
        userId: 'user-1',
        recentTemplateIds: ['tpl-2', 'tpl-3', 'tpl-4', 'tpl-5', 'tpl-6'],
      });

      mockPrisma.userChartPreference.upsert.mockResolvedValue({
        userId: 'user-1',
        recentTemplateIds: ['tpl-1', 'tpl-2', 'tpl-3', 'tpl-4', 'tpl-5'],
      });

      await service.recordUsage('tpl-1', 'user-1');

      expect(mockPrisma.userChartPreference.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: {
            recentTemplateIds: expect.arrayContaining(['tpl-1']),
          },
        }),
      );
    });
  });

  describe('findMyPersonal', () => {
    it('should return user personal templates sorted by usage and date', async () => {
      const mockPersonals = [
        { id: 'tpl-1', name: '내 템플릿 1', usageCount: 10 },
        { id: 'tpl-2', name: '내 템플릿 2', usageCount: 5 },
      ];

      mockPrisma.chartTemplate.findMany.mockResolvedValue(mockPersonals);

      const result = await service.findMyPersonal('user-1');

      expect(result).toHaveLength(2);
      expect(result[0].usageCount).toBeGreaterThanOrEqual(result[1].usageCount);
      expect(mockPrisma.chartTemplate.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            isActive: true,
            isPersonal: true,
            ownerId: 'user-1',
          },
        }),
      );
    });
  });

  /* ================================================================
   * W8-R7 가드 — 차트 에디터 실결함 재발 방지
   * ================================================================ */

  describe('🔴 E3 매핑 키 수렴 — soapMapping 재유입 차단', () => {
    const sections = [{
      id: 's1', title: '섹션',
      fields: [
        { id: 'f1', type: 'textarea', label: '주호소', soapMapping: 'subjective' },
        { id: 'f2', type: 'text', label: '이학적', soapMapping: 'objective', mappedTo: 'plan' },
        { id: 'f3', type: 'text', label: '기타', soapMapping: '' },
        { id: 'f4', type: 'text', label: '비SOAP', soapMapping: 'vitals' },
      ],
    }];

    const savedSections = () => {
      const call = mockPrisma.chartTemplate.create.mock.calls[0]?.[0]
        ?? mockPrisma.chartTemplate.update.mock.calls[0]?.[0];
      return call.data.sections as any[];
    };

    it('create: soapMapping 은 mappedTo 로 흡수되고 저장본에서 사라진다', async () => {
      mockPrisma.chartTemplate.create.mockResolvedValue({ id: 'tpl-1' });
      await service.create({ name: 't', sections: sections as any }, 'user-1');

      const fields = savedSections()[0].fields;
      expect(fields[0].mappedTo).toBe('subjective');   // 레거시 키 흡수
      expect(fields[1].mappedTo).toBe('plan');          // mappedTo 가 정본 — 레거시가 덮지 않는다
      expect(fields[3].mappedTo).toBeUndefined();       // SOAP 슬롯이 아닌 값은 승격하지 않는다
      for (const f of fields) expect('soapMapping' in f).toBe(false);
    });

    it('update: 수정 경로로도 soapMapping 이 되살아나지 않는다', async () => {
      mockPrisma.chartTemplate.findUnique.mockResolvedValue({ id: 'tpl-1', version: '1.0', isPersonal: false, ownerId: null, sections: [] });
      mockPrisma.chartTemplateVersion.create.mockResolvedValue({});
      mockPrisma.chartTemplate.update.mockResolvedValue({ id: 'tpl-1', version: '1.1' });

      await service.update('tpl-1', { sections: sections as any }, 'user-1');

      const fields = savedSections()[0].fields;
      expect(fields[0].mappedTo).toBe('subjective');
      for (const f of fields) expect('soapMapping' in f).toBe(false);
    });
  });

  describe('🔴 E10 역할·카테고리 계약 — 한글 저장 차단', () => {
    it("role:'의사' 로는 만들 수 없다(진료 화면 목록은 영문 enum 으로 조회한다)", async () => {
      await expect(service.create({ name: 't', role: '의사' }, 'user-1')).rejects.toThrow(BadRequestException);
      expect(mockPrisma.chartTemplate.create).not.toHaveBeenCalled();
    });

    it("category:'초진' 로는 만들 수 없다", async () => {
      await expect(service.create({ name: 't', category: '초진' }, 'user-1')).rejects.toThrow(BadRequestException);
    });

    it('수정 경로로도 한글 역할을 넣을 수 없다', async () => {
      mockPrisma.chartTemplate.findUnique.mockResolvedValue({ id: 'tpl-1', version: '1.0', isPersonal: false, ownerId: null });
      await expect(service.update('tpl-1', { role: '간호사' }, 'user-1')).rejects.toThrow(BadRequestException);
      expect(mockPrisma.chartTemplate.update).not.toHaveBeenCalled();
    });

    it('영문 역할 enum 은 통과한다', async () => {
      mockPrisma.chartTemplate.create.mockResolvedValue({ id: 'tpl-1', role: 'NURSE' });
      const r = await service.create({ name: 't', role: 'NURSE', category: 'NURSING' }, 'user-1');
      expect(r.role).toBe('NURSE');
    });
  });

  describe('🔴 rollback IDOR — 없는 것과 남의 것을 똑같이 404', () => {
    const othersPersonal = { id: 'tpl-1', version: '2.0', isPersonal: true, ownerId: 'user-1', sections: [] };

    beforeEach(() => {
      mockPrisma.chartTemplateVersion.findFirst = vi.fn().mockResolvedValue({ id: 'v1', templateId: 'tpl-1', version: '1.0', sections: [] });
      mockPrisma.chartTemplateVersion.findMany = vi.fn().mockResolvedValue([]);
    });

    it('남의 개인 템플릿은 rollback 되지 않는다(sections 를 덮어쓸 수 있었다)', async () => {
      mockPrisma.chartTemplate.findUnique.mockResolvedValue(othersPersonal);
      await expect(service.rollbackToVersion('tpl-1', 'v1', 'user-2')).rejects.toThrow(NotFoundException);
      expect(mockPrisma.chartTemplate.update).not.toHaveBeenCalled();
      expect(mockPrisma.chartTemplateVersion.create).not.toHaveBeenCalled();
    });

    it('남의 개인 템플릿은 상세·버전목록·버전상세·복사도 404', async () => {
      mockPrisma.chartTemplate.findUnique.mockResolvedValue(othersPersonal);
      await expect(service.findById('tpl-1', 'user-2')).rejects.toThrow(NotFoundException);
      await expect(service.getVersionHistory('tpl-1', 'user-2')).rejects.toThrow(NotFoundException);
      await expect(service.getVersion('tpl-1', 'v1', 'user-2')).rejects.toThrow(NotFoundException);
      await expect(service.clone('tpl-1', 'user-2')).rejects.toThrow(NotFoundException);
      await expect(service.recordUsage('tpl-1', 'user-2')).rejects.toThrow(NotFoundException);
    });

    it('소유자는 rollback 할 수 있다', async () => {
      mockPrisma.chartTemplate.findUnique.mockResolvedValue(othersPersonal);
      mockPrisma.chartTemplateVersion.create.mockResolvedValue({});
      mockPrisma.chartTemplate.update.mockResolvedValue({ id: 'tpl-1', version: '2.1' });
      const r = await service.rollbackToVersion('tpl-1', 'v1', 'user-1');
      expect(r.version).toBe('2.1');
    });
  });

  describe('🔴 E12 복사 — 개인 템플릿 복제본이 전체 공개로 새지 않는다', () => {
    it('개인 템플릿의 복사본은 복사한 사람의 개인 템플릿이다', async () => {
      mockPrisma.chartTemplate.findUnique.mockResolvedValue({
        id: 'tpl-1', name: '내 서식', department: '내과', role: 'DOCTOR', category: 'OUTPATIENT',
        layout: 'tabs', sections: [], isPersonal: true, ownerId: 'user-1',
      });
      mockPrisma.chartTemplate.create.mockResolvedValue({ id: 'tpl-2', isPersonal: true, ownerId: 'user-1' });

      await service.clone('tpl-1', 'user-1');

      expect(mockPrisma.chartTemplate.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ isPersonal: true, ownerId: 'user-1' }) }),
      );
    });

    it('공용 템플릿의 복사본은 공용이다(소유자 없음)', async () => {
      mockPrisma.chartTemplate.findUnique.mockResolvedValue({
        id: 'tpl-1', name: '공용', department: '내과', role: 'DOCTOR', category: 'OUTPATIENT',
        layout: 'tabs', sections: [], isPersonal: false, ownerId: null,
      });
      mockPrisma.chartTemplate.create.mockResolvedValue({ id: 'tpl-2' });

      await service.clone('tpl-1', 'user-2');

      expect(mockPrisma.chartTemplate.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ isPersonal: false, ownerId: null }) }),
      );
    });
  });

  describe('boardLayout 핀 고정(레거시 호환·부분 저장)', () => {
    it('레거시 배열 저장분은 {panels, pinned:[]}로 정규화한다', async () => {
      mockPrisma.userChartPreference.findUnique.mockResolvedValue({ boardLayout: ['vitals', 'orders'] });
      const res = await service.getBoardLayout('user-1');
      expect(res).toEqual({ panels: ['vitals', 'orders'], pinned: [] });
    });

    it('pinned 미전달(undefined)이면 기존 핀을 보존한다(편집기 부분 저장 호환)', async () => {
      mockPrisma.userChartPreference.findUnique.mockResolvedValue({ boardLayout: { panels: ['vitals'], pinned: ['orders'] } });
      mockPrisma.userChartPreference.upsert.mockResolvedValue({});
      const res = await service.setBoardLayout('user-1', ['vitals', 'labresults']);
      expect(res).toEqual({ panels: ['vitals', 'labresults'], pinned: ['orders'] });
    });

    it('panels·pinned 둘 다 비면 DbNull(완전 초기화)', async () => {
      mockPrisma.userChartPreference.upsert.mockResolvedValue({});
      const res = await service.setBoardLayout('user-1', null, []);
      expect(res).toEqual({ panels: null, pinned: [] });
    });
  });
});
