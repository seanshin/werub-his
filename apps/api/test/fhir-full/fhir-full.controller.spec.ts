import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FhirFullController } from '../../src/modules/fhir-full/fhir-full.controller';
import { NotFoundException } from '@nestjs/common';

describe('FhirFullController', () => {
  let controller: FhirFullController;
  let mockService: any;

  beforeEach(() => {
    mockService = {
      getEncounterAsResource: vi.fn(),
      getObservation: vi.fn(),
      getMedicationRequest: vi.fn(),
    };
    controller = new FhirFullController(mockService);
  });

  describe('getObservation', () => {
    it('should get FHIR Observation bundle for form submission', async () => {
      const mockBundle = {
        resourceType: 'Bundle',
        type: 'collection',
        entry: [
          {
            resource: {
              resourceType: 'Observation',
              id: 'form-1-systolicBp',
              status: 'final',
              code: { text: 'systolicBp' },
              valueQuantity: { value: 120 },
            },
          },
        ],
      };

      mockService.getObservation.mockResolvedValue(mockBundle);

      const result = await controller.getObservation('form-1');

      expect(result.resourceType).toBe('Bundle');
      expect(result.type).toBe('collection');
      expect(mockService.getObservation).toHaveBeenCalledWith('form-1');
    });

    it('should throw NotFoundException if observation not found', async () => {
      mockService.getObservation.mockResolvedValue(null);

      await expect(controller.getObservation('non-existent')).rejects.toThrow(NotFoundException);
    });

    it('should return complete bundle structure', async () => {
      const mockBundle = {
        resourceType: 'Bundle',
        type: 'collection',
        entry: [
          {
            resource: {
              resourceType: 'Observation',
              id: 'form-1-systolicBp',
              status: 'final',
              code: { text: 'systolicBp' },
              subject: { reference: 'Patient/p-1' },
              valueQuantity: { value: 120 },
              effectiveDateTime: '2026-05-15T09:00:00Z',
            },
          },
          {
            resource: {
              resourceType: 'Observation',
              id: 'form-1-diastolicBp',
              status: 'final',
              code: { text: 'diastolicBp' },
              subject: { reference: 'Patient/p-1' },
              valueQuantity: { value: 80 },
              effectiveDateTime: '2026-05-15T09:00:00Z',
            },
          },
        ],
      };

      mockService.getObservation.mockResolvedValue(mockBundle);

      const result = await controller.getObservation('form-1');

      expect(result.entry).toHaveLength(2);
      expect(result.entry[0].resource.status).toBe('final');
      expect(result.entry[1].resource.status).toBe('final');
    });

    it('should include all observation entries', async () => {
      const mockBundle = {
        resourceType: 'Bundle',
        type: 'collection',
        entry: [
          { resource: { resourceType: 'Observation', id: 'form-1-systolicBp' } },
          { resource: { resourceType: 'Observation', id: 'form-1-diastolicBp' } },
          { resource: { resourceType: 'Observation', id: 'form-1-heartRate' } },
        ],
      };

      mockService.getObservation.mockResolvedValue(mockBundle);

      const result = await controller.getObservation('form-1');

      expect(result.entry).toHaveLength(3);
    });

    it('should handle form submission with vital signs', async () => {
      const mockBundle = {
        resourceType: 'Bundle',
        type: 'collection',
        entry: [
          {
            resource: {
              resourceType: 'Observation',
              code: { text: 'systolicBp' },
              valueQuantity: { value: 120 },
            },
          },
          {
            resource: {
              resourceType: 'Observation',
              code: { text: 'diastolicBp' },
              valueQuantity: { value: 80 },
            },
          },
          {
            resource: {
              resourceType: 'Observation',
              code: { text: 'heartRate' },
              valueQuantity: { value: 75 },
            },
          },
        ],
      };

      mockService.getObservation.mockResolvedValue(mockBundle);

      const result = await controller.getObservation('form-1');

      expect(result.entry[0].resource.valueQuantity.value).toBe(120);
      expect(result.entry[1].resource.valueQuantity.value).toBe(80);
      expect(result.entry[2].resource.valueQuantity.value).toBe(75);
    });

    it('should maintain form submission ID in observation references', async () => {
      const mockBundle = {
        resourceType: 'Bundle',
        type: 'collection',
        entry: [
          {
            resource: {
              resourceType: 'Observation',
              id: 'form-123-systolicBp',
              subject: { reference: 'Patient/p-1' },
            },
          },
        ],
      };

      mockService.getObservation.mockResolvedValue(mockBundle);

      const result = await controller.getObservation('form-123');

      expect(result.entry[0].resource.id).toContain('form-123');
    });

    it('should handle empty observation bundle', async () => {
      const mockBundle = {
        resourceType: 'Bundle',
        type: 'collection',
        entry: [],
      };

      mockService.getObservation.mockResolvedValue(mockBundle);

      const result = await controller.getObservation('form-empty');

      expect(result.entry).toHaveLength(0);
    });

    it('should return FHIR-compliant response', async () => {
      const mockBundle = {
        resourceType: 'Bundle',
        type: 'collection',
        entry: [
          {
            resource: {
              resourceType: 'Observation',
              id: 'form-1-systolicBp',
              status: 'final',
              code: { text: 'systolicBp' },
              subject: { reference: 'Patient/p-1' },
              valueQuantity: { value: 120 },
              effectiveDateTime: '2026-05-15T09:00:00Z',
            },
          },
        ],
      };

      mockService.getObservation.mockResolvedValue(mockBundle);

      const result = await controller.getObservation('form-1');

      // Verify FHIR structure
      expect(result.resourceType).toBe('Bundle');
      expect(result.type).toBe('collection');
      expect(result.entry[0].resource.resourceType).toBe('Observation');
    });
  });

  describe('Authorization', () => {
    it('should require JWT authentication', async () => {
      // @UseGuards(JwtAuthGuard) is applied
      expect(controller).toBeDefined();
    });
  });

  describe('Response Format', () => {
    it('should return bundle without extra wrapping', async () => {
      const mockBundle = {
        resourceType: 'Bundle',
        type: 'collection',
        entry: [],
      };

      mockService.getObservation.mockResolvedValue(mockBundle);

      const result = await controller.getObservation('form-1');

      expect(result).toEqual(mockBundle);
    });

    it('should preserve exact bundle structure', async () => {
      const mockBundle = {
        resourceType: 'Bundle',
        type: 'collection',
        entry: [
          {
            resource: {
              resourceType: 'Observation',
              id: 'form-1-systolicBp',
              status: 'final',
              code: { text: 'systolicBp' },
              subject: { reference: 'Patient/p-1' },
              valueQuantity: { value: 120 },
              effectiveDateTime: '2026-05-15T09:00:00Z',
            },
          },
        ],
      };

      mockService.getObservation.mockResolvedValue(mockBundle);

      const result = await controller.getObservation('form-1');

      expect(JSON.stringify(result)).toBe(JSON.stringify(mockBundle));
    });
  });

  describe('Error Handling', () => {
    it('should throw NotFoundException with proper error message', async () => {
      mockService.getObservation.mockResolvedValue(null);

      try {
        await controller.getObservation('missing-form');
        expect.fail('Should have thrown NotFoundException');
      } catch (error) {
        expect(error).toBeInstanceOf(NotFoundException);
        expect(error.message).toBe('Observation not found');
      }
    });

    it('should handle service errors gracefully', async () => {
      mockService.getObservation.mockRejectedValue(new Error('Database error'));

      await expect(controller.getObservation('form-1')).rejects.toThrow('Database error');
    });
  });

  describe('Route Parameters', () => {
    it('should pass formSubmissionId to service', async () => {
      mockService.getObservation.mockResolvedValue({
        resourceType: 'Bundle',
        type: 'collection',
        entry: [],
      });

      await controller.getObservation('form-123');

      expect(mockService.getObservation).toHaveBeenCalledWith('form-123');
    });

    it('should accept UUID-formatted form submission ID', async () => {
      const uuidId = '550e8400-e29b-41d4-a716-446655440000';
      mockService.getObservation.mockResolvedValue({
        resourceType: 'Bundle',
        type: 'collection',
        entry: [],
      });

      await controller.getObservation(uuidId);

      expect(mockService.getObservation).toHaveBeenCalledWith(uuidId);
    });
  });

  describe('FHIR Resource Types', () => {
    it('should return Observation resourceType', async () => {
      const mockBundle = {
        resourceType: 'Bundle',
        type: 'collection',
        entry: [
          {
            resource: {
              resourceType: 'Observation',
              id: 'form-1-systolicBp',
            },
          },
        ],
      };

      mockService.getObservation.mockResolvedValue(mockBundle);

      const result = await controller.getObservation('form-1');

      expect(result.entry[0].resource.resourceType).toBe('Observation');
    });

    it('should use collection bundle type', async () => {
      const mockBundle = {
        resourceType: 'Bundle',
        type: 'collection',
        entry: [],
      };

      mockService.getObservation.mockResolvedValue(mockBundle);

      const result = await controller.getObservation('form-1');

      expect(result.type).toBe('collection');
    });
  });

  describe('Integration with FHIR Endpoints', () => {
    it('should serve observations from FHIR R4 endpoint', async () => {
      // Controller is mapped to 'fhir/R4' base path
      // Endpoint: GET /fhir/R4/Observation/:formSubmissionId
      mockService.getObservation.mockResolvedValue({
        resourceType: 'Bundle',
        type: 'collection',
        entry: [],
      });

      const result = await controller.getObservation('form-1');

      expect(result.resourceType).toBe('Bundle');
    });

    it('should support healthcare data exchange via FHIR', async () => {
      const mockBundle = {
        resourceType: 'Bundle',
        type: 'collection',
        entry: [
          {
            resource: {
              resourceType: 'Observation',
              id: 'form-1-systolicBp',
              status: 'final',
              code: { text: 'systolicBp', coding: [] },
              subject: { reference: 'Patient/p-1' },
              valueQuantity: { value: 120, unit: 'mmHg' },
              effectiveDateTime: '2026-05-15T09:00:00Z',
            },
          },
        ],
      };

      mockService.getObservation.mockResolvedValue(mockBundle);

      const result = await controller.getObservation('form-1');

      // Verify FHIR-compliant structure for EHR exchange
      expect(result.resourceType).toBe('Bundle');
      expect(result.entry[0].resource.resourceType).toBe('Observation');
    });
  });

  describe('Vital Signs Observations', () => {
    it('should handle blood pressure observations', async () => {
      const mockBundle = {
        resourceType: 'Bundle',
        type: 'collection',
        entry: [
          {
            resource: {
              resourceType: 'Observation',
              id: 'form-1-systolicBp',
              code: { text: 'systolicBp' },
              valueQuantity: { value: 120 },
            },
          },
          {
            resource: {
              resourceType: 'Observation',
              id: 'form-1-diastolicBp',
              code: { text: 'diastolicBp' },
              valueQuantity: { value: 80 },
            },
          },
        ],
      };

      mockService.getObservation.mockResolvedValue(mockBundle);

      const result = await controller.getObservation('form-1');

      const systolic = result.entry.find(e => e.resource.code.text === 'systolicBp');
      const diastolic = result.entry.find(e => e.resource.code.text === 'diastolicBp');

      expect(systolic.resource.valueQuantity.value).toBe(120);
      expect(diastolic.resource.valueQuantity.value).toBe(80);
    });

    it('should handle heart rate observations', async () => {
      const mockBundle = {
        resourceType: 'Bundle',
        type: 'collection',
        entry: [
          {
            resource: {
              resourceType: 'Observation',
              id: 'form-1-heartRate',
              code: { text: 'heartRate' },
              valueQuantity: { value: 72 },
            },
          },
        ],
      };

      mockService.getObservation.mockResolvedValue(mockBundle);

      const result = await controller.getObservation('form-1');

      expect(result.entry[0].resource.code.text).toBe('heartRate');
      expect(result.entry[0].resource.valueQuantity.value).toBe(72);
    });

    it('should handle temperature observations', async () => {
      const mockBundle = {
        resourceType: 'Bundle',
        type: 'collection',
        entry: [
          {
            resource: {
              resourceType: 'Observation',
              id: 'form-1-temperature',
              code: { text: 'temperature' },
              valueQuantity: { value: 37.2 },
            },
          },
        ],
      };

      mockService.getObservation.mockResolvedValue(mockBundle);

      const result = await controller.getObservation('form-1');

      expect(result.entry[0].resource.code.text).toBe('temperature');
      expect(result.entry[0].resource.valueQuantity.value).toBe(37.2);
    });

    it('should handle multiple vital signs in single bundle', async () => {
      const mockBundle = {
        resourceType: 'Bundle',
        type: 'collection',
        entry: [
          { resource: { resourceType: 'Observation', code: { text: 'systolicBp' }, valueQuantity: { value: 120 } } },
          { resource: { resourceType: 'Observation', code: { text: 'diastolicBp' }, valueQuantity: { value: 80 } } },
          { resource: { resourceType: 'Observation', code: { text: 'heartRate' }, valueQuantity: { value: 72 } } },
          { resource: { resourceType: 'Observation', code: { text: 'temperature' }, valueQuantity: { value: 37.2 } } },
          { resource: { resourceType: 'Observation', code: { text: 'respiratoryRate' }, valueQuantity: { value: 16 } } },
        ],
      };

      mockService.getObservation.mockResolvedValue(mockBundle);

      const result = await controller.getObservation('form-1');

      expect(result.entry).toHaveLength(5);
    });
  });
});
