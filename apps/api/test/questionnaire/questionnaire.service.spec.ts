import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { QuestionnaireService } from '../../src/modules/questionnaire/questionnaire.service';

describe('QuestionnaireService', () => {
  let service: QuestionnaireService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      formSchema: {
        findUnique: vi.fn(),
      },
      questionnaireToken: {
        create: vi.fn(),
        findUnique: vi.fn(),
        findMany: vi.fn(),
        update: vi.fn(),
      },
      formSubmission: {
        create: vi.fn(),
      },
    };

    service = new QuestionnaireService(mockPrisma);
  });

  describe('generateToken', () => {
    it('should generate questionnaire token with 48-hour expiration', async () => {
      const data = {
        patientId: 'patient-1',
        formSchemaId: 'schema-1',
        appointmentId: 'apt-1',
      };

      const mockSchema = {
        id: 'schema-1',
        name: '수술 전 문진표',
      };

      mockPrisma.formSchema.findUnique.mockResolvedValue(mockSchema);
      mockPrisma.questionnaireToken.create.mockResolvedValue({
        id: 'token-1',
        patientId: 'patient-1',
        formSchemaId: 'schema-1',
        appointmentId: 'apt-1',
        token: 'uuid-token-1',
        expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
        completedAt: null,
        createdAt: new Date(),
        formSchema: { name: '수술 전 문진표' },
        patient: { familyName: '이', givenName: '환자' },
      });

      const result = await service.generateToken(data);

      expect(result.id).toBe('token-1');
      expect(result.token).toBe('uuid-token-1');
      expect(result.expiresAt).toBeDefined();
      expect(mockPrisma.questionnaireToken.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            patientId: 'patient-1',
            formSchemaId: 'schema-1',
          }),
        })
      );
    });

    it('should throw NotFoundException when form schema not found', async () => {
      mockPrisma.formSchema.findUnique.mockResolvedValue(null);

      const data = {
        patientId: 'patient-1',
        formSchemaId: 'invalid-schema',
      };

      await expect(service.generateToken(data)).rejects.toThrow(NotFoundException);
    });

    it('should generate token without appointmentId', async () => {
      const data = {
        patientId: 'patient-1',
        formSchemaId: 'schema-1',
      };

      mockPrisma.formSchema.findUnique.mockResolvedValue({
        id: 'schema-1',
        name: '일반 문진표',
      });

      mockPrisma.questionnaireToken.create.mockResolvedValue({
        id: 'token-2',
        patientId: 'patient-1',
        formSchemaId: 'schema-1',
        appointmentId: null,
        token: 'uuid-token-2',
        expiresAt: new Date(),
        completedAt: null,
      });

      const result = await service.generateToken(data);

      expect(result.appointmentId).toBeNull();
    });

    it('should include patient and form schema info in response', async () => {
      mockPrisma.formSchema.findUnique.mockResolvedValue({
        id: 'schema-1',
        name: '입원 문진표',
      });

      mockPrisma.questionnaireToken.create.mockResolvedValue({
        id: 'token-3',
        token: 'uuid-token-3',
        patientId: 'patient-1',
        formSchemaId: 'schema-1',
        expiresAt: new Date(),
        formSchema: { name: '입원 문진표' },
        patient: { familyName: '김', givenName: '환자' },
      });

      const result = await service.generateToken({
        patientId: 'patient-1',
        formSchemaId: 'schema-1',
      });

      expect(result.formSchema).toBeDefined();
      expect(result.patient).toBeDefined();
      expect(result.patient.familyName).toBe('김');
    });
  });

  describe('getByToken', () => {
    it('should return questionnaire token with valid token', async () => {
      const mockToken = {
        id: 'token-1',
        token: 'valid-token',
        patientId: 'patient-1',
        formSchemaId: 'schema-1',
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24시간 뒤
        completedAt: null,
        formSchema: { id: 'schema-1', name: '문진표' },
        patient: { id: 'patient-1', familyName: '이', givenName: '환자' },
      };

      mockPrisma.questionnaireToken.findUnique.mockResolvedValue(mockToken);

      const result = await service.getByToken('valid-token');

      expect(result.id).toBe('token-1');
      expect(result.token).toBe('valid-token');
      expect(mockPrisma.questionnaireToken.findUnique).toHaveBeenCalledWith({
        where: { token: 'valid-token' },
        include: expect.any(Object),
      });
    });

    it('should throw NotFoundException for invalid token', async () => {
      mockPrisma.questionnaireToken.findUnique.mockResolvedValue(null);

      await expect(service.getByToken('invalid-token')).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when token expired', async () => {
      const mockToken = {
        id: 'token-1',
        token: 'expired-token',
        expiresAt: new Date(Date.now() - 1000), // 이미 만료됨
        completedAt: null,
      };

      mockPrisma.questionnaireToken.findUnique.mockResolvedValue(mockToken);
      mockPrisma.questionnaireToken.update.mockResolvedValue(mockToken);

      await expect(service.getByToken('expired-token')).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when already completed', async () => {
      const mockToken = {
        id: 'token-1',
        token: 'completed-token',
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        completedAt: new Date(), // 이미 완료됨
      };

      mockPrisma.questionnaireToken.findUnique.mockResolvedValue(mockToken);

      await expect(service.getByToken('completed-token')).rejects.toThrow(BadRequestException);
    });

    it('should include form schema and patient details', async () => {
      const mockToken = {
        id: 'token-1',
        token: 'valid-token',
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        completedAt: null,
        formSchema: {
          id: 'schema-1',
          name: '수술 전 문진표',
          items: [],
        },
        patient: {
          id: 'patient-1',
          familyName: '박',
          givenName: '환자',
        },
      };

      mockPrisma.questionnaireToken.findUnique.mockResolvedValue(mockToken);

      const result = await service.getByToken('valid-token');

      expect(result.formSchema.name).toBe('수술 전 문진표');
      expect(result.patient.familyName).toBe('박');
    });
  });

  describe('submit', () => {
    it('should create form submission and update token', async () => {
      const mockToken = {
        id: 'token-1',
        token: 'valid-token',
        patientId: 'patient-1',
        formSchemaId: 'schema-1',
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        completedAt: null,
        formSchema: { name: '문진표' },
        patient: { id: 'patient-1' },
      };

      mockPrisma.questionnaireToken.findUnique.mockResolvedValue(mockToken);

      mockPrisma.formSubmission.create.mockResolvedValue({
        id: 'submission-1',
        formSchemaId: 'schema-1',
        patientId: 'patient-1',
        data: { symptom: '두통', duration: '3일' },
        submittedBy: 'patient-1',
        submittedAt: new Date(),
      });

      mockPrisma.questionnaireToken.update.mockResolvedValue({
        id: 'token-1',
        completedAt: new Date(),
        submissionId: 'submission-1',
      });

      const formData = { symptom: '두통', duration: '3일' };
      const result = await service.submit('valid-token', formData);

      expect(result.id).toBe('submission-1');
      expect(mockPrisma.formSubmission.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            formSchemaId: 'schema-1',
            patientId: 'patient-1',
          }),
        })
      );
      expect(mockPrisma.questionnaireToken.update).toHaveBeenCalledWith({
        where: { token: 'valid-token' },
        data: expect.objectContaining({
          completedAt: expect.any(Date),
          submissionId: 'submission-1',
        }),
      });
    });

    it('should validate token before submission', async () => {
      mockPrisma.questionnaireToken.findUnique.mockResolvedValue(null);

      await expect(service.submit('invalid-token', {})).rejects.toThrow(NotFoundException);
    });

    it('should reject expired token during submission', async () => {
      const mockToken = {
        expiresAt: new Date(Date.now() - 1000),
        completedAt: null,
      };

      mockPrisma.questionnaireToken.findUnique.mockResolvedValue(mockToken);
      mockPrisma.questionnaireToken.update.mockResolvedValue(mockToken);

      await expect(service.submit('expired-token', {})).rejects.toThrow(BadRequestException);
    });

    it('should set submittedBy to patient ID', async () => {
      const mockToken = {
        id: 'token-1',
        token: 'valid-token',
        patientId: 'patient-1',
        formSchemaId: 'schema-1',
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        completedAt: null,
      };

      mockPrisma.questionnaireToken.findUnique.mockResolvedValue(mockToken);

      mockPrisma.formSubmission.create.mockResolvedValue({
        id: 'submission-1',
        submittedBy: 'patient-1',
      });

      mockPrisma.questionnaireToken.update.mockResolvedValue({});

      await service.submit('valid-token', { data: 'test' });

      expect(mockPrisma.formSubmission.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          submittedBy: 'patient-1',
        }),
      });
    });

    it('should return created submission', async () => {
      const mockToken = {
        id: 'token-1',
        token: 'valid-token',
        patientId: 'patient-1',
        formSchemaId: 'schema-1',
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        completedAt: null,
      };

      const mockSubmission = {
        id: 'submission-1',
        formSchemaId: 'schema-1',
        patientId: 'patient-1',
        data: { answers: ['yes', 'no'] },
        submittedAt: new Date(),
      };

      mockPrisma.questionnaireToken.findUnique.mockResolvedValue(mockToken);
      mockPrisma.formSubmission.create.mockResolvedValue(mockSubmission);
      mockPrisma.questionnaireToken.update.mockResolvedValue({});

      const result = await service.submit('valid-token', { answers: ['yes', 'no'] });

      expect(result.id).toBe('submission-1');
      expect(result.data).toEqual({ answers: ['yes', 'no'] });
    });
  });

  describe('findByPatient', () => {
    it('should return all questionnaires for patient', async () => {
      const mockTokens = [
        {
          id: 'token-1',
          patientId: 'patient-1',
          token: 'token-1',
          createdAt: new Date('2026-05-13'),
          formSchema: { name: '수술 전 문진표' },
          submission: { id: 'sub-1', submittedAt: new Date() },
        },
        {
          id: 'token-2',
          patientId: 'patient-1',
          token: 'token-2',
          createdAt: new Date('2026-05-12'),
          formSchema: { name: '입원 문진표' },
          submission: null,
        },
      ];

      mockPrisma.questionnaireToken.findMany.mockResolvedValue(mockTokens);

      const result = await service.findByPatient('patient-1');

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('token-1');
      expect(mockPrisma.questionnaireToken.findMany).toHaveBeenCalledWith({
        where: { patientId: 'patient-1' },
        orderBy: { createdAt: 'desc' },
        include: expect.any(Object),
      });
    });

    it('should return empty array when patient has no questionnaires', async () => {
      mockPrisma.questionnaireToken.findMany.mockResolvedValue([]);

      const result = await service.findByPatient('patient-999');

      expect(result).toEqual([]);
    });

    it('should sort by createdAt descending', async () => {
      mockPrisma.questionnaireToken.findMany.mockResolvedValue([]);

      await service.findByPatient('patient-1');

      expect(mockPrisma.questionnaireToken.findMany).toHaveBeenCalledWith({
        where: { patientId: 'patient-1' },
        orderBy: { createdAt: 'desc' },
        include: expect.any(Object),
      });
    });

    it('should include form schema name', async () => {
      const mockTokens = [
        {
          id: 'token-1',
          patientId: 'patient-1',
          formSchema: { name: '수술 전 문진표' },
          submission: null,
        },
      ];

      mockPrisma.questionnaireToken.findMany.mockResolvedValue(mockTokens);

      const result = await service.findByPatient('patient-1');

      expect(result[0].formSchema.name).toBe('수술 전 문진표');
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

      mockPrisma.questionnaireToken.findMany.mockResolvedValue(mockTokens);

      const result = await service.findByPatient('patient-1');

      expect(result[0].submission).toBeDefined();
      expect(result[1].submission).toBeNull();
    });

    it('should order most recent first', async () => {
      const mockTokens = [
        { id: 'token-3', createdAt: new Date('2026-05-13') },
        { id: 'token-2', createdAt: new Date('2026-05-12') },
        { id: 'token-1', createdAt: new Date('2026-05-11') },
      ];

      mockPrisma.questionnaireToken.findMany.mockResolvedValue(mockTokens);

      const result = await service.findByPatient('patient-1');

      expect(result[0].id).toBe('token-3');
      expect(result[1].id).toBe('token-2');
      expect(result[2].id).toBe('token-1');
    });
  });
});
