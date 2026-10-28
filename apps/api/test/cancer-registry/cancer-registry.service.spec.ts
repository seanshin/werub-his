import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { CancerRegistryService } from '../../src/modules/cancer-registry/cancer-registry.service';

describe('CancerRegistryService', () => {
  let service: CancerRegistryService;
  let mockPrisma: any;
  let mockAi: any;

  const mockPatient = {
    id: 'pat-1',
    mrn: 'MR001',
    familyName: '김',
    givenName: '환자',
    dateOfBirth: new Date('1965-03-15'),
    gender: 'MALE',
  };

  const mockRegistry = {
    id: 'reg-1',
    registrationNo: 'CR-2026-00001',
    patientId: 'pat-1',
    diagnosisDate: new Date('2026-03-01'),
    primarySite: 'C34.1',
    morphology: '8140/3',
    behavior: '3',
    grade: 'G2',
    laterality: 'RIGHT',
    diagnosisBasis: 'HISTOLOGY',
    icdCode: 'C34.1',
    tnmClinical: 'T2N1M0',
    tnmPathological: null,
    ajccStage: 'IIIA',
    ajccEdition: 8,
    firstTreatment: 'SURGERY',
    firstTreatmentDate: new Date('2026-03-15'),
    vitalStatus: 'ALIVE',
    registrarId: 'user-1',
    status: 'REGISTERED',
    reportedToKccr: false,
    lastContactDate: null,
    deathDate: null,
    causeOfDeath: null,
    recurrenceDate: null,
    recurrenceSite: null,
    createdAt: new Date('2026-03-01'),
  };

  const mockTreatment = {
    id: 'tx-1',
    registryId: 'reg-1',
    treatmentType: 'SURGERY',
    startDate: new Date('2026-03-15'),
    endDate: new Date('2026-03-15'),
    regimen: null,
    cycles: null,
    response: 'COMPLETE_RESPONSE',
    surgeryType: 'LOBECTOMY',
    radiationDose: null,
    note: null,
  };

  const mockFollowUp = {
    id: 'fu-1',
    registryId: 'reg-1',
    followUpDate: new Date('2026-06-01'),
    status: 'NO_EVIDENCE_OF_DISEASE',
    recurrence: false,
    metastasisSite: null,
    performanceStatus: 'ECOG-0',
    note: null,
    recordedBy: 'user-1',
  };

  beforeEach(() => {
    mockPrisma = {
      cancerRegistry: {
        findMany: vi.fn(),
        findUnique: vi.fn(),
        findFirst: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
        count: vi.fn(),
        groupBy: vi.fn(),
      },
      cancerTreatment: {
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      cancerFollowUp: {
        create: vi.fn(),
      },
      // registrationNo 채번 advisory lock(withAdvisoryLock) — tx 는 동일 목을 재사용
      $executeRaw: vi.fn(),
      $queryRaw: vi.fn().mockResolvedValue([]),
      $transaction: vi.fn(async (arg: any) =>
        typeof arg === 'function' ? arg(mockPrisma) : Promise.all(arg),
      ),
    };

    mockAi = {
      reference: vi.fn().mockResolvedValue({ answer: 'AJCC 8th Ed: Stage IIIA (T2N1M0)' }),
      getDisclaimer: vi.fn().mockResolvedValue('WeRU.B가 생성한 참고 정보입니다. 진단·처방 등 최종 판단은 반드시 의료진이 수행합니다.'),
    };

    service = new CancerRegistryService(mockPrisma, mockAi as any);
  });

  describe('findAll', () => {
    it('should return registries with pagination', async () => {
      mockPrisma.cancerRegistry.findMany.mockResolvedValue([
        { ...mockRegistry, patient: mockPatient },
      ]);
      mockPrisma.cancerRegistry.count.mockResolvedValue(1);

      const result = await service.findAll({ page: 1, limit: 20 });

      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
    });

    it('should filter by primarySite, ajccStage, and status', async () => {
      mockPrisma.cancerRegistry.findMany.mockResolvedValue([]);
      mockPrisma.cancerRegistry.count.mockResolvedValue(0);

      await service.findAll({
        primarySite: 'C34.1',
        ajccStage: 'IIIA',
        status: 'VERIFIED',
      });

      expect(mockPrisma.cancerRegistry.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { primarySite: 'C34.1', ajccStage: 'IIIA', status: 'VERIFIED' },
        }),
      );
    });

    // 🔴 원결함: vitalStatus / reportedToKccr 필터가 서버에 없어 화면 필터가 무효였다
    it('should filter by vitalStatus and reportedToKccr', async () => {
      mockPrisma.cancerRegistry.findMany.mockResolvedValue([]);
      mockPrisma.cancerRegistry.count.mockResolvedValue(0);

      await service.findAll({ vitalStatus: 'ALIVE', reportedToKccr: false });

      expect(mockPrisma.cancerRegistry.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { vitalStatus: 'ALIVE', reportedToKccr: false } }),
      );
    });

    it('should use default pagination when not specified', async () => {
      mockPrisma.cancerRegistry.findMany.mockResolvedValue([]);
      mockPrisma.cancerRegistry.count.mockResolvedValue(0);

      const result = await service.findAll({});

      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
      expect(mockPrisma.cancerRegistry.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 20 }),
      );
    });
  });

  describe('create', () => {
    it('should create registry with auto-generated registrationNo', async () => {
      mockPrisma.cancerRegistry.findFirst.mockResolvedValue(null);
      mockPrisma.cancerRegistry.create.mockResolvedValue({
        ...mockRegistry,
        registrationNo: 'CR-2026-00001',
        patient: { id: 'pat-1', mrn: 'MR001', familyName: '김', givenName: '환자' },
      });

      const result = await service.create(
        {
          patientId: 'pat-1',
          diagnosisDate: '2026-03-01',
          primarySite: 'C34.1',
          morphology: '8140/3',
          behavior: '3',
          diagnosisBasis: 'HISTOLOGY',
          icdCode: 'C34.1',
        },
        'user-1',
      );

      expect(result.registrationNo).toBe('CR-2026-00001');
      expect(mockPrisma.cancerRegistry.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          registrationNo: expect.stringMatching(/^CR-\d{4}-\d{5}$/),
          status: 'REGISTERED',
          registrarId: 'user-1',
        }),
        include: expect.any(Object),
      });
    });

    it('should increment sequence number when previous registrations exist', async () => {
      mockPrisma.cancerRegistry.findFirst.mockResolvedValue({
        registrationNo: 'CR-2026-00042',
      });
      mockPrisma.cancerRegistry.create.mockResolvedValue({
        ...mockRegistry,
        registrationNo: 'CR-2026-00043',
      });

      const result = await service.create(
        {
          patientId: 'pat-1',
          diagnosisDate: '2026-03-01',
          primarySite: 'C34.1',
          morphology: '8140/3',
          behavior: '3',
          diagnosisBasis: 'HISTOLOGY',
          icdCode: 'C34.1',
        },
        'user-1',
      );

      expect(mockPrisma.cancerRegistry.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          registrationNo: 'CR-2026-00043',
        }),
        include: expect.any(Object),
      });
    });
  });

  describe('findOne', () => {
    it('should return registry with treatments and followUps', async () => {
      mockPrisma.cancerRegistry.findUnique.mockResolvedValue({
        ...mockRegistry,
        patient: mockPatient,
        treatments: [mockTreatment],
        followUps: [mockFollowUp],
      });

      const result = await service.findOne('reg-1');

      expect(result.treatments).toHaveLength(1);
      expect(result.followUps).toHaveLength(1);
      expect(result.registrationNo).toBe('CR-2026-00001');
    });

    it('should throw NotFoundException when registry not found', async () => {
      mockPrisma.cancerRegistry.findUnique.mockResolvedValue(null);

      await expect(service.findOne('nonexistent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('verify', () => {
    it('should change status from REGISTERED to VERIFIED', async () => {
      // findOne is called internally, mock findUnique
      mockPrisma.cancerRegistry.findUnique.mockResolvedValue({
        ...mockRegistry,
        status: 'REGISTERED',
        patient: mockPatient,
        treatments: [],
        followUps: [],
      });
      mockPrisma.cancerRegistry.update.mockResolvedValue({
        ...mockRegistry,
        status: 'VERIFIED',
      });

      const result = await service.verify('reg-1');

      expect(result.status).toBe('VERIFIED');
      expect(mockPrisma.cancerRegistry.update).toHaveBeenCalledWith({
        where: { id: 'reg-1' },
        data: { status: 'VERIFIED', verifiedAt: expect.any(Date), verifiedBy: null },
      });
    });

    it('should throw BadRequestException if status is not REGISTERED', async () => {
      mockPrisma.cancerRegistry.findUnique.mockResolvedValue({
        ...mockRegistry,
        status: 'VERIFIED',
        patient: mockPatient,
        treatments: [],
        followUps: [],
      });

      await expect(service.verify('reg-1')).rejects.toThrow(BadRequestException);
    });
  });

  describe('addTreatment', () => {
    it('should add treatment record to registry', async () => {
      mockPrisma.cancerRegistry.findUnique.mockResolvedValue({
        ...mockRegistry,
        patient: mockPatient,
        treatments: [],
        followUps: [],
      });
      mockPrisma.cancerTreatment.create.mockResolvedValue(mockTreatment);

      const result = await service.addTreatment('reg-1', {
        treatmentType: 'SURGERY',
        startDate: '2026-03-15',
        endDate: '2026-03-15',
        response: 'COMPLETE_RESPONSE',
        surgeryType: 'LOBECTOMY',
      });

      expect(result.treatmentType).toBe('SURGERY');
      expect(result.registryId).toBe('reg-1');
      expect(mockPrisma.cancerTreatment.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          registryId: 'reg-1',
          treatmentType: 'SURGERY',
        }),
      });
    });
  });

  describe('addFollowUp', () => {
    it('should add follow-up and update lastContactDate', async () => {
      mockPrisma.cancerRegistry.findUnique.mockResolvedValue({
        ...mockRegistry,
        patient: mockPatient,
        treatments: [],
        followUps: [],
      });
      mockPrisma.cancerFollowUp.create.mockResolvedValue(mockFollowUp);
      mockPrisma.cancerRegistry.update.mockResolvedValue({});

      const result = await service.addFollowUp(
        'reg-1',
        {
          followUpDate: '2026-06-01',
          status: 'NO_EVIDENCE_OF_DISEASE',
          recurrence: false,
          performanceStatus: 'ECOG-0',
        },
        'user-1',
      );

      expect(result.status).toBe('NO_EVIDENCE_OF_DISEASE');
      expect(mockPrisma.cancerRegistry.update).toHaveBeenCalledWith({
        where: { id: 'reg-1' },
        data: { lastContactDate: expect.any(Date) },
      });
    });
  });

  describe('getTimeline', () => {
    it('should return combined timeline sorted by date', async () => {
      mockPrisma.cancerRegistry.findUnique.mockResolvedValue({
        ...mockRegistry,
        patient: mockPatient,
        treatments: [mockTreatment],
        followUps: [mockFollowUp],
      });

      const result = await service.getTimeline('reg-1');

      expect(result.registryId).toBe('reg-1');
      expect(result.registrationNo).toBe('CR-2026-00001');
      expect(result.timeline).toHaveLength(3); // diagnosis + treatment + follow-up
      expect(result.timeline[0].type).toBe('DIAGNOSIS');
      expect(result.timeline[1].type).toBe('TREATMENT');
      expect(result.timeline[2].type).toBe('FOLLOW_UP');
    });

    it('should throw NotFoundException if registry not found', async () => {
      mockPrisma.cancerRegistry.findUnique.mockResolvedValue(null);

      await expect(service.getTimeline('nonexistent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('getStats', () => {
    it('should return statistics by site, stage, and vital status', async () => {
      mockPrisma.cancerRegistry.count.mockResolvedValue(100);
      mockPrisma.cancerRegistry.groupBy
        .mockResolvedValueOnce([
          { primarySite: 'C34.1', _count: { id: 30 } },
          { primarySite: 'C50.9', _count: { id: 25 } },
        ])
        .mockResolvedValueOnce([
          { ajccStage: 'IIIA', _count: { id: 20 } },
          { ajccStage: 'IIB', _count: { id: 15 } },
          { ajccStage: null, _count: { id: 10 } },
        ])
        .mockResolvedValueOnce([
          { vitalStatus: 'ALIVE', _count: { id: 80 } },
          { vitalStatus: 'DEAD', _count: { id: 20 } },
        ]);

      const result = await service.getStats();

      expect(result.total).toBe(100);
      expect(result.bySite).toHaveLength(2);
      expect(result.bySite[0]).toEqual({ site: 'C34.1', count: 30 });
      expect(result.byStage).toHaveLength(3);
      expect(result.byStage[2]).toEqual({ stage: 'UNKNOWN', count: 10 });
      expect(result.byVitalStatus).toHaveLength(2);
    });

    it('should filter stats by primarySite', async () => {
      mockPrisma.cancerRegistry.count.mockResolvedValue(30);
      mockPrisma.cancerRegistry.groupBy
        .mockResolvedValueOnce([{ primarySite: 'C34.1', _count: { id: 30 } }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      await service.getStats('C34.1');

      expect(mockPrisma.cancerRegistry.count).toHaveBeenCalledWith({
        where: { primarySite: 'C34.1' },
      });
    });
  });

  describe('getOverdueFollowUps', () => {
    it('should return overdue follow-up list with days since last contact', async () => {
      const oldDate = new Date();
      oldDate.setMonth(oldDate.getMonth() - 8);

      mockPrisma.cancerRegistry.findMany.mockResolvedValue([
        {
          id: 'reg-1',
          registrationNo: 'CR-2026-00001',
          primarySite: 'C34.1',
          ajccStage: 'IIIA',
          diagnosisDate: new Date('2026-03-01'),
          lastContactDate: oldDate,
          patient: { id: 'pat-1', mrn: 'MR001', familyName: '김', givenName: '환자' },
          followUps: [{ ...mockFollowUp, followUpDate: oldDate }],
        },
      ]);

      const result = await service.getOverdueFollowUps();

      expect(result).toHaveLength(1);
      expect(result[0].registryId).toBe('reg-1');
      expect(result[0].daysSinceLastContact).toBeGreaterThan(200);
      expect(result[0].neverContacted).toBe(false);
      expect(result[0].patient.familyName).toBe('김');
    });

    /**
     * 🔴 원결함: 화면이 null 경과일을 `undefined > 365 = false` 로 낙착시켜
     * **한 번도 추적하지 않은 환자를 가장 약한 노랑**으로 칠했다.
     * 서버는 '추적 이력 없음' 을 별도 사실(neverContacted)로 내보내야 한다.
     */
    it('should mark never-contacted registries explicitly (미상을 최경증으로 낙착 금지)', async () => {
      mockPrisma.cancerRegistry.findMany.mockResolvedValue([
        {
          id: 'reg-2',
          registrationNo: 'CR-2026-00002',
          primarySite: 'C50.9',
          ajccStage: 'IIA',
          diagnosisDate: new Date(Date.now() - 400 * 24 * 60 * 60 * 1000),
          lastContactDate: null,
          patient: { id: 'pat-2', mrn: 'MR002', familyName: '이', givenName: '환자' },
          followUps: [],
        },
      ]);

      const result = await service.getOverdueFollowUps();

      expect(result).toHaveLength(1);
      expect(result[0].daysSinceLastContact).toBeNull();
      expect(result[0].lastFollowUp).toBeNull();
      expect(result[0].neverContacted).toBe(true);
      // 추적 이력이 없어도 방치 기간은 진단일로 정직하게 말할 수 있다
      expect(result[0].daysSinceDiagnosis).toBeGreaterThan(390);
    });

    it('should put never-contacted registries first (nulls: first)', async () => {
      mockPrisma.cancerRegistry.findMany.mockResolvedValue([]);

      await service.getOverdueFollowUps();

      expect(mockPrisma.cancerRegistry.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { lastContactDate: { sort: 'asc', nulls: 'first' } },
        }),
      );
    });
  });

  describe('autoStage', () => {
    it('should call AI for TNM staging and return suggestion', async () => {
      mockPrisma.cancerRegistry.findUnique.mockResolvedValue({
        ...mockRegistry,
        patient: mockPatient,
        treatments: [mockTreatment],
        followUps: [],
      });

      const result = await service.autoStage('reg-1');

      expect(result.registryId).toBe('reg-1');
      expect(result.currentStage).toBe('IIIA');
      expect(result.aiSuggestion).toEqual({ answer: 'AJCC 8th Ed: Stage IIIA (T2N1M0)' });
      expect(result.note).toContain('AI 추정 결과');
      expect(mockAi.reference).toHaveBeenCalledWith(
        expect.stringContaining('TNM 병기 결정'),
        'oncology',
      );
    });

    it('should throw BadRequestException when AI fails', async () => {
      mockPrisma.cancerRegistry.findUnique.mockResolvedValue({
        ...mockRegistry,
        patient: mockPatient,
        treatments: [],
        followUps: [],
      });
      mockAi.reference.mockRejectedValue(new Error('AI service unavailable'));

      await expect(service.autoStage('reg-1')).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException if registry not found', async () => {
      mockPrisma.cancerRegistry.findUnique.mockResolvedValue(null);

      await expect(service.autoStage('nonexistent')).rejects.toThrow(NotFoundException);
    });
  });
});
