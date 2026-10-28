import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { EncounterService } from '../../src/modules/encounter/encounter.service';

describe('EncounterService', () => {
  let service: EncounterService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      // 입원 중 여부 조회(진료↔입원 자동 연결) — 기본은 입원 없음
      admission: { findFirst: vi.fn().mockResolvedValue(null) },
      encounter: {
        create: vi.fn(),
        findMany: vi.fn(),
        findUnique: vi.fn(),
        update: vi.fn(),
        count: vi.fn(),
      },
      encounterDiagnosis: {
        deleteMany: vi.fn(),
        count: vi.fn().mockResolvedValue(1), // 상병 필수 게이트 — 기본 1건(경고 없음)
      },
      // 게이트 위반은 GateViolationLog 에 남는다(승격 판단 근거) — 목이 없으면 서명 자체가 깨진다
      gateViolationLog: { create: vi.fn().mockResolvedValue({}) },
      $transaction: vi.fn((fn) => fn(mockPrisma)),
    };

    const mockEventEmitter = { emit: vi.fn() };
    service = new EncounterService(mockPrisma, mockEventEmitter as any);
  });

  describe('create', () => {
    it('should create encounter with SOAP notes', async () => {
      const dto = {
        patientId: 'patient-1',
        appointmentId: 'apt-1',
        subjective: '환자 호소: 두통 3일',
        objective: '체온 37.2°C, BP 120/80',
        assessment: 'Primary headache, tension type',
        plan: 'Rest, hydration, analgesics if needed',
        diagnoses: [
          { diagnosisCodeId: 'diag-1', type: 'PRIMARY', notes: 'Tension headache' },
        ],
      };

      mockPrisma.encounter.create.mockResolvedValue({
        id: 'enc-1',
        ...dto,
        doctorId: 'doctor-1',
        status: 'DRAFT',
        patient: { id: 'patient-1', mrn: 'MRN-001', familyName: '이', givenName: '환자' },
        doctor: { id: 'doctor-1', familyName: '김', givenName: '의사' },
        diagnoses: [
          {
            id: 'encdiag-1',
            diagnosisCodeId: 'diag-1',
            type: 'PRIMARY',
            notes: 'Tension headache',
            diagnosisCode: { code: 'G89.1', nameKo: '두통', nameEn: 'Headache' },
          },
        ],
      });

      const result = await service.create(dto, 'doctor-1');

      expect(result.id).toBe('enc-1');
      expect(result.status).toBe('DRAFT');
      expect(result.subjective).toBe(dto.subjective);
      expect(result.diagnoses).toHaveLength(1);
      expect(mockPrisma.encounter.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            patientId: 'patient-1',
            doctorId: 'doctor-1',
          }),
        })
      );
    });

    it('should create encounter without diagnoses', async () => {
      const dto = {
        patientId: 'patient-1',
        subjective: '환자 호소',
        objective: '검사 결과',
        assessment: '평가',
        plan: '계획',
      };

      mockPrisma.encounter.create.mockResolvedValue({
        id: 'enc-2',
        ...dto,
        doctorId: 'doctor-1',
        status: 'DRAFT',
        appointmentId: null,
        diagnoses: [],
      });

      const result = await service.create(dto, 'doctor-1');

      expect(result.diagnoses).toEqual([]);
    });

    it('should include patient and doctor information', async () => {
      const dto = {
        patientId: 'patient-1',
        subjective: 'S',
        objective: 'O',
        assessment: 'A',
        plan: 'P',
      };

      mockPrisma.encounter.create.mockResolvedValue({
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
      });

      const result = await service.create(dto, 'doctor-1');

      expect(result.patient).toBeDefined();
      expect(result.doctor).toBeDefined();
      expect(result.doctor.familyName).toBe('이');
    });
  });

  describe('findAll', () => {
    it('should return encounters with pagination', async () => {
      const mockEncounters = [
        {
          id: 'enc-1',
          patientId: 'patient-1',
          doctorId: 'doctor-1',
          status: 'SIGNED',
          createdAt: new Date(),
        },
        {
          id: 'enc-2',
          patientId: 'patient-1',
          doctorId: 'doctor-1',
          status: 'DRAFT',
          createdAt: new Date(),
        },
      ];

      mockPrisma.encounter.findMany.mockResolvedValue(mockEncounters);
      mockPrisma.encounter.count.mockResolvedValue(2);

      const result = await service.findAll({ page: 1, limit: 20 });

      expect(result.data).toHaveLength(2);
      expect(result.pagination.total).toBe(2);
      expect(result.pagination.page).toBe(1);
      expect(result.pagination.hasMore).toBe(false);
      expect(mockPrisma.encounter.findMany).toHaveBeenCalledWith({
        where: {},
        skip: 0,
        take: 20,
        orderBy: { createdAt: 'desc' },
        include: expect.any(Object),
      });
    });

    it('should filter by patientId', async () => {
      const mockEncounters = [
        { id: 'enc-1', patientId: 'patient-1', doctorId: 'doctor-1' },
      ];

      mockPrisma.encounter.findMany.mockResolvedValue(mockEncounters);
      mockPrisma.encounter.count.mockResolvedValue(1);

      const result = await service.findAll({ patientId: 'patient-1' });

      expect(result.data[0].patientId).toBe('patient-1');
      expect(mockPrisma.encounter.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { patientId: 'patient-1' },
        })
      );
    });

    it('should filter by doctorId', async () => {
      const mockEncounters = [
        { id: 'enc-1', patientId: 'patient-1', doctorId: 'doctor-1' },
      ];

      mockPrisma.encounter.findMany.mockResolvedValue(mockEncounters);
      mockPrisma.encounter.count.mockResolvedValue(1);

      const result = await service.findAll({ doctorId: 'doctor-1' });

      expect(mockPrisma.encounter.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { doctorId: 'doctor-1' },
        })
      );
    });

    it('should handle pagination offset correctly', async () => {
      mockPrisma.encounter.findMany.mockResolvedValue([]);
      mockPrisma.encounter.count.mockResolvedValue(100);

      await service.findAll({ page: 3, limit: 20 });

      expect(mockPrisma.encounter.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 40,
          take: 20,
        })
      );
    });

    it('should indicate if more data exists', async () => {
      mockPrisma.encounter.findMany.mockResolvedValue([{}, {}]);
      mockPrisma.encounter.count.mockResolvedValue(100);

      const result = await service.findAll({ page: 1, limit: 20 });

      expect(result.pagination.hasMore).toBe(true);
    });

    it('should use default pagination values', async () => {
      mockPrisma.encounter.findMany.mockResolvedValue([]);
      mockPrisma.encounter.count.mockResolvedValue(0);

      await service.findAll({});

      expect(mockPrisma.encounter.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 0,
          take: 20,
        })
      );
    });
  });

  describe('findById', () => {
    it('should return encounter with full details', async () => {
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

      mockPrisma.encounter.findUnique.mockResolvedValue(mockEncounter);

      const result = await service.findById('enc-1');

      expect(result.id).toBe('enc-1');
      expect(result.status).toBe('SIGNED');
      expect(mockPrisma.encounter.findUnique).toHaveBeenCalledWith({
        where: { id: 'enc-1' },
        include: expect.any(Object),
      });
    });

    it('should throw NotFoundException if not found', async () => {
      mockPrisma.encounter.findUnique.mockResolvedValue(null);

      await expect(service.findById('invalid-id')).rejects.toThrow(NotFoundException);
    });

    it('should include diagnoses and prescriptions', async () => {
      const mockEncounter = {
        id: 'enc-1',
        patientId: 'patient-1',
        diagnoses: [
          { id: 'encdiag-1', type: 'PRIMARY', diagnosisCode: { code: 'I10', nameKo: '고혈압' } },
        ],
        prescriptions: [
          {
            id: 'px-1',
            medicationCode: { code: 'AM12', nameKo: '약물1' },
            procedureCode: null,
          },
        ],
      };

      mockPrisma.encounter.findUnique.mockResolvedValue(mockEncounter);

      const result = await service.findById('enc-1');

      expect(result.diagnoses).toHaveLength(1);
      expect(result.prescriptions).toHaveLength(1);
    });
  });

  describe('findByPatient', () => {
    it('should return all encounters for patient', async () => {
      const mockEncounters = [
        { id: 'enc-1', patientId: 'patient-1', doctorId: 'doctor-1', createdAt: new Date('2026-05-10') },
        { id: 'enc-2', patientId: 'patient-1', doctorId: 'doctor-2', createdAt: new Date('2026-05-05') },
      ];

      mockPrisma.encounter.findMany.mockResolvedValue(mockEncounters);

      const result = await service.findByPatient('patient-1');

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('enc-1');
      expect(mockPrisma.encounter.findMany).toHaveBeenCalledWith({
        where: { patientId: 'patient-1' },
        orderBy: { createdAt: 'desc' },
        include: expect.any(Object),
      });
    });

    it('should return empty array when no encounters', async () => {
      mockPrisma.encounter.findMany.mockResolvedValue([]);

      const result = await service.findByPatient('patient-999');

      expect(result).toEqual([]);
    });

    it('should sort by createdAt descending', async () => {
      mockPrisma.encounter.findMany.mockResolvedValue([]);

      await service.findByPatient('patient-1');

      expect(mockPrisma.encounter.findMany).toHaveBeenCalledWith({
        where: { patientId: 'patient-1' },
        orderBy: { createdAt: 'desc' },
        include: expect.any(Object),
      });
    });
  });

  describe('update', () => {
    it('should update SOAP notes', async () => {
      mockPrisma.encounter.findUnique.mockResolvedValue({
        id: 'enc-1',
        status: 'DRAFT',
      });

      mockPrisma.$transaction.mockImplementation((fn) => fn(mockPrisma));

      const mockTx = {
        encounterDiagnosis: { deleteMany: vi.fn() },
        encounter: {
          update: vi.fn().mockResolvedValue({
            id: 'enc-1',
            status: 'DRAFT',
            subjective: '수정된 S',
            objective: '수정된 O',
            assessment: '수정된 A',
            plan: '수정된 P',
          }),
        },
      };

      mockPrisma.$transaction.mockImplementation((fn) => fn(mockTx));

      const dto = {
        subjective: '수정된 S',
        objective: '수정된 O',
        assessment: '수정된 A',
        plan: '수정된 P',
      };

      const result = await service.update('enc-1', dto);

      expect(result.subjective).toBe('수정된 S');
    });

    it('should convert SIGNED to AMENDED on update', async () => {
      mockPrisma.encounter.findUnique.mockResolvedValue({
        id: 'enc-1',
        status: 'SIGNED',
        subjective: '원래',
        diagnoses: [],
      });

      const mockTx = {
        signedRecordVersion: { create: vi.fn(async () => ({})) }, // 직전 서명본 보존(2026-10-03)
        encounterDiagnosis: { deleteMany: vi.fn() },
        encounter: {
          update: vi.fn().mockResolvedValue({
            id: 'enc-1',
            status: 'AMENDED',
            subjective: '수정됨',
          }),
        },
      };

      mockPrisma.$transaction.mockImplementation((fn) => fn(mockTx));

      await service.update('enc-1', { subjective: '수정됨' });

      expect(mockTx.encounter.update).toHaveBeenCalledWith({
        where: { id: 'enc-1' },
        data: expect.objectContaining({
          status: 'AMENDED',
        }),
        include: expect.any(Object),
      });
    });

    it('should replace diagnoses atomically', async () => {
      mockPrisma.encounter.findUnique.mockResolvedValue({
        id: 'enc-1',
        status: 'DRAFT',
      });

      const mockTx = {
        encounterDiagnosis: { deleteMany: vi.fn() },
        encounter: {
          update: vi.fn().mockResolvedValue({
            id: 'enc-1',
            diagnoses: [{ diagnosisCodeId: 'new-diag' }],
          }),
        },
      };

      mockPrisma.$transaction.mockImplementation((fn) => fn(mockTx));

      const dto = {
        diagnoses: [{ diagnosisCodeId: 'new-diag', type: 'PRIMARY' }],
      };

      await service.update('enc-1', dto);

      expect(mockTx.encounterDiagnosis.deleteMany).toHaveBeenCalledWith({
        where: { encounterId: 'enc-1' },
      });
    });

    it('should throw NotFoundException if not found', async () => {
      mockPrisma.encounter.findUnique.mockResolvedValue(null);

      await expect(service.update('invalid-id', {})).rejects.toThrow(NotFoundException);
    });
  });

  describe('sign', () => {
    it('should sign DRAFT encounter', async () => {
      mockPrisma.encounter.findUnique.mockResolvedValue({
        id: 'enc-1',
        status: 'DRAFT',
        subjective: '두통 호소',
      });

      mockPrisma.encounter.update.mockResolvedValue({
        id: 'enc-1',
        status: 'SIGNED',
        signedAt: new Date(),
      });

      const result = await service.sign('enc-1');

      expect(result.status).toBe('SIGNED');
      expect(result.signedAt).toBeDefined();
      expect(mockPrisma.encounter.update).toHaveBeenCalledWith({
        where: { id: 'enc-1' },
        data: expect.objectContaining({
          status: 'SIGNED',
        }),
        include: expect.any(Object),
      });
    });

    it('상병 필수 게이트 BLOCK: 진단 0건이면 서명 거부', async () => {
      mockPrisma.encounter.findUnique.mockResolvedValue({ id: 'enc-1', status: 'DRAFT', subjective: '두통' });
      mockPrisma.encounterDiagnosis.count.mockResolvedValue(0);
      const cfg = { get: vi.fn().mockResolvedValue('BLOCK') } as any;
      const svc = new EncounterService(mockPrisma, { emit: vi.fn() } as any, undefined, cfg);
      await expect(svc.sign('enc-1')).rejects.toThrow('상병(진단)을 최소 1개');
    });

    it('상병 필수 게이트 WARN: 진단 0건이어도 서명하되 signWarnings 동봉', async () => {
      mockPrisma.encounter.findUnique.mockResolvedValue({ id: 'enc-1', status: 'DRAFT', subjective: '두통' });
      mockPrisma.encounterDiagnosis.count.mockResolvedValue(0);
      mockPrisma.encounter.update.mockResolvedValue({ id: 'enc-1', status: 'SIGNED', signedAt: new Date() });
      const cfg = { get: vi.fn().mockResolvedValue('WARN') } as any;
      const svc = new EncounterService(mockPrisma, { emit: vi.fn() } as any, undefined, cfg);
      const result = await svc.sign('enc-1') as { status: string; signWarnings?: string[] };
      expect(result.status).toBe('SIGNED');
      expect(result.signWarnings?.[0]).toContain('상병');
    });

    it('should throw BadRequestException if not DRAFT', async () => {
      mockPrisma.encounter.findUnique.mockResolvedValue({
        id: 'enc-1',
        status: 'SIGNED',
      });

      await expect(service.sign('enc-1')).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException if not found', async () => {
      mockPrisma.encounter.findUnique.mockResolvedValue(null);

      await expect(service.sign('invalid-id')).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException for AMENDED status', async () => {
      mockPrisma.encounter.findUnique.mockResolvedValue({
        id: 'enc-1',
        status: 'AMENDED',
      });

      await expect(service.sign('enc-1')).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if SOAP is empty', async () => {
      mockPrisma.encounter.findUnique.mockResolvedValue({
        id: 'enc-1',
        status: 'DRAFT',
        subjective: null, objective: null, assessment: null, plan: null,
      });

      await expect(service.sign('enc-1')).rejects.toThrow(BadRequestException);
    });

    it('should set signedAt timestamp', async () => {
      mockPrisma.encounter.findUnique.mockResolvedValue({
        id: 'enc-1',
        status: 'DRAFT',
        subjective: '기침',
      });

      mockPrisma.encounter.update.mockResolvedValue({
        id: 'enc-1',
        status: 'SIGNED',
        signedAt: new Date(),
      });

      await service.sign('enc-1');

      expect(mockPrisma.encounter.update).toHaveBeenCalledWith({
        where: { id: 'enc-1' },
        data: expect.objectContaining({
          signedAt: expect.any(Date),
        }),
        include: expect.any(Object),
      });
    });
  });

  describe('상병 제한 게이트(diagnosis.restrictionEnforce — 기본 OFF)', () => {
    const gatePrisma = () => ({
      ...mockPrisma,
      patient: { findUnique: vi.fn().mockResolvedValue({ gender: 'MALE', dateOfBirth: new Date('1990-01-01') }) },
      diagnosisCode: { findMany: vi.fn().mockResolvedValue([
        { id: 'diag-1', code: 'N70.0', notPrimary: false, sexRestriction: 'F', ageMin: null, ageMax: null },
      ]) },
    });
    const dto = { patientId: 'p1', diagnoses: [{ diagnosisCodeId: 'diag-1', type: 'PRIMARY' }] } as any;
    const emitter = { emit: vi.fn() } as any;

    it('BLOCK 모드 위반이면 저장 전에 400으로 거부한다', async () => {
      const prisma = gatePrisma();
      const cfg = { get: vi.fn().mockResolvedValue({ sex: 'BLOCK' }) } as any;
      const svc = new EncounterService(prisma as any, emitter, undefined, cfg);
      await expect(svc.create(dto, 'doc-1')).rejects.toThrow(BadRequestException);
      expect(prisma.encounter.create).not.toHaveBeenCalled();
    });

    it('WARN 모드 위반은 저장하고 diagnosisWarnings를 동봉한다', async () => {
      const prisma = gatePrisma();
      prisma.encounter.create.mockResolvedValue({ id: 'enc-1', diagnoses: [], doctor: {} });
      const cfg = { get: vi.fn().mockResolvedValue({ sex: 'WARN' }) } as any;
      const svc = new EncounterService(prisma as any, emitter, undefined, cfg);
      const res: any = await svc.create(dto, 'doc-1');
      expect(res.diagnosisWarnings).toHaveLength(1);
      expect(res.diagnosisWarnings[0].rule).toBe('sex');
    });

    it('OFF(기본·config 미설정)는 저장하고 경고를 동봉하지 않는다', async () => {
      const prisma = gatePrisma();
      prisma.encounter.create.mockResolvedValue({ id: 'enc-1', diagnoses: [], doctor: {} });
      const cfg = { get: vi.fn().mockResolvedValue(null) } as any;
      const svc = new EncounterService(prisma as any, emitter, undefined, cfg);
      const res: any = await svc.create(dto, 'doc-1');
      expect(res.diagnosisWarnings).toBeUndefined();
    });
  });
});
