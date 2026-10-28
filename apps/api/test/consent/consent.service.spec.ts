import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConsentService } from '../../src/modules/consent/consent.service';
import { ConsentNotFoundError, ConsentAlreadySignedError, ConsentAlreadyRevokedError } from '../../src/domain/errors/domain-error';

/** A1 — 서명패드 이미지(서버가 data URL 형식을 검사한다) */
const SIG_PNG = 'data:image/png;base64,iVBORw0KGgo=';

describe('ConsentService', () => {
  let service: ConsentService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      consentForm: {
        create: vi.fn(),
        findUnique: vi.fn(),
        findMany: vi.fn(),
        update: vi.fn(),
      },
    };

    service = new ConsentService(mockPrisma);
  });

  describe('create', () => {
    it('should create consent form', async () => {
      const data = {
        patientId: 'patient-1',
        type: 'SURGERY',
        templateName: '수술 동의서',
        content: { procedure: '충수절제술', risks: ['감염', '출혈'] },
        templateId: 'template-1',
        consentType: 'INFORMED_CONSENT' as any,
        doctorId: 'doctor-1',
      };

      mockPrisma.consentForm.create.mockResolvedValue({
        id: 'consent-1',
        ...data,
        status: 'PENDING',
        isValid: false,
        createdAt: new Date(),
        template: { id: 'template-1', name: '수술 동의서', type: 'SURGERY' },
        doctor: { id: 'doctor-1', familyName: '이', givenName: '의사' },
      });

      const result = await service.create(data);

      expect(result.id).toBe('consent-1');
      expect(result.type).toBe('SURGERY');
      expect(result.status).toBe('PENDING');
      expect(mockPrisma.consentForm.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            patientId: 'patient-1',
            type: 'SURGERY',
            status: 'PENDING',
          }),
        })
      );
    });

    it('should create general consent form', async () => {
      const data = {
        patientId: 'patient-1',
        type: 'GENERAL',
        templateName: '일반 동의서',
        content: { items: ['의료진 명시적 동의'] },
      };

      mockPrisma.consentForm.create.mockResolvedValue({
        id: 'consent-2',
        ...data,
        status: 'PENDING',
      });

      const result = await service.create(data);

      expect(result.type).toBe('GENERAL');
      expect(result.status).toBe('PENDING');
    });

    it('should include template and doctor information', async () => {
      const data = {
        patientId: 'patient-1',
        type: 'SURGERY',
        templateName: '수술 동의서',
        content: {},
        templateId: 'template-1',
        doctorId: 'doctor-1',
      };

      mockPrisma.consentForm.create.mockResolvedValue({
        id: 'consent-3',
        ...data,
        status: 'PENDING',
        template: { id: 'template-1', name: '수술 동의서', type: 'SURGERY' },
        doctor: { id: 'doctor-1', familyName: '김', givenName: '간호사' },
      });

      const result = await service.create(data);

      expect(result.template).toBeDefined();
      expect(result.doctor).toBeDefined();
    });

    it('should include witness information if provided', async () => {
      const data = {
        patientId: 'patient-1',
        type: 'SURGERY',
        templateName: '수술 동의서',
        content: {},
        witnessId: 'witness-1',
      };

      mockPrisma.consentForm.create.mockResolvedValue({
        id: 'consent-4',
        ...data,
        status: 'PENDING',
      });

      const result = await service.create(data);

      expect(mockPrisma.consentForm.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            witnessId: 'witness-1',
          }),
        })
      );
    });
  });

  describe('sign', () => {
    it('should sign consent form', async () => {
      // GENERAL 동의서(consentType null)는 PATIENT 단독 서명으로 완결 → finalizeIfComplete가
      // 재조회 시 patientSignedAt이 채워진 상태를 봐야 SIGNED로 확정
      mockPrisma.consentForm.findUnique.mockResolvedValue({
        id: 'consent-1',
        status: 'PENDING',
        consentType: null,
        patientSignedAt: new Date(),
        doctorSignedAt: null,
        witnessSignedAt: null,
        nurseCheckedAt: null,
      });

      mockPrisma.consentForm.update.mockResolvedValue({
        id: 'consent-1',
        status: 'SIGNED',
        patientSignature: SIG_PNG,
        patientSignedBy: 'patient-1',
        patientSignedAt: new Date(),
        isValid: true,
      });

      const result = await service.sign('consent-1', {
        patientSignature: SIG_PNG,
        patientSignedBy: 'patient-1',
      });

      expect(result.status).toBe('SIGNED');
      expect(result.isValid).toBe(true);
      expect(result.patientSignature).toBe(SIG_PNG);
      expect(mockPrisma.consentForm.update).toHaveBeenCalledWith({
        where: { id: 'consent-1' },
        data: expect.objectContaining({
          status: 'SIGNED',
          isValid: true,
        }),
        include: expect.any(Object),
      });
    });

    it('should throw ConsentNotFoundError if not found', async () => {
      mockPrisma.consentForm.findUnique.mockResolvedValue(null);

      await expect(
        service.sign('invalid-id', { patientSignedBy: 'patient-1' })
      ).rejects.toThrow(ConsentNotFoundError);
    });

    it('should throw ConsentAlreadySignedError if already signed', async () => {
      mockPrisma.consentForm.findUnique.mockResolvedValue({
        id: 'consent-1',
        status: 'SIGNED',
      });

      await expect(
        service.sign('consent-1', { patientSignedBy: 'patient-1' })
      ).rejects.toThrow(ConsentAlreadySignedError);
    });

    it('should set signedAt timestamp', async () => {
      mockPrisma.consentForm.findUnique.mockResolvedValue({
        id: 'consent-1',
        status: 'PENDING',
        consentType: null,
        patientSignedAt: new Date(),
        doctorSignedAt: null,
        witnessSignedAt: null,
        nurseCheckedAt: null,
      });

      mockPrisma.consentForm.update.mockResolvedValue({
        id: 'consent-1',
        status: 'SIGNED',
        signedAt: new Date(),
        patientSignedAt: new Date(),
      });

      await service.sign('consent-1', { patientSignedBy: 'patient-1', patientSignature: SIG_PNG });

      // 서명은 2단계로 갈린다: (1) 환자 서명 기록(patientSignedAt), (2) 완결 시 signedAt/status 확정
      expect(mockPrisma.consentForm.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'consent-1' },
          data: expect.objectContaining({ patientSignedAt: expect.any(Date) }),
        }),
      );
      expect(mockPrisma.consentForm.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'consent-1' },
          data: expect.objectContaining({ signedAt: expect.any(Date) }),
          include: expect.any(Object),
        }),
      );
    });
  });

  describe('findAll', () => {
    it('should return all consents', async () => {
      const mockConsents = [
        {
          id: 'consent-1',
          type: 'SURGERY',
          status: 'SIGNED',
          patientId: 'patient-1',
          createdAt: new Date(),
        },
        {
          id: 'consent-2',
          type: 'GENERAL',
          status: 'PENDING',
          patientId: 'patient-2',
          createdAt: new Date(),
        },
      ];

      mockPrisma.consentForm.findMany.mockResolvedValue(mockConsents);

      const result = await service.findAll({});

      expect(result).toHaveLength(2);
      expect(mockPrisma.consentForm.findMany).toHaveBeenCalledWith({
        where: {},
        orderBy: { createdAt: 'desc' },
        take: 200,
        include: expect.any(Object),
      });
    });

    it('should filter by status', async () => {
      const mockConsents = [
        {
          id: 'consent-1',
          status: 'SIGNED',
          patientId: 'patient-1',
        },
      ];

      mockPrisma.consentForm.findMany.mockResolvedValue(mockConsents);

      const result = await service.findAll({ status: 'SIGNED' });

      expect(result[0].status).toBe('SIGNED');
      expect(mockPrisma.consentForm.findMany).toHaveBeenCalledWith({
        where: { status: 'SIGNED' },
        orderBy: { createdAt: 'desc' },
        take: 200,
        include: expect.any(Object),
      });
    });

    it('should filter by type', async () => {
      const mockConsents = [
        {
          id: 'consent-1',
          type: 'SURGERY',
          consentType: 'INFORMED_CONSENT',
        },
      ];

      mockPrisma.consentForm.findMany.mockResolvedValue(mockConsents);

      const result = await service.findAll({ type: 'SURGERY' });

      expect(mockPrisma.consentForm.findMany).toHaveBeenCalledWith({
        where: { consentType: 'SURGERY' },
        orderBy: { createdAt: 'desc' },
        take: 200,
        include: expect.any(Object),
      });
    });

    it('should filter by patientId', async () => {
      const mockConsents = [
        {
          id: 'consent-1',
          patientId: 'patient-1',
          status: 'SIGNED',
        },
        {
          id: 'consent-2',
          patientId: 'patient-1',
          status: 'PENDING',
        },
      ];

      mockPrisma.consentForm.findMany.mockResolvedValue(mockConsents);

      const result = await service.findAll({ patientId: 'patient-1' });

      expect(result).toHaveLength(2);
      expect(mockPrisma.consentForm.findMany).toHaveBeenCalledWith({
        where: { patientId: 'patient-1' },
        orderBy: { createdAt: 'desc' },
        take: 200,
        include: expect.any(Object),
      });
    });

    it('should include patient information', async () => {
      const mockConsents = [
        {
          id: 'consent-1',
          patientId: 'patient-1',
          patient: {
            id: 'patient-1',
            familyName: '이',
            givenName: '환자',
            mrn: 'MRN-001',
          },
        },
      ];

      mockPrisma.consentForm.findMany.mockResolvedValue(mockConsents);

      const result = await service.findAll({});

      expect(result[0].patient).toBeDefined();
      expect(result[0].patient.mrn).toBe('MRN-001');
    });
  });

  describe('findById', () => {
    it('should return consent by id', async () => {
      const mockConsent = {
        id: 'consent-1',
        type: 'SURGERY',
        status: 'SIGNED',
        patientId: 'patient-1',
        patient: {
          id: 'patient-1',
          familyName: '이',
          givenName: '환자',
          mrn: 'MRN-001',
          dateOfBirth: '1990-01-01',
          gender: 'M',
        },
        template: { id: 'template-1', name: '수술 동의서', type: 'SURGERY' },
        doctor: { id: 'doctor-1', familyName: '김', givenName: '의사' },
      };

      mockPrisma.consentForm.findUnique.mockResolvedValue(mockConsent);

      const result = await service.findById('consent-1');

      expect(result.id).toBe('consent-1');
      expect(result.type).toBe('SURGERY');
      expect(result.patient.dateOfBirth).toBe('1990-01-01');
      expect(mockPrisma.consentForm.findUnique).toHaveBeenCalledWith({
        where: { id: 'consent-1' },
        include: expect.any(Object),
      });
    });

    it('should throw ConsentNotFoundError if not found', async () => {
      mockPrisma.consentForm.findUnique.mockResolvedValue(null);

      await expect(service.findById('invalid-id')).rejects.toThrow(ConsentNotFoundError);
    });

    it('should include full patient details', async () => {
      const mockConsent = {
        id: 'consent-1',
        patientId: 'patient-1',
        patient: {
          id: 'patient-1',
          familyName: '박',
          givenName: '환자',
          mrn: 'MRN-002',
          dateOfBirth: '1985-05-15',
          gender: 'F',
        },
      };

      mockPrisma.consentForm.findUnique.mockResolvedValue(mockConsent);

      const result = await service.findById('consent-1');

      expect(result.patient.gender).toBe('F');
      expect(result.patient.mrn).toBe('MRN-002');
    });
  });

  describe('getByPatient', () => {
    it('should return all consents for patient', async () => {
      const mockConsents = [
        {
          id: 'consent-1',
          patientId: 'patient-1',
          type: 'SURGERY',
          status: 'SIGNED',
          createdAt: new Date('2026-05-10'),
        },
        {
          id: 'consent-2',
          patientId: 'patient-1',
          type: 'GENERAL',
          status: 'PENDING',
          createdAt: new Date('2026-05-05'),
        },
      ];

      mockPrisma.consentForm.findMany.mockResolvedValue(mockConsents);

      const result = await service.getByPatient('patient-1');

      expect(result).toHaveLength(2);
      expect(result[0].type).toBe('SURGERY');
      expect(mockPrisma.consentForm.findMany).toHaveBeenCalledWith({
        where: { patientId: 'patient-1' },
        orderBy: { createdAt: 'desc' },
        include: expect.any(Object),
      });
    });

    it('should return empty array when no consents', async () => {
      mockPrisma.consentForm.findMany.mockResolvedValue([]);

      const result = await service.getByPatient('patient-999');

      expect(result).toEqual([]);
    });

    it('should sort by createdAt descending', async () => {
      mockPrisma.consentForm.findMany.mockResolvedValue([]);

      await service.getByPatient('patient-1');

      expect(mockPrisma.consentForm.findMany).toHaveBeenCalledWith({
        where: { patientId: 'patient-1' },
        orderBy: { createdAt: 'desc' },
        include: expect.any(Object),
      });
    });
  });

  describe('revoke', () => {
    it('should revoke consent', async () => {
      mockPrisma.consentForm.findUnique.mockResolvedValue({
        id: 'consent-1',
        status: 'SIGNED',
      });

      mockPrisma.consentForm.update.mockResolvedValue({
        id: 'consent-1',
        status: 'REVOKED',
        isValid: false,
        revokedAt: new Date(),
        revokedReason: '환자 요청',
      });

      const result = await service.revoke('consent-1', '환자 요청');

      expect(result.status).toBe('REVOKED');
      expect(result.isValid).toBe(false);
      expect(result.revokedReason).toBe('환자 요청');
      expect(mockPrisma.consentForm.update).toHaveBeenCalledWith({
        where: { id: 'consent-1' },
        data: expect.objectContaining({
          status: 'REVOKED',
          isValid: false,
        }),
        include: expect.any(Object),
      });
    });

    it('should revoke without reason', async () => {
      mockPrisma.consentForm.findUnique.mockResolvedValue({
        id: 'consent-1',
        status: 'SIGNED',
      });

      mockPrisma.consentForm.update.mockResolvedValue({
        id: 'consent-1',
        status: 'REVOKED',
        isValid: false,
        revokedAt: new Date(),
      });

      const result = await service.revoke('consent-1');

      expect(result.status).toBe('REVOKED');
      expect(result.isValid).toBe(false);
    });

    it('should throw ConsentNotFoundError if not found', async () => {
      mockPrisma.consentForm.findUnique.mockResolvedValue(null);

      await expect(service.revoke('invalid-id')).rejects.toThrow(ConsentNotFoundError);
    });

    it('should throw ConsentAlreadyRevokedError if already revoked', async () => {
      mockPrisma.consentForm.findUnique.mockResolvedValue({
        id: 'consent-1',
        status: 'REVOKED',
      });

      await expect(service.revoke('consent-1')).rejects.toThrow(ConsentAlreadyRevokedError);
    });

    it('should set revokedAt timestamp', async () => {
      mockPrisma.consentForm.findUnique.mockResolvedValue({
        id: 'consent-1',
        status: 'SIGNED',
      });

      mockPrisma.consentForm.update.mockResolvedValue({
        id: 'consent-1',
        status: 'REVOKED',
        revokedAt: new Date(),
      });

      await service.revoke('consent-1');

      expect(mockPrisma.consentForm.update).toHaveBeenCalledWith({
        where: { id: 'consent-1' },
        data: expect.objectContaining({
          revokedAt: expect.any(Date),
        }),
        include: expect.any(Object),
      });
    });
  });
});
