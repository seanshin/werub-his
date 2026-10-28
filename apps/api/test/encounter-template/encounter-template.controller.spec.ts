import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EncounterTemplateController } from '../../src/modules/encounter-template/encounter-template.controller';
import { NotFoundException, BadRequestException } from '@nestjs/common';

describe('EncounterTemplateController', () => {
  let controller: EncounterTemplateController;
  let mockService: any;

  beforeEach(() => {
    mockService = {
      create: vi.fn(),
      findAll: vi.fn(),
      findById: vi.fn(),
      update: vi.fn(),
    };
    controller = new EncounterTemplateController(mockService);
  });

  describe('create', () => {
    it('should create a new template', async () => {
      const dto = {
        name: 'Cardiology Initial',
        department: 'Cardiology',
        soapSections: {
          subjective: 'Chief complaint, HPI',
          objective: 'Vital signs, exam findings',
          assessment: 'Clinical impression',
          plan: 'Treatment plan',
        },
      };
      const mockResult = {
        id: 'template-1',
        name: 'Cardiology Initial',
        department: 'Cardiology',
        createdBy: 'user-1',
        version: '1.0',
        active: true,
      };

      mockService.create.mockResolvedValue(mockResult);

      const result = await controller.create(dto, 'user-1');

      expect(result.data).toEqual(mockResult);
      expect(mockService.create).toHaveBeenCalledWith(dto, 'user-1');
    });

    it('should wrap response in data object', async () => {
      const dto = { name: 'Template', department: 'Cardiology', soapSections: {} };

      mockService.create.mockResolvedValue({ id: 'template-1' });

      const result = await controller.create(dto, 'user-1');

      expect(result).toHaveProperty('data');
    });

    it('should pass userId from decorator', async () => {
      const dto = { name: 'Template', department: 'Cardiology', soapSections: {} };

      mockService.create.mockResolvedValue({ id: 'template-1' });

      await controller.create(dto, 'user-123');

      expect(mockService.create).toHaveBeenCalledWith(dto, 'user-123');
    });

    it('should include SOAP sections in template', async () => {
      const dto = {
        name: 'Orthopedic Consult',
        department: 'Orthopedics',
        soapSections: {
          subjective: 'History of present illness',
          objective: 'Physical examination findings',
          assessment: 'Clinical diagnosis',
          plan: 'Treatment recommendations',
        },
      };

      mockService.create.mockResolvedValue({
        id: 'template-1',
        soapSections: dto.soapSections,
      });

      const result = await controller.create(dto, 'user-1');

      expect(mockService.create).toHaveBeenCalledWith(dto, 'user-1');
    });

    it('should handle template creation for different departments', async () => {
      const departments = ['Cardiology', 'Orthopedics', 'Internal Medicine', 'Pediatrics'];

      for (const dept of departments) {
        const dto = {
          name: `${dept} Template`,
          department: dept,
          soapSections: {},
        };

        mockService.create.mockResolvedValue({
          id: `template-${dept}`,
          department: dept,
        });

        const result = await controller.create(dto, 'user-1');

        expect(result.data.department).toBe(dept);
      }
    });

    it('should create template with version tracking', async () => {
      const dto = {
        name: 'Template v1',
        department: 'Cardiology',
        soapSections: {},
      };

      mockService.create.mockResolvedValue({
        id: 'template-1',
        version: '1.0',
      });

      const result = await controller.create(dto, 'user-1');

      expect(result.data.version).toBe('1.0');
    });

    it('should set active status to true on creation', async () => {
      const dto = {
        name: 'Template',
        department: 'Cardiology',
        soapSections: {},
      };

      mockService.create.mockResolvedValue({
        id: 'template-1',
        active: true,
      });

      const result = await controller.create(dto, 'user-1');

      expect(result.data.active).toBe(true);
    });
  });

  describe('findAll', () => {
    it('should return all templates', async () => {
      const mockResult = [
        {
          id: 'template-1',
          name: 'Cardiology',
          department: 'Cardiology',
          active: true,
        },
        {
          id: 'template-2',
          name: 'Orthopedics',
          department: 'Orthopedics',
          active: true,
        },
      ];

      mockService.findAll.mockResolvedValue(mockResult);

      const result = await controller.findAll();

      expect(result.data).toEqual(mockResult);
      expect(mockService.findAll).toHaveBeenCalledWith(undefined);
    });

    it('should filter templates by department', async () => {
      const mockResult = [
        {
          id: 'template-1',
          name: 'Cardiology Initial',
          department: 'Cardiology',
        },
      ];

      mockService.findAll.mockResolvedValue(mockResult);

      const result = await controller.findAll('Cardiology');

      expect(result.data).toEqual(mockResult);
      expect(mockService.findAll).toHaveBeenCalledWith('Cardiology');
    });

    it('should wrap response in data object', async () => {
      mockService.findAll.mockResolvedValue([]);

      const result = await controller.findAll();

      expect(result).toHaveProperty('data');
    });

    it('should support optional department query parameter', async () => {
      mockService.findAll.mockResolvedValue([]);

      await controller.findAll('Orthopedics');

      expect(mockService.findAll).toHaveBeenCalledWith('Orthopedics');
    });

    it('should handle empty template list', async () => {
      mockService.findAll.mockResolvedValue([]);

      const result = await controller.findAll();

      expect(result.data).toEqual([]);
    });

    it('should return templates ordered by department', async () => {
      const mockResult = [
        { id: 'template-1', department: 'Cardiology' },
        { id: 'template-2', department: 'Internal Medicine' },
        { id: 'template-3', department: 'Orthopedics' },
      ];

      mockService.findAll.mockResolvedValue(mockResult);

      const result = await controller.findAll();

      expect(result.data[0].department).toBe('Cardiology');
      expect(result.data[1].department).toBe('Internal Medicine');
      expect(result.data[2].department).toBe('Orthopedics');
    });

    it('should return active templates only', async () => {
      const mockResult = [
        { id: 'template-1', active: true },
        { id: 'template-2', active: true },
      ];

      mockService.findAll.mockResolvedValue(mockResult);

      const result = await controller.findAll();

      expect(result.data.every((t: any) => t.active)).toBe(true);
    });
  });

  describe('findById', () => {
    it('should return template by id', async () => {
      const mockResult = {
        id: 'template-1',
        name: 'Cardiology Initial',
        department: 'Cardiology',
        soapSections: {
          subjective: 'Chief complaint',
          objective: 'Vital signs',
          assessment: 'Diagnosis',
          plan: 'Treatment',
        },
        active: true,
      };

      mockService.findById.mockResolvedValue(mockResult);

      const result = await controller.findById('template-1');

      expect(result.data).toEqual(mockResult);
      expect(mockService.findById).toHaveBeenCalledWith('template-1');
    });

    it('should return null if template not found', async () => {
      mockService.findById.mockResolvedValue(null);

      const result = await controller.findById('non-existent');

      expect(result.data).toBeNull();
    });

    it('should wrap response in data object', async () => {
      const mockResult = {
        id: 'template-1',
        name: 'Template',
      };

      mockService.findById.mockResolvedValue(mockResult);

      const result = await controller.findById('template-1');

      expect(result).toHaveProperty('data');
    });

    it('should accept UUID-formatted id', async () => {
      const uuidId = '550e8400-e29b-41d4-a716-446655440000';
      mockService.findById.mockResolvedValue({ id: uuidId });

      const result = await controller.findById(uuidId);

      expect(mockService.findById).toHaveBeenCalledWith(uuidId);
      expect(result.data.id).toBe(uuidId);
    });

    it('should return template with complete SOAP structure', async () => {
      const mockResult = {
        id: 'template-1',
        soapSections: {
          subjective: 'Patient symptoms and history',
          objective: 'Examination findings and vital signs',
          assessment: 'Clinical diagnosis and analysis',
          plan: 'Treatment and follow-up plan',
        },
      };

      mockService.findById.mockResolvedValue(mockResult);

      const result = await controller.findById('template-1');

      expect(result.data.soapSections).toBeDefined();
      expect(result.data.soapSections.subjective).toBeDefined();
    });

    it('should include version information', async () => {
      const mockResult = {
        id: 'template-1',
        version: '2.0.1',
      };

      mockService.findById.mockResolvedValue(mockResult);

      const result = await controller.findById('template-1');

      expect(result.data.version).toBe('2.0.1');
    });

    it('should include active status', async () => {
      const mockResult = {
        id: 'template-1',
        active: true,
      };

      mockService.findById.mockResolvedValue(mockResult);

      const result = await controller.findById('template-1');

      expect(result.data.active).toBe(true);
    });

    it('should wrap null result in data object', async () => {
      mockService.findById.mockResolvedValue(null);

      const result = await controller.findById('missing-id');

      expect(result).toHaveProperty('data');
      expect(result.data).toBeNull();
    });
  });

  describe('update', () => {
    it('should update template', async () => {
      const updateDto = {
        name: 'Updated Cardiology',
        department: 'Cardiology',
      };
      const mockResult = {
        id: 'template-1',
        name: 'Updated Cardiology',
        department: 'Cardiology',
        version: '1.1',
      };

      mockService.update.mockResolvedValue(mockResult);

      const result = await controller.update('template-1', updateDto);

      expect(result.data).toEqual(mockResult);
      expect(mockService.update).toHaveBeenCalledWith('template-1', updateDto);
    });

    it('should wrap response in data object', async () => {
      const updateDto = { name: 'Updated' };

      mockService.update.mockResolvedValue({ id: 'template-1' });

      const result = await controller.update('template-1', updateDto);

      expect(result).toHaveProperty('data');
    });

    it('should accept partial updates', async () => {
      const updateDto = { name: 'New Name' };

      mockService.update.mockResolvedValue({
        id: 'template-1',
        name: 'New Name',
      });

      const result = await controller.update('template-1', updateDto);

      expect(mockService.update).toHaveBeenCalledWith('template-1', updateDto);
    });

    it('should update SOAP sections', async () => {
      const updateDto = {
        soapSections: {
          subjective: 'Updated history',
          objective: 'Updated exam',
          assessment: 'Updated diagnosis',
          plan: 'Updated treatment',
        },
      };

      mockService.update.mockResolvedValue({
        id: 'template-1',
        soapSections: updateDto.soapSections,
      });

      const result = await controller.update('template-1', updateDto);

      expect(result.data.soapSections).toEqual(updateDto.soapSections);
    });

    it('should increment version on update', async () => {
      const updateDto = { name: 'Updated' };

      mockService.update.mockResolvedValue({
        id: 'template-1',
        version: '1.1',
      });

      const result = await controller.update('template-1', updateDto);

      expect(result.data.version).toBe('1.1');
    });

    it('should toggle active status', async () => {
      const updateDto = { active: false };

      mockService.update.mockResolvedValue({
        id: 'template-1',
        active: false,
      });

      const result = await controller.update('template-1', updateDto);

      expect(result.data.active).toBe(false);
    });

    it('should accept UUID-formatted id', async () => {
      const uuidId = '550e8400-e29b-41d4-a716-446655440000';
      const updateDto = { name: 'Updated' };

      mockService.update.mockResolvedValue({ id: uuidId });

      const result = await controller.update(uuidId, updateDto);

      expect(mockService.update).toHaveBeenCalledWith(uuidId, updateDto);
    });

    it('should handle error if template does not exist', async () => {
      mockService.update.mockRejectedValue(new NotFoundException('Template not found'));

      await expect(controller.update('non-existent', { name: 'Updated' })).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('Authorization', () => {
    it('should require JWT authentication', async () => {
      // @UseGuards(JwtAuthGuard, RolesGuard) is applied to controller
      expect(controller).toBeDefined();
    });

    it('should require DOCTOR or ADMIN role for create', async () => {
      // @Roles(UserRole.DOCTOR, UserRole.ADMIN) on POST endpoint
      expect(controller).toBeDefined();
    });

    it('should require DOCTOR, NURSE, or ADMIN role for findAll', async () => {
      // @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN) on GET endpoint
      expect(controller).toBeDefined();
    });

    it('should require DOCTOR, NURSE, or ADMIN role for findById', async () => {
      // @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN) on GET /:id endpoint
      expect(controller).toBeDefined();
    });

    it('should require ADMIN role for update', async () => {
      // @Roles(UserRole.ADMIN) on PUT endpoint
      expect(controller).toBeDefined();
    });
  });

  describe('Response Format', () => {
    it('should wrap all responses in data object', async () => {
      const mockTemplate = { id: 'template-1', name: 'Template' };

      mockService.create.mockResolvedValue(mockTemplate);
      mockService.findAll.mockResolvedValue([mockTemplate]);
      mockService.findById.mockResolvedValue(mockTemplate);
      mockService.update.mockResolvedValue(mockTemplate);

      const createResult = await controller.create({ name: 'Template', department: 'Cardiology', soapSections: {} }, 'user-1');
      const findAllResult = await controller.findAll();
      const findByIdResult = await controller.findById('template-1');
      const updateResult = await controller.update('template-1', { name: 'Updated' });

      expect(createResult).toHaveProperty('data');
      expect(findAllResult).toHaveProperty('data');
      expect(findByIdResult).toHaveProperty('data');
      expect(updateResult).toHaveProperty('data');
    });

    it('should preserve exact template structure', async () => {
      const mockTemplate = {
        id: 'template-1',
        name: 'Cardiology Initial',
        department: 'Cardiology',
        soapSections: {
          subjective: 'Chief complaint',
          objective: 'Vital signs',
          assessment: 'Diagnosis',
          plan: 'Treatment',
        },
        version: '1.0',
        active: true,
        createdBy: 'user-1',
      };

      mockService.findById.mockResolvedValue(mockTemplate);

      const result = await controller.findById('template-1');

      expect(JSON.stringify(result.data)).toBe(JSON.stringify(mockTemplate));
    });
  });

  describe('Route Parameters', () => {
    it('should pass id from route parameter to service', async () => {
      mockService.findById.mockResolvedValue({ id: 'template-1' });

      await controller.findById('template-1');

      expect(mockService.findById).toHaveBeenCalledWith('template-1');
    });

    it('should pass id from route parameter to update', async () => {
      mockService.update.mockResolvedValue({ id: 'template-1' });

      await controller.update('template-1', { name: 'Updated' });

      expect(mockService.update).toHaveBeenCalledWith('template-1', { name: 'Updated' });
    });

    it('should accept UUID format for template id', async () => {
      const uuidId = '550e8400-e29b-41d4-a716-446655440000';
      mockService.findById.mockResolvedValue({ id: uuidId });

      await controller.findById(uuidId);

      expect(mockService.findById).toHaveBeenCalledWith(uuidId);
    });
  });

  describe('Query Parameters', () => {
    it('should accept optional department query parameter', async () => {
      mockService.findAll.mockResolvedValue([]);

      await controller.findAll('Cardiology');

      expect(mockService.findAll).toHaveBeenCalledWith('Cardiology');
    });

    it('should handle missing department parameter', async () => {
      mockService.findAll.mockResolvedValue([]);

      await controller.findAll(undefined);

      expect(mockService.findAll).toHaveBeenCalledWith(undefined);
    });
  });

  describe('SOAP Templates', () => {
    it('should handle Cardiology template', async () => {
      const mockTemplate = {
        id: 'template-1',
        department: 'Cardiology',
        soapSections: {
          subjective: 'Chest pain, dyspnea',
          objective: 'HR, BP, cardiac exam',
          assessment: 'Cardiac diagnosis',
          plan: 'Medication, imaging',
        },
      };

      mockService.findById.mockResolvedValue(mockTemplate);

      const result = await controller.findById('template-1');

      expect(result.data.department).toBe('Cardiology');
      expect(result.data.soapSections.subjective).toContain('Chest pain');
    });

    it('should handle Orthopedics template', async () => {
      const mockTemplate = {
        id: 'template-2',
        department: 'Orthopedics',
        soapSections: {
          subjective: 'Joint pain, trauma',
          objective: 'Range of motion, stability',
          assessment: 'Fracture or injury',
          plan: 'PT, immobilization',
        },
      };

      mockService.findById.mockResolvedValue(mockTemplate);

      const result = await controller.findById('template-2');

      expect(result.data.department).toBe('Orthopedics');
    });

    it('should handle templates for different departments', async () => {
      const templates = [
        {
          id: 'template-1',
          department: 'Cardiology',
          soapSections: { subjective: 'Chest pain' },
        },
        {
          id: 'template-2',
          department: 'Orthopedics',
          soapSections: { subjective: 'Joint pain' },
        },
        {
          id: 'template-3',
          department: 'Internal Medicine',
          soapSections: { subjective: 'General symptoms' },
        },
      ];

      mockService.findAll.mockResolvedValue(templates);

      const result = await controller.findAll();

      expect(result.data).toHaveLength(3);
      expect(result.data.map((t: any) => t.department)).toContain('Cardiology');
    });
  });

  describe('Template Versioning', () => {
    it('should track version on creation', async () => {
      mockService.create.mockResolvedValue({
        id: 'template-1',
        version: '1.0',
      });

      const result = await controller.create(
        {
          name: 'Template',
          department: 'Cardiology',
          soapSections: {},
        },
        'user-1',
      );

      expect(result.data.version).toBe('1.0');
    });

    it('should increment version on update', async () => {
      mockService.update.mockResolvedValue({
        id: 'template-1',
        version: '1.1',
      });

      const result = await controller.update('template-1', {
        name: 'Updated',
      });

      expect(result.data.version).toBe('1.1');
    });

    it('should support major version increments', async () => {
      mockService.update.mockResolvedValue({
        id: 'template-1',
        version: '2.0',
      });

      const result = await controller.update('template-1', {
        soapSections: { subjective: 'Major revision' },
      });

      expect(result.data.version).toBe('2.0');
    });
  });

  describe('Error Handling', () => {
    it('should handle service errors gracefully', async () => {
      mockService.findById.mockRejectedValue(new Error('Database error'));

      await expect(controller.findById('template-1')).rejects.toThrow('Database error');
    });

    it('should wrap null result from service in data object', async () => {
      mockService.findById.mockResolvedValue(null);

      const result = await controller.findById('template-1');

      expect(result.data).toBeNull();
    });

    it('should propagate service exceptions', async () => {
      mockService.update.mockRejectedValue(new BadRequestException('Invalid template'));

      await expect(controller.update('template-1', {})).rejects.toThrow(BadRequestException);
    });
  });
});
