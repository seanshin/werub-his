import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EncounterTemplateService } from '../../src/modules/encounter-template/encounter-template.service';
import { NotFoundException } from '@nestjs/common';

describe('EncounterTemplateService', () => {
  let service: EncounterTemplateService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      encounterTemplate: {
        create: vi.fn(),
        findMany: vi.fn(),
        findUnique: vi.fn(),
        update: vi.fn(),
      },
    };
    service = new EncounterTemplateService(mockPrisma);
  });

  describe('create', () => {
    it('should create encounter template', async () => {
      const dto = {
        department: 'Cardiology',
        name: '심장내과 기본',
        description: 'Cardiology baseline template',
        soapSections: { subjective: {}, objective: {}, assessment: {}, plan: {} },
        version: '1.0',
      };
      const mockTemplate = { id: 'tpl-1', ...dto, createdBy: 'user-1', isActive: true };

      mockPrisma.encounterTemplate.create.mockResolvedValue(mockTemplate);

      const result = await service.create(dto, 'user-1');

      expect(result.id).toBe('tpl-1');
      expect(result.department).toBe('Cardiology');
      expect(mockPrisma.encounterTemplate.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            department: 'Cardiology',
            name: '심장내과 기본',
          }),
        }),
      );
    });

    it('should record createdBy userId', async () => {
      const dto = {
        department: 'Cardiology',
        name: 'Template',
        soapSections: {},
        version: '1.0',
      };

      mockPrisma.encounterTemplate.create.mockResolvedValue({ id: 'tpl-1' });

      await service.create(dto, 'user-123');

      expect(mockPrisma.encounterTemplate.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            createdBy: 'user-123',
          }),
        }),
      );
    });

    it('should store SOAP sections as JSON', async () => {
      const soapSections = {
        subjective: { fields: ['chief complaint', 'history'] },
        objective: { fields: ['vital signs', 'physical exam'] },
        assessment: { fields: ['diagnosis'] },
        plan: { fields: ['treatment plan'] },
      };
      const dto = {
        department: 'Cardiology',
        name: 'Template',
        soapSections,
        version: '1.0',
      };

      mockPrisma.encounterTemplate.create.mockResolvedValue({ id: 'tpl-1' });

      await service.create(dto, 'user-1');

      expect(mockPrisma.encounterTemplate.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            soapSections,
          }),
        }),
      );
    });

    it('should set version', async () => {
      const dto = {
        department: 'Cardiology',
        name: 'Template',
        soapSections: {},
        version: '2.5.1',
      };

      mockPrisma.encounterTemplate.create.mockResolvedValue({ id: 'tpl-1' });

      await service.create(dto, 'user-1');

      expect(mockPrisma.encounterTemplate.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            version: '2.5.1',
          }),
        }),
      );
    });

    it('should handle optional description', async () => {
      const dtoWithDescription = {
        department: 'Cardiology',
        name: 'Template',
        description: 'Optional description',
        soapSections: {},
        version: '1.0',
      };

      mockPrisma.encounterTemplate.create.mockResolvedValue({ id: 'tpl-1' });

      await service.create(dtoWithDescription, 'user-1');

      expect(mockPrisma.encounterTemplate.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            description: 'Optional description',
          }),
        }),
      );
    });
  });

  describe('findAll', () => {
    it('should list all active templates', async () => {
      const mockTemplates = [
        { id: 'tpl-1', department: 'Cardiology', name: 'Template 1', isActive: true },
        { id: 'tpl-2', department: 'Orthopedics', name: 'Template 2', isActive: true },
      ];

      mockPrisma.encounterTemplate.findMany.mockResolvedValue(mockTemplates);

      const result = await service.findAll();

      expect(result).toHaveLength(2);
      expect(mockPrisma.encounterTemplate.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { isActive: true },
        }),
      );
    });

    it('should filter by department', async () => {
      const mockTemplates = [
        { id: 'tpl-1', department: 'Cardiology', name: 'Template 1', isActive: true },
      ];

      mockPrisma.encounterTemplate.findMany.mockResolvedValue(mockTemplates);

      const result = await service.findAll('Cardiology');

      expect(result).toHaveLength(1);
      expect(mockPrisma.encounterTemplate.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { isActive: true, department: 'Cardiology' },
        }),
      );
    });

    it('should order by department ascending', async () => {
      mockPrisma.encounterTemplate.findMany.mockResolvedValue([]);

      await service.findAll();

      expect(mockPrisma.encounterTemplate.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { department: 'asc' },
        }),
      );
    });

    it('should exclude inactive templates', async () => {
      mockPrisma.encounterTemplate.findMany.mockResolvedValue([]);

      await service.findAll();

      expect(mockPrisma.encounterTemplate.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            isActive: true,
          }),
        }),
      );
    });

    it('should handle empty result', async () => {
      mockPrisma.encounterTemplate.findMany.mockResolvedValue([]);

      const result = await service.findAll();

      expect(result).toHaveLength(0);
    });

    it('should support department filter with empty results', async () => {
      mockPrisma.encounterTemplate.findMany.mockResolvedValue([]);

      const result = await service.findAll('NonexistentDept');

      expect(result).toHaveLength(0);
    });
  });

  describe('findById', () => {
    it('should get template by id', async () => {
      const mockTemplate = { id: 'tpl-1', department: 'Cardiology', name: 'Template 1' };

      mockPrisma.encounterTemplate.findUnique.mockResolvedValue(mockTemplate);

      const result = await service.findById('tpl-1');

      expect(result.id).toBe('tpl-1');
      expect(mockPrisma.encounterTemplate.findUnique).toHaveBeenCalledWith({
        where: { id: 'tpl-1' },
      });
    });

    it('should throw NotFoundException if template not found', async () => {
      mockPrisma.encounterTemplate.findUnique.mockResolvedValue(null);

      await expect(service.findById('non-existent')).rejects.toThrow(NotFoundException);
    });

    it('should throw with correct error message', async () => {
      mockPrisma.encounterTemplate.findUnique.mockResolvedValue(null);

      try {
        await service.findById('invalid-id');
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error.message).toBe('Encounter template not found');
      }
    });

    it('should return full template with all fields', async () => {
      const mockTemplate = {
        id: 'tpl-1',
        department: 'Cardiology',
        name: 'Template 1',
        description: 'Description',
        soapSections: { s: {}, o: {}, a: {}, p: {} },
        version: '1.0',
        isActive: true,
        createdBy: 'user-1',
        createdAt: new Date(),
      };

      mockPrisma.encounterTemplate.findUnique.mockResolvedValue(mockTemplate);

      const result = await service.findById('tpl-1');

      expect(result).toEqual(mockTemplate);
    });
  });

  describe('update', () => {
    it('should update template', async () => {
      const updateDto = { name: 'Updated Name' };
      const mockTemplate = { id: 'tpl-1', name: 'Old Name' };
      const updatedTemplate = { id: 'tpl-1', name: 'Updated Name' };

      mockPrisma.encounterTemplate.findUnique.mockResolvedValue(mockTemplate);
      mockPrisma.encounterTemplate.update.mockResolvedValue(updatedTemplate);

      const result = await service.update('tpl-1', updateDto);

      expect(result.name).toBe('Updated Name');
    });

    it('should verify template exists before updating', async () => {
      const updateDto = { name: 'Updated' };

      mockPrisma.encounterTemplate.findUnique.mockResolvedValue({ id: 'tpl-1' });
      mockPrisma.encounterTemplate.update.mockResolvedValue({ id: 'tpl-1' });

      await service.update('tpl-1', updateDto);

      expect(mockPrisma.encounterTemplate.findUnique).toHaveBeenCalledWith({
        where: { id: 'tpl-1' },
      });
    });

    it('should throw NotFoundException if template does not exist', async () => {
      mockPrisma.encounterTemplate.findUnique.mockResolvedValue(null);

      await expect(service.update('non-existent', {})).rejects.toThrow(NotFoundException);
    });

    it('should update department', async () => {
      const updateDto = { department: 'Orthopedics' };

      mockPrisma.encounterTemplate.findUnique.mockResolvedValue({ id: 'tpl-1' });
      mockPrisma.encounterTemplate.update.mockResolvedValue({ id: 'tpl-1', department: 'Orthopedics' });

      await service.update('tpl-1', updateDto);

      expect(mockPrisma.encounterTemplate.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            department: 'Orthopedics',
          }),
        }),
      );
    });

    it('should update SOAP sections', async () => {
      const soapSections = { subjective: { new: true } };
      const updateDto = { soapSections };

      mockPrisma.encounterTemplate.findUnique.mockResolvedValue({ id: 'tpl-1' });
      mockPrisma.encounterTemplate.update.mockResolvedValue({ id: 'tpl-1' });

      await service.update('tpl-1', updateDto);

      expect(mockPrisma.encounterTemplate.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            soapSections,
          }),
        }),
      );
    });

    it('should update version', async () => {
      const updateDto = { version: '2.0' };

      mockPrisma.encounterTemplate.findUnique.mockResolvedValue({ id: 'tpl-1' });
      mockPrisma.encounterTemplate.update.mockResolvedValue({ id: 'tpl-1', version: '2.0' });

      await service.update('tpl-1', updateDto);

      expect(mockPrisma.encounterTemplate.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            version: '2.0',
          }),
        }),
      );
    });

    it('should toggle isActive status', async () => {
      const updateDto = { isActive: false };

      mockPrisma.encounterTemplate.findUnique.mockResolvedValue({ id: 'tpl-1' });
      mockPrisma.encounterTemplate.update.mockResolvedValue({ id: 'tpl-1', isActive: false });

      await service.update('tpl-1', updateDto);

      expect(mockPrisma.encounterTemplate.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            isActive: false,
          }),
        }),
      );
    });

    it('should handle partial updates (only update provided fields)', async () => {
      const updateDto = { name: 'New Name', version: '1.1' };

      mockPrisma.encounterTemplate.findUnique.mockResolvedValue({ id: 'tpl-1' });
      mockPrisma.encounterTemplate.update.mockResolvedValue({ id: 'tpl-1' });

      await service.update('tpl-1', updateDto);

      expect(mockPrisma.encounterTemplate.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: 'New Name',
            version: '1.1',
          }),
        }),
      );
    });

    it('should not update undefined fields', async () => {
      const updateDto = { name: 'Updated', department: undefined };

      mockPrisma.encounterTemplate.findUnique.mockResolvedValue({ id: 'tpl-1' });
      mockPrisma.encounterTemplate.update.mockResolvedValue({ id: 'tpl-1' });

      await service.update('tpl-1', updateDto);

      const callData = mockPrisma.encounterTemplate.update.mock.calls[0][0].data;
      expect(callData).toHaveProperty('name', 'Updated');
      expect(callData).not.toHaveProperty('department');
    });

    it('should update multiple fields at once', async () => {
      const updateDto = {
        name: 'Updated',
        description: 'New description',
        version: '2.0',
        isActive: false,
      };

      mockPrisma.encounterTemplate.findUnique.mockResolvedValue({ id: 'tpl-1' });
      mockPrisma.encounterTemplate.update.mockResolvedValue({ id: 'tpl-1' });

      await service.update('tpl-1', updateDto);

      const callData = mockPrisma.encounterTemplate.update.mock.calls[0][0].data;
      expect(callData).toEqual(expect.objectContaining(updateDto));
    });
  });

  describe('SOAP Sections Management', () => {
    it('should store complex SOAP structures', async () => {
      const complexSoap = {
        subjective: {
          fields: ['chief complaint', 'HPI', 'PMH'],
          validation: { required: true },
        },
        objective: {
          fields: ['vital signs', 'physical exam', 'lab results'],
          validation: { required: true },
        },
        assessment: {
          fields: ['diagnosis', 'differential'],
          validation: { required: true },
        },
        plan: {
          fields: ['treatment', 'medication', 'follow-up'],
          validation: { required: false },
        },
      };

      const dto = {
        department: 'Internal Medicine',
        name: 'Complex Template',
        soapSections: complexSoap,
        version: '1.0',
      };

      mockPrisma.encounterTemplate.create.mockResolvedValue({ id: 'tpl-1', ...dto });

      await service.create(dto, 'user-1');

      expect(mockPrisma.encounterTemplate.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            soapSections: complexSoap,
          }),
        }),
      );
    });
  });

  describe('Department Management', () => {
    it('should support multiple departments', async () => {
      const departments = ['Cardiology', 'Orthopedics', 'Internal Medicine'];

      mockPrisma.encounterTemplate.findMany.mockResolvedValue([]);

      for (const dept of departments) {
        await service.findAll(dept);
      }

      expect(mockPrisma.encounterTemplate.findMany).toHaveBeenCalledTimes(3);
    });

    it('should filter case-sensitively by department', async () => {
      mockPrisma.encounterTemplate.findMany.mockResolvedValue([]);

      await service.findAll('Cardiology');

      expect(mockPrisma.encounterTemplate.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            department: 'Cardiology',
          }),
        }),
      );
    });
  });

  describe('Version Management', () => {
    it('should track template versions', async () => {
      const versions = ['1.0', '1.1', '2.0', '2.0.1'];

      for (const version of versions) {
        const dto = {
          department: 'Cardiology',
          name: 'Template',
          soapSections: {},
          version,
        };

        mockPrisma.encounterTemplate.create.mockResolvedValue({ id: 'tpl-1', version });

        await service.create(dto, 'user-1');
      }

      expect(mockPrisma.encounterTemplate.create).toHaveBeenCalledTimes(4);
    });
  });

  describe('Active/Inactive Templates', () => {
    it('should only list active templates by default', async () => {
      mockPrisma.encounterTemplate.findMany.mockResolvedValue([]);

      await service.findAll();

      expect(mockPrisma.encounterTemplate.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            isActive: true,
          }),
        }),
      );
    });

    it('should allow deactivating templates', async () => {
      mockPrisma.encounterTemplate.findUnique.mockResolvedValue({ id: 'tpl-1' });
      mockPrisma.encounterTemplate.update.mockResolvedValue({ id: 'tpl-1', isActive: false });

      await service.update('tpl-1', { isActive: false });

      expect(mockPrisma.encounterTemplate.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            isActive: false,
          }),
        }),
      );
    });

    it('should allow reactivating templates', async () => {
      mockPrisma.encounterTemplate.findUnique.mockResolvedValue({ id: 'tpl-1', isActive: false });
      mockPrisma.encounterTemplate.update.mockResolvedValue({ id: 'tpl-1', isActive: true });

      await service.update('tpl-1', { isActive: true });

      expect(mockPrisma.encounterTemplate.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            isActive: true,
          }),
        }),
      );
    });
  });
});
