import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FhirFullService } from '../../src/modules/fhir-full/fhir-full.service';

describe('FhirFullService', () => {
  let service: FhirFullService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      encounter: { findUnique: vi.fn() },
      formSubmission: { findUnique: vi.fn() },
      prescription: { findUnique: vi.fn() },
    };
    service = new FhirFullService(mockPrisma);
  });

  describe('getEncounterAsResource', () => {
    it('should convert encounter to FHIR Encounter resource', async () => {
      const mockEncounter = {
        id: 'enc-1',
        status: 'SIGNED',
        patientId: 'p-1',
        doctorId: 'd-1',
        createdAt: new Date('2026-05-15T09:00:00Z'),
        doctor: { familyName: 'Kim', givenName: 'John' },
        diagnoses: [
          { diagnosisCode: { code: 'E11', nameKo: '제2형 당뇨병' } },
        ],
      };

      mockPrisma.encounter.findUnique.mockResolvedValue(mockEncounter);

      const result = await service.getEncounterAsResource('enc-1');

      expect(result.resourceType).toBe('Encounter');
      expect(result.id).toBe('enc-1');
      expect(result.status).toBe('finished');
      expect(result.subject.reference).toBe('Patient/p-1');
    });

    it('should map encounter status to FHIR status', async () => {
      const signedEncounter = {
        id: 'enc-1',
        status: 'SIGNED',
        patientId: 'p-1',
        doctorId: 'd-1',
        createdAt: new Date(),
        doctor: { familyName: 'Kim', givenName: 'John' },
        diagnoses: [],
      };

      mockPrisma.encounter.findUnique.mockResolvedValue(signedEncounter);

      const result = await service.getEncounterAsResource('enc-1');

      expect(result.status).toBe('finished');
    });

    it('should map draft encounter status', async () => {
      const draftEncounter = {
        id: 'enc-1',
        status: 'DRAFT',
        patientId: 'p-1',
        doctorId: 'd-1',
        createdAt: new Date(),
        doctor: { familyName: 'Kim', givenName: 'John' },
        diagnoses: [],
      };

      mockPrisma.encounter.findUnique.mockResolvedValue(draftEncounter);

      const result = await service.getEncounterAsResource('enc-1');

      expect(result.status).toBe('in-progress');
    });

    it('should include participant with doctor reference', async () => {
      const mockEncounter = {
        id: 'enc-1',
        status: 'SIGNED',
        patientId: 'p-1',
        doctorId: 'd-1',
        createdAt: new Date(),
        doctor: { familyName: 'Kim', givenName: 'John' },
        diagnoses: [],
      };

      mockPrisma.encounter.findUnique.mockResolvedValue(mockEncounter);

      const result = await service.getEncounterAsResource('enc-1');

      expect(result.participant).toHaveLength(1);
      expect(result.participant[0].individual.reference).toBe('Practitioner/d-1');
      expect(result.participant[0].individual.display).toBe('KimJohn');
    });

    it('should include diagnoses as reasonCode', async () => {
      const mockEncounter = {
        id: 'enc-1',
        status: 'SIGNED',
        patientId: 'p-1',
        doctorId: 'd-1',
        createdAt: new Date(),
        doctor: { familyName: 'Kim', givenName: 'John' },
        diagnoses: [
          { diagnosisCode: { code: 'E11', nameKo: '제2형 당뇨병' } },
          { diagnosisCode: { code: 'I10', nameKo: '본태성 고혈압' } },
        ],
      };

      mockPrisma.encounter.findUnique.mockResolvedValue(mockEncounter);

      const result = await service.getEncounterAsResource('enc-1');

      expect(result.reasonCode).toHaveLength(2);
      expect(result.reasonCode[0].coding[0].code).toBe('E11');
      expect(result.reasonCode[0].coding[0].display).toBe('제2형 당뇨병');
    });

    it('should return null for non-existent encounter', async () => {
      mockPrisma.encounter.findUnique.mockResolvedValue(null);

      const result = await service.getEncounterAsResource('non-existent');

      expect(result).toBeNull();
    });

    it('should include class as ambulatory', async () => {
      const mockEncounter = {
        id: 'enc-1',
        status: 'SIGNED',
        patientId: 'p-1',
        doctorId: 'd-1',
        createdAt: new Date(),
        doctor: { familyName: 'Kim', givenName: 'John' },
        diagnoses: [],
      };

      mockPrisma.encounter.findUnique.mockResolvedValue(mockEncounter);

      const result = await service.getEncounterAsResource('enc-1');

      expect(result.class.code).toBe('AMB');
      expect(result.class.display).toBe('ambulatory');
    });

    it('should include encounter period with start time', async () => {
      const createdAt = new Date('2026-05-15T09:00:00Z');
      const mockEncounter = {
        id: 'enc-1',
        status: 'SIGNED',
        patientId: 'p-1',
        doctorId: 'd-1',
        createdAt,
        doctor: { familyName: 'Kim', givenName: 'John' },
        diagnoses: [],
      };

      mockPrisma.encounter.findUnique.mockResolvedValue(mockEncounter);

      const result = await service.getEncounterAsResource('enc-1');

      expect(result.period.start).toBe(createdAt.toISOString());
    });
  });

  describe('getObservation', () => {
    it('should convert form submission to FHIR Observation bundle', async () => {
      const mockSubmission = {
        id: 'form-1',
        patientId: 'p-1',
        submittedAt: new Date('2026-05-15T09:00:00Z'),
        data: { systolicBp: 120, diastolicBp: 80 },
        patient: { id: 'p-1' },
        formSchema: { id: 'schema-1' },
      };

      mockPrisma.formSubmission.findUnique.mockResolvedValue(mockSubmission);

      const result = await service.getObservation('form-1');

      expect(result.resourceType).toBe('Bundle');
      expect(result.type).toBe('collection');
      expect(result.entry).toHaveLength(2);
    });

    it('should create observation entry for each form field', async () => {
      const mockSubmission = {
        id: 'form-1',
        patientId: 'p-1',
        submittedAt: new Date(),
        data: { systolicBp: 120, diastolicBp: 80, heartRate: 75 },
        patient: { id: 'p-1' },
        formSchema: { id: 'schema-1' },
      };

      mockPrisma.formSubmission.findUnique.mockResolvedValue(mockSubmission);

      const result = await service.getObservation('form-1');

      expect(result.entry).toHaveLength(3);
      expect(result.entry[0].resource.code.text).toBe('systolicBp');
      expect(result.entry[1].resource.code.text).toBe('diastolicBp');
      expect(result.entry[2].resource.code.text).toBe('heartRate');
    });

    it('should include observation values from form data', async () => {
      const mockSubmission = {
        id: 'form-1',
        patientId: 'p-1',
        submittedAt: new Date(),
        data: { systolicBp: 120 },
        patient: { id: 'p-1' },
        formSchema: { id: 'schema-1' },
      };

      mockPrisma.formSubmission.findUnique.mockResolvedValue(mockSubmission);

      const result = await service.getObservation('form-1');

      expect(result.entry[0].resource.valueQuantity.value).toBe(120);
    });

    it('should set observation status to final', async () => {
      const mockSubmission = {
        id: 'form-1',
        patientId: 'p-1',
        submittedAt: new Date(),
        data: { systolicBp: 120 },
        patient: { id: 'p-1' },
        formSchema: { id: 'schema-1' },
      };

      mockPrisma.formSubmission.findUnique.mockResolvedValue(mockSubmission);

      const result = await service.getObservation('form-1');

      expect(result.entry[0].resource.status).toBe('final');
    });

    it('should include patient reference in observation', async () => {
      const mockSubmission = {
        id: 'form-1',
        patientId: 'p-1',
        submittedAt: new Date(),
        data: { systolicBp: 120 },
        patient: { id: 'p-1' },
        formSchema: { id: 'schema-1' },
      };

      mockPrisma.formSubmission.findUnique.mockResolvedValue(mockSubmission);

      const result = await service.getObservation('form-1');

      expect(result.entry[0].resource.subject.reference).toBe('Patient/p-1');
    });

    it('should include effective datetime from form submission', async () => {
      const submittedAt = new Date('2026-05-15T09:00:00Z');
      const mockSubmission = {
        id: 'form-1',
        patientId: 'p-1',
        submittedAt,
        data: { systolicBp: 120 },
        patient: { id: 'p-1' },
        formSchema: { id: 'schema-1' },
      };

      mockPrisma.formSubmission.findUnique.mockResolvedValue(mockSubmission);

      const result = await service.getObservation('form-1');

      expect(result.entry[0].resource.effectiveDateTime).toBe(submittedAt.toISOString());
    });

    it('should return null for non-existent form submission', async () => {
      mockPrisma.formSubmission.findUnique.mockResolvedValue(null);

      const result = await service.getObservation('non-existent');

      expect(result).toBeNull();
    });

    it('should handle empty form data', async () => {
      const mockSubmission = {
        id: 'form-1',
        patientId: 'p-1',
        submittedAt: new Date(),
        data: {},
        patient: { id: 'p-1' },
        formSchema: { id: 'schema-1' },
      };

      mockPrisma.formSubmission.findUnique.mockResolvedValue(mockSubmission);

      const result = await service.getObservation('form-1');

      expect(result.entry).toHaveLength(0);
    });

    it('should generate unique observation IDs', async () => {
      const mockSubmission = {
        id: 'form-1',
        patientId: 'p-1',
        submittedAt: new Date(),
        data: { systolicBp: 120, diastolicBp: 80 },
        patient: { id: 'p-1' },
        formSchema: { id: 'schema-1' },
      };

      mockPrisma.formSubmission.findUnique.mockResolvedValue(mockSubmission);

      const result = await service.getObservation('form-1');

      expect(result.entry[0].resource.id).toBe('form-1-systolicBp');
      expect(result.entry[1].resource.id).toBe('form-1-diastolicBp');
    });
  });

  describe('getMedicationRequest', () => {
    it('should convert prescription to FHIR MedicationRequest', async () => {
      const mockPrescription = {
        id: 'rx-1',
        status: 'ACTIVE',
        createdAt: new Date('2026-05-15T09:00:00Z'),
        dosage: '500mg',
        frequency: '1일 3회',
        duration: 7,
        medicationCode: { code: 'ASPIRIN', nameKo: '아스피린' },
        encounter: { patientId: 'p-1', doctorId: 'd-1' },
      };

      mockPrisma.prescription.findUnique.mockResolvedValue(mockPrescription);

      const result = await service.getMedicationRequest('rx-1');

      expect(result.resourceType).toBe('MedicationRequest');
      expect(result.id).toBe('rx-1');
      expect(result.status).toBe('active');
    });

    it('should map prescription status to FHIR status', async () => {
      const activePrescription = {
        id: 'rx-1',
        status: 'ACTIVE',
        createdAt: new Date(),
        dosage: '500mg',
        frequency: '1일 3회',
        duration: null,
        medicationCode: { code: 'ASPIRIN', nameKo: '아스피린' },
        encounter: { patientId: 'p-1', doctorId: 'd-1' },
      };

      mockPrisma.prescription.findUnique.mockResolvedValue(activePrescription);

      const result = await service.getMedicationRequest('rx-1');

      expect(result.status).toBe('active');
    });

    it('should map cancelled prescription status', async () => {
      const cancelledPrescription = {
        id: 'rx-1',
        status: 'CANCELLED',
        createdAt: new Date(),
        dosage: '500mg',
        frequency: '1일 3회',
        duration: null,
        medicationCode: { code: 'ASPIRIN', nameKo: '아스피린' },
        encounter: { patientId: 'p-1', doctorId: 'd-1' },
      };

      mockPrisma.prescription.findUnique.mockResolvedValue(cancelledPrescription);

      const result = await service.getMedicationRequest('rx-1');

      expect(result.status).toBe('cancelled');
    });

    it('should include medication information', async () => {
      const mockPrescription = {
        id: 'rx-1',
        status: 'ACTIVE',
        createdAt: new Date(),
        dosage: '500mg',
        frequency: '1일 3회',
        duration: null,
        medicationCode: { code: 'ASPIRIN', nameKo: '아스피린' },
        encounter: { patientId: 'p-1', doctorId: 'd-1' },
      };

      mockPrisma.prescription.findUnique.mockResolvedValue(mockPrescription);

      const result = await service.getMedicationRequest('rx-1');

      expect(result.medicationCodeableConcept.coding[0].code).toBe('ASPIRIN');
      expect(result.medicationCodeableConcept.coding[0].display).toBe('아스피린');
    });

    it('should include patient and requester references', async () => {
      const mockPrescription = {
        id: 'rx-1',
        status: 'ACTIVE',
        createdAt: new Date(),
        dosage: '500mg',
        frequency: '1일 3회',
        duration: null,
        medicationCode: { code: 'ASPIRIN', nameKo: '아스피린' },
        encounter: { patientId: 'p-1', doctorId: 'd-1' },
      };

      mockPrisma.prescription.findUnique.mockResolvedValue(mockPrescription);

      const result = await service.getMedicationRequest('rx-1');

      expect(result.subject.reference).toBe('Patient/p-1');
      expect(result.requester.reference).toBe('Practitioner/d-1');
    });

    it('should include dosage instruction with all components', async () => {
      const mockPrescription = {
        id: 'rx-1',
        status: 'ACTIVE',
        createdAt: new Date(),
        dosage: '500mg',
        frequency: '1일 3회',
        duration: 7,
        medicationCode: { code: 'ASPIRIN', nameKo: '아스피린' },
        encounter: { patientId: 'p-1', doctorId: 'd-1' },
      };

      mockPrisma.prescription.findUnique.mockResolvedValue(mockPrescription);

      const result = await service.getMedicationRequest('rx-1');

      expect(result.dosageInstruction[0].text).toBe('500mg 1일 3회 7일');
    });

    it('should handle missing dosage', async () => {
      const mockPrescription = {
        id: 'rx-1',
        status: 'ACTIVE',
        createdAt: new Date(),
        dosage: null,
        frequency: '1일 3회',
        duration: 7,
        medicationCode: { code: 'ASPIRIN', nameKo: '아스피린' },
        encounter: { patientId: 'p-1', doctorId: 'd-1' },
      };

      mockPrisma.prescription.findUnique.mockResolvedValue(mockPrescription);

      const result = await service.getMedicationRequest('rx-1');

      expect(result.dosageInstruction[0].text).toBe('1일 3회 7일');
    });

    it('should handle missing duration', async () => {
      const mockPrescription = {
        id: 'rx-1',
        status: 'ACTIVE',
        createdAt: new Date(),
        dosage: '500mg',
        frequency: '1일 3회',
        duration: null,
        medicationCode: { code: 'ASPIRIN', nameKo: '아스피린' },
        encounter: { patientId: 'p-1', doctorId: 'd-1' },
      };

      mockPrisma.prescription.findUnique.mockResolvedValue(mockPrescription);

      const result = await service.getMedicationRequest('rx-1');

      expect(result.dosageInstruction[0].text).toBe('500mg 1일 3회');
    });

    it('should include authored date from prescription creation', async () => {
      const createdAt = new Date('2026-05-15T09:00:00Z');
      const mockPrescription = {
        id: 'rx-1',
        status: 'ACTIVE',
        createdAt,
        dosage: '500mg',
        frequency: '1일 3회',
        duration: null,
        medicationCode: { code: 'ASPIRIN', nameKo: '아스피린' },
        encounter: { patientId: 'p-1', doctorId: 'd-1' },
      };

      mockPrisma.prescription.findUnique.mockResolvedValue(mockPrescription);

      const result = await service.getMedicationRequest('rx-1');

      expect(result.authoredOn).toBe(createdAt.toISOString());
    });

    it('should return null for non-existent prescription', async () => {
      mockPrisma.prescription.findUnique.mockResolvedValue(null);

      const result = await service.getMedicationRequest('non-existent');

      expect(result).toBeNull();
    });

    it('should return null if prescription has no medication code', async () => {
      const mockPrescription = {
        id: 'rx-1',
        status: 'ACTIVE',
        createdAt: new Date(),
        dosage: '500mg',
        frequency: '1일 3회',
        duration: null,
        medicationCode: null,
        encounter: { patientId: 'p-1', doctorId: 'd-1' },
      };

      mockPrisma.prescription.findUnique.mockResolvedValue(mockPrescription);

      const result = await service.getMedicationRequest('rx-1');

      expect(result).toBeNull();
    });

    it('should set intent to order', async () => {
      const mockPrescription = {
        id: 'rx-1',
        status: 'ACTIVE',
        createdAt: new Date(),
        dosage: '500mg',
        frequency: '1일 3회',
        duration: null,
        medicationCode: { code: 'ASPIRIN', nameKo: '아스피린' },
        encounter: { patientId: 'p-1', doctorId: 'd-1' },
      };

      mockPrisma.prescription.findUnique.mockResolvedValue(mockPrescription);

      const result = await service.getMedicationRequest('rx-1');

      expect(result.intent).toBe('order');
    });
  });

  describe('FHIR System URLs', () => {
    it('should use KCD coding system for diagnoses', async () => {
      const mockEncounter = {
        id: 'enc-1',
        status: 'SIGNED',
        patientId: 'p-1',
        doctorId: 'd-1',
        createdAt: new Date(),
        doctor: { familyName: 'Kim', givenName: 'John' },
        diagnoses: [{ diagnosisCode: { code: 'E11', nameKo: '제2형 당뇨병' } }],
      };

      mockPrisma.encounter.findUnique.mockResolvedValue(mockEncounter);

      const result = await service.getEncounterAsResource('enc-1');

      expect(result.reasonCode[0].coding[0].system).toBe('urn:oid:2.16.840.1.113883.6.256');
    });

    it('should use hospital-run medication system', async () => {
      const mockPrescription = {
        id: 'rx-1',
        status: 'ACTIVE',
        createdAt: new Date(),
        dosage: '500mg',
        frequency: '1일 3회',
        duration: null,
        medicationCode: { code: 'ASPIRIN', nameKo: '아스피린' },
        encounter: { patientId: 'p-1', doctorId: 'd-1' },
      };

      mockPrisma.prescription.findUnique.mockResolvedValue(mockPrescription);

      const result = await service.getMedicationRequest('rx-1');

      expect(result.medicationCodeableConcept.coding[0].system).toBe('urn:hospital-run:medication');
    });
  });
});
