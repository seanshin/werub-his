import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NotFoundException, ForbiddenException } from '@nestjs/common';
import { FhirController } from '../../src/modules/fhir/fhir.controller';
import { FhirPatientMapper } from '../../src/modules/fhir/fhir-patient.mapper';
import { PATIENT_SENSITIVE_OMIT } from '../../src/common/patient-select';

describe('FhirController', () => {
  let controller: FhirController;
  let mockPatientService: any;
  let mockPrisma: any;
  let mockMapper: any;
  let mockLabIngest: any;
  let mockSmartAuth: any;

  beforeEach(() => {
    mockPatientService = {
      findAll: vi.fn(),
      findById: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    };

    mockMapper = {
      toFhir: vi.fn(),
      toCreateDto: vi.fn(),
    };

    mockPrisma = {
      encounter: { findMany: vi.fn(), findUnique: vi.fn() },
      prescription: { findMany: vi.fn(), findUnique: vi.fn() },
      encounterDiagnosis: { findMany: vi.fn(), findUnique: vi.fn() },
    };

    mockLabIngest = {
      ingestReport: vi.fn().mockResolvedValue({ id: 'lir-1', status: 'MATCHED', items: 1 }),
      ingestObservation: vi.fn().mockResolvedValue({ id: 'lir-2', status: 'RECEIVED', items: 1 }),
    };
    // 기본 스코프 충족 + 단건 소유 검증(실서비스 로직을 그대로 위임해 IDOR 회귀를 잡는다)
    mockSmartAuth = {
      hasScope: vi.fn().mockReturnValue(true),
      hasSystemScope: vi.fn().mockReturnValue(false),
      assertPatientAccess: vi.fn((smartClient: any, _rt: string, owner?: string | null) => {
        if (!smartClient) return;                       // 내부 직원 경로
        if (!smartClient.patient) throw new ForbiddenException('환자 컨텍스트 필요');
        if (!owner || owner !== smartClient.patient) throw new ForbiddenException('IDOR 차단');
      }),
    };

    controller = new FhirController(mockPatientService, mockMapper, mockPrisma, mockLabIngest, mockSmartAuth);
  });

  describe('getCapabilityStatement', () => {
    it('should return CapabilityStatement with FHIR R4 metadata', () => {
      const result = controller.getCapabilityStatement();

      expect(result.resourceType).toBe('CapabilityStatement');
      expect(result.fhirVersion).toBe('4.0.1');
      expect(result.status).toBe('active');
    });

    it('should return server kind', () => {
      const result = controller.getCapabilityStatement();

      expect(result.kind).toBe('instance');
    });

    it('should include JSON format', () => {
      const result = controller.getCapabilityStatement();

      expect(result.format).toContain('json');
    });

    it('should include security description with JWT', () => {
      const result = controller.getCapabilityStatement();
      const security = result.rest[0].security;

      expect(security.description).toContain('JWT');
    });

    it('should define Patient resource with CRUD interactions', () => {
      const result = controller.getCapabilityStatement();
      const patientResource = result.rest[0].resource.find((r) => r.type === 'Patient');

      expect(patientResource).toBeDefined();
      expect(patientResource.interaction.map((i) => i.code)).toEqual(
        expect.arrayContaining(['read', 'search-type', 'create', 'update']),
      );
    });

    it('should define Patient search parameters', () => {
      const result = controller.getCapabilityStatement();
      const patientResource = result.rest[0].resource.find((r) => r.type === 'Patient');
      const searchParams = patientResource.searchParam.map((p) => p.name);

      expect(searchParams).toContain('name');
      expect(searchParams).toContain('identifier');
      expect(searchParams).toContain('birthdate');
      expect(searchParams).toContain('gender');
    });

    it('should define Encounter resource', () => {
      const result = controller.getCapabilityStatement();
      const encounterResource = result.rest[0].resource.find((r) => r.type === 'Encounter');

      expect(encounterResource).toBeDefined();
      expect(encounterResource.interaction.map((i) => i.code)).toEqual(
        expect.arrayContaining(['read', 'search-type']),
      );
    });

    it('should define MedicationRequest resource', () => {
      const result = controller.getCapabilityStatement();
      const mrResource = result.rest[0].resource.find((r) => r.type === 'MedicationRequest');

      expect(mrResource).toBeDefined();
    });

    it('should define Condition resource', () => {
      const result = controller.getCapabilityStatement();
      const conditionResource = result.rest[0].resource.find((r) => r.type === 'Condition');

      expect(conditionResource).toBeDefined();
    });
  });

  describe('searchPatients', () => {
    it('should search patients without filters', async () => {
      const mockPatients = [{ id: 'p-1', mrn: 'MRN001' }];
      mockPatientService.findAll.mockResolvedValue({
        data: mockPatients,
        pagination: { total: 1 },
      });
      mockMapper.toFhir.mockReturnValue({
        resourceType: 'Patient',
        id: 'p-1',
      });

      const result = await controller.searchPatients();

      expect(result.resourceType).toBe('Bundle');
      expect(result.type).toBe('searchset');
      expect(result.total).toBe(1);
    });

    it('should search patients by name', async () => {
      mockPatientService.findAll.mockResolvedValue({
        data: [],
        pagination: { total: 0 },
      });

      await controller.searchPatients('김철수');

      expect(mockPatientService.findAll).toHaveBeenCalledWith(
        expect.objectContaining({
          q: '김철수',
        }),
      );
    });

    it('should search patients by identifier (MRN)', async () => {
      mockPatientService.findAll.mockResolvedValue({
        data: [],
        pagination: { total: 0 },
      });

      await controller.searchPatients(undefined, 'MRN001');

      expect(mockPatientService.findAll).toHaveBeenCalledWith(
        expect.objectContaining({
          mrn: 'MRN001',
        }),
      );
    });

    it('should search patients by gender', async () => {
      mockPatientService.findAll.mockResolvedValue({
        data: [],
        pagination: { total: 0 },
      });

      await controller.searchPatients(undefined, undefined, undefined, 'male');

      expect(mockPatientService.findAll).toHaveBeenCalledWith(
        expect.objectContaining({
          gender: 'MALE',
        }),
      );
    });

    it('should return Bundle with entries mapped via mapper', async () => {
      const mockPatients = [{ id: 'p-1' }, { id: 'p-2' }];
      mockPatientService.findAll.mockResolvedValue({
        data: mockPatients,
        pagination: { total: 2 },
      });
      mockMapper.toFhir.mockReturnValue({ resourceType: 'Patient' });

      const result = await controller.searchPatients();

      expect(result.entry).toHaveLength(2);
      expect(result.entry[0].resource.resourceType).toBe('Patient');
    });
  });

  describe('getPatient', () => {
    it('should return FHIR Patient by ID', async () => {
      const mockPatient = { id: 'p-1', mrn: 'MRN001' };
      mockPatientService.findById.mockResolvedValue(mockPatient);
      mockMapper.toFhir.mockReturnValue({
        resourceType: 'Patient',
        id: 'p-1',
      });

      const result = await controller.getPatient('p-1', {} as never);

      expect(result.resourceType).toBe('Patient');
      expect(mockPatientService.findById).toHaveBeenCalledWith('p-1');
    });

    it('should throw NotFoundException if patient not found', async () => {
      mockPatientService.findById.mockResolvedValue(null);

      await expect(controller.getPatient('p-999', {} as never)).rejects.toThrow(NotFoundException);
    });

    it('should call mapper to convert patient to FHIR', async () => {
      const mockPatient = { id: 'p-1' };
      mockPatientService.findById.mockResolvedValue(mockPatient);
      mockMapper.toFhir.mockReturnValue({ resourceType: 'Patient' });

      await controller.getPatient('p-1', {} as never);

      expect(mockMapper.toFhir).toHaveBeenCalledWith(mockPatient);
    });
  });

  describe('createPatient', () => {
    it('should create patient from FHIR Patient', async () => {
      const fhirPatient = {
        resourceType: 'Patient' as const,
        name: [{ family: 'Kim', given: ['Chulsu'] }],
        gender: 'male' as const,
        birthDate: '1990-01-01',
      };
      const createDto = { familyName: 'Kim', givenName: 'Chulsu' };
      const createdPatient = { id: 'p-1', ...createDto };

      mockMapper.toCreateDto.mockReturnValue(createDto);
      mockPatientService.create.mockResolvedValue(createdPatient);
      mockMapper.toFhir.mockReturnValue({
        resourceType: 'Patient',
        id: 'p-1',
      });

      const result = await controller.createPatient(fhirPatient, 'user-1');

      expect(mockMapper.toCreateDto).toHaveBeenCalledWith(fhirPatient);
      expect(mockPatientService.create).toHaveBeenCalledWith(createDto, 'user-1');
      expect(result.resourceType).toBe('Patient');
    });

    it('should inject currentUser ID to create method', async () => {
      const fhirPatient = { resourceType: 'Patient' as const };
      mockMapper.toCreateDto.mockReturnValue({});
      mockPatientService.create.mockResolvedValue({});
      mockMapper.toFhir.mockReturnValue({ resourceType: 'Patient' });

      await controller.createPatient(fhirPatient, 'user-123');

      expect(mockPatientService.create).toHaveBeenCalledWith(
        expect.any(Object),
        'user-123',
      );
    });
  });

  describe('updatePatient', () => {
    it('should update patient by ID', async () => {
      const fhirPatient = {
        resourceType: 'Patient' as const,
        name: [{ family: 'Kim', given: ['Chulsu'] }],
      };
      const updateDto = { familyName: 'Kim', givenName: 'Chulsu' };
      const updatedPatient = { id: 'p-1', ...updateDto };

      mockMapper.toCreateDto.mockReturnValue(updateDto);
      mockPatientService.update.mockResolvedValue(updatedPatient);
      mockMapper.toFhir.mockReturnValue({
        resourceType: 'Patient',
        id: 'p-1',
      });

      const result = await controller.updatePatient('p-1', fhirPatient, 'user-1');

      expect(mockPatientService.update).toHaveBeenCalledWith('p-1', updateDto, 'user-1');
      expect(result.resourceType).toBe('Patient');
    });

    it('should inject currentUser ID to update method', async () => {
      const fhirPatient = { resourceType: 'Patient' as const };
      mockMapper.toCreateDto.mockReturnValue({});
      mockPatientService.update.mockResolvedValue({});
      mockMapper.toFhir.mockReturnValue({ resourceType: 'Patient' });

      await controller.updatePatient('p-1', fhirPatient, 'user-456');

      expect(mockPatientService.update).toHaveBeenCalledWith(
        'p-1',
        expect.any(Object),
        'user-456',
      );
    });
  });

  describe('searchEncounters', () => {
    it('should search encounters without filters', async () => {
      mockPrisma.encounter.findMany.mockResolvedValue([]);

      const result = await controller.searchEncounters();

      expect(result.resourceType).toBe('Bundle');
      expect(result.type).toBe('searchset');
    });

    it('should filter encounters by subject patient ID', async () => {
      mockPrisma.encounter.findMany.mockResolvedValue([]);

      await controller.searchEncounters('Patient/p-1');

      expect(mockPrisma.encounter.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            patientId: 'p-1',
          }),
        }),
      );
    });

    it('should accept subject without Patient/ prefix', async () => {
      mockPrisma.encounter.findMany.mockResolvedValue([]);

      await controller.searchEncounters('p-1');

      expect(mockPrisma.encounter.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            patientId: 'p-1',
          }),
        }),
      );
    });

    it('should map FHIR status to internal status', async () => {
      mockPrisma.encounter.findMany.mockResolvedValue([]);

      await controller.searchEncounters(undefined, 'finished');

      expect(mockPrisma.encounter.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            // 2026-10-01 — 종료(finished)는 서명·정정 진료 둘 다(정정은 기록의 사실이지 방문 상태가 아니다)
            status: { in: ['SIGNED', 'AMENDED'] },
          }),
        }),
      );
    });

    it('should include relations in query', async () => {
      mockPrisma.encounter.findMany.mockResolvedValue([]);

      await controller.searchEncounters();

      expect(mockPrisma.encounter.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: expect.objectContaining({
            patient: { omit: PATIENT_SENSITIVE_OMIT },
            doctor: true,
          }),
        }),
      );
    });

    it('should order encounters by date descending', async () => {
      mockPrisma.encounter.findMany.mockResolvedValue([]);

      await controller.searchEncounters();

      expect(mockPrisma.encounter.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { createdAt: 'desc' },
        }),
      );
    });

    it('should return Bundle entries with mapped encounters', async () => {
      const mockEncounters = [
        {
          id: 'e-1',
          patient: { familyName: 'Kim', givenName: 'Chul' },
          doctor: { familyName: 'Lee', givenName: 'Soon' },
          patientId: 'p-1',
          doctorId: 'd-1',
          status: 'SIGNED',
          createdAt: new Date(),
        },
      ];
      mockPrisma.encounter.findMany.mockResolvedValue(mockEncounters);

      const result = await controller.searchEncounters();

      expect(result.entry).toHaveLength(1);
      expect(result.total).toBe(1);
    });
  });

  describe('getEncounter', () => {
    it('should return FHIR Encounter by ID', async () => {
      const mockEncounter = {
        id: 'e-1',
        patient: { familyName: 'Kim', givenName: 'Chul' },
        doctor: { familyName: 'Lee', givenName: 'Soon' },
        status: 'SIGNED',
        createdAt: new Date(),
      };
      mockPrisma.encounter.findUnique.mockResolvedValue(mockEncounter);

      const result = await controller.getEncounter('e-1', {} as never);

      expect(result.resourceType).toBe('Encounter');
      expect(result.id).toBe('e-1');
    });

    it('should throw NotFoundException if encounter not found', async () => {
      mockPrisma.encounter.findUnique.mockResolvedValue(null);

      await expect(controller.getEncounter('e-999', {} as never)).rejects.toThrow(NotFoundException);
    });

    it('should include all relations', async () => {
      mockPrisma.encounter.findUnique.mockResolvedValue({
        id: 'e-1',
        patient: {},
        doctor: {},
        appointment: {},
        diagnoses: [],
        status: 'SIGNED',
        createdAt: new Date(),
      });

      await controller.getEncounter('e-1', {} as never);

      expect(mockPrisma.encounter.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          include: expect.objectContaining({
            patient: { omit: PATIENT_SENSITIVE_OMIT },
            doctor: true,
            appointment: true,
          }),
        }),
      );
    });
  });

  describe('searchMedicationRequests', () => {
    it('should search medication requests with type MEDICATION filter', async () => {
      mockPrisma.prescription.findMany.mockResolvedValue([]);

      await controller.searchMedicationRequests();

      expect(mockPrisma.prescription.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            type: 'MEDICATION',
          }),
        }),
      );
    });

    it('should filter by subject patient ID', async () => {
      mockPrisma.prescription.findMany.mockResolvedValue([]);

      await controller.searchMedicationRequests('Patient/p-1');

      expect(mockPrisma.prescription.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            encounter: { patientId: 'p-1' },
          }),
        }),
      );
    });

    it('should filter by encounter ID', async () => {
      mockPrisma.prescription.findMany.mockResolvedValue([]);

      await controller.searchMedicationRequests(undefined, 'Encounter/e-1');

      expect(mockPrisma.prescription.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            encounterId: 'e-1',
          }),
        }),
      );
    });

    it('should include medication code relations', async () => {
      mockPrisma.prescription.findMany.mockResolvedValue([]);

      await controller.searchMedicationRequests();

      expect(mockPrisma.prescription.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: expect.objectContaining({
            medicationCode: true,
          }),
        }),
      );
    });

    it('should filter out prescriptions without medication code', async () => {
      const mockRx = [
        {
          id: 'rx-1',
          status: 'ACTIVE',
          medicationCode: { code: 'ASPIRIN', nameKo: '아스피린' },
          encounter: { patientId: 'p-1', doctorId: 'd-1', doctor: {} },
          createdAt: new Date(),
        },
        {
          id: 'rx-2',
          status: 'ACTIVE',
          medicationCode: null,
          encounter: { patientId: 'p-1', doctorId: 'd-1', doctor: {} },
          createdAt: new Date(),
        },
      ];
      mockPrisma.prescription.findMany.mockResolvedValue(mockRx);

      const result = await controller.searchMedicationRequests();

      expect(result.entry).toHaveLength(1);
    });
  });

  describe('getMedicationRequest', () => {
    it('should return FHIR MedicationRequest by ID', async () => {
      const mockRx = {
        id: 'rx-1',
        status: 'ACTIVE',
        medicationCode: { code: 'ASPIRIN', nameKo: '아스피린' },
        encounter: { patientId: 'p-1', doctorId: 'd-1', doctor: {} },
        createdAt: new Date(),
      };
      mockPrisma.prescription.findUnique.mockResolvedValue(mockRx);

      const result = await controller.getMedicationRequest('rx-1', {} as never);

      expect(result.resourceType).toBe('MedicationRequest');
      expect(result.id).toBe('rx-1');
    });

    it('should throw NotFoundException if prescription not found', async () => {
      mockPrisma.prescription.findUnique.mockResolvedValue(null);

      await expect(controller.getMedicationRequest('rx-999', {} as never)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw NotFoundException if medication code missing', async () => {
      mockPrisma.prescription.findUnique.mockResolvedValue({
        id: 'rx-1',
        medicationCode: null,
      });

      await expect(controller.getMedicationRequest('rx-1', {} as never)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('searchConditions', () => {
    it('should search conditions (diagnoses)', async () => {
      mockPrisma.encounterDiagnosis.findMany.mockResolvedValue([]);

      const result = await controller.searchConditions();

      expect(result.resourceType).toBe('Bundle');
      expect(result.type).toBe('searchset');
    });

    it('should filter conditions by subject patient ID', async () => {
      mockPrisma.encounterDiagnosis.findMany.mockResolvedValue([]);

      await controller.searchConditions('Patient/p-1');

      expect(mockPrisma.encounterDiagnosis.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            encounter: { patientId: 'p-1' },
          }),
        }),
      );
    });

    it('should include diagnosis code relations', async () => {
      mockPrisma.encounterDiagnosis.findMany.mockResolvedValue([]);

      await controller.searchConditions();

      expect(mockPrisma.encounterDiagnosis.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: expect.objectContaining({
            diagnosisCode: true,
          }),
        }),
      );
    });

    it('should limit results to 100', async () => {
      mockPrisma.encounterDiagnosis.findMany.mockResolvedValue([]);

      await controller.searchConditions();

      expect(mockPrisma.encounterDiagnosis.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 100,
        }),
      );
    });
  });

  describe('getCondition', () => {
    it('should return FHIR Condition (diagnosis) by ID', async () => {
      const mockDiagnosis = {
        id: 'd-1',
        diagnosisCode: {
          code: 'E11',
          nameKo: '당뇨병',
          icd10Code: 'E11.9',
        },
        encounter: { patientId: 'p-1', createdAt: new Date() },
      };
      mockPrisma.encounterDiagnosis.findUnique.mockResolvedValue(mockDiagnosis);

      const result = await controller.getCondition('d-1', {} as never);

      expect(result.resourceType).toBe('Condition');
      expect(result.id).toBe('d-1');
    });

    it('should throw NotFoundException if diagnosis not found', async () => {
      mockPrisma.encounterDiagnosis.findUnique.mockResolvedValue(null);

      await expect(controller.getCondition('d-999', {} as never)).rejects.toThrow(NotFoundException);
    });

    it('should include diagnosis code with ICD-10 preference', async () => {
      const mockDiagnosis = {
        id: 'd-1',
        diagnosisCode: {
          code: 'E11',
          icd10Code: 'E11.9',
          nameKo: '당뇨병',
        },
        encounter: { patientId: 'p-1', createdAt: new Date() },
      };
      mockPrisma.encounterDiagnosis.findUnique.mockResolvedValue(mockDiagnosis);

      const result = await controller.getCondition('d-1', {} as never);

      expect(result.code.coding[0].code).toBe('E11.9');
      expect(result.code.coding[0].system).toBe('http://hl7.org/fhir/sid/icd-10');
    });

    it('should use KCD-8 code when ICD-10 not available', async () => {
      const mockDiagnosis = {
        id: 'd-1',
        diagnosisCode: {
          code: 'E11',
          icd10Code: null,
          nameKo: '당뇨병',
        },
        encounter: { patientId: 'p-1', createdAt: new Date() },
      };
      mockPrisma.encounterDiagnosis.findUnique.mockResolvedValue(mockDiagnosis);

      const result = await controller.getCondition('d-1', {} as never);

      expect(result.code.coding[0].code).toBe('E11');
    });
  });

  describe('FHIR R4 Compliance', () => {
    it('should use correct FHIR resource types', async () => {
      const capStatement = controller.getCapabilityStatement();

      expect(capStatement.resourceType).toBe('CapabilityStatement');
      expect(capStatement.rest[0].resource.map((r) => r.type)).toContain('Patient');
      expect(capStatement.rest[0].resource.map((r) => r.type)).toContain('Encounter');
      expect(capStatement.rest[0].resource.map((r) => r.type)).toContain('MedicationRequest');
      expect(capStatement.rest[0].resource.map((r) => r.type)).toContain('Condition');
    });

    it('should use FHIR search parameters', async () => {
      mockPrisma.encounter.findMany.mockResolvedValue([]);

      await controller.searchEncounters('Patient/p-1');

      expect(mockPrisma.encounter.findMany).toHaveBeenCalled();
    });

    it('should return JSON format only', () => {
      const capStatement = controller.getCapabilityStatement();

      expect(capStatement.format).toEqual(['json']);
    });
  });

  describe('Error Handling', () => {
    it('should throw NotFoundException for missing patients', async () => {
      mockPatientService.findById.mockResolvedValue(null);

      await expect(controller.getPatient('p-999', {} as never)).rejects.toThrow('Patient not found');
    });

    it('should throw NotFoundException for missing encounters', async () => {
      mockPrisma.encounter.findUnique.mockResolvedValue(null);

      await expect(controller.getEncounter('e-999', {} as never)).rejects.toThrow('Encounter not found');
    });

    it('should throw NotFoundException for missing prescriptions', async () => {
      mockPrisma.prescription.findUnique.mockResolvedValue(null);

      await expect(controller.getMedicationRequest('rx-999', {} as never)).rejects.toThrow(
        'MedicationRequest not found',
      );
    });

    it('should throw NotFoundException for missing diagnoses', async () => {
      mockPrisma.encounterDiagnosis.findUnique.mockResolvedValue(null);

      await expect(controller.getCondition('d-999', {} as never)).rejects.toThrow('Condition not found');
    });
  });

  describe('searchServiceRequests (오더 LOINC)', () => {
    it('procedureCode.loincCode 있으면 ServiceRequest.code에 LOINC 병기', async () => {
      mockPrisma.order = { findMany: vi.fn().mockResolvedValue([
        { id: 'ord-1', status: 'ORDERED', department: 'LAB', priority: 'ROUTINE', createdAt: new Date(),
          prescription: { procedureCode: { code: 'E6591', nameKo: 'HbA1c', loincCode: '4548-4' }, encounter: { id: 'e1', patientId: 'p1', doctorId: 'd1', doctor: null } } },
      ]) };
      const res: any = await controller.searchServiceRequests(undefined, undefined, 'laboratory');
      const codings = res.entry[0].resource.code.coding;
      expect(codings[0]).toEqual(expect.objectContaining({ system: 'http://loinc.org', code: '4548-4' }));
      expect(codings.some((c: any) => c.system === 'urn:hospital-run:procedure' && c.code === 'E6591')).toBe(true);
    });
  });

  describe('searchObservations (트윈 GCS·Child-Pugh 병합)', () => {
    beforeEach(() => {
      mockPrisma.labResultItem = { findMany: vi.fn().mockResolvedValue([]) };
      mockPrisma.preVisitVitals = { findMany: vi.fn().mockResolvedValue([]) };
      mockPrisma.flowSheetEntry = { findMany: vi.fn().mockResolvedValue([]) };
      mockPrisma.internalMedicineExam = { findMany: vi.fn().mockResolvedValue([]) };
      mockPrisma.haiCase = { findMany: vi.fn().mockResolvedValue([]) };
    });

    it('patient 지정 시 GCS/의식(FlowSheet)·Child-Pugh(InternalMedicineExam) 병합', async () => {
      mockPrisma.flowSheetEntry.findMany.mockResolvedValue([{ id: 'fs-1', gcsScore: 11, consciousness: 'CONFUSION', recordedAt: new Date() }]);
      mockPrisma.internalMedicineExam.findMany.mockResolvedValue([{ id: 'im-1', childPughScore: 9, childPughClass: 'B', ascites: 'MODERATE', meldScore: 15, examinedAt: new Date() }]);
      const res: any = await controller.searchObservations('pat-1', undefined, undefined, undefined);
      const codes = res.entry.map((e: any) => (e.resource.code.coding[0].code));
      expect(codes).toContain('9269-2'); // GCS
      expect(codes).toContain('80288-4'); // 의식수준
      expect(codes).toContain('child-pugh-score');
      expect(codes).toContain('ascites');
      expect(codes).toContain('meld-score');
      // GCS는 valueInteger, 복수는 valueCodeableConcept
      const gcs = res.entry.find((e: any) => e.resource.code.coding[0].code === '9269-2').resource;
      expect(gcs.valueInteger).toBe(11);
    });

    it('HaiCase 중심정맥관 → 유치기구 Observation(central-line)', async () => {
      mockPrisma.haiCase.findMany.mockResolvedValue([{ id: 'hai-1', deviceType: 'CENTRAL_LINE', deviceInsertedAt: new Date(), deviceDays: 5 }]);
      const res: any = await controller.searchObservations('pat-1', undefined, undefined, undefined);
      const dev = res.entry.find((e: any) => e.resource.code.coding[0].code === 'central-line');
      expect(dev).toBeTruthy();
      expect(dev.resource.code.coding[0].system).toBe('urn:hospital-run:device');
      expect(dev.resource.valueCodeableConcept.text).toContain('5d');
    });

    it('code=9269-2 필터 시 GCS만 반환', async () => {
      mockPrisma.flowSheetEntry.findMany.mockResolvedValue([{ id: 'fs-1', gcsScore: 8, consciousness: 'PAIN', recordedAt: new Date() }]);
      const res: any = await controller.searchObservations('pat-1', '9269-2', undefined, undefined);
      expect(res.entry).toHaveLength(1);
      expect(res.entry[0].resource.code.coding[0].code).toBe('9269-2');
    });

    it('code 필터가 LOINC/testCode/testName 어느 것으로도 매칭', async () => {
      await controller.searchObservations('pat-1', '2951-2', undefined, 'laboratory');
      expect(mockPrisma.labResultItem.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ OR: [{ loincCode: '2951-2' }, { testCode: '2951-2' }, { testName: '2951-2' }] }) }),
      );
    });

    it('결과에 loincCode 있으면 Observation.code에 LOINC 병기', async () => {
      mockPrisma.labResultItem.findMany.mockResolvedValue([
        { id: 'it-1', testName: '칼륨', testCode: '2823-3', loincCode: '2823-3', value: '5.0', unit: 'mmol/L', labResult: { status: 'VERIFIED', patientId: 'p1' } },
      ]);
      const res: any = await controller.searchObservations('pat-1', undefined, undefined, 'laboratory');
      const codings = res.entry[0].resource.code.coding;
      expect(codings[0]).toEqual(expect.objectContaining({ system: 'http://loinc.org', code: '2823-3' }));
      expect(res.entry[0].resource.status).toBe('final'); // VERIFIED→final
    });

    it('patient 미지정 시 비검사 관측치 스캔 안 함(전역 방지)', async () => {
      await controller.searchObservations(undefined, undefined, undefined, undefined);
      expect(mockPrisma.flowSheetEntry.findMany).not.toHaveBeenCalled();
      expect(mockPrisma.internalMedicineExam.findMany).not.toHaveBeenCalled();
    });

    it('🔴 활력징후가 vital-signs 로 나온다 — 종전 GCS 만 반환하고 활력은 0건이던 갭', async () => {
      mockPrisma.preVisitVitals.findMany.mockResolvedValue([{
        id: 'pv-1', systolicBp: 128, diastolicBp: 82, heartRate: 96, temperature: 38.199999999999996,
        spo2: 97, respiratoryRate: 18, weight: 64.25, height: 170, bmi: 22.23, painScore: 4,
        measuredAt: new Date('2026-08-10T01:00:00Z'),
      }]);
      const res: any = await controller.searchObservations('pat-1', undefined, undefined, 'vital-signs');
      const byCode = (c: string) => res.entry.map((e: any) => e.resource).find((r: any) => r.code.coding[0].code === c);

      // 체온 — 정책 반올림(소수1·부동소수점 잔차 제거) + UCUM Cel
      expect(byCode('8310-5').valueQuantity).toEqual({ value: 38.2, unit: '℃', system: 'http://unitsofmeasure.org', code: 'Cel' });
      // 맥박 — 표시 bpm, UCUM /min (표시와 UCUM 이 다르다)
      expect(byCode('8867-4').valueQuantity).toEqual({ value: 96, unit: 'bpm', system: 'http://unitsofmeasure.org', code: '/min' });
      expect(byCode('59408-5').valueQuantity.value).toBe(97);
      expect(byCode('9279-1').valueQuantity.value).toBe(18);
      // 체중 소수1 반올림 · BMI 소수1
      expect(byCode('29463-7').valueQuantity.value).toBe(64.3);
      expect(byCode('39156-5').valueQuantity).toEqual({ value: 22.2, unit: 'kg/m²', system: 'http://unitsofmeasure.org', code: 'kg/m2' });
      // 전부 vital-signs 범주
      expect(byCode('8310-5').category[0].coding[0].code).toBe('vital-signs');
    });

    it('🔴 혈압은 패널(85354-9)+component 2종 — FHIR Vital Signs 프로파일', async () => {
      mockPrisma.preVisitVitals.findMany.mockResolvedValue([{
        id: 'pv-1', systolicBp: 128, diastolicBp: 82, measuredAt: new Date('2026-08-10T01:00:00Z'),
      }]);
      const res: any = await controller.searchObservations('pat-1', undefined, undefined, 'vital-signs');
      const bp = res.entry.map((e: any) => e.resource).find((r: any) => r.code.coding[0].code === '85354-9');
      expect(bp.component).toHaveLength(2);
      expect(bp.component[0].code.coding[0].code).toBe('8480-6');
      expect(bp.component[0].valueQuantity).toEqual({ value: 128, unit: 'mmHg', system: 'http://unitsofmeasure.org', code: 'mm[Hg]' });
      expect(bp.component[1].valueQuantity).toEqual({ value: 82, unit: 'mmHg', system: 'http://unitsofmeasure.org', code: 'mm[Hg]' });
    });

    it('component 코드로도 code 질의가 매칭된다(code=8480-6)', async () => {
      mockPrisma.preVisitVitals.findMany.mockResolvedValue([{ id: 'pv-1', systolicBp: 128, diastolicBp: 82, heartRate: 70, measuredAt: new Date() }]);
      const res: any = await controller.searchObservations('pat-1', '8480-6', undefined, 'vital-signs');
      expect(res.entry).toHaveLength(1);
      expect(res.entry[0].resource.code.coding[0].code).toBe('85354-9');
    });

    it('미측정 항목은 관측치를 만들지 않는다(빈 Observation 금지)', async () => {
      mockPrisma.preVisitVitals.findMany.mockResolvedValue([{ id: 'pv-1', heartRate: 70, measuredAt: new Date() }]);
      const res: any = await controller.searchObservations('pat-1', undefined, undefined, 'vital-signs');
      const codes = res.entry.map((e: any) => e.resource.code.coding[0].code);
      expect(codes).toEqual(['8867-4']); // 맥박만
    });

    it('🔴 검사 단위는 UCUM 을 아는 것만 표준 선언 — 모르면 unit 만(허위 표기 금지)', async () => {
      mockPrisma.labResultItem.findMany.mockResolvedValue([
        { id: 'it-1', testName: 'WBC', testCode: 'W1', value: '6.4', unit: '10^3/μL', normalMin: 4, normalMax: 10, labResult: { status: 'VERIFIED', patientId: 'p1' } },
        { id: 'it-2', testName: '희귀단위', testCode: 'X1', value: '3', unit: 'SICU', labResult: { status: 'VERIFIED', patientId: 'p1' } },
      ]);
      const res: any = await controller.searchObservations('pat-1', undefined, undefined, 'laboratory');
      const wbc = res.entry[0].resource;
      // 표시형 10^3/μL → UCUM 10*3/uL (그대로 실어보내면 외부가 못 읽는다)
      expect(wbc.valueQuantity).toEqual({ value: 6.4, unit: '10^3/μL', system: 'http://unitsofmeasure.org', code: '10*3/uL' });
      // 참조범위(Prisma Decimal)도 유실 없이 같은 단위 규약
      expect(wbc.referenceRange[0].low).toEqual({ value: 4, unit: '10^3/μL', system: 'http://unitsofmeasure.org', code: '10*3/uL' });
      expect(wbc.referenceRange[0].high.value).toBe(10);

      const unknown = res.entry[1].resource;
      expect(unknown.valueQuantity).toEqual({ value: 3, unit: 'SICU' });
      expect(unknown.valueQuantity.system).toBeUndefined();
    });

    it('[P1] date 파라미터 → 소스별 gte 필터 적용(무시되던 것 구현)', async () => {
      await controller.searchObservations('pat-1', undefined, '2026-07-01', undefined);
      expect(mockPrisma.labResultItem.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ labResult: expect.objectContaining({ completedAt: { gte: expect.any(Date) } }) }) }),
      );
      expect(mockPrisma.flowSheetEntry.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ recordedAt: { gte: expect.any(Date) } }) }),
      );
    });
  });

  describe('getObservation (합성 id 방어)', () => {
    it('[P1] 검색 반환 합성 id(gcs-..) 조회 → 404(500 아님)', async () => {
      await expect(controller.getObservation('gcs-3f9a1234')).rejects.toThrow(NotFoundException);
      await expect(controller.getObservation('dev-abc')).rejects.toThrow(NotFoundException);
    });
  });

  describe('searchDiagnosticReports (LIS 대사)', () => {
    beforeEach(() => {
      mockPrisma.labResult = { findMany: vi.fn().mockResolvedValue([]) };
      mockPrisma.labInterfaceResult = { findMany: vi.fn().mockResolvedValue([]) };
    });

    it('based-on=ServiceRequest/{id} → orderId 필터', async () => {
      await controller.searchDiagnosticReports(undefined, undefined, 'ServiceRequest/ord-1', undefined);
      expect(mockPrisma.labResult.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ orderId: 'ord-1' }) }),
      );
    });

    it('identifier=바코드 → 스테이징 역해소 후 orderId in [...]', async () => {
      mockPrisma.labInterfaceResult.findMany.mockResolvedValue([{ matchedOrderId: 'ord-A' }, { matchedOrderId: 'ord-B' }]);
      await controller.searchDiagnosticReports(undefined, undefined, undefined, 'S-0090');
      expect(mockPrisma.labInterfaceResult.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { sampleBarcode: 'S-0090' } }),
      );
      expect(mockPrisma.labResult.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ orderId: { in: ['ord-A', 'ord-B'] } }) }),
      );
    });

    it('identifier 매칭 오더 없으면 결과 없음(sentinel)', async () => {
      mockPrisma.labInterfaceResult.findMany.mockResolvedValue([]);
      await controller.searchDiagnosticReports(undefined, undefined, undefined, 'UNKNOWN');
      expect(mockPrisma.labResult.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ orderId: '00000000-0000-0000-0000-000000000000' }) }),
      );
    });
  });

  describe('processBundle (LIS 검사결과 라우팅)', () => {
    const smartReq = { smartClient: { client_id: 'lis-1' } };

    it('SMART Bundle: DiagnosticReport(result 참조)+Observation → 검사 파이프라인 라우팅', async () => {
      const bundle: any = {
        type: 'transaction',
        entry: [
          { fullUrl: 'urn:uuid:obs-1', resource: { resourceType: 'Observation', id: 'obs-1', code: { coding: [{ code: '2823-3' }] }, valueQuantity: { value: 6.8 } }, request: { method: 'POST', url: 'Observation' } },
          { resource: { resourceType: 'DiagnosticReport', result: [{ reference: 'urn:uuid:obs-1' }] }, request: { method: 'POST', url: 'DiagnosticReport' } },
        ],
      };
      const res: any = await controller.processBundle(bundle, undefined as any, smartReq as any);
      // Observation은 report에 소비됨 → 200 ack, DiagnosticReport → 201
      expect(mockLabIngest.ingestReport).toHaveBeenCalledTimes(1);
      const [, obsArg] = mockLabIngest.ingestReport.mock.calls[0];
      expect(obsArg).toHaveLength(1); // 참조 해소된 Observation 1건
      expect(res.entry[0].response.status).toBe('200 OK');
      expect(res.entry[1].response.status).toBe('201 Created');
      expect(mockLabIngest.ingestObservation).not.toHaveBeenCalled();
    });

    it('[P2] DiagnosticReport result[] 미해소 참조 → 경고 outcome(무음 누락 방지)', async () => {
      const bundle: any = {
        type: 'transaction',
        entry: [
          // 참조 2개 중 obs-1만 번들에 존재, urn:uuid:obs-2는 부재(미해소)
          { fullUrl: 'urn:uuid:obs-1', resource: { resourceType: 'Observation', id: 'obs-1', code: { coding: [{ code: '2823-3' }] }, valueQuantity: { value: 6.8 } }, request: { method: 'POST', url: 'Observation' } },
          { resource: { resourceType: 'DiagnosticReport', result: [{ reference: 'urn:uuid:obs-1' }, { reference: 'urn:uuid:obs-2' }] }, request: { method: 'POST', url: 'DiagnosticReport' } },
        ],
      };
      const res: any = await controller.processBundle(bundle, undefined as any, smartReq as any);
      const drEntry = res.entry[1];
      expect(drEntry.response.status).toBe('201 Created');
      expect(drEntry.response.outcome?.issue?.[0]?.severity).toBe('warning');
      expect(drEntry.response.outcome?.issue?.[0]?.code).toBe('incomplete');
    });

    it('[스코프] DiagnosticReport.write 스코프 없으면 403(Bundle.write만으론 결과 쓰기 불가)', async () => {
      mockSmartAuth.hasScope.mockReturnValue(false); // DiagnosticReport.write 미보유
      const bundle: any = {
        type: 'transaction',
        entry: [{ resource: { resourceType: 'DiagnosticReport', result: [] }, request: { method: 'POST', url: 'DiagnosticReport' } }],
      };
      const res: any = await controller.processBundle(bundle, undefined as any, smartReq as any);
      expect(res.entry[0].response.status).toContain('403');
      expect(mockLabIngest.ingestReport).not.toHaveBeenCalled();
    });

    it('SMART 클라이언트의 Patient 생성은 차단(422 응답)', async () => {
      const bundle: any = {
        type: 'transaction',
        entry: [{ resource: { resourceType: 'Patient', name: [{ family: 'X' }] }, request: { method: 'POST', url: 'Patient' } }],
      };
      const res: any = await controller.processBundle(bundle, undefined as any, smartReq as any);
      expect(res.entry[0].response.status).toContain('403'); // 진단 전달 개선(2026-07-15) — 예외 status 그대로 노출(구 422 뭉개기 폐지)
      expect(mockPatientService.create).not.toHaveBeenCalled();
    });

    it('소비되지 않은 단독 Observation은 단건 스테이징(201)', async () => {
      const bundle: any = {
        type: 'transaction',
        entry: [{ fullUrl: 'urn:uuid:o9', resource: { resourceType: 'Observation', id: 'o9', code: { coding: [{ code: '718-7' }] }, valueQuantity: { value: 8 } }, request: { method: 'POST', url: 'Observation' } }],
      };
      const res: any = await controller.processBundle(bundle, undefined as any, smartReq as any);
      expect(mockLabIngest.ingestObservation).toHaveBeenCalledTimes(1);
      expect(res.entry[0].response.status).toBe('201 Created');
    });
  });
});
