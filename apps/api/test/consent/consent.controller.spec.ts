import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConsentController, PatientConsentController } from '../../src/modules/consent/consent.controller';
import { ConsentService } from '../../src/modules/consent/consent.service';

describe('ConsentController', () => {
  let controller: ConsentController;
  let service: ConsentService;
  let pdfService: any;

  beforeEach(() => {
    service = {
      create: vi.fn(),
      sign: vi.fn(),
      findAll: vi.fn(),
      findById: vi.fn(),
      getByPatient: vi.fn(),
      revoke: vi.fn(),
    } as any;

    pdfService = {
      generateConsentFormPdf: vi.fn(),
    };

    controller = new ConsentController(service, pdfService);
  });

  describe('POST /api/v1/consent (create)', () => {
    it('should create consent form', async () => {
      const dto = {
        patientId: 'patient-1',
        type: 'SURGERY',
        templateName: '수술 동의서',
        content: { procedure: '충수절제술' },
        templateId: 'template-1',
        doctorId: 'doctor-1',
      };

      const mockConsent = {
        id: 'consent-1',
        ...dto,
        status: 'PENDING',
      };

      vi.mocked(service.create).mockResolvedValue(mockConsent);

      const result = await controller.create(dto);

      expect(result.data.id).toBe('consent-1');
      expect(result.data.type).toBe('SURGERY');
      expect(result.data.status).toBe('PENDING');
      expect(service.create).toHaveBeenCalledWith(dto);
    });

    it('should create general consent', async () => {
      const dto = {
        patientId: 'patient-1',
        type: 'GENERAL',
        templateName: '일반 동의서',
        content: { items: ['의료진 명시적 동의'] },
      };

      const mockConsent = {
        id: 'consent-2',
        ...dto,
        status: 'PENDING',
      };

      vi.mocked(service.create).mockResolvedValue(mockConsent);

      const result = await controller.create(dto);

      expect(result.data.type).toBe('GENERAL');
    });
  });

  describe('GET /api/v1/consent (findAll)', () => {
    it('should return all consents', async () => {
      const mockConsents = [
        {
          id: 'consent-1',
          type: 'SURGERY',
          status: 'SIGNED',
          patientId: 'patient-1',
          patient: { id: 'patient-1', familyName: '이', givenName: '환자', mrn: 'MRN-001' },
        },
        {
          id: 'consent-2',
          type: 'GENERAL',
          status: 'PENDING',
          patientId: 'patient-2',
          patient: { id: 'patient-2', familyName: '김', givenName: '환자', mrn: 'MRN-002' },
        },
      ];

      vi.mocked(service.findAll).mockResolvedValue(mockConsents);

      const result = await controller.findAll();

      expect(result.data).toHaveLength(2);
      expect(service.findAll).toHaveBeenCalledWith({
        status: undefined,
        type: undefined,
        patientId: undefined,
      });
    });

    it('should filter by status', async () => {
      const mockConsents = [
        {
          id: 'consent-1',
          status: 'SIGNED',
          type: 'SURGERY',
        },
      ];

      vi.mocked(service.findAll).mockResolvedValue(mockConsents);

      const result = await controller.findAll('SIGNED');

      expect(result.data[0].status).toBe('SIGNED');
      expect(service.findAll).toHaveBeenCalledWith({
        status: 'SIGNED',
        type: undefined,
        patientId: undefined,
      });
    });

    it('should filter by type', async () => {
      const mockConsents = [
        {
          id: 'consent-1',
          type: 'SURGERY',
        },
      ];

      vi.mocked(service.findAll).mockResolvedValue(mockConsents);

      const result = await controller.findAll(undefined, 'SURGERY');

      expect(result.data[0].type).toBe('SURGERY');
      expect(service.findAll).toHaveBeenCalledWith({
        status: undefined,
        type: 'SURGERY',
        patientId: undefined,
      });
    });

    it('should filter by patientId', async () => {
      const mockConsents = [
        {
          id: 'consent-1',
          patientId: 'patient-1',
        },
      ];

      vi.mocked(service.findAll).mockResolvedValue(mockConsents);

      const result = await controller.findAll(undefined, undefined, 'patient-1');

      expect(result.data[0].patientId).toBe('patient-1');
    });

    it('should return empty array when no matches', async () => {
      vi.mocked(service.findAll).mockResolvedValue([]);

      const result = await controller.findAll('REVOKED');

      expect(result.data).toEqual([]);
    });
  });

  describe('GET /api/v1/consent/:id (findById)', () => {
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

      vi.mocked(service.findById).mockResolvedValue(mockConsent);

      const result = await controller.findById('consent-1');

      expect(result.data.id).toBe('consent-1');
      expect(result.data.type).toBe('SURGERY');
      expect(result.data.patient.dateOfBirth).toBe('1990-01-01');
      expect(service.findById).toHaveBeenCalledWith('consent-1');
    });

    it('should include full patient and doctor details', async () => {
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
        doctor: { id: 'doctor-1', familyName: '이', givenName: '의사' },
      };

      vi.mocked(service.findById).mockResolvedValue(mockConsent);

      const result = await controller.findById('consent-1');

      expect(result.data.patient.gender).toBe('F');
      expect(result.data.doctor.familyName).toBe('이');
    });
  });

  describe('PATCH /api/v1/consent/:id/sign (sign)', () => {
    it('should sign consent', async () => {
      const mockSigned = {
        id: 'consent-1',
        status: 'SIGNED',
        patientSignature: 'signature-data',
        patientSignedBy: 'patient-1',
        patientSignedAt: new Date(),
        isValid: true,
      };

      vi.mocked(service.sign).mockResolvedValue(mockSigned);

      const result = await controller.sign('consent-1', {
        patientSignature: 'signature-data',
        patientSignedBy: 'patient-1',
      }, 'staff-1');

      expect(result.data.status).toBe('SIGNED');
      expect(result.data.isValid).toBe(true);
      // 🔴 (M1) 전자서명 직원 서명자는 로그인 사용자 — 본문이 아니라 호출 맥락에서 넘긴다
      expect(service.sign).toHaveBeenCalledWith('consent-1', {
        patientSignature: 'signature-data',
        patientSignedBy: 'patient-1',
      }, { userId: 'staff-1' });
    });

    it('should sign with witness', async () => {
      const mockSigned = {
        id: 'consent-1',
        status: 'SIGNED',
        patientSignedBy: 'patient-1',
        isValid: true,
      };

      vi.mocked(service.sign).mockResolvedValue(mockSigned);

      const result = await controller.sign('consent-1', {
        patientSignedBy: 'patient-1',
      }, 'staff-1');

      expect(result.data.status).toBe('SIGNED');
    });
  });

  describe('GET /api/v1/consent/patient/:patientId (getByPatient)', () => {
    it('should return patient consents', async () => {
      const mockConsents = [
        {
          id: 'consent-1',
          patientId: 'patient-1',
          type: 'SURGERY',
          status: 'SIGNED',
        },
        {
          id: 'consent-2',
          patientId: 'patient-1',
          type: 'GENERAL',
          status: 'PENDING',
        },
      ];

      vi.mocked(service.getByPatient).mockResolvedValue(mockConsents);

      const result = await controller.getByPatient('patient-1');

      expect(result.data).toHaveLength(2);
      expect(service.getByPatient).toHaveBeenCalledWith('patient-1');
    });

    it('should return empty array for patient with no consents', async () => {
      vi.mocked(service.getByPatient).mockResolvedValue([]);

      const result = await controller.getByPatient('patient-999');

      expect(result.data).toEqual([]);
    });
  });

  describe('PATCH /api/v1/consent/:id/revoke (revoke)', () => {
    it('should revoke consent', async () => {
      const mockRevoked = {
        id: 'consent-1',
        status: 'REVOKED',
        isValid: false,
        revokedAt: new Date(),
        revokedReason: '환자 요청',
      };

      vi.mocked(service.revoke).mockResolvedValue(mockRevoked);

      const result = await controller.revoke('consent-1', { reason: '환자 요청' });

      expect(result.data.status).toBe('REVOKED');
      expect(result.data.isValid).toBe(false);
      expect(service.revoke).toHaveBeenCalledWith('consent-1', '환자 요청');
    });

    it('should revoke without reason', async () => {
      const mockRevoked = {
        id: 'consent-1',
        status: 'REVOKED',
        isValid: false,
      };

      vi.mocked(service.revoke).mockResolvedValue(mockRevoked);

      const result = await controller.revoke('consent-1', {});

      expect(result.data.status).toBe('REVOKED');
      expect(service.revoke).toHaveBeenCalledWith('consent-1', undefined);
    });
  });
});

describe('PatientConsentController', () => {
  let controller: PatientConsentController;
  let service: ConsentService;
  let pdfService: any;

  beforeEach(() => {
    service = {
      create: vi.fn(),
      getByPatient: vi.fn(),
    } as any;

    pdfService = {
      generateConsentFormPdf: vi.fn(),
    };

    controller = new PatientConsentController(service, pdfService);
  });

  describe('POST /api/v1/patients/:patientId/consents (create)', () => {
    it('should create patient consent', async () => {
      const dto = {
        type: 'SURGERY',
        templateName: '수술 동의서',
        content: { procedure: '충수절제술' },
        templateId: 'template-1',
      };

      const mockConsent = {
        id: 'consent-1',
        patientId: 'patient-1',
        ...dto,
        status: 'PENDING',
      };

      vi.mocked(service.create).mockResolvedValue(mockConsent);

      const result = await controller.create('patient-1', dto);

      expect(result.data.id).toBe('consent-1');
      expect(result.data.patientId).toBe('patient-1');
      expect(service.create).toHaveBeenCalledWith({
        ...dto,
        patientId: 'patient-1',
      });
    });

    it('should create with doctor ID', async () => {
      const dto = {
        type: 'GENERAL',
        templateName: '일반 동의서',
        content: {},
        doctorId: 'doctor-1',
      };

      const mockConsent = {
        id: 'consent-2',
        patientId: 'patient-1',
        ...dto,
        status: 'PENDING',
      };

      vi.mocked(service.create).mockResolvedValue(mockConsent);

      const result = await controller.create('patient-1', dto);

      expect(result.data.patientId).toBe('patient-1');
      expect(result.data.doctorId).toBe('doctor-1');
    });
  });

  describe('GET /api/v1/patients/:patientId/consents (getByPatient)', () => {
    it('should return patient consents', async () => {
      const mockConsents = [
        {
          id: 'consent-1',
          patientId: 'patient-1',
          type: 'SURGERY',
          status: 'SIGNED',
        },
        {
          id: 'consent-2',
          patientId: 'patient-1',
          type: 'GENERAL',
          status: 'PENDING',
        },
      ];

      vi.mocked(service.getByPatient).mockResolvedValue(mockConsents);

      const result = await controller.getByPatient('patient-1');

      expect(result.data).toHaveLength(2);
      expect(result.data[0].patientId).toBe('patient-1');
      expect(service.getByPatient).toHaveBeenCalledWith('patient-1');
    });

    it('should return empty array for patient with no consents', async () => {
      vi.mocked(service.getByPatient).mockResolvedValue([]);

      const result = await controller.getByPatient('patient-999');

      expect(result.data).toEqual([]);
    });

    it('should return consents in date order', async () => {
      const mockConsents = [
        {
          id: 'consent-3',
          patientId: 'patient-1',
          createdAt: new Date('2026-05-10'),
        },
        {
          id: 'consent-1',
          patientId: 'patient-1',
          createdAt: new Date('2026-05-01'),
        },
      ];

      vi.mocked(service.getByPatient).mockResolvedValue(mockConsents);

      const result = await controller.getByPatient('patient-1');

      expect(result.data[0].id).toBe('consent-3');
    });
  });
});
