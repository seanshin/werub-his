import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EncounterController, PatientEncounterController } from '../../src/modules/encounter/encounter.controller';
import { EncounterService } from '../../src/modules/encounter/encounter.service';

describe('EncounterController', () => {
  let controller: EncounterController;
  let service: EncounterService;

  beforeEach(() => {
    service = {
      create: vi.fn(),
      findAll: vi.fn(),
      findById: vi.fn(),
      findDetail: vi.fn(),
      findByPatient: vi.fn(),
      update: vi.fn(),
      sign: vi.fn(),
    } as any;

    controller = new EncounterController(service);
  });

  describe('POST /api/v1/encounters (create)', () => {
    it('should create encounter with SOAP notes', async () => {
      const dto = {
        patientId: 'patient-1',
        appointmentId: 'apt-1',
        subjective: '환자 호소: 두통',
        objective: '검사 결과',
        assessment: '진단',
        plan: '계획',
        diagnoses: [{ diagnosisCodeId: 'diag-1', type: 'PRIMARY' }],
      };

      const mockEncounter = {
        id: 'enc-1',
        ...dto,
        doctorId: 'doctor-1',
        status: 'DRAFT',
        patient: { id: 'patient-1', mrn: 'MRN-001', familyName: '이', givenName: '환자' },
        doctor: { id: 'doctor-1', familyName: '김', givenName: '의사' },
        diagnoses: [],
      };

      vi.mocked(service.create).mockResolvedValue(mockEncounter);

      const result = await controller.create(dto, 'doctor-1');

      expect(result.data.id).toBe('enc-1');
      expect(result.data.status).toBe('DRAFT');
      expect(result.data.subjective).toBe(dto.subjective);
      expect(service.create).toHaveBeenCalledWith(dto, 'doctor-1');
    });

    it('should create without diagnoses', async () => {
      const dto = {
        patientId: 'patient-1',
        subjective: 'S',
        objective: 'O',
        assessment: 'A',
        plan: 'P',
      };

      const mockEncounter = {
        id: 'enc-2',
        ...dto,
        doctorId: 'doctor-1',
        status: 'DRAFT',
        diagnoses: [],
      };

      vi.mocked(service.create).mockResolvedValue(mockEncounter);

      const result = await controller.create(dto, 'doctor-1');

      expect(result.data.diagnoses).toEqual([]);
    });

    it('should include patient and doctor info', async () => {
      const dto = {
        patientId: 'patient-1',
        subjective: 'S',
        objective: 'O',
        assessment: 'A',
        plan: 'P',
      };

      const mockEncounter = {
        id: 'enc-3',
        ...dto,
        doctorId: 'doctor-1',
        status: 'DRAFT',
        patient: {
          id: 'patient-1',
          mrn: 'MRN-002',
          familyName: '박',
          givenName: '환자',
        },
        doctor: {
          id: 'doctor-1',
          familyName: '이',
          givenName: '의사',
        },
        diagnoses: [],
      };

      vi.mocked(service.create).mockResolvedValue(mockEncounter);

      const result = await controller.create(dto, 'doctor-1');

      expect(result.data.patient).toBeDefined();
      expect(result.data.doctor).toBeDefined();
    });
  });

  describe('GET /api/v1/encounters (findAll)', () => {
    it('should return encounters with pagination', async () => {
      const mockResult = {
        data: [
          { id: 'enc-1', patientId: 'patient-1', status: 'SIGNED' },
          { id: 'enc-2', patientId: 'patient-1', status: 'DRAFT' },
        ],
        pagination: { total: 100, page: 1, limit: 20, hasMore: true },
      };

      vi.mocked(service.findAll).mockResolvedValue(mockResult);

      const result = await controller.findAll('me');

      expect(result.data).toHaveLength(2);
      expect(result.pagination.total).toBe(100);
      expect(result.pagination.hasMore).toBe(true);
      expect(service.findAll).toHaveBeenCalledWith({
        patientId: undefined,
        doctorId: undefined,
        page: undefined,
        limit: undefined,
      });
    });

    it('🔴 mine=true 는 호출자 본인으로 고정된다(넘어온 doctorId 를 덮는다)', async () => {
      (service.findAll as any).mockResolvedValue({ data: [], pagination: {} });
      await controller.findAll('me', undefined, 'someone-else', 'DRAFT', 'true');
      expect((service.findAll as any)).toHaveBeenCalledWith(
        expect.objectContaining({ doctorId: 'me', status: 'DRAFT' }),
      );
    });

    it('대조군 — mine 이 없으면 넘어온 doctorId 를 그대로 쓴다', async () => {
      (service.findAll as any).mockResolvedValue({ data: [], pagination: {} });
      await controller.findAll('me', undefined, 'doctor-1', 'DRAFT');
      expect((service.findAll as any)).toHaveBeenCalledWith(
        expect.objectContaining({ doctorId: 'doctor-1', status: 'DRAFT' }),
      );
    });

    it('should filter by patientId', async () => {
      const mockResult = {
        data: [{ id: 'enc-1', patientId: 'patient-1' }],
        pagination: { total: 1, page: 1, limit: 20, hasMore: false },
      };

      vi.mocked(service.findAll).mockResolvedValue(mockResult);

      const result = await controller.findAll('me', 'patient-1');

      expect(result.data[0].patientId).toBe('patient-1');
      expect(service.findAll).toHaveBeenCalledWith({
        patientId: 'patient-1',
        doctorId: undefined,
        page: undefined,
        limit: undefined,
      });
    });

    it('should filter by doctorId', async () => {
      const mockResult = {
        data: [{ id: 'enc-1', doctorId: 'doctor-1' }],
        pagination: { total: 1, page: 1, limit: 20, hasMore: false },
      };

      vi.mocked(service.findAll).mockResolvedValue(mockResult);

      const result = await controller.findAll('me', undefined, 'doctor-1');

      expect(result.data[0].doctorId).toBe('doctor-1');
    });

    it('should handle pagination parameters', async () => {
      const mockResult = {
        data: [],
        pagination: { total: 100, page: 2, limit: 10, hasMore: true },
      };

      vi.mocked(service.findAll).mockResolvedValue(mockResult);

      const result = await controller.findAll('me', undefined, undefined, undefined, undefined, '2', '10');

      expect(result.pagination.page).toBe(2);
      expect(result.pagination.limit).toBe(10);
      expect(service.findAll).toHaveBeenCalledWith({
        patientId: undefined,
        doctorId: undefined,
        page: 2,
        limit: 10,
      });
    });

    it('should convert string page and limit to numbers', async () => {
      const mockResult = {
        data: [],
        pagination: { total: 50, page: 3, limit: 15, hasMore: true },
      };

      vi.mocked(service.findAll).mockResolvedValue(mockResult);

      await controller.findAll('me', undefined, undefined, undefined, undefined, '3', '15');

      expect(service.findAll).toHaveBeenCalledWith({
        patientId: undefined,
        doctorId: undefined,
        page: 3,
        limit: 15,
      });
    });
  });

  describe('GET /api/v1/encounters/:id (findOne)', () => {
    it('should return encounter details', async () => {
      const mockEncounter = {
        id: 'enc-1',
        patientId: 'patient-1',
        doctorId: 'doctor-1',
        status: 'SIGNED',
        subjective: 'S',
        objective: 'O',
        assessment: 'A',
        plan: 'P',
        patient: { id: 'patient-1', mrn: 'MRN-001', familyName: '이', givenName: '환자' },
        doctor: { id: 'doctor-1', familyName: '김', givenName: '의사' },
        diagnoses: [],
        prescriptions: [],
      };

      vi.mocked(service.findDetail).mockResolvedValue(mockEncounter);

      const result = await controller.findOne('enc-1');

      expect(result.data.id).toBe('enc-1');
      expect(result.data.status).toBe('SIGNED');
      expect(service.findDetail).toHaveBeenCalledWith('enc-1');
    });

    it('should include full encounter details', async () => {
      const mockEncounter = {
        id: 'enc-1',
        subjective: 'Detailed S',
        objective: 'Detailed O',
        assessment: 'Detailed A',
        plan: 'Detailed P',
        diagnoses: [
          { id: 'encdiag-1', type: 'PRIMARY', diagnosisCode: { code: 'I10' } },
        ],
        prescriptions: [
          { id: 'px-1', medicationCode: { code: 'AM01' } },
        ],
      };

      vi.mocked(service.findDetail).mockResolvedValue(mockEncounter);

      const result = await controller.findOne('enc-1');

      expect(result.data.diagnoses).toHaveLength(1);
      expect(result.data.prescriptions).toHaveLength(1);
    });
  });

  describe('PUT /api/v1/encounters/:id (update)', () => {
    it('should update SOAP notes', async () => {
      const dto = {
        subjective: '수정된 S',
        objective: '수정된 O',
        assessment: '수정된 A',
        plan: '수정된 P',
      };

      const mockEncounter = {
        id: 'enc-1',
        status: 'DRAFT',
        ...dto,
      };

      vi.mocked(service.update).mockResolvedValue(mockEncounter);

      const result = await controller.update('enc-1', dto, 'doc-1');

      expect(result.data.subjective).toBe('수정된 S');
      expect(service.update).toHaveBeenCalledWith('enc-1', dto, 'doc-1'); // 정정한 사람(2026-10-03 서명본 보존)
    });

    it('should update diagnoses', async () => {
      const dto = {
        diagnoses: [
          { diagnosisCodeId: 'new-diag', type: 'PRIMARY' },
        ],
      };

      const mockEncounter = {
        id: 'enc-1',
        status: 'DRAFT',
        diagnoses: [{ diagnosisCodeId: 'new-diag', type: 'PRIMARY' }],
      };

      vi.mocked(service.update).mockResolvedValue(mockEncounter);

      const result = await controller.update('enc-1', dto);

      expect(result.data.diagnoses).toHaveLength(1);
    });

    it('should handle SIGNED to AMENDED conversion', async () => {
      const dto = { subjective: '수정됨' };

      const mockEncounter = {
        id: 'enc-1',
        status: 'AMENDED',
        subjective: '수정됨',
      };

      vi.mocked(service.update).mockResolvedValue(mockEncounter);

      const result = await controller.update('enc-1', dto);

      expect(result.data.status).toBe('AMENDED');
    });
  });

  describe('PATCH /api/v1/encounters/:id/sign (sign)', () => {
    it('should sign encounter', async () => {
      const mockEncounter = {
        id: 'enc-1',
        status: 'SIGNED',
        signedAt: new Date(),
      };

      vi.mocked(service.sign).mockResolvedValue(mockEncounter);

      const result = await controller.sign('enc-1', 'doc-1');

      expect(result.data.status).toBe('SIGNED');
      expect(result.data.signedAt).toBeDefined();
      expect(service.sign).toHaveBeenCalledWith('enc-1', 'doc-1', undefined);
    });

    it('should set signedAt timestamp', async () => {
      const mockEncounter = {
        id: 'enc-1',
        status: 'SIGNED',
        signedAt: new Date('2026-05-13T12:00:00Z'),
      };

      vi.mocked(service.sign).mockResolvedValue(mockEncounter);

      const result = await controller.sign('enc-1', 'doc-1');

      expect(result.data.signedAt).toBeDefined();
    });

    it('should transition from DRAFT to SIGNED', async () => {
      const mockEncounter = {
        id: 'enc-1',
        status: 'SIGNED',
        previousStatus: 'DRAFT',
      };

      vi.mocked(service.sign).mockResolvedValue(mockEncounter);

      const result = await controller.sign('enc-1', 'doc-1');

      expect(result.data.status).toBe('SIGNED');
    });
  });
});

describe('PatientEncounterController', () => {
  let controller: PatientEncounterController;
  let service: EncounterService;

  beforeEach(() => {
    service = {
      findByPatient: vi.fn(),
    } as any;

    controller = new PatientEncounterController(service);
  });

  describe('GET /api/v1/patients/:patientId/encounters (getPatientEncounters)', () => {
    it('should return patient encounters', async () => {
      const mockEncounters = [
        {
          id: 'enc-1',
          patientId: 'patient-1',
          doctorId: 'doctor-1',
          status: 'SIGNED',
          createdAt: new Date('2026-05-10'),
        },
        {
          id: 'enc-2',
          patientId: 'patient-1',
          doctorId: 'doctor-2',
          status: 'DRAFT',
          createdAt: new Date('2026-05-05'),
        },
      ];

      vi.mocked(service.findByPatient).mockResolvedValue(mockEncounters);

      const result = await controller.getPatientEncounters('patient-1');

      expect(result.data).toHaveLength(2);
      expect(result.data[0].patientId).toBe('patient-1');
      expect(service.findByPatient).toHaveBeenCalledWith('patient-1');
    });

    it('should return empty array when no encounters', async () => {
      vi.mocked(service.findByPatient).mockResolvedValue([]);

      const result = await controller.getPatientEncounters('patient-999');

      expect(result.data).toEqual([]);
    });

    it('should include doctor information', async () => {
      const mockEncounters = [
        {
          id: 'enc-1',
          patientId: 'patient-1',
          doctor: {
            id: 'doctor-1',
            familyName: '김',
            givenName: '의사',
          },
        },
      ];

      vi.mocked(service.findByPatient).mockResolvedValue(mockEncounters);

      const result = await controller.getPatientEncounters('patient-1');

      expect(result.data[0].doctor).toBeDefined();
      expect(result.data[0].doctor.familyName).toBe('김');
    });

    it('should include diagnoses information', async () => {
      const mockEncounters = [
        {
          id: 'enc-1',
          patientId: 'patient-1',
          diagnoses: [
            {
              id: 'encdiag-1',
              type: 'PRIMARY',
              diagnosisCode: { code: 'I10', nameKo: '고혈압' },
            },
          ],
        },
      ];

      vi.mocked(service.findByPatient).mockResolvedValue(mockEncounters);

      const result = await controller.getPatientEncounters('patient-1');

      expect(result.data[0].diagnoses).toHaveLength(1);
      expect(result.data[0].diagnoses[0].diagnosisCode.nameKo).toBe('고혈압');
    });

    it('should sort by createdAt descending', async () => {
      const mockEncounters = [
        { id: 'enc-3', createdAt: new Date('2026-05-13') },
        { id: 'enc-2', createdAt: new Date('2026-05-12') },
        { id: 'enc-1', createdAt: new Date('2026-05-11') },
      ];

      vi.mocked(service.findByPatient).mockResolvedValue(mockEncounters);

      const result = await controller.getPatientEncounters('patient-1');

      expect(result.data[0].id).toBe('enc-3');
      expect(result.data[1].id).toBe('enc-2');
      expect(result.data[2].id).toBe('enc-1');
    });
  });
});
