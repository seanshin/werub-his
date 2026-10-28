import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PatientService } from '../../src/modules/patient/patient.service';

describe('PatientService', () => {
  let service: PatientService;
  let mockPrisma: any;
  let mockConfig: any;
  let mockGates: { record: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    mockConfig = {
      getOrThrow: vi.fn().mockReturnValue('0102030405060708090a0b0c0d0e0f101112131415161718'),
    };

    mockPrisma = {
      // 목록 진료 횟수(서명/작성 중) — 2026-10-20
      encounter: { groupBy: vi.fn().mockResolvedValue([]) },
      // 목록 행 덧붙임 — 2026-10-20 P3
      emergencyVisit: { findMany: vi.fn().mockResolvedValue([]) }, allergy: { groupBy: vi.fn().mockResolvedValue([]) }, allergyAssessment: { findMany: vi.fn().mockResolvedValue([]) },
      patient: {
        create: vi.fn(),
        findMany: vi.fn(),
        findUnique: vi.fn(),
        findFirst: vi.fn(),
        update: vi.fn(),
        count: vi.fn(),
      },
      patientContact: {
        findMany: vi.fn(),
        create: vi.fn(),
        findFirst: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      },
      patientHistory: {
        create: vi.fn(),
        findMany: vi.fn(),
      },
      patientRelation: {
        findMany: vi.fn(),
        findFirst: vi.fn(),
        create: vi.fn(),
        delete: vi.fn(),
        update: vi.fn(),
      },
      patientConsent: {
        createMany: vi.fn(),
      },
      order: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      appointment: {
        findMany: vi.fn().mockResolvedValue([]),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      admission: {
        // 🔴 사망 자동 퇴원은 **어떤 입원을 퇴원시켰는지** 알아야 퇴원 게이트 면제를 그 입원에 걸 수 있다.
        //    목에 이 메서드가 없으면 정본이 부르는 모양과 어긋난다(2026-08-26).
        findMany: vi.fn().mockResolvedValue([]),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      waitingQueue: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      $queryRaw: vi.fn(),
      $transaction: vi.fn((fn) => fn(mockPrisma)),
    };

    mockGates = { record: vi.fn().mockResolvedValue(undefined) };
    service = new PatientService(mockPrisma, mockConfig, mockGates as never);
  });

  describe('findAll', () => {
    it('should return paginated patient list', async () => {
      const query = { skip: 0, take: 20 };
      const mockPatients = [
        { id: 'pat-1', mrn: 'MR000001', familyName: '김', givenName: '환자' },
        { id: 'pat-2', mrn: 'MR000002', familyName: '이', givenName: '의사' },
      ];

      mockPrisma.patient.findMany.mockResolvedValue(mockPatients);
      mockPrisma.patient.count.mockResolvedValue(2);

      const result = await service.findAll(query);

      expect(result.data).toHaveLength(2);
      expect(mockPrisma.patient.findMany).toHaveBeenCalled();
    });

    it('should support search filtering', async () => {
      mockPrisma.patient.findMany.mockResolvedValue([]);
      mockPrisma.patient.count.mockResolvedValue(0);

      await service.findAll({ search: '김' });

      expect(mockPrisma.patient.findMany).toHaveBeenCalled();
    });
  });

  describe('findById', () => {
    it('should return patient by ID', async () => {
      const mockPatient = {
        id: 'pat-1',
        mrn: 'MR000001',
        familyName: '김',
        givenName: '환자',
      };

      mockPrisma.patient.findUnique.mockResolvedValue(mockPatient);

      const result = await service.findById('pat-1');

      expect(result.id).toBe('pat-1');
      expect(result.mrn).toBe('MR000001');
    });
  });

  describe('softDelete', () => {
    it('should deactivate patient', async () => {
      mockPrisma.patient.findUnique.mockResolvedValue({ id: 'pat-1' });
      mockPrisma.patient.update.mockResolvedValue({ id: 'pat-1', isActive: false });

      await service.softDelete('pat-1', 'user-1');

      expect(mockPrisma.patient.update).toHaveBeenCalled();
    });
  });

  describe('getHistory', () => {
    it('should return patient change history', async () => {
      const mockHistory = [
        { id: 'h-1', fieldName: 'phone' },
      ];

      mockPrisma.patient.findUnique.mockResolvedValue({ id: 'pat-1' });
      mockPrisma.patientHistory.findMany.mockResolvedValue(mockHistory);

      const result = await service.getHistory('pat-1');

      expect(result).toHaveLength(1);
    });
  });

  describe('getContacts', () => {
    it('should return patient contacts', async () => {
      const mockContacts = [
        { id: 'c-1', name: '아내', relationship: 'SPOUSE' },
      ];

      mockPrisma.patient.findUnique.mockResolvedValue({ id: 'pat-1' });
      mockPrisma.patientContact.findMany.mockResolvedValue(mockContacts);

      const result = await service.getContacts('pat-1');

      expect(result).toHaveLength(1);
    });
  });

  describe('createContact', () => {
    it('should create new contact', async () => {
      const dto = { name: '어머니', relationship: 'PARENT' };
      const mockContact = { id: 'c-2', name: '어머니' };

      mockPrisma.patient.findUnique.mockResolvedValue({ id: 'pat-1' });
      mockPrisma.patientContact.create.mockResolvedValue(mockContact);

      const result = await service.createContact('pat-1', dto);

      expect(result.name).toBe('어머니');
    });
  });

  describe('updateContact', () => {
    it('should update contact', async () => {
      const dto = { phone: '010-2222-2222' };
      const mockUpdated = { id: 'c-1', phone: '010-2222-2222' };

      mockPrisma.patient.findUnique.mockResolvedValue({ id: 'pat-1' });
      mockPrisma.patientContact.findFirst.mockResolvedValue({ id: 'c-1', patientId: 'pat-1' });
      mockPrisma.patientContact.update.mockResolvedValue(mockUpdated);

      const result = await service.updateContact('pat-1', 'c-1', dto);

      expect(result.phone).toBe('010-2222-2222');
    });
  });

  describe('deleteContact', () => {
    it('should delete contact', async () => {
      mockPrisma.patient.findUnique.mockResolvedValue({ id: 'pat-1' });
      mockPrisma.patientContact.findFirst.mockResolvedValue({ id: 'c-1', patientId: 'pat-1' });
      mockPrisma.patientContact.delete.mockResolvedValue({});

      await service.deleteContact('pat-1', 'c-1');

      expect(mockPrisma.patientContact.delete).toHaveBeenCalled();
    });
  });

  describe('markDeceased', () => {
    it('should mark patient as deceased', async () => {
      const dto = { deceasedDate: new Date(), deceasedReason: '심근경색' };
      const mockDeceased = { id: 'pat-1', isDeceased: true };

      mockPrisma.patient.findUnique.mockResolvedValue({ id: 'pat-1' });
      mockPrisma.patient.update.mockResolvedValue(mockDeceased);

      const result = await service.markDeceased('pat-1', dto, 'user-1');

      expect(result.isDeceased).toBe(true);
    });

    /**
     * 🔴 이 경로는 `InpatientService.discharge()` 를 거치지 않아 퇴원 게이트가 평가되지 않는다.
     *    사망 퇴원을 **막지는 않는다**(막으면 현장이 멈춘다) — 대신 면제로 통과한 사실을 남긴다.
     *    재주입: `markDeceased()` 의 `gates?.record(... 'EXEMPT' ...)` 를 지우면 이 케이스가 실패한다.
     */
    it('🔴 재원 중이면 자동 퇴원하되, 퇴원 게이트를 면제로 통과한 사실을 원장에 남긴다', async () => {
      const dto = { deathDate: new Date().toISOString() } as never;
      mockPrisma.patient.findUnique.mockResolvedValue({ id: 'pat-1' });
      mockPrisma.patient.update.mockResolvedValue({ id: 'pat-1', isDeceased: true });
      mockPrisma.admission.findMany.mockResolvedValue([{ id: 'adm-9' }]);
      mockPrisma.admission.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.markDeceased('pat-1', dto, 'user-1');

      expect(mockGates.record).toHaveBeenCalledWith(
        'inpatient.dischargeGate', 'EXEMPT', expect.stringContaining('DECEASED'), 'Admission', 'adm-9',
      );
      // 사람이 보는 자리에도 남는다 — 사후 정산·기록 완결이 남았다는 사실을 침묵시키지 않는다
      expect(result.actions.join(' ')).toContain('사망 면제');
    });

    // 대조군 — 재원이 아니면 면제 기록을 만들지 않는다(없는 일을 원장에 적지 않는다)
    it('재원 중이 아니면 면제 기록을 남기지 않는다', async () => {
      const dto = { deathDate: new Date().toISOString() } as never;
      mockPrisma.patient.findUnique.mockResolvedValue({ id: 'pat-1' });
      mockPrisma.patient.update.mockResolvedValue({ id: 'pat-1', isDeceased: true });
      mockPrisma.admission.findMany.mockResolvedValue([]);
      mockPrisma.admission.updateMany.mockResolvedValue({ count: 0 });

      await service.markDeceased('pat-1', dto, 'user-1');

      expect(mockGates.record).not.toHaveBeenCalled();
    });
  });

  describe('getRelations', () => {
    it('should return family relations', async () => {
      const mockRelations = [
        { id: 'rel-1', relationshipType: 'SIBLING' },
      ];

      mockPrisma.patient.findUnique.mockResolvedValue({ id: 'pat-1' });
      mockPrisma.patientRelation.findMany.mockResolvedValue(mockRelations);

      const result = await service.getRelations('pat-1');

      expect(result.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('createRelation', () => {
    it('should create family relation', async () => {
      const dto = { relatedPatientId: 'pat-2', relationshipType: 'SIBLING' };
      const mockRelation = { id: 'rel-1', relationshipType: 'SIBLING' };

      mockPrisma.patient.findUnique.mockResolvedValueOnce({ id: 'pat-1' });
      mockPrisma.patient.findUnique.mockResolvedValueOnce({ id: 'pat-2' });
      mockPrisma.patientRelation.create.mockResolvedValue(mockRelation);

      const result = await service.createRelation('pat-1', dto);

      expect(result.relationshipType).toBe('SIBLING');
    });
  });

  describe('deleteRelation', () => {
    it('should delete family relation', async () => {
      mockPrisma.patient.findUnique.mockResolvedValue({ id: 'pat-1' });
      mockPrisma.patientRelation.findFirst.mockResolvedValue({ id: 'rel-1' });
      mockPrisma.patientRelation.update.mockResolvedValue({ id: 'rel-1', isActive: false });

      await service.deleteRelation('pat-1', 'rel-1');

      expect(mockPrisma.patientRelation.update).toHaveBeenCalled();
    });
  });

  describe('checkDuplicate', () => {
    it('should detect duplicate patients', async () => {
      const dto = {
        familyName: '김',
        givenName: '환자',
        dateOfBirth: '1980-01-15',
      };

      const mockMatches = [
        { id: 'pat-1', mrn: 'MR000001', dateOfBirth: new Date('1980-01-15') },
      ];

      mockPrisma.patient.findMany.mockResolvedValue(mockMatches);

      const result = await service.checkDuplicate(dto);

      expect(result.matches).toHaveLength(1);
    });

    it('should return no duplicates for unique patient', async () => {
      const dto = {
        familyName: '박',
        givenName: '신규',
        dateOfBirth: '2000-01-01',
      };

      mockPrisma.patient.findMany.mockResolvedValue([]);

      const result = await service.checkDuplicate(dto);

      expect(result.matches).toHaveLength(0);
    });
  });
});
