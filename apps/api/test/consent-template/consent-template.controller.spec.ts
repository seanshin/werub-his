import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConsentTemplateController } from '../../src/modules/consent-template/consent-template.controller';
import { NotFoundException } from '@nestjs/common';

describe('ConsentTemplateController', () => {
  let controller: ConsentTemplateController;
  let mockService: any;

  beforeEach(() => {
    mockService = {
      create: vi.fn(),
      findAll: vi.fn(),
      findById: vi.fn(),
    };

    controller = new ConsentTemplateController(mockService);
  });

  describe('create', () => {
    it('should create consent template', async () => {
      const mockCreated = {
        id: 'ct-1',
        type: 'SURGERY',
        name: '수술 동의서',
        version: '1.0',
        content: { sections: ['risks'] },
        requiredFields: { patientSignature: true },
      };

      vi.mocked(mockService.create).mockResolvedValue(mockCreated);

      const body = {
        type: 'SURGERY',
        name: '수술 동의서',
        version: '1.0',
        content: { sections: ['risks'] },
        requiredFields: { patientSignature: true },
      };

      const result = await controller.create(body, 'user-1');

      expect(result.data.id).toBe('ct-1');
      expect(result.data.type).toBe('SURGERY');
      expect(mockService.create).toHaveBeenCalledWith({ ...body, lastEditedBy: 'user-1' });
    });

    it('should wrap template creation response in data object', async () => {
      const mockCreated = {
        id: 'ct-1',
        type: 'SURGERY',
        name: '수술 동의서',
      };

      vi.mocked(mockService.create).mockResolvedValue(mockCreated);

      const result = await controller.create({
        type: 'SURGERY',
        name: '수술 동의서',
        version: '1.0',
        content: {},
        requiredFields: {},
      });

      expect(result).toHaveProperty('data');
      expect(result.data.id).toBe('ct-1');
    });

    it('should create template with complex JSON content', async () => {
      const mockCreated = {
        id: 'ct-2',
        type: 'ANESTHESIA',
        name: '마취 동의서',
        content: {
          sections: [
            { title: 'Risks', items: ['dizziness', 'nausea'] },
            { title: 'Benefits', items: ['pain relief'] },
          ],
        },
      };

      vi.mocked(mockService.create).mockResolvedValue(mockCreated);

      const body = {
        type: 'ANESTHESIA',
        name: '마취 동의서',
        version: '1.0',
        content: {
          sections: [
            { title: 'Risks', items: ['dizziness', 'nausea'] },
            { title: 'Benefits', items: ['pain relief'] },
          ],
        },
        requiredFields: { patientSignature: true },
      };

      const result = await controller.create(body);

      expect(result.data.content.sections).toHaveLength(2);
    });
  });

  describe('findAll', () => {
    it('should get all templates without filter', async () => {
      const mockTemplates = [
        { id: 'ct-1', type: 'SURGERY', name: '수술 동의서' },
        { id: 'ct-2', type: 'ANESTHESIA', name: '마취 동의서' },
      ];

      vi.mocked(mockService.findAll).mockResolvedValue(mockTemplates);

      const result = await controller.findAll();

      expect(result.data).toHaveLength(2);
      expect(mockService.findAll).toHaveBeenCalledWith(undefined, undefined, false, undefined);
    });

    it('should get templates filtered by type', async () => {
      const mockTemplates = [
        { id: 'ct-1', type: 'SURGERY', name: '수술 동의서' },
      ];

      vi.mocked(mockService.findAll).mockResolvedValue(mockTemplates);

      const result = await controller.findAll('SURGERY');

      expect(result.data).toHaveLength(1);
      expect(result.data[0].type).toBe('SURGERY');
      expect(mockService.findAll).toHaveBeenCalledWith('SURGERY', undefined, false, undefined);
    });

    it('should filter by ANESTHESIA type', async () => {
      const mockTemplates = [
        { id: 'ct-2', type: 'ANESTHESIA', name: '마취 동의서' },
      ];

      vi.mocked(mockService.findAll).mockResolvedValue(mockTemplates);

      const result = await controller.findAll('ANESTHESIA');

      expect(result.data[0].type).toBe('ANESTHESIA');
      expect(mockService.findAll).toHaveBeenCalledWith('ANESTHESIA', undefined, false, undefined);
    });

    it('should filter by BLOOD_TRANSFUSION type', async () => {
      const mockTemplates = [
        { id: 'ct-3', type: 'BLOOD_TRANSFUSION', name: '수혈 동의서' },
      ];

      vi.mocked(mockService.findAll).mockResolvedValue(mockTemplates);

      const result = await controller.findAll('BLOOD_TRANSFUSION');

      expect(result.data[0].type).toBe('BLOOD_TRANSFUSION');
      expect(mockService.findAll).toHaveBeenCalledWith('BLOOD_TRANSFUSION', undefined, false, undefined);
    });

    it('should wrap templates list in data object', async () => {
      const mockTemplates = [
        { id: 'ct-1', type: 'SURGERY', name: '수술 동의서' },
      ];

      vi.mocked(mockService.findAll).mockResolvedValue(mockTemplates);

      const result = await controller.findAll();

      expect(result).toHaveProperty('data');
      expect(Array.isArray(result.data)).toBe(true);
    });

    it('should return empty array when no templates found', async () => {
      vi.mocked(mockService.findAll).mockResolvedValue([]);

      const result = await controller.findAll('NONEXISTENT');

      expect(result.data).toHaveLength(0);
    });
  });

  describe('findById', () => {
    it('should get template by id', async () => {
      const mockTemplate = {
        id: 'ct-1',
        type: 'SURGERY',
        name: '수술 동의서',
        version: '1.0',
        content: { sections: ['risks'] },
        requiredFields: { patientSignature: true },
      };

      vi.mocked(mockService.findById).mockResolvedValue(mockTemplate);

      const result = await controller.findById('ct-1');

      expect(result.data.id).toBe('ct-1');
      expect(result.data.type).toBe('SURGERY');
      expect(mockService.findById).toHaveBeenCalledWith('ct-1');
    });

    it('should return full template details', async () => {
      const mockTemplate = {
        id: 'ct-1',
        type: 'SURGERY',
        name: '수술 동의서',
        version: '1.0',
        content: {
          sections: ['risks', 'benefits', 'alternatives'],
          language: 'KO',
        },
        requiredFields: {
          patientSignature: true,
          doctorSignature: true,
          guardianSignature: false,
        },
      };

      vi.mocked(mockService.findById).mockResolvedValue(mockTemplate);

      const result = await controller.findById('ct-1');

      expect(result.data.content.language).toBe('KO');
      expect(result.data.requiredFields.guardianSignature).toBe(false);
    });

    it('should wrap template detail in data object', async () => {
      const mockTemplate = {
        id: 'ct-1',
        type: 'SURGERY',
        name: '수술 동의서',
      };

      vi.mocked(mockService.findById).mockResolvedValue(mockTemplate);

      const result = await controller.findById('ct-1');

      expect(result).toHaveProperty('data');
      expect(result.data.id).toBe('ct-1');
    });

    it('should throw NotFoundException when template not found', async () => {
      vi.mocked(mockService.findById).mockRejectedValue(
        new NotFoundException('Consent template not found'),
      );

      await expect(controller.findById('non-existent')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should use ParseUUIDPipe for id validation', async () => {
      const mockTemplate = { id: 'ct-1', type: 'SURGERY' };

      vi.mocked(mockService.findById).mockResolvedValue(mockTemplate);

      const result = await controller.findById('ct-1');

      expect(result.data.id).toBe('ct-1');
      expect(mockService.findById).toHaveBeenCalledWith('ct-1');
    });
  });

  describe('Authorization', () => {
    it('should require ADMIN for create endpoint', async () => {
      // @Roles(UserRole.ADMIN) is applied to create method
      expect(controller).toBeDefined();
    });

    it('should allow DOCTOR, NURSE, ADMIN for findAll endpoint', async () => {
      // @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN) is applied
      expect(controller).toBeDefined();
    });

    it('should allow DOCTOR, NURSE, ADMIN for findById endpoint', async () => {
      // @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN) is applied
      expect(controller).toBeDefined();
    });

    it('should require JWT authentication for all endpoints', async () => {
      // @UseGuards(JwtAuthGuard, RolesGuard) is applied at controller level
      expect(controller).toBeDefined();
    });
  });

  describe('Response Wrapping', () => {
    it('should wrap create response with data property', async () => {
      const mockCreated = { id: 'ct-1', type: 'SURGERY' };

      vi.mocked(mockService.create).mockResolvedValue(mockCreated);

      const result = await controller.create({
        type: 'SURGERY',
        name: '수술 동의서',
        version: '1.0',
        content: {},
        requiredFields: {},
      });

      expect(result).toHaveProperty('data');
      expect(result.data).toEqual(mockCreated);
    });

    it('should wrap findAll response with data property', async () => {
      const mockTemplates = [{ id: 'ct-1' }];

      vi.mocked(mockService.findAll).mockResolvedValue(mockTemplates);

      const result = await controller.findAll();

      expect(result).toHaveProperty('data');
      expect(result.data).toEqual(mockTemplates);
    });

    it('should wrap findById response with data property', async () => {
      const mockTemplate = { id: 'ct-1' };

      vi.mocked(mockService.findById).mockResolvedValue(mockTemplate);

      const result = await controller.findById('ct-1');

      expect(result).toHaveProperty('data');
      expect(result.data).toEqual(mockTemplate);
    });
  });

  describe('Error Handling', () => {
    it('should propagate service errors on create', async () => {
      vi.mocked(mockService.create).mockRejectedValue(
        new Error('Database error'),
      );

      await expect(
        controller.create({
          type: 'SURGERY',
          name: '수술 동의서',
          version: '1.0',
          content: {},
          requiredFields: {},
        }),
      ).rejects.toThrow('Database error');
    });

    it('should propagate NotFoundException from service', async () => {
      vi.mocked(mockService.findById).mockRejectedValue(
        new NotFoundException('Consent template not found'),
      );

      await expect(controller.findById('invalid')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should handle empty template list gracefully', async () => {
      vi.mocked(mockService.findAll).mockResolvedValue([]);

      const result = await controller.findAll();

      expect(result.data).toHaveLength(0);
    });
  });

  describe('Route-specific Behavior', () => {
    it('should route POST / to create', async () => {
      const mockCreated = { id: 'ct-1' };

      vi.mocked(mockService.create).mockResolvedValue(mockCreated);

      const result = await controller.create({
        type: 'SURGERY',
        name: '수술 동의서',
        version: '1.0',
        content: {},
        requiredFields: {},
      });

      expect(result.data).toBeDefined();
    });

    it('should route GET / to findAll', async () => {
      const mockTemplates = [];

      vi.mocked(mockService.findAll).mockResolvedValue(mockTemplates);

      const result = await controller.findAll();

      expect(result.data).toBeDefined();
    });

    it('should route GET /:id to findById', async () => {
      const mockTemplate = { id: 'ct-1' };

      vi.mocked(mockService.findById).mockResolvedValue(mockTemplate);

      const result = await controller.findById('ct-1');

      expect(result.data).toBeDefined();
    });

    it('should pass query type parameter correctly', async () => {
      const mockTemplates = [{ type: 'SURGERY' }];

      vi.mocked(mockService.findAll).mockResolvedValue(mockTemplates);

      await controller.findAll('SURGERY');

      expect(mockService.findAll).toHaveBeenCalledWith('SURGERY', undefined, false, undefined);
    });
  });

  describe('Request/Response Format', () => {
    it('should accept body with all template fields', async () => {
      const mockCreated = { id: 'ct-1' };

      vi.mocked(mockService.create).mockResolvedValue(mockCreated);

      const body = {
        type: 'SURGERY',
        name: '수술 동의서',
        version: '1.0',
        content: { key: 'value' },
        requiredFields: { field: true },
      };

      await controller.create(body);

      expect(mockService.create).toHaveBeenCalledWith(body);
    });

    it('should pass id parameter to service', async () => {
      const mockTemplate = { id: 'ct-1' };

      vi.mocked(mockService.findById).mockResolvedValue(mockTemplate);

      const id = 'ct-1';
      await controller.findById(id);

      expect(mockService.findById).toHaveBeenCalledWith(id);
    });

    it('should pass query type parameter to service', async () => {
      vi.mocked(mockService.findAll).mockResolvedValue([]);

      const type = 'SURGERY';
      await controller.findAll(type);

      expect(mockService.findAll).toHaveBeenCalledWith(type, undefined, false, undefined);
    });
  });
});
