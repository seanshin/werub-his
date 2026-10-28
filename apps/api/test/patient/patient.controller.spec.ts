import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PatientController } from '../../src/modules/patient/patient.controller';
import { PatientService } from '../../src/modules/patient/patient.service';

const ADMIN_USER = { id: 'u-admin', role: 'ADMIN' } as never;

describe('PatientController', () => {
  let controller: PatientController;
  let service: PatientService;

  beforeEach(() => {
    service = {
      findAll: vi.fn(),
      create: vi.fn(),
      checkDuplicate: vi.fn(),
      mergePatients: vi.fn(),
      importPatients: vi.fn(),
      exportCsv: vi.fn(),
      getQualityDashboard: vi.fn(),
      findById: vi.fn(),
      update: vi.fn(),
      softDelete: vi.fn(),
      getHistory: vi.fn(),
      getContacts: vi.fn(),
      createContact: vi.fn(),
      updateContact: vi.fn(),
      deleteContact: vi.fn(),
      markDeceased: vi.fn(),
      uploadPhoto: vi.fn(),
      getRelations: vi.fn(),
      createRelation: vi.fn(),
      deleteRelation: vi.fn(),
    } as any;

    // 마스킹 판정용 의존성 — 관리자 시점(전체 열람)으로 고정해 기존 응답 계약을 그대로 검증
    const audit: any = { log: vi.fn().mockResolvedValue(undefined) };
    const permissions: any = { hasPermission: vi.fn().mockReturnValue(true) };
    // 목록 능력표 — 관리자는 역할 데이터 접근 설정으로 좁히지 않는다(부서 없음)
    const accessControl: any = { listNarrowing: vi.fn().mockResolvedValue(null) };
    controller = new PatientController(service, audit, permissions, accessControl);
  });

  describe('GET / (findAll)', () => {
    it('should return paginated patient list', async () => {
      const mockResult = {
        data: [
          { id: 'pat-1', mrn: 'MR000001', familyName: '김', givenName: '환자' },
          { id: 'pat-2', mrn: 'MR000002', familyName: '이', givenName: '의사' },
        ],
        meta: { total: 2, skip: 0, take: 20 },
      };

      vi.mocked(service.findAll).mockResolvedValue(mockResult);

      const result = await controller.findAll({} as any, ADMIN_USER);

      expect(result.data).toHaveLength(2);
      expect(result.meta.total).toBe(2);
      expect(service.findAll).toHaveBeenCalled();
    });

    it('should apply search filter', async () => {
      vi.mocked(service.findAll).mockResolvedValue({
        data: [{ id: 'pat-1', mrn: 'MR000001' }],
        meta: { total: 1 },
      });

      await controller.findAll({ search: '김환자' } as any, ADMIN_USER);

      expect(service.findAll).toHaveBeenCalledWith(expect.objectContaining({ search: '김환자' }), expect.objectContaining({ phoneSearch: true }));
    });
  });

  describe('POST / (create)', () => {
    it('should create new patient', async () => {
      const dto = {
        familyName: '김',
        givenName: '신규',
        dateOfBirth: '1980-01-15',
        gender: 'MALE',
      };

      const mockPatient = {
        id: 'pat-1',
        mrn: 'MR000001',
        familyName: '김',
        givenName: '신규',
      };

      vi.mocked(service.create).mockResolvedValue(mockPatient);

      const result = await controller.create(dto as any, 'user-1');

      expect(result.data.mrn).toBe('MR000001');
      expect(service.create).toHaveBeenCalledWith(dto, 'user-1');
    });

    it('should include contacts when provided', async () => {
      const dto = {
        familyName: '김',
        givenName: '신규',
        dateOfBirth: '1980-01-15',
        gender: 'MALE',
        contacts: [{ name: '아내', relationship: 'SPOUSE' }],
      };

      const mockPatient = {
        id: 'pat-1',
        mrn: 'MR000001',
        contacts: [{ id: 'c-1', name: '아내' }],
      };

      vi.mocked(service.create).mockResolvedValue(mockPatient);

      const result = await controller.create(dto as any, 'user-1');

      expect(result.data.contacts).toHaveLength(1);
    });
  });

  describe('POST /check-duplicate', () => {
    it('should detect duplicate patients', async () => {
      const dto = {
        familyName: '김',
        givenName: '환자',
        dateOfBirth: '1980-01-15',
      };

      const mockResult = {
        isDuplicate: true,
        matches: [
          { id: 'pat-1', mrn: 'MR000001', phone: '010-1234-5678' },
        ],
      };

      vi.mocked(service.checkDuplicate).mockResolvedValue(mockResult);

      const result = await controller.checkDuplicate(dto);

      expect(result.data.isDuplicate).toBe(true);
      expect(result.data.matches).toHaveLength(1);
    });
  });

  describe('POST /merge', () => {
    it('should merge duplicate patients', async () => {
      const dto = {
        primaryPatientId: 'pat-1',
        duplicatePatientId: 'pat-2',
        keepData: 'PRIMARY',
      };

      const mockMerged = {
        id: 'pat-1',
        mrn: 'MR000001',
        mergedWith: 'pat-2',
      };

      vi.mocked(service.mergePatients).mockResolvedValue(mockMerged);

      const result = await controller.mergePatients(dto, 'user-1');

      expect(result.data.mergedWith).toBe('pat-2');
      expect(service.mergePatients).toHaveBeenCalledWith(dto, 'user-1');
    });
  });

  describe('POST /import', () => {
    it('should import multiple patients', async () => {
      const dto = {
        patients: [
          {
            familyName: '김',
            givenName: '환자1',
            dateOfBirth: '1980-01-15',
            gender: 'MALE',
          },
        ],
      };

      const mockResult = {
        imported: 1,
        skipped: 0,
        errors: [],
        patients: [{ id: 'pat-1', mrn: 'MR000001' }],
      };

      vi.mocked(service.importPatients).mockResolvedValue(mockResult);

      const result = await controller.importPatients(dto, 'user-1');

      expect(result.data.imported).toBe(1);
      expect(result.data.patients).toHaveLength(1);
    });
  });

  describe('GET /quality-dashboard', () => {
    it('should return data quality metrics', async () => {
      const mockDashboard = {
        totalPatients: 100,
        activePatients: 95,
        deceasedPatients: 5,
        completenessScore: 92.5,
        missingFields: { email: 8, bloodType: 15 },
      };

      vi.mocked(service.getQualityDashboard).mockResolvedValue(mockDashboard);

      const result = await controller.getQualityDashboard();

      expect(result.data.completenessScore).toBe(92.5);
      expect(result.data.totalPatients).toBe(100);
    });
  });

  describe('GET /:id (findOne)', () => {
    it('should return patient detail', async () => {
      const mockPatient = {
        id: 'pat-1',
        mrn: 'MR000001',
        familyName: '김',
        givenName: '환자',
        gender: 'MALE',
        dateOfBirth: new Date('1980-01-15'),
      };

      vi.mocked(service.findById).mockResolvedValue(mockPatient);

      const result = await controller.findOne('pat-1', ADMIN_USER);

      expect(result.data.id).toBe('pat-1');
      expect(result.data.mrn).toBe('MR000001');
      expect(service.findById).toHaveBeenCalledWith('pat-1');
    });
  });

  describe('PUT /:id (update)', () => {
    it('should update patient information', async () => {
      const dto = { givenName: '환자(수정)', phone: '010-9999-9999' };
      const mockUpdated = {
        id: 'pat-1',
        mrn: 'MR000001',
        familyName: '김',
        givenName: '환자(수정)',
        phone: '010-9999-9999',
      };

      vi.mocked(service.update).mockResolvedValue(mockUpdated);

      const result = await controller.update('pat-1', dto as any, 'user-1');

      expect(result.data.givenName).toBe('환자(수정)');
      expect(service.update).toHaveBeenCalledWith('pat-1', dto, 'user-1');
    });
  });

  describe('DELETE /:id (remove)', () => {
    it('should deactivate patient', async () => {
      vi.mocked(service.softDelete).mockResolvedValue(undefined);

      const result = await controller.remove('pat-1', 'user-1');

      expect(result.data.message).toBe('Patient deactivated');
      expect(service.softDelete).toHaveBeenCalledWith('pat-1', 'user-1');
    });
  });

  describe('GET /:id/history', () => {
    it('should return patient change history', async () => {
      const mockHistory = [
        { id: 'h-1', fieldName: 'phone', oldValue: '010-1234-5678', newValue: '010-9999-9999' },
      ];

      vi.mocked(service.getHistory).mockResolvedValue(mockHistory);

      const result = await controller.getHistory('pat-1');

      expect(result.data).toHaveLength(1);
      expect(result.data[0].fieldName).toBe('phone');
    });
  });

  describe('GET /:id/contacts', () => {
    it('should return patient contacts', async () => {
      const mockContacts = [
        { id: 'c-1', name: '아내', relationship: 'SPOUSE', isEmergencyContact: true },
      ];

      vi.mocked(service.getContacts).mockResolvedValue(mockContacts);

      const result = await controller.getContacts('pat-1');

      expect(result.data).toHaveLength(1);
      expect(result.data[0].name).toBe('아내');
    });
  });

  describe('POST /:id/contacts', () => {
    it('should create contact', async () => {
      const dto = {
        name: '어머니',
        relationship: 'PARENT',
        phone: '010-1111-1111',
      };

      const mockContact = {
        id: 'c-2',
        patientId: 'pat-1',
        name: '어머니',
        relationship: 'PARENT',
      };

      vi.mocked(service.createContact).mockResolvedValue(mockContact);

      const result = await controller.createContact('pat-1', dto);

      expect(result.data.name).toBe('어머니');
    });
  });

  describe('PUT /:id/contacts/:cid', () => {
    it('should update contact', async () => {
      const dto = { phone: '010-2222-2222' };
      const mockUpdated = {
        id: 'c-1',
        patientId: 'pat-1',
        phone: '010-2222-2222',
      };

      vi.mocked(service.updateContact).mockResolvedValue(mockUpdated);

      const result = await controller.updateContact('pat-1', 'c-1', dto as any);

      expect(result.data.phone).toBe('010-2222-2222');
    });
  });

  describe('DELETE /:id/contacts/:cid', () => {
    it('should delete contact', async () => {
      vi.mocked(service.deleteContact).mockResolvedValue(undefined);

      const result = await controller.deleteContact('pat-1', 'c-1');

      expect(result.data.message).toBe('Contact deleted');
      expect(service.deleteContact).toHaveBeenCalledWith('pat-1', 'c-1');
    });
  });

  describe('POST /:id/deceased', () => {
    it('should mark patient as deceased', async () => {
      const dto = { deceasedDate: new Date(), deceasedReason: '심근경색' };
      const mockDeceased = {
        id: 'pat-1',
        isDeceased: true,
        deceasedDate: new Date(),
      };

      vi.mocked(service.markDeceased).mockResolvedValue(mockDeceased);

      const result = await controller.markDeceased('pat-1', dto, 'user-1');

      expect(result.data.isDeceased).toBe(true);
    });
  });

  describe('POST /:id/photo', () => {
    it('should upload patient photo', async () => {
      const mockFile = {
        originalname: 'photo.jpg',
        path: 'uploads/patients/temp-123.jpg',
      };

      const mockResult = {
        id: 'pat-1',
        photoUrl: 'https://storage/pat-1.jpg',
      };

      vi.mocked(service.uploadPhoto).mockResolvedValue(mockResult);

      const result = await controller.uploadPhoto('pat-1', mockFile as any);

      expect(result.data.photoUrl).toBeDefined();
      expect(service.uploadPhoto).toHaveBeenCalled();
    });
  });

  describe('GET /:id/relations', () => {
    it('should return family relations', async () => {
      const mockRelations = [
        { id: 'rel-1', relatedPatientId: 'pat-2', relationshipType: 'SIBLING' },
      ];

      vi.mocked(service.getRelations).mockResolvedValue(mockRelations);

      const result = await controller.getRelations('pat-1');

      expect(result.data).toHaveLength(1);
      expect(result.data[0].relationshipType).toBe('SIBLING');
    });
  });

  describe('POST /:id/relations', () => {
    it('should create family relation', async () => {
      const dto = { relatedPatientId: 'pat-2', relationshipType: 'SIBLING' };
      const mockRelation = {
        id: 'rel-1',
        patientId: 'pat-1',
        relatedPatientId: 'pat-2',
        relationshipType: 'SIBLING',
      };

      vi.mocked(service.createRelation).mockResolvedValue(mockRelation);

      const result = await controller.createRelation('pat-1', dto);

      expect(result.data.relationshipType).toBe('SIBLING');
    });
  });

  describe('DELETE /:id/relations/:relationId', () => {
    it('should delete family relation', async () => {
      vi.mocked(service.deleteRelation).mockResolvedValue(undefined);

      const result = await controller.deleteRelation('pat-1', 'rel-1');

      expect(result.data.message).toBe('Relation removed');
      expect(service.deleteRelation).toHaveBeenCalledWith('pat-1', 'rel-1');
    });
  });
});
