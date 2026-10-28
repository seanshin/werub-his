import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FormEngineController } from '../../src/modules/form-engine/form-engine.controller';
import { FormEngineService } from '../../src/modules/form-engine/form-engine.service';

describe('FormEngineController', () => {
  let controller: FormEngineController;
  let service: FormEngineService;

  beforeEach(() => {
    service = {
      findAllSchemas: vi.fn(),
      findSchemaByName: vi.fn(),
      createSchema: vi.fn(),
      updateSchema: vi.fn(),
      submit: vi.fn(),
      getPatientFormData: vi.fn(),
    } as any;

    controller = new FormEngineController(service);
  });

  describe('GET /api/v1/forms (findAll)', () => {
    it('should return all active form schemas', async () => {
      const mockSchemas = [
        {
          id: 'schema-1',
          name: '수술전 문진',
          version: '1.0',
          locale: 'ko',
          isActive: true,
          createdAt: new Date(),
        },
        {
          id: 'schema-2',
          name: '입원 체크리스트',
          version: '1.0',
          locale: 'ko',
          isActive: true,
          createdAt: new Date(),
        },
      ];

      vi.mocked(service.findAllSchemas).mockResolvedValue(mockSchemas);

      const result = await controller.findAll();

      expect(result.data).toHaveLength(2);
      expect(result.data[0].name).toBe('수술전 문진');
      expect(service.findAllSchemas).toHaveBeenCalled();
    });

    it('should return empty array when no schemas exist', async () => {
      vi.mocked(service.findAllSchemas).mockResolvedValue([]);

      const result = await controller.findAll();

      expect(result.data).toEqual([]);
    });

    it('should include schema metadata', async () => {
      const mockSchemas = [
        {
          id: 'schema-1',
          name: '문진표',
          version: '2.1',
          locale: 'en',
          isActive: true,
          createdAt: new Date('2026-05-13'),
        },
      ];

      vi.mocked(service.findAllSchemas).mockResolvedValue(mockSchemas);

      const result = await controller.findAll();

      expect(result.data[0].version).toBe('2.1');
      expect(result.data[0].locale).toBe('en');
      expect(result.data[0].isActive).toBe(true);
    });
  });

  describe('GET /api/v1/forms/:name (findByName)', () => {
    it('should return form schema by name', async () => {
      const mockSchema = {
        id: 'schema-1',
        name: '수술전 문진',
        version: '1.0',
        locale: 'ko',
        schema: {
          fields: [
            { id: 'field-1', label: '알레르기', type: 'text' },
          ],
        },
        isActive: true,
        createdAt: new Date(),
      };

      vi.mocked(service.findSchemaByName).mockResolvedValue(mockSchema);

      const result = await controller.findByName('수술전 문진');

      expect(result.data.id).toBe('schema-1');
      expect(result.data.name).toBe('수술전 문진');
      expect(service.findSchemaByName).toHaveBeenCalledWith('수술전 문진');
    });

    it('should include schema structure for rendering', async () => {
      const mockSchema = {
        id: 'schema-1',
        name: '문진',
        schema: {
          fields: [
            { id: 'f1', label: '질문1', type: 'text', required: true },
            { id: 'f2', label: '질문2', type: 'select', options: ['옵션1', '옵션2'] },
          ],
        },
        isActive: true,
      };

      vi.mocked(service.findSchemaByName).mockResolvedValue(mockSchema);

      const result = await controller.findByName('문진');

      expect(result.data.schema.fields).toHaveLength(2);
      expect(result.data.schema.fields[0].required).toBe(true);
    });

    it('should handle schema with locale-specific content', async () => {
      const mockSchema = {
        id: 'schema-1',
        name: '환자 정보',
        locale: 'ko',
        schema: {
          title: '환자 정보 입력',
          fields: [],
        },
        isActive: true,
      };

      vi.mocked(service.findSchemaByName).mockResolvedValue(mockSchema);

      const result = await controller.findByName('환자 정보');

      expect(result.data.locale).toBe('ko');
      expect(result.data.schema.title).toBe('환자 정보 입력');
    });
  });

  describe('POST /api/v1/forms (create)', () => {
    it('should create new form schema', async () => {
      const dto = {
        name: '새로운 폼',
        version: '1.0',
        locale: 'ko',
        schema: { fields: [] },
      };

      const mockSchema = {
        id: 'schema-1',
        ...dto,
        isActive: true,
        createdBy: 'user-1',
        createdAt: new Date(),
      };

      vi.mocked(service.createSchema).mockResolvedValue(mockSchema);

      const result = await controller.create(dto, 'user-1');

      expect(result.data.id).toBe('schema-1');
      expect(result.data.name).toBe('새로운 폼');
      expect(result.data.isActive).toBe(true);
      expect(service.createSchema).toHaveBeenCalledWith(dto, 'user-1');
    });

    it('should track creator information', async () => {
      const dto = {
        name: '폼1',
        version: '1.0',
        schema: { fields: [] },
      };

      const mockSchema = {
        id: 'schema-2',
        ...dto,
        createdBy: 'admin-user',
        isActive: true,
      };

      vi.mocked(service.createSchema).mockResolvedValue(mockSchema);

      const result = await controller.create(dto, 'admin-user');

      expect(result.data.createdBy).toBe('admin-user');
    });

    it('should include schema structure in response', async () => {
      const dto = {
        name: '복합 폼',
        version: '2.0',
        locale: 'ko',
        schema: {
          title: '환자 설문',
          sections: [
            { id: 'sec1', label: '기본 정보' },
          ],
          fields: [
            { id: 'f1', label: 'Q1', type: 'text' },
          ],
        },
      };

      const mockSchema = {
        id: 'schema-3',
        ...dto,
        isActive: true,
        createdBy: 'user-1',
      };

      vi.mocked(service.createSchema).mockResolvedValue(mockSchema);

      const result = await controller.create(dto, 'user-1');

      expect(result.data.schema.sections).toHaveLength(1);
      expect(result.data.schema.fields).toHaveLength(1);
    });
  });

  describe('PUT /api/v1/forms/:id (update)', () => {
    it('should update form schema', async () => {
      const dto = {
        version: '1.1',
        schema: { fields: [] },
      };

      const mockSchema = {
        id: 'schema-1',
        name: '기존 폼',
        ...dto,
        locale: 'ko',
        isActive: true,
      };

      vi.mocked(service.updateSchema).mockResolvedValue(mockSchema);

      const result = await controller.update('schema-1', dto, 'user-1');

      expect(result.data.version).toBe('1.1');
      expect(service.updateSchema).toHaveBeenCalledWith('schema-1', dto, 'user-1');
    });

    it('should support partial updates', async () => {
      const dto = {
        version: '2.0',
      };

      const mockSchema = {
        id: 'schema-1',
        name: '폼',
        version: '2.0',
        schema: { fields: [] },
        isActive: true,
      };

      vi.mocked(service.updateSchema).mockResolvedValue(mockSchema);

      const result = await controller.update('schema-1', dto, 'user-1');

      expect(result.data.version).toBe('2.0');
    });

    it('should update schema structure', async () => {
      const dto = {
        schema: {
          fields: [
            { id: 'f1', label: '수정된 질문', type: 'text' },
            { id: 'f2', label: '새 질문', type: 'select' },
          ],
        },
      };

      const mockSchema = {
        id: 'schema-1',
        name: '폼',
        version: '1.0',
        ...dto,
        isActive: true,
      };

      vi.mocked(service.updateSchema).mockResolvedValue(mockSchema);

      const result = await controller.update('schema-1', dto, 'user-1');

      expect(result.data.schema.fields).toHaveLength(2);
    });

    it('should deactivate form if needed', async () => {
      const dto = {
        isActive: false,
      };

      const mockSchema = {
        id: 'schema-1',
        name: '폼',
        version: '1.0',
        schema: { fields: [] },
        isActive: false,
      };

      vi.mocked(service.updateSchema).mockResolvedValue(mockSchema);

      const result = await controller.update('schema-1', dto, 'user-1');

      expect(result.data.isActive).toBe(false);
    });
  });
  // 2026-10-21 P5 A7 — 직원 제출·환자 폼 데이터 EP 회수(부르는 화면 0) · 부재 가드는 test/form-engine/form-revision-p5.spec.ts
});
