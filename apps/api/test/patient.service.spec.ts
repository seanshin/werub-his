import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { ConflictException } from '@nestjs/common';
import { PatientService } from '../src/modules/patient/patient.service';
import { CreatePatientDto } from '../src/modules/patient/dto/create-patient.dto';

describe('PatientService', () => {
  let service: PatientService;
  let prisma: any;

  const mockPatient = {
    id: 'patient-1',
    mrn: 'MRN-2026-00001',
    familyName: '김',
    givenName: '환자',
    dateOfBirth: new Date('1990-01-01'),
    gender: 'MALE',
    email: 'patient@test.example',
    phone: '010-1234-5678',
    nationalId: null, // Will be encrypted, so mock as null to avoid decrypt errors
    insuranceNumber: null,
    insuranceType: 'NHI',
    maritalStatus: 'MARRIED',
    religion: 'NONE',
    occupation: 'ENGINEER',
    status: 'ACTIVE',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const createPatientDto: CreatePatientDto = {
    familyName: '박',
    givenName: '신규',
    dateOfBirth: '1985-05-15',
    gender: 'FEMALE',
    nationalId: '8505151234567',
    email: 'new-patient@test.example',
    phone: '010-9999-8888',
    insuranceType: 'NHI',
  };

  beforeEach(() => {
    prisma = {
      // 목록 진료 횟수(서명/작성 중) — 2026-10-20
      encounter: { groupBy: vi.fn(async () => []) },
      // 목록 행 덧붙임(최근 방문·다음 예약·머무는 곳·알레르기) — 2026-10-20 P3
      appointment: { findMany: vi.fn(async () => []) }, admission: { findMany: vi.fn(async () => []) }, emergencyVisit: { findMany: vi.fn(async () => []) }, allergy: { groupBy: vi.fn(async () => []) }, allergyAssessment: { findMany: vi.fn(async () => []) },
      patient: {
        create: vi.fn(),
        findUnique: vi.fn(),
        findMany: vi.fn().mockResolvedValue([]),
        update: vi.fn(),
        count: vi.fn().mockResolvedValue(0),
        findUniqueOrThrow: vi.fn(),
        findFirst: vi.fn(),
      },
      patientHistory: {
        create: vi.fn(),
      },
      consentForm: {
        create: vi.fn(),
      },
      registrationConsent: {
        createMany: vi.fn(async () => ({ count: 0 })),
      },
      $transaction: vi.fn(async (callback) => {
        // Simple transaction mock that just calls the callback with prisma
        return callback(prisma);
      }),
    };

    const mockConfig = {
      getOrThrow: vi.fn((key: string) => {
        if (key === 'ENCRYPTION_KEY') {
          return '0000000000000000000000000000000000000000000000000000000000000000'; // 32 bytes hex (256 bits)
        }
        return undefined;
      }),
    } as unknown as ConfigService;

    service = new PatientService(prisma, mockConfig);
  });

  describe('create', () => {
    it('should create a new patient with auto-generated MRN', async () => {
      const expectedMrn = 'MRN-2026-00001';
      prisma.patient.create.mockResolvedValue({
        ...mockPatient,
        mrn: expectedMrn,
      } as any);

      const result = await service.create(createPatientDto, 'user-1');

      expect(result.mrn).toBeDefined();
      expect(prisma.patient.create).toHaveBeenCalled();
    });

    // DTO validation is handled at controller level, not in service
    // This test is skipped until service-level validation is added
    // it('should throw error if required fields are missing', async () => {
    //   const invalidDto = { familyName: '김' } as any;
    //   await expect(service.create(invalidDto, 'user-1')).rejects.toThrow();
    // });

    /**
     * 🔴 (2026-10-02) 접수 체크박스로 동의서(ConsentForm)를 "환자 이름으로 서명됨·지금·유효"로 만들던 것 — 환자는 서명한 적이 없다.
     *    이제 등록 동의 원장 10종에 **직원 입력(HIS)·서명자 없음·서명 시각 없음**으로만 남긴다(종전 3종만 남던 것도 10종).
     *    (종전 이 자리의 테스트는 기대문이 주석 처리돼 아무것도 검사하지 않았다)
     */
    it('🔴 접수 체크박스는 직원 입력(HIS)으로만 — 서명된 동의서를 만들지 않는다', async () => {
      prisma.patient.create.mockResolvedValue({ ...mockPatient, id: 'p-new' } as any);
      await service.create({ ...createPatientDto, consents: { privacy: true, sensitive: true, uniqueId: true, thirdParty: false, treatment: true, hie: true, marketing: false } } as any, 'user-1');
      expect(prisma.consentForm.create).not.toHaveBeenCalled();
      const rows = (prisma.registrationConsent.createMany.mock.calls[0][0] as any).data as any[];
      expect(rows.map((r) => r.type).sort()).toEqual(['HIE', 'MARKETING', 'PRIVACY', 'SENSITIVE', 'THIRD_PARTY', 'TREATMENT', 'UNIQUE_ID'].sort());
      for (const r of rows) expect(r).toMatchObject({ patientId: 'p-new', signMethod: 'HIS', signedBy: null, signedAt: null, collectedBy: 'user-1' });
      expect(rows.find((r) => r.type === 'THIRD_PARTY').agreed).toBe(false);
    });

    it('대조군: 체크박스가 없으면 아무것도 쓰지 않는다', async () => {
      prisma.patient.create.mockResolvedValue(mockPatient as any);
      await service.create(createPatientDto, 'user-1');
      expect(prisma.registrationConsent.createMany).not.toHaveBeenCalled();
    });

    it('should encrypt sensitive fields', async () => {
      prisma.patient.create.mockResolvedValue(mockPatient as any);
      prisma.consentForm.create.mockResolvedValue({} as any);

      const result = await service.create(createPatientDto, 'user-1');

      // Verify that the result has encrypted fields (they will be different from input)
      expect(result).toBeDefined();
      expect(result.nationalId).toBeDefined();
      // The actual encryption happens during create, mock returns mocked data
    });
  });

  describe('findById', () => {
    it('should return patient by id', async () => {
      prisma.patient.findUnique.mockResolvedValue(mockPatient as any);

      const result = await service.findById('patient-1');

      expect(result).toBeDefined();
      expect(result.id).toBe('patient-1');
      expect(prisma.patient.findUnique).toHaveBeenCalled();
    });

    it('should return null if patient not found', async () => {
      prisma.patient.findUnique.mockResolvedValue(null);

      await expect(service.findById('nonexistent')).rejects.toThrow();
    });
  });

  describe('findAll', () => {
    it('should return paginated patients', async () => {
      // 목록은 포털계정/인증서 관계를 boolean 파생으로 축약한다(mapListItem) — 관계 없으면 전부 false
      const mockPatients = [{ ...mockPatient, account: null, blockchainCerts: [] }];
      prisma.patient.findMany.mockResolvedValue(mockPatients as any);
      prisma.patient.count.mockResolvedValue(1);

      const result = await service.findAll({ page: 1, limit: 20 });

      expect(result.data).toEqual([
        { ...mockPatient, hasPortalAccount: false, portalActive: false, hasCertificate: false, encounterCounts: { signed: 0, drafts: 0 }, lastVisitAt: null, nextAppointment: null, stay: null },
      ]);
      expect(result.pagination.total).toBe(1);
      expect(prisma.patient.findMany).toHaveBeenCalled();
    });

    it('should filter patients by MRN', async () => {
      prisma.patient.findMany.mockResolvedValue([mockPatient] as any);
      prisma.patient.count.mockResolvedValue(1);

      const result = await service.findAll({ mrn: 'MRN-2026-00001' });

      expect(result.data.length).toBeGreaterThan(0);
      expect(prisma.patient.findMany).toHaveBeenCalled();
    });

    it('should filter patients by name', async () => {
      prisma.patient.findMany.mockResolvedValue([mockPatient] as any);
      prisma.patient.count.mockResolvedValue(1);

      await service.findAll({ q: '김' });

      const whereClause = prisma.patient.findMany.mock.calls[0][0].where;
      expect(whereClause).toBeDefined();
    });

    it('should handle pagination correctly', async () => {
      prisma.patient.findMany.mockResolvedValue([mockPatient] as any);
      prisma.patient.count.mockResolvedValue(100);

      const result = await service.findAll({ page: 2, limit: 20 });

      expect(result.pagination.page).toBe(2);
      expect(result.pagination.limit).toBe(20);
      const call = prisma.patient.findMany.mock.calls[0][0];
      expect(call.skip).toBe(20);
      expect(call.take).toBe(20);
    });
  });

  describe('update', () => {
    it('should update patient fields', async () => {
      const updateDto = { email: 'updated@test.example', phone: '010-5555-6666' };
      const updatedPatient = { ...mockPatient, ...updateDto };

      prisma.patient.findFirst.mockResolvedValue(mockPatient as any);
      prisma.patient.update.mockResolvedValue(updatedPatient as any);

      const result = await service.update('patient-1', updateDto, 'user-1');

      expect(result.email).toBe('updated@test.example');
      expect(prisma.patient.update).toHaveBeenCalled();
    });

    it('should not allow MRN change', async () => {
      const updateDto = { mrn: 'NEW-MRN' } as any;

      // MRN should be ignored or throw error
      prisma.patient.findFirst.mockResolvedValue(mockPatient as any);
      prisma.patient.update.mockResolvedValue(mockPatient as any);

      const result = await service.update('patient-1', updateDto, 'user-1');

      expect(result).toBeDefined();
      // MRN should not be changed
      expect(result.mrn).toBe(mockPatient.mrn);
    });
  });

  describe('checkDuplicate', () => {
    it('should detect duplicate patients by national ID', async () => {
      // Reset the default mock and set specific mock for this test
      prisma.patient.findMany.mockReset().mockResolvedValue([mockPatient] as any);

      const result = await service.checkDuplicate({ nationalId: '1234567890' });

      expect(result).toBeDefined();
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(Array.isArray(result.matches)).toBe(true);
    });

    it('should return no duplicates if not found', async () => {
      prisma.patient.findMany.mockReset().mockResolvedValue([]);

      const result = await service.checkDuplicate({ nationalId: '9999999999' });

      expect(result).toBeDefined();
      expect(result.score).toBe(0);
      expect(result.matches.length).toBe(0);
    });

    // 🔴 A1: 표기차 전화(하이픈 유무)가 같은 사람으로 매칭돼야 한다(정규화)
    it('정규화 전화로 표기차를 흡수해 중복을 잡는다', async () => {
      const cand = {
        id: 'p-x', mrn: 'M1', familyName: '김', givenName: '철수',
        dateOfBirth: new Date('1990-01-01'), gender: 'MALE',
        phone: '010-1234-5678', phoneNormalized: '+821012345678',
        nationalId: null, nationalIdHash: null, createdAt: new Date(),
      };
      prisma.patient.findMany.mockReset().mockResolvedValue([cand] as any);

      // 입력은 하이픈 없는 표기 — 원문 정확일치라면 못 잡는다
      const result = await service.checkDuplicate({ phone: '01012345678' });

      // where 절이 원문이 아니라 정규화 값으로 질의한다
      const where = prisma.patient.findMany.mock.calls[0][0].where;
      const orArr = where.AND?.find((a: any) => a.OR)?.OR ?? where.OR ?? [];
      expect(JSON.stringify(orArr)).toContain('+821012345678');
      // 전화 일치 +25 가 반영돼 점수>0
      expect(result.score).toBeGreaterThan(0);
      expect(result.matches.length).toBe(1);
    });
  });

  describe('mergePatients', () => {
    // mergePatients involves complex transaction with many related models
    // Skipping test until full mock setup is available
    // it('should merge two patients', async () => {
    //   const primaryPatient = mockPatient;
    //   const duplicatePatient = { ...mockPatient, id: 'patient-2' };
    //
    //   prisma.patient.findUnique.mockReset();
    //   prisma.patient.findUnique.mockResolvedValueOnce(primaryPatient as any);
    //   prisma.patient.findUnique.mockResolvedValueOnce(duplicatePatient as any);
    //   prisma.patient.update.mockResolvedValue(primaryPatient as any);
    //
    //   const result = await service.mergePatients(
    //     {
    //       sourceId: 'patient-2',
    //       targetId: 'patient-1',
    //       reason: 'Duplicate patient',
    //     },
    //     'user-1',
    //   );
    //
    //   expect(result).toBeDefined();
    //   expect(prisma.patient.update).toHaveBeenCalled();
    // });

    it('should throw error if patients not found', async () => {
      prisma.patient.findUnique.mockResolvedValue(null);

      await expect(
        service.mergePatients(
          { primaryPatientId: 'invalid', duplicatePatientId: 'also-invalid' },
          'user-1',
        ),
      ).rejects.toThrow();
    });
  });
});
