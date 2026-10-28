import { describe, it, expect, beforeEach, vi } from 'vitest';
import { QuestionnaireController, QuestionnairePublicController } from '../../src/modules/questionnaire/questionnaire.controller';
import { QuestionnaireService } from '../../src/modules/questionnaire/questionnaire.service';

describe('QuestionnaireController', () => {
  let controller: QuestionnaireController;
  let service: QuestionnaireService;

  beforeEach(() => {
    service = {
      generateToken: vi.fn(),
      findByPatient: vi.fn(),
    } as any;

    controller = new QuestionnaireController(service);
  });

  describe('POST /api/v1/questionnaires/generate-token (generateToken)', () => {
    it('should generate questionnaire token', async () => {
      const body = {
        patientId: 'patient-1',
        formSchemaId: 'schema-1',
        appointmentId: 'apt-1',
      };

      const mockToken = {
        id: 'token-1',
        patientId: 'patient-1',
        formSchemaId: 'schema-1',
        appointmentId: 'apt-1',
        token: 'uuid-token',
        expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
        createdAt: new Date(),
        formSchema: { name: '수술 전 문진표' },
        patient: { familyName: '이', givenName: '환자' },
      };

      vi.mocked(service.generateToken).mockResolvedValue(mockToken);

      const result = await controller.generateToken(body);

      expect(result.data.id).toBe('token-1');
      expect(result.data.token).toBe('uuid-token');
      expect(service.generateToken).toHaveBeenCalledWith(body);
    });

    it('should generate token without appointmentId', async () => {
      const body = {
        patientId: 'patient-1',
        formSchemaId: 'schema-1',
      };

      const mockToken = {
        id: 'token-2',
        patientId: 'patient-1',
        formSchemaId: 'schema-1',
        appointmentId: undefined,
        token: 'uuid-token-2',
        expiresAt: new Date(),
      };

      vi.mocked(service.generateToken).mockResolvedValue(mockToken);

      const result = await controller.generateToken(body);

      expect(result.data.appointmentId).toBeUndefined();
    });

    it('should include form schema info', async () => {
      const mockToken = {
        id: 'token-3',
        patientId: 'patient-1',
        token: 'uuid-token-3',
        expiresAt: new Date(),
        formSchema: { name: '입원 문진표' },
        patient: { familyName: '김', givenName: '환자' },
      };

      vi.mocked(service.generateToken).mockResolvedValue(mockToken);

      const result = await controller.generateToken({
        patientId: 'patient-1',
        formSchemaId: 'schema-1',
      });

      expect(result.data.formSchema.name).toBe('입원 문진표');
    });

    it('should include patient info', async () => {
      const mockToken = {
        id: 'token-4',
        patientId: 'patient-1',
        token: 'uuid-token-4',
        expiresAt: new Date(),
        formSchema: { name: '문진표' },
        patient: { familyName: '박', givenName: '환자' },
      };

      vi.mocked(service.generateToken).mockResolvedValue(mockToken);

      const result = await controller.generateToken({
        patientId: 'patient-1',
        formSchemaId: 'schema-1',
      });

      expect(result.data.patient.familyName).toBe('박');
    });
  });

  describe('GET /api/v1/patients/:patientId/questionnaires (findByPatient)', () => {
    it('should return patient questionnaires', async () => {
      const mockTokens = [
        {
          id: 'token-1',
          patientId: 'patient-1',
          token: 'token-1',
          formSchema: { name: '수술 전 문진표' },
          submission: { id: 'sub-1', submittedAt: new Date() },
        },
        {
          id: 'token-2',
          patientId: 'patient-1',
          token: 'token-2',
          formSchema: { name: '입원 문진표' },
          submission: null,
        },
      ];

      vi.mocked(service.findByPatient).mockResolvedValue(mockTokens);

      const result = await controller.findByPatient('patient-1');

      expect(result.data).toHaveLength(2);
      expect(result.data[0].id).toBe('token-1');
      expect(service.findByPatient).toHaveBeenCalledWith('patient-1');
    });

    it('should return empty array when patient has no questionnaires', async () => {
      vi.mocked(service.findByPatient).mockResolvedValue([]);

      const result = await controller.findByPatient('patient-999');

      expect(result.data).toEqual([]);
    });

    it('should include submission status', async () => {
      const mockTokens = [
        {
          id: 'token-1',
          patientId: 'patient-1',
          formSchema: { name: '문진표1' },
          submission: { id: 'sub-1', submittedAt: new Date() },
        },
        {
          id: 'token-2',
          patientId: 'patient-1',
          formSchema: { name: '문진표2' },
          submission: null,
        },
      ];

      vi.mocked(service.findByPatient).mockResolvedValue(mockTokens);

      const result = await controller.findByPatient('patient-1');

      expect(result.data[0].submission).toBeDefined();
      expect(result.data[1].submission).toBeNull();
    });

    it('should include form schema names', async () => {
      const mockTokens = [
        {
          id: 'token-1',
          patientId: 'patient-1',
          formSchema: { name: '수술 전 문진표' },
          submission: null,
        },
      ];

      vi.mocked(service.findByPatient).mockResolvedValue(mockTokens);

      const result = await controller.findByPatient('patient-1');

      expect(result.data[0].formSchema.name).toBe('수술 전 문진표');
    });
  });
});

describe('QuestionnairePublicController', () => {
  let controller: QuestionnairePublicController;
  let service: QuestionnaireService;

  beforeEach(() => {
    service = {
      getByToken: vi.fn(),
      submit: vi.fn(),
    } as any;

    controller = new QuestionnairePublicController(service);
  });

  describe('GET /api/v1/questionnaires/:token (getByToken)', () => {
    it('should return form by token', async () => {
      const mockToken = {
        id: 'token-1',
        token: 'valid-token',
        patientId: 'patient-1',
        formSchemaId: 'schema-1',
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        completedAt: null,
        formSchema: { id: 'schema-1', name: '수술 전 문진표', items: [] },
        patient: { id: 'patient-1', familyName: '이', givenName: '환자' },
      };

      vi.mocked(service.getByToken).mockResolvedValue(mockToken);

      const result = await controller.getByToken('valid-token');

      expect(result.data.id).toBe('token-1');
      expect(result.data.formSchema.name).toBe('수술 전 문진표');
      expect(service.getByToken).toHaveBeenCalledWith('valid-token');
    });

    it('should include patient information', async () => {
      const mockToken = {
        id: 'token-1',
        token: 'valid-token',
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        completedAt: null,
        formSchema: { name: '문진표' },
        patient: { id: 'patient-1', familyName: '김', givenName: '환자' },
      };

      vi.mocked(service.getByToken).mockResolvedValue(mockToken);

      const result = await controller.getByToken('valid-token');

      expect(result.data.patient.familyName).toBe('김');
    });

    it('should include form schema details', async () => {
      const mockToken = {
        id: 'token-1',
        token: 'valid-token',
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        completedAt: null,
        formSchema: {
          id: 'schema-1',
          name: '수술 전 문진표',
          items: [
            { id: 'item-1', label: '알레르기 여부', type: 'text' },
            { id: 'item-2', label: '과거 수술 경험', type: 'text' },
          ],
        },
        patient: { id: 'patient-1' },
      };

      vi.mocked(service.getByToken).mockResolvedValue(mockToken);

      const result = await controller.getByToken('valid-token');

      expect(result.data.formSchema.items).toHaveLength(2);
    });

    it('should indicate if already completed', async () => {
      const mockToken = {
        id: 'token-1',
        token: 'completed-token',
        completedAt: new Date(),
      };

      vi.mocked(service.getByToken).mockResolvedValue(mockToken);

      const result = await controller.getByToken('completed-token');

      expect(result.data.completedAt).toBeDefined();
    });
  });

  describe('POST /api/v1/questionnaires/:token/submit (submit)', () => {
    it('should submit questionnaire form', async () => {
      const body = {
        data: {
          symptom: '두통',
          duration: '3일',
          severity: '중등도',
        },
      };

      const mockSubmission = {
        id: 'submission-1',
        formSchemaId: 'schema-1',
        patientId: 'patient-1',
        data: body.data,
        submittedBy: 'patient-1',
        submittedAt: new Date(),
      };

      vi.mocked(service.submit).mockResolvedValue(mockSubmission);

      const result = await controller.submit('valid-token', body);

      expect(result.data.id).toBe('submission-1');
      expect(result.data.data.symptom).toBe('두통');
      expect(service.submit).toHaveBeenCalledWith('valid-token', body.data);
    });

    it('should handle different data structures', async () => {
      const body = {
        data: {
          answers: ['yes', 'no', 'somewhat'],
          timestamp: new Date().toISOString(),
        },
      };

      const mockSubmission = {
        id: 'submission-2',
        formSchemaId: 'schema-2',
        patientId: 'patient-1',
        data: body.data,
        submittedBy: 'patient-1',
        submittedAt: new Date(),
      };

      vi.mocked(service.submit).mockResolvedValue(mockSubmission);

      const result = await controller.submit('valid-token', body);

      expect(result.data.data.answers).toHaveLength(3);
    });

    it('should return submitted form data', async () => {
      const body = {
        data: {
          bloodType: 'O+',
          medications: ['약물1', '약물2'],
          allergies: ['페니실린'],
        },
      };

      const mockSubmission = {
        id: 'submission-3',
        formSchemaId: 'schema-1',
        patientId: 'patient-1',
        data: body.data,
        submittedBy: 'patient-1',
        submittedAt: new Date(),
      };

      vi.mocked(service.submit).mockResolvedValue(mockSubmission);

      const result = await controller.submit('valid-token', body);

      expect(result.data.data.bloodType).toBe('O+');
      expect(result.data.data.allergies[0]).toBe('페니실린');
    });

    it('should set submittedAt timestamp', async () => {
      const body = { data: { test: 'data' } };
      const submitTime = new Date();

      const mockSubmission = {
        id: 'submission-4',
        formSchemaId: 'schema-1',
        patientId: 'patient-1',
        data: body.data,
        submittedBy: 'patient-1',
        submittedAt: submitTime,
      };

      vi.mocked(service.submit).mockResolvedValue(mockSubmission);

      const result = await controller.submit('valid-token', body);

      expect(result.data.submittedAt).toBeDefined();
    });

    it('should track form schema and patient info', async () => {
      const body = { data: { content: 'form data' } };

      const mockSubmission = {
        id: 'submission-5',
        formSchemaId: 'schema-abc',
        patientId: 'patient-xyz',
        data: body.data,
        submittedBy: 'patient-xyz',
        submittedAt: new Date(),
      };

      vi.mocked(service.submit).mockResolvedValue(mockSubmission);

      const result = await controller.submit('valid-token', body);

      expect(result.data.formSchemaId).toBe('schema-abc');
      expect(result.data.patientId).toBe('patient-xyz');
    });
  });
});
