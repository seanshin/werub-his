import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConsentTemplateService } from '../../src/modules/consent-template/consent-template.service';
import { NotFoundException } from '@nestjs/common';

describe('ConsentTemplateService', () => {
  let service: ConsentTemplateService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      consentTemplate: {
        create: vi.fn(),
        findMany: vi.fn(),
        findUnique: vi.fn(),
        findFirst: vi.fn().mockResolvedValue(null), // (name, language) 최신판 중복 가드 — 기본 없음
      },
    };

    service = new ConsentTemplateService(mockPrisma);
  });

  describe('create', () => {
    it('should create consent template with all required fields', async () => {
      const mockCreated = {
        id: 'ct-1',
        type: 'SURGERY',
        name: '수술 동의서',
        version: '1.0',
        content: { sections: ['surgery risks', 'benefits'] },
        requiredFields: { patientSignature: true, doctorSignature: true },
        isActive: true,
        createdAt: new Date(),
      };

      vi.mocked(mockPrisma.consentTemplate.create).mockResolvedValue(mockCreated);

      const result = await service.create({
        type: 'SURGERY',
        name: '수술 동의서',
        version: '1.0',
        content: { sections: ['surgery risks', 'benefits'] },
        requiredFields: { patientSignature: true, doctorSignature: true },
      });

      expect(result.id).toBe('ct-1');
      expect(result.type).toBe('SURGERY');
      expect(mockPrisma.consentTemplate.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'SURGERY',
            name: '수술 동의서',
            version: '1.0',
          }),
        }),
      );
    });

    it('should create template with JSON content', async () => {
      const mockCreated = {
        id: 'ct-2',
        type: 'ANESTHESIA',
        name: '마취 동의서',
        version: '1.0',
        content: { risks: ['dizziness', 'nausea'] },
        requiredFields: { patientSignature: true },
      };

      vi.mocked(mockPrisma.consentTemplate.create).mockResolvedValue(mockCreated);

      const result = await service.create({
        type: 'ANESTHESIA',
        name: '마취 동의서',
        version: '1.0',
        content: { risks: ['dizziness', 'nausea'] },
        requiredFields: { patientSignature: true },
      });

      expect(result.content.risks).toBeDefined();
      expect(mockPrisma.consentTemplate.create).toHaveBeenCalled();
    });

    it('should handle version numbering', async () => {
      const mockCreated = {
        id: 'ct-3',
        type: 'BLOOD_TRANSFUSION',
        name: '수혈 동의서',
        version: '2.1',
      };

      vi.mocked(mockPrisma.consentTemplate.create).mockResolvedValue(mockCreated);

      const result = await service.create({
        type: 'BLOOD_TRANSFUSION',
        name: '수혈 동의서',
        version: '2.1',
        content: {},
        requiredFields: {},
      });

      expect(result.version).toBe('2.1');
    });
  });

  describe('findAll', () => {
    it('should find all active latest templates', async () => {
      const mockTemplates = [
        { id: 'ct-1', type: 'SURGERY', name: '수술 동의서', _count: { consentForms: 5 } },
        { id: 'ct-2', type: 'ANESTHESIA', name: '마취 동의서', _count: { consentForms: 2 } },
      ];
      vi.mocked(mockPrisma.consentTemplate.findMany).mockResolvedValue(mockTemplates);

      const result = await service.findAll();

      expect(result).toHaveLength(2);
      expect(result[0].usageCount).toBe(5);
      expect(mockPrisma.consentTemplate.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ isActive: true, isLatest: true }) }),
      );
    });

    it('should filter templates by type', async () => {
      const mockTemplates = [
        { id: 'ct-1', type: 'SURGERY', name: '수술 동의서', _count: { consentForms: 1 } },
      ];
      vi.mocked(mockPrisma.consentTemplate.findMany).mockResolvedValue(mockTemplates);

      const result = await service.findAll('SURGERY');

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('SURGERY');
    });

    it('should return empty array when no templates found', async () => {
      vi.mocked(mockPrisma.consentTemplate.findMany).mockResolvedValue([]);
      const result = await service.findAll('NONEXISTENT');
      expect(result).toHaveLength(0);
    });

    it('should order results by updatedAt descending', async () => {
      vi.mocked(mockPrisma.consentTemplate.findMany).mockResolvedValue([]);
      await service.findAll();
      expect(mockPrisma.consentTemplate.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { updatedAt: 'desc' } }),
      );
    });

    it('should exclude inactive templates by default', async () => {
      vi.mocked(mockPrisma.consentTemplate.findMany).mockResolvedValue([]);
      await service.findAll();
      expect(mockPrisma.consentTemplate.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ isActive: true }) }),
      );
    });
  });

  describe('findById', () => {
    it('should find template by id', async () => {
      const mockTemplate = {
        id: 'ct-1',
        type: 'SURGERY',
        name: '수술 동의서',
        version: '1.0',
        content: { sections: [] },
        requiredFields: { patientSignature: true },
      };

      vi.mocked(mockPrisma.consentTemplate.findUnique).mockResolvedValue({ ...mockTemplate, _count: { consentForms: 3 } } as any);

      const result = await service.findById('ct-1');

      expect(result.id).toBe('ct-1');
      expect(result.usageCount).toBe(3);
    });

    it('should return full template details including content and requiredFields', async () => {
      const mockTemplate = {
        id: 'ct-1',
        type: 'SURGERY',
        name: '수술 동의서',
        version: '1.0',
        content: { sections: ['risks', 'benefits'], language: 'KO' },
        requiredFields: { patientSignature: true, guardianSignature: false },
        _count: { consentForms: 0 },
      };

      vi.mocked(mockPrisma.consentTemplate.findUnique).mockResolvedValue(mockTemplate as any);

      const result = await service.findById('ct-1');

      expect(result.content.language).toBe('KO');
      expect(result.requiredFields.guardianSignature).toBe(false);
    });

    it('should throw NotFoundException when template not found', async () => {
      vi.mocked(mockPrisma.consentTemplate.findUnique).mockResolvedValue(null);

      await expect(service.findById('non-existent')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw NotFoundException with specific message', async () => {
      vi.mocked(mockPrisma.consentTemplate.findUnique).mockResolvedValue(null);

      await expect(service.findById('invalid-id')).rejects.toThrow(
        'Consent template not found',
      );
    });
  });

  describe('Template Type Variations', () => {
    it('should handle SURGERY type templates', async () => {
      const mockTemplate = {
        id: 'ct-1',
        type: 'SURGERY',
        name: '수술 동의서',
      };

      vi.mocked(mockPrisma.consentTemplate.create).mockResolvedValue(mockTemplate);

      const result = await service.create({
        type: 'SURGERY',
        name: '수술 동의서',
        version: '1.0',
        content: {},
        requiredFields: {},
      });

      expect(result.type).toBe('SURGERY');
    });

    it('should handle ANESTHESIA type templates', async () => {
      const mockTemplate = {
        id: 'ct-2',
        type: 'ANESTHESIA',
        name: '마취 동의서',
      };

      vi.mocked(mockPrisma.consentTemplate.create).mockResolvedValue(mockTemplate);

      const result = await service.create({
        type: 'ANESTHESIA',
        name: '마취 동의서',
        version: '1.0',
        content: {},
        requiredFields: {},
      });

      expect(result.type).toBe('ANESTHESIA');
    });

    it('should handle BLOOD_TRANSFUSION type templates', async () => {
      const mockTemplate = {
        id: 'ct-3',
        type: 'BLOOD_TRANSFUSION',
        name: '수혈 동의서',
      };

      vi.mocked(mockPrisma.consentTemplate.create).mockResolvedValue(mockTemplate);

      const result = await service.create({
        type: 'BLOOD_TRANSFUSION',
        name: '수혈 동의서',
        version: '1.0',
        content: {},
        requiredFields: {},
      });

      expect(result.type).toBe('BLOOD_TRANSFUSION');
    });
  });
});
