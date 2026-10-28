import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NotFoundException, ConflictException } from '@nestjs/common';
import { FormEngineService } from '../../src/modules/form-engine/form-engine.service';

describe('FormEngineService', () => {
  let service: FormEngineService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      formSchema: {
        findMany: vi.fn(),
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      formSubmission: {
        create: vi.fn(),
        findMany: vi.fn(),
      },
      // 2026-10-21 P5 A7 — 만들기·문항 수정은 판 원장과 한 트랜잭션
      formSchemaRevision: { create: vi.fn(), createMany: vi.fn() },
      $transaction: vi.fn(async (fn: any) => fn(mockPrisma)),
    };

    service = new FormEngineService(mockPrisma);
  });

  describe('findAllSchemas', () => {
    it('should return all active schemas', async () => {
      const mockSchemas = [
        {
          id: 'schema-1',
          name: '입원 문진표',
          version: '1.0',
          locale: 'ko',
          isActive: true,
          createdAt: new Date(),
        },
        {
          id: 'schema-2',
          name: '퇴원 설문',
          version: '1.0',
          locale: 'ko',
          isActive: true,
          createdAt: new Date(),
        },
      ];

      mockPrisma.formSchema.findMany.mockResolvedValue(mockSchemas);

      const result = await service.findAllSchemas();

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('입원 문진표');
      expect(mockPrisma.formSchema.findMany).toHaveBeenCalledWith({
        where: { isActive: true },
        select: expect.any(Object),
        orderBy: { name: 'asc' },
      });
    });

    it('should only return active schemas', async () => {
      mockPrisma.formSchema.findMany.mockResolvedValue([]);

      await service.findAllSchemas();

      expect(mockPrisma.formSchema.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { isActive: true },
        })
      );
    });

    it('should sort by name ascending', async () => {
      mockPrisma.formSchema.findMany.mockResolvedValue([]);

      await service.findAllSchemas();

      expect(mockPrisma.formSchema.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { name: 'asc' },
        })
      );
    });

    it('should include specific fields only', async () => {
      const mockSchemas = [
        {
          id: 'schema-1',
          name: '폼',
          version: '1.0',
          locale: 'ko',
          isActive: true,
          createdAt: new Date(),
        },
      ];

      mockPrisma.formSchema.findMany.mockResolvedValue(mockSchemas);

      const result = await service.findAllSchemas();

      result.forEach((schema) => {
        expect(schema).toHaveProperty('id');
        expect(schema).toHaveProperty('name');
        expect(schema).toHaveProperty('version');
        expect(schema).toHaveProperty('locale');
        expect(schema).toHaveProperty('isActive');
      });
    });

    it('should return empty array if no active schemas', async () => {
      mockPrisma.formSchema.findMany.mockResolvedValue([]);

      const result = await service.findAllSchemas();

      expect(result).toEqual([]);
    });
  });

  describe('findSchemaByName', () => {
    it('should return schema by name', async () => {
      const mockSchema = {
        id: 'schema-1',
        name: '수술 전 문진',
        version: '1.0',
        locale: 'ko',
        schema: { fields: [] },
        isActive: true,
      };

      mockPrisma.formSchema.findUnique.mockResolvedValue(mockSchema);

      const result = await service.findSchemaByName('수술 전 문진');

      expect(result.name).toBe('수술 전 문진');
      expect(mockPrisma.formSchema.findUnique).toHaveBeenCalledWith({
        where: { name: '수술 전 문진' },
      });
    });

    it('should throw NotFoundException if schema not found', async () => {
      mockPrisma.formSchema.findUnique.mockResolvedValue(null);

      await expect(service.findSchemaByName('non-existent')).rejects.toThrow(
        NotFoundException
      );
    });

    it('should include full schema data', async () => {
      const mockSchema = {
        id: 'schema-1',
        name: '테스트',
        version: '2.0',
        schema: { fields: [{ id: 'field-1', type: 'text' }] },
      };

      mockPrisma.formSchema.findUnique.mockResolvedValue(mockSchema);

      const result = await service.findSchemaByName('테스트');

      expect(result.schema).toBeDefined();
      expect(result.version).toBe('2.0');
    });
  });

  describe('createSchema', () => {
    it('should create new schema', async () => {
      const dto = {
        name: '새 폼',
        version: '1.0',
        locale: 'ko',
        schema: { fields: [] },
      };

      mockPrisma.formSchema.findUnique.mockResolvedValue(null);
      mockPrisma.formSchema.create.mockResolvedValue({
        id: 'schema-1',
        ...dto,
        createdBy: 'user-1',
      });

      const result = await service.createSchema(dto, 'user-1');

      expect(result.name).toBe('새 폼');
      expect(result.createdBy).toBe('user-1');
    });

    it('should throw ConflictException if schema exists', async () => {
      const dto = {
        name: '기존 폼',
        version: '1.0',
        locale: 'ko',
        schema: {},
      };

      mockPrisma.formSchema.findUnique.mockResolvedValue({ id: 'schema-1' });

      await expect(service.createSchema(dto, 'user-1')).rejects.toThrow(
        ConflictException
      );
    });

    it('should set default locale to ko', async () => {
      const dto = {
        name: '폼',
        version: '1.0',
        schema: {},
      };

      mockPrisma.formSchema.findUnique.mockResolvedValue(null);
      mockPrisma.formSchema.create.mockResolvedValue({
        id: 'schema-1',
        ...dto,
        locale: 'ko',
        createdBy: 'user-1',
      });

      const result = await service.createSchema(dto, 'user-1');

      expect(result.locale).toBe('ko');
    });

    it('should use provided locale', async () => {
      const dto = {
        name: '폼',
        version: '1.0',
        locale: 'en',
        schema: {},
      };

      mockPrisma.formSchema.findUnique.mockResolvedValue(null);
      mockPrisma.formSchema.create.mockResolvedValue({
        id: 'schema-1',
        ...dto,
        createdBy: 'user-1',
      });

      const result = await service.createSchema(dto, 'user-1');

      expect(result.locale).toBe('en');
    });

    it('should track userId as createdBy', async () => {
      const dto = {
        name: '폼',
        version: '1.0',
        schema: {},
      };

      mockPrisma.formSchema.findUnique.mockResolvedValue(null);
      mockPrisma.formSchema.create.mockResolvedValue({
        id: 'schema-1',
        ...dto,
        createdBy: 'doctor-123',
      });

      await service.createSchema(dto, 'doctor-123');

      expect(mockPrisma.formSchema.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          createdBy: 'doctor-123',
        }),
      });
    });
  });

  describe('updateSchema', () => {
    it('should update schema', async () => {
      mockPrisma.formSchema.findUnique.mockResolvedValue({
        id: 'schema-1',
        name: '폼',
      });
      mockPrisma.formSchema.update.mockResolvedValue({
        id: 'schema-1',
        version: '2.0',
        name: '폼',
      });

      const result = await service.updateSchema('schema-1', { version: '2.0' });

      expect(result.version).toBe('2.0');
    });

    it('should throw NotFoundException if schema not found', async () => {
      mockPrisma.formSchema.findUnique.mockResolvedValue(null);

      await expect(
        service.updateSchema('invalid-id', { version: '2.0' })
      ).rejects.toThrow(NotFoundException);
    });

    it('should update partial fields', async () => {
      mockPrisma.formSchema.findUnique.mockResolvedValue({
        id: 'schema-1',
      });
      mockPrisma.formSchema.update.mockResolvedValue({
        id: 'schema-1',
        locale: 'en',
      });

      const result = await service.updateSchema('schema-1', { locale: 'en' });

      expect(result.locale).toBe('en');
    });

    it('should update schema content', async () => {
      mockPrisma.formSchema.findUnique.mockResolvedValue({
        id: 'schema-1', revision: 1, version: '1.0', schema: {},
      });
      const newSchema = { fields: [{ id: 'field-1', type: 'text' }] };

      // 문항이 바뀌면 판을 올리는 조건부 갱신 → 저장된 행
      mockPrisma.formSchema.updateMany = vi.fn().mockResolvedValue({ count: 1 });
      mockPrisma.formSchema.findUniqueOrThrow = vi.fn().mockResolvedValue({
        id: 'schema-1', revision: 2, version: '1.0', schema: newSchema,
      });

      const result = await service.updateSchema('schema-1', { schema: newSchema });

      expect(result.schema).toEqual(newSchema);
    });

    it('should allow multiple fields update', async () => {
      mockPrisma.formSchema.findUnique.mockResolvedValue({
        id: 'schema-1',
      });
      mockPrisma.formSchema.update.mockResolvedValue({
        id: 'schema-1',
        version: '2.0',
        locale: 'en',
      });

      const result = await service.updateSchema('schema-1', {
        version: '2.0',
        locale: 'en',
      });

      expect(result.version).toBe('2.0');
      expect(result.locale).toBe('en');
    });
  });
  // 2026-10-21 P5 A7 — submit·getPatientFormData 회수 · 판 원장은 form-revision-p5.spec.ts
});
