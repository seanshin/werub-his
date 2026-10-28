import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AllergyController } from '../../src/modules/allergy/allergy.controller';
import { AllergyService } from '../../src/modules/allergy/allergy.service';

describe('AllergyController', () => {
  let controller: AllergyController;
  let service: AllergyService;

  beforeEach(() => {
    service = {
      create: vi.fn(),
      findByPatient: vi.fn(),
      findById: vi.fn(),
      update: vi.fn(),
      verify: vi.fn(),
      checkDrugAllergy: vi.fn(),
    } as any;

    controller = new AllergyController(service);
  });

  describe('POST /api/v1/patients/:patientId/allergies (create)', () => {
    it('should create allergy', async () => {
      const dto = {
        type: 'DRUG',
        allergen: '페니실린',
        allergenCode: 'PCN',
        reaction: '발진',
        severity: 'HIGH',
        onsetDate: '2025-01-15',
        reportedBy: 'patient',
        notes: 'Known allergy',
      };

      const mockAllergy = {
        id: 'allergy-1',
        patientId: 'patient-1',
        ...dto,
        onsetDate: new Date(dto.onsetDate),
        recordedBy: 'user-1',
        isActive: true,
        recorder: { id: 'user-1', familyName: '이', givenName: '의사' },
      };

      vi.mocked(service.create).mockResolvedValue(mockAllergy);

      const result = await controller.create('patient-1', dto, 'user-1');

      expect(result.data.id).toBe('allergy-1');
      expect(result.data.type).toBe('DRUG');
      expect(result.data.allergen).toBe('페니실린');
      expect(result.data.severity).toBe('HIGH');
      expect(service.create).toHaveBeenCalledWith('patient-1', dto, 'user-1');
    });

    it('should create food allergy', async () => {
      const dto = {
        type: 'FOOD',
        allergen: '땅콩',
        reaction: '호흡곤란, 부종',
        severity: 'CRITICAL',
        reportedBy: 'family',
      };

      const mockAllergy = {
        id: 'allergy-2',
        patientId: 'patient-1',
        ...dto,
        recordedBy: 'user-1',
        isActive: true,
      };

      vi.mocked(service.create).mockResolvedValue(mockAllergy);

      const result = await controller.create('patient-1', dto, 'user-1');

      expect(result.data.type).toBe('FOOD');
      expect(result.data.allergen).toBe('땅콩');
      expect(result.data.severity).toBe('CRITICAL');
    });

    it('should include recorder information', async () => {
      const dto = {
        type: 'ENVIRONMENTAL',
        allergen: '꽃가루',
        reaction: '알레르기성 비염',
        severity: 'MILD',
      };

      const mockAllergy = {
        id: 'allergy-3',
        patientId: 'patient-1',
        ...dto,
        recordedBy: 'user-1',
        isActive: true,
        recorder: { id: 'user-1', familyName: '김', givenName: '간호사' },
      };

      vi.mocked(service.create).mockResolvedValue(mockAllergy);

      const result = await controller.create('patient-1', dto, 'user-1');

      expect(result.data.recorder).toBeDefined();
      expect(result.data.recorder.familyName).toBe('김');
    });
  });

  describe('GET /api/v1/patients/:patientId/allergies (findByPatient)', () => {
    it('should return all allergies for patient', async () => {
      const mockAllergies = [
        {
          id: 'allergy-1',
          patientId: 'patient-1',
          type: 'DRUG',
          allergen: '페니실린',
          severity: 'HIGH',
          isActive: true,
        },
        {
          id: 'allergy-2',
          patientId: 'patient-1',
          type: 'FOOD',
          allergen: '땅콩',
          severity: 'CRITICAL',
          isActive: true,
        },
      ];

      vi.mocked(service.findByPatient).mockResolvedValue(mockAllergies);

      const result = await controller.findByPatient('patient-1');

      expect(result.data).toHaveLength(2);
      expect(result.data[0].allergen).toBe('페니실린');
      expect(service.findByPatient).toHaveBeenCalledWith('patient-1', undefined);
    });

    it('should filter by isActive=true', async () => {
      const mockAllergies = [
        {
          id: 'allergy-1',
          patientId: 'patient-1',
          type: 'DRUG',
          allergen: '페니실린',
          isActive: true,
        },
      ];

      vi.mocked(service.findByPatient).mockResolvedValue(mockAllergies);

      const result = await controller.findByPatient('patient-1', 'true');

      expect(result.data).toHaveLength(1);
      expect(result.data[0].isActive).toBe(true);
      expect(service.findByPatient).toHaveBeenCalledWith('patient-1', true);
    });

    it('should filter by isActive=false', async () => {
      const mockAllergies = [
        {
          id: 'allergy-2',
          patientId: 'patient-1',
          type: 'FOOD',
          allergen: '딸기',
          isActive: false,
        },
      ];

      vi.mocked(service.findByPatient).mockResolvedValue(mockAllergies);

      const result = await controller.findByPatient('patient-1', 'false');

      expect(result.data[0].isActive).toBe(false);
      expect(service.findByPatient).toHaveBeenCalledWith('patient-1', false);
    });

    it('should return empty array when no allergies', async () => {
      vi.mocked(service.findByPatient).mockResolvedValue([]);

      const result = await controller.findByPatient('patient-999');

      expect(result.data).toEqual([]);
    });
  });

  describe('GET /api/v1/patients/:patientId/allergies/:id (findById)', () => {
    it('should return allergy by id', async () => {
      const mockAllergy = {
        id: 'allergy-1',
        patientId: 'patient-1',
        type: 'DRUG',
        allergen: '페니실린',
        severity: 'HIGH',
        isActive: true,
        recorder: { id: 'user-1', familyName: '이', givenName: '의사' },
      };

      vi.mocked(service.findById).mockResolvedValue(mockAllergy);

      const result = await controller.findById('patient-1', 'allergy-1');

      expect(result.data.id).toBe('allergy-1');
      expect(result.data.allergen).toBe('페니실린');
      expect(result.data.type).toBe('DRUG');
      expect(service.findById).toHaveBeenCalledWith('patient-1', 'allergy-1');
    });

    it('should include severity information', async () => {
      const mockAllergy = {
        id: 'allergy-2',
        patientId: 'patient-1',
        type: 'FOOD',
        allergen: '땅콩',
        severity: 'CRITICAL',
        isActive: true,
      };

      vi.mocked(service.findById).mockResolvedValue(mockAllergy);

      const result = await controller.findById('patient-1', 'allergy-2');

      expect(result.data.severity).toBe('CRITICAL');
    });

    it('should include recorder details', async () => {
      const mockAllergy = {
        id: 'allergy-3',
        patientId: 'patient-1',
        type: 'ENVIRONMENTAL',
        allergen: '꽃가루',
        recorder: { id: 'user-1', familyName: '김', givenName: '간호사' },
      };

      vi.mocked(service.findById).mockResolvedValue(mockAllergy);

      const result = await controller.findById('patient-1', 'allergy-3');

      expect(result.data.recorder).toBeDefined();
      expect(result.data.recorder.familyName).toBe('김');
    });
  });

  describe('PUT /api/v1/patients/:patientId/allergies/:id (update)', () => {
    it('should update allergy', async () => {
      const dto = {
        severity: 'CRITICAL',
        notes: 'Updated notes',
      };

      const mockUpdated = {
        id: 'allergy-1',
        patientId: 'patient-1',
        type: 'DRUG',
        allergen: '페니실린',
        severity: 'CRITICAL',
        notes: 'Updated notes',
        isActive: true,
      };

      vi.mocked(service.update).mockResolvedValue(mockUpdated);

      const result = await controller.update('patient-1', 'allergy-1', dto);

      expect(result.data.severity).toBe('CRITICAL');
      expect(result.data.notes).toBe('Updated notes');
      expect(service.update).toHaveBeenCalledWith('patient-1', 'allergy-1', dto);
    });

    it('should update allergen name', async () => {
      const dto = {
        allergen: '암피실린',
      };

      const mockUpdated = {
        id: 'allergy-1',
        patientId: 'patient-1',
        allergen: '암피실린',
        type: 'DRUG',
      };

      vi.mocked(service.update).mockResolvedValue(mockUpdated);

      const result = await controller.update('patient-1', 'allergy-1', dto);

      expect(result.data.allergen).toBe('암피실린');
    });

    it('should update isActive status', async () => {
      const dto = {
        isActive: false,
      };

      const mockUpdated = {
        id: 'allergy-1',
        patientId: 'patient-1',
        type: 'DRUG',
        allergen: '페니실린',
        isActive: false,
      };

      vi.mocked(service.update).mockResolvedValue(mockUpdated);

      const result = await controller.update('patient-1', 'allergy-1', dto);

      expect(result.data.isActive).toBe(false);
    });

    it('should update reaction information', async () => {
      const dto = {
        reaction: '심한 발진 및 가려움',
      };

      const mockUpdated = {
        id: 'allergy-1',
        patientId: 'patient-1',
        type: 'DRUG',
        allergen: '페니실린',
        reaction: '심한 발진 및 가려움',
      };

      vi.mocked(service.update).mockResolvedValue(mockUpdated);

      const result = await controller.update('patient-1', 'allergy-1', dto);

      expect(result.data.reaction).toBe('심한 발진 및 가려움');
    });
  });

  describe('PATCH /api/v1/patients/:patientId/allergies/:id/verify (verify)', () => {
    it('should verify allergy as CONFIRMED', async () => {
      const dto = {
        verificationStatus: 'CONFIRMED',
        notes: 'Confirmed by patient',
      };

      const mockVerified = {
        id: 'allergy-1',
        patientId: 'patient-1',
        type: 'DRUG',
        allergen: '페니실린',
        verificationStatus: 'CONFIRMED',
        isActive: true,
      };

      vi.mocked(service.verify).mockResolvedValue(mockVerified);

      const result = await controller.verify('patient-1', 'allergy-1', dto);

      expect(result.data.verificationStatus).toBe('CONFIRMED');
      expect(result.data.isActive).toBe(true);
      expect(service.verify).toHaveBeenCalledWith('patient-1', 'allergy-1', dto);
    });

    it('should deactivate when REFUTED', async () => {
      const dto = {
        verificationStatus: 'REFUTED',
        notes: 'Denied by patient',
      };

      const mockVerified = {
        id: 'allergy-1',
        patientId: 'patient-1',
        type: 'DRUG',
        allergen: '페니실린',
        verificationStatus: 'REFUTED',
        isActive: false,
      };

      vi.mocked(service.verify).mockResolvedValue(mockVerified);

      const result = await controller.verify('patient-1', 'allergy-1', dto);

      expect(result.data.verificationStatus).toBe('REFUTED');
      expect(result.data.isActive).toBe(false);
    });

    it('should mark ENTERED_IN_ERROR', async () => {
      const dto = {
        verificationStatus: 'ENTERED_IN_ERROR',
        notes: 'Data entry error',
      };

      const mockVerified = {
        id: 'allergy-1',
        patientId: 'patient-1',
        verificationStatus: 'ENTERED_IN_ERROR',
        isActive: false,
      };

      vi.mocked(service.verify).mockResolvedValue(mockVerified);

      const result = await controller.verify('patient-1', 'allergy-1', dto);

      expect(result.data.verificationStatus).toBe('ENTERED_IN_ERROR');
      expect(result.data.isActive).toBe(false);
    });

    it('should update verification notes', async () => {
      const dto = {
        verificationStatus: 'CONFIRMED',
        notes: 'Verified by healthcare provider',
      };

      const mockVerified = {
        id: 'allergy-1',
        patientId: 'patient-1',
        verificationStatus: 'CONFIRMED',
        notes: 'Verified by healthcare provider',
        isActive: true,
      };

      vi.mocked(service.verify).mockResolvedValue(mockVerified);

      const result = await controller.verify('patient-1', 'allergy-1', dto);

      expect(result.data.notes).toBe('Verified by healthcare provider');
    });

    it('should allow UNCONFIRMED status', async () => {
      const dto = {
        verificationStatus: 'UNCONFIRMED',
        notes: 'Awaiting verification',
      };

      const mockVerified = {
        id: 'allergy-1',
        patientId: 'patient-1',
        verificationStatus: 'UNCONFIRMED',
        isActive: true,
      };

      vi.mocked(service.verify).mockResolvedValue(mockVerified);

      const result = await controller.verify('patient-1', 'allergy-1', dto);

      expect(result.data.verificationStatus).toBe('UNCONFIRMED');
    });
  });
});
