import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { ClinicalPathwayService } from '../../src/modules/clinical-pathway/clinical-pathway.service';
import { PATIENT_SENSITIVE_OMIT } from '../../src/common/patient-select';

describe('ClinicalPathwayService', () => {
  let service: ClinicalPathwayService;
  let mockPrisma: any;

  const mockPathway = {
    id: 'pw-1',
    code: 'CP-TKR-001',
    name: '슬관절 전치환술 경로',
    department: 'ORTHOPEDICS',
    targetDrg: 'I47',
    version: 1,
    status: 'DRAFT',
    totalDays: 7,
    description: '인공 슬관절 전치환술 표준 경로',
    createdBy: 'user-1',
    createdAt: new Date('2026-01-01'),
  };

  const mockMilestone = {
    id: 'ms-1',
    pathwayId: 'pw-1',
    day: 0,
    category: 'LAB',
    title: '수술 전 혈액검사',
    detail: null,
    isRequired: true,
    sortOrder: 0,
  };

  const mockAssignment = {
    id: 'asgn-1',
    pathwayId: 'pw-1',
    patientId: 'pat-1',
    encounterId: 'enc-1',
    startDate: new Date('2026-05-01'),
    status: 'ACTIVE',
    deviations: 0,
    note: null,
    assignedBy: 'user-1',
    createdAt: new Date('2026-05-01'),
  };

  beforeEach(() => {
    mockPrisma = {
      clinicalPathway: {
        findMany: vi.fn(),
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        aggregate: vi.fn(),
      },
      pathwayMilestone: {
        findUnique: vi.fn(),
        findMany: vi.fn(),
        create: vi.fn(),
        createMany: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        count: vi.fn(),
      },
      pathwayAssignment: {
        findMany: vi.fn(),
        findFirst: vi.fn(),
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      milestoneOutcome: {
        findUnique: vi.fn(),
        findMany: vi.fn(),
        create: vi.fn(),
        upsert: vi.fn(),
        count: vi.fn(),
      },
      // 🔴 (I2) 정본이 결과·이탈 카운트·완료 판정을 한 트랜잭션에서 쓴다 — 목도 같은 호출 모양을 준다.
      //    종전 `vi.fn()` 은 콜백을 **실행하지 않아** 트랜잭션 안의 쓰기가 통째로 사라졌다(목이 정본 모양과 달랐다).
      $transaction: vi.fn(async (arg: any) => (typeof arg === 'function' ? arg(mockPrisma) : Promise.all(arg))),
    };

    service = new ClinicalPathwayService(mockPrisma);
  });

  describe('findAll', () => {
    it('should return pathways list with milestone counts', async () => {
      mockPrisma.clinicalPathway.findMany.mockResolvedValue([
        { ...mockPathway, _count: { milestones: 5 } },
      ]);

      const result = await service.findAll();

      expect(result).toHaveLength(1);
      expect(result[0].milestoneCount).toBe(5);
      expect(result[0]._count).toBeUndefined();
      expect(mockPrisma.clinicalPathway.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: {}, orderBy: { createdAt: 'desc' } }),
      );
    });

    it('should filter by department and status', async () => {
      mockPrisma.clinicalPathway.findMany.mockResolvedValue([]);

      await service.findAll('ORTHOPEDICS', 'ACTIVE');

      expect(mockPrisma.clinicalPathway.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { department: 'ORTHOPEDICS', status: 'ACTIVE' },
        }),
      );
    });
  });

  describe('findOne', () => {
    it('should return pathway with milestones and assignment count', async () => {
      mockPrisma.clinicalPathway.findUnique.mockResolvedValue({
        ...mockPathway,
        milestones: [mockMilestone],
        _count: { assignments: 3 },
      });

      const result = await service.findOne('pw-1');

      expect(result.assignmentCount).toBe(3);
      expect(result.milestones).toHaveLength(1);
      expect(result._count).toBeUndefined();
    });

    it('should throw NotFoundException when pathway not found', async () => {
      mockPrisma.clinicalPathway.findUnique.mockResolvedValue(null);

      await expect(service.findOne('nonexistent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('create', () => {
    it('should create pathway with DRAFT status and version 1', async () => {
      const createData = {
        code: 'CP-TKR-001',
        name: '슬관절 전치환술 경로',
        department: 'ORTHOPEDICS',
        totalDays: 7,
        description: '표준 경로',
      };

      mockPrisma.clinicalPathway.create.mockResolvedValue({
        ...mockPathway,
        ...createData,
      });

      const result = await service.create(createData, 'user-1');

      expect(mockPrisma.clinicalPathway.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          status: 'DRAFT',
          version: 1,
          createdBy: 'user-1',
        }),
      });
      expect(result.code).toBe('CP-TKR-001');
    });
  });

  describe('publish', () => {
    it('should change status from DRAFT to ACTIVE', async () => {
      mockPrisma.clinicalPathway.findUnique.mockResolvedValue({ ...mockPathway, status: 'DRAFT' });
      mockPrisma.clinicalPathway.update.mockResolvedValue({ ...mockPathway, status: 'ACTIVE' });

      const result = await service.publish('pw-1', { userId: 'u-1' });

      expect(result.status).toBe('ACTIVE');
      // 🔴 2026-08-27 — 발행자·발행시각이 함께 남는다.
      //    종전에는 `data: { status:'ACTIVE' }` 뿐이라 **누가 눌렀는지도 남지 않았다**
      //    (급성심근경색 표준경로가 관리자 클릭 한 번으로 전 병원에 발효돼 있었다).
      expect(mockPrisma.clinicalPathway.update).toHaveBeenCalledWith({
        where: { id: 'pw-1' },
        data: expect.objectContaining({
          status: 'ACTIVE',
          publishedBy: 'u-1',
          publishedAt: expect.any(Date),
          governanceRef: null,   // 의결 근거 없이 발효했다는 사실이 남는다
        }),
      });
    });

    it('🔴 발행자를 넘기지 않아도 발행은 되지만, 그 사실이 null 로 남는다(막지 않는다)', async () => {
      mockPrisma.clinicalPathway.findUnique.mockResolvedValue({ ...mockPathway, status: 'DRAFT' });
      mockPrisma.clinicalPathway.update.mockResolvedValue({ ...mockPathway, status: 'ACTIVE' });

      await service.publish('pw-1');

      expect(mockPrisma.clinicalPathway.update).toHaveBeenCalledWith({
        where: { id: 'pw-1' },
        data: expect.objectContaining({ publishedBy: null, governanceRef: null }),
      });
    });

    it('should throw BadRequestException if not DRAFT', async () => {
      mockPrisma.clinicalPathway.findUnique.mockResolvedValue({ ...mockPathway, status: 'ACTIVE' });

      await expect(service.publish('pw-1')).rejects.toThrow(BadRequestException);
    });
  });

  describe('retire', () => {
    it('should change status from ACTIVE to RETIRED', async () => {
      mockPrisma.clinicalPathway.findUnique.mockResolvedValue({ ...mockPathway, status: 'ACTIVE' });
      mockPrisma.clinicalPathway.update.mockResolvedValue({ ...mockPathway, status: 'RETIRED' });

      const result = await service.retire('pw-1');

      expect(result.status).toBe('RETIRED');
      expect(mockPrisma.clinicalPathway.update).toHaveBeenCalledWith({
        where: { id: 'pw-1' },
        data: { status: 'RETIRED' },
      });
    });

    it('should throw BadRequestException if not ACTIVE', async () => {
      mockPrisma.clinicalPathway.findUnique.mockResolvedValue({ ...mockPathway, status: 'DRAFT' });

      await expect(service.retire('pw-1')).rejects.toThrow(BadRequestException);
    });
  });

  describe('clone', () => {
    it('should create copy with incremented version', async () => {
      mockPrisma.clinicalPathway.findUnique.mockResolvedValue({
        ...mockPathway,
        milestones: [mockMilestone],
      });
      mockPrisma.clinicalPathway.aggregate.mockResolvedValue({
        _max: { version: 1 },
      });

      const clonedPathway = {
        ...mockPathway,
        id: 'pw-2',
        code: 'CP-TKR-001_v2',
        version: 2,
        status: 'DRAFT',
        milestones: [{ ...mockMilestone, pathwayId: 'pw-2' }],
      };

      mockPrisma.$transaction.mockImplementation(async (fn: any) => {
        const tx = {
          clinicalPathway: {
            create: vi.fn().mockResolvedValue({ ...clonedPathway }),
            findUnique: vi.fn().mockResolvedValue(clonedPathway),
          },
          pathwayMilestone: {
            createMany: vi.fn().mockResolvedValue({ count: 1 }),
          },
        };
        return fn(tx);
      });

      const result = await service.clone('pw-1', 'user-1');

      expect(result.version).toBe(2);
      expect(result.status).toBe('DRAFT');
      expect(result.code).toBe('CP-TKR-001_v2');
    });

    it('should throw NotFoundException if source pathway not found', async () => {
      mockPrisma.clinicalPathway.findUnique.mockResolvedValue(null);

      await expect(service.clone('nonexistent', 'user-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('addMilestone', () => {
    it('should add milestone to pathway', async () => {
      mockPrisma.clinicalPathway.findUnique.mockResolvedValue(mockPathway);
      mockPrisma.pathwayMilestone.create.mockResolvedValue(mockMilestone);

      const result = await service.addMilestone('pw-1', {
        day: 0,
        category: 'LAB',
        title: '수술 전 혈액검사',
        isRequired: true,
        sortOrder: 0,
      });

      expect(result.pathwayId).toBe('pw-1');
      expect(result.category).toBe('LAB');
      expect(mockPrisma.pathwayMilestone.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ pathwayId: 'pw-1', day: 0 }),
      });
    });

    it('should throw NotFoundException if pathway not found', async () => {
      mockPrisma.clinicalPathway.findUnique.mockResolvedValue(null);

      await expect(
        service.addMilestone('nonexistent', { day: 0, category: 'LAB', title: 'Test' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('assign', () => {
    it('should assign ACTIVE pathway to patient', async () => {
      mockPrisma.clinicalPathway.findUnique.mockResolvedValue({ ...mockPathway, status: 'ACTIVE' });
      mockPrisma.pathwayAssignment.findFirst.mockResolvedValue(null);
      mockPrisma.pathwayAssignment.create.mockResolvedValue({
        ...mockAssignment,
        pathway: mockPathway,
        patient: { id: 'pat-1', familyName: '김', givenName: '환자' },
      });

      const result = await service.assign(
        'pw-1',
        { patientId: 'pat-1', encounterId: 'enc-1', startDate: '2026-05-01' },
        'user-1',
      );

      expect(result.pathwayId).toBe('pw-1');
      expect(result.patientId).toBe('pat-1');
      expect(mockPrisma.pathwayAssignment.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          status: 'ACTIVE',
          deviations: 0,
          assignedBy: 'user-1',
        }),
        include: { pathway: true, patient: { omit: PATIENT_SENSITIVE_OMIT } },
      });
    });

    /** 🔴 startDate 없이 오면 종전엔 Invalid Date 로 Prisma 단계에서 터졌다(화면은 이유를 말하지 못했다) */
    it('should reject an assignment without a usable startDate', async () => {
      mockPrisma.clinicalPathway.findUnique.mockResolvedValue({ ...mockPathway, status: 'ACTIVE' });
      mockPrisma.pathwayAssignment.findFirst.mockResolvedValue(null);

      await expect(
        service.assign('pw-1', { patientId: 'pat-1', encounterId: 'enc-1' }, 'user-1'),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.assign('pw-1', { patientId: 'pat-1', encounterId: 'enc-1', startDate: '아무말' }, 'user-1'),
      ).rejects.toThrow(BadRequestException);
      expect(mockPrisma.pathwayAssignment.create).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException if pathway is not ACTIVE', async () => {
      mockPrisma.clinicalPathway.findUnique.mockResolvedValue({ ...mockPathway, status: 'DRAFT' });

      await expect(
        service.assign('pw-1', { patientId: 'pat-1', encounterId: 'enc-1', startDate: '2026-05-01' }, 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject duplicate ACTIVE assignment of same pathway to same patient', async () => {
      mockPrisma.clinicalPathway.findUnique.mockResolvedValue({ ...mockPathway, status: 'ACTIVE' });
      mockPrisma.pathwayAssignment.findFirst.mockResolvedValue({ id: 'asgn-existing' });

      await expect(
        service.assign('pw-1', { patientId: 'pat-1', encounterId: 'enc-1', startDate: '2026-05-01' }, 'user-1'),
      ).rejects.toThrow(BadRequestException);
      expect(mockPrisma.pathwayAssignment.create).not.toHaveBeenCalled();
    });
  });

  describe('recordOutcome', () => {
    /** 새 흐름 공통 목 — 마일스톤 소속 검증·기존 outcome 조회·upsert·필수 마일스톤 완료판정 */
    const stubOutcomeFlow = (opts: {
      milestone?: { pathwayId: string } | null;
      prevOutcome?: { status: string } | null;
      upserted: Record<string, unknown>;
      requiredIds?: string[];
      doneCount?: number;
    }) => {
      mockPrisma.pathwayMilestone.findUnique.mockResolvedValue(
        opts.milestone === undefined ? { pathwayId: 'pw-1' } : opts.milestone,
      );
      mockPrisma.milestoneOutcome.findUnique.mockResolvedValue(opts.prevOutcome ?? null);
      mockPrisma.milestoneOutcome.upsert.mockResolvedValue(opts.upserted);
      mockPrisma.pathwayMilestone.findMany.mockResolvedValue(
        (opts.requiredIds ?? ['ms-1', 'ms-2', 'ms-3', 'ms-4', 'ms-5']).map((id) => ({ id, isRequired: true })),
      );
      mockPrisma.milestoneOutcome.count.mockResolvedValue(opts.doneCount ?? 1);
    };

    it('should record milestone outcome with DONE status (upsert)', async () => {
      mockPrisma.pathwayAssignment.findUnique.mockResolvedValue(mockAssignment);
      stubOutcomeFlow({
        upserted: { id: 'out-1', assignmentId: 'asgn-1', milestoneId: 'ms-1', actualDay: 0, status: 'DONE' },
      });

      const result = await service.recordOutcome('asgn-1', {
        milestoneId: 'ms-1',
        actualDay: 0,
        status: 'DONE',
      });

      expect(result.status).toBe('DONE');
      expect(mockPrisma.milestoneOutcome.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { assignmentId_milestoneId: { assignmentId: 'asgn-1', milestoneId: 'ms-1' } },
        }),
      );
    });

    it('should reject milestone that belongs to another pathway', async () => {
      mockPrisma.pathwayAssignment.findUnique.mockResolvedValue(mockAssignment);
      mockPrisma.pathwayMilestone.findUnique.mockResolvedValue({ pathwayId: 'pw-OTHER' });

      await expect(
        service.recordOutcome('asgn-1', { milestoneId: 'ms-x', actualDay: 1, status: 'DONE' }),
      ).rejects.toThrow(BadRequestException);
      expect(mockPrisma.milestoneOutcome.upsert).not.toHaveBeenCalled();
    });

    it('should increment deviations count on DEVIATED status', async () => {
      mockPrisma.pathwayAssignment.findUnique.mockResolvedValue(mockAssignment);
      mockPrisma.pathwayAssignment.update.mockResolvedValue({});
      stubOutcomeFlow({
        upserted: { id: 'out-1', assignmentId: 'asgn-1', milestoneId: 'ms-1', actualDay: 2, status: 'DEVIATED' },
      });

      await service.recordOutcome('asgn-1', {
        milestoneId: 'ms-1',
        actualDay: 2,
        status: 'DEVIATED',
        variance: '수술 합병증으로 지연',
      });

      expect(mockPrisma.pathwayAssignment.update).toHaveBeenCalledWith({
        where: { id: 'asgn-1' },
        data: { deviations: { increment: 1 } },
      });
    });

    it('should not double-increment deviations when re-recording DEVIATED', async () => {
      mockPrisma.pathwayAssignment.findUnique.mockResolvedValue(mockAssignment);
      mockPrisma.pathwayAssignment.update.mockResolvedValue({});
      stubOutcomeFlow({
        prevOutcome: { status: 'DEVIATED' },
        upserted: { id: 'out-1', assignmentId: 'asgn-1', milestoneId: 'ms-1', actualDay: 3, status: 'DEVIATED' },
      });

      await service.recordOutcome('asgn-1', { milestoneId: 'ms-1', actualDay: 3, status: 'DEVIATED' });

      expect(mockPrisma.pathwayAssignment.update).not.toHaveBeenCalledWith(
        expect.objectContaining({ data: { deviations: { increment: 1 } } }),
      );
    });

    it('should auto-complete assignment when all required milestones DONE', async () => {
      mockPrisma.pathwayAssignment.findUnique.mockResolvedValue(mockAssignment);
      mockPrisma.pathwayAssignment.update.mockResolvedValue({});
      stubOutcomeFlow({
        upserted: { id: 'out-5', assignmentId: 'asgn-1', milestoneId: 'ms-5', actualDay: 7, status: 'DONE' },
        doneCount: 5,
      });

      await service.recordOutcome('asgn-1', {
        milestoneId: 'ms-5',
        actualDay: 7,
        status: 'DONE',
      });

      expect(mockPrisma.milestoneOutcome.count).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ status: 'DONE' }) }),
      );
      expect(mockPrisma.pathwayAssignment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'COMPLETED' }),
        }),
      );
    });

    it('should NOT complete when required milestones only SKIPPED (done count short)', async () => {
      mockPrisma.pathwayAssignment.findUnique.mockResolvedValue(mockAssignment);
      mockPrisma.pathwayAssignment.update.mockResolvedValue({});
      stubOutcomeFlow({
        upserted: { id: 'out-2', assignmentId: 'asgn-1', milestoneId: 'ms-2', actualDay: 2, status: 'SKIPPED' },
        doneCount: 4,
      });

      await service.recordOutcome('asgn-1', { milestoneId: 'ms-2', actualDay: 2, status: 'SKIPPED' });

      expect(mockPrisma.pathwayAssignment.update).not.toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'COMPLETED' }) }),
      );
    });

    it('should throw BadRequestException for invalid status', async () => {
      mockPrisma.pathwayAssignment.findUnique.mockResolvedValue(mockAssignment);

      await expect(
        service.recordOutcome('asgn-1', { milestoneId: 'ms-1', actualDay: 0, status: 'INVALID' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException if assignment not found', async () => {
      mockPrisma.pathwayAssignment.findUnique.mockResolvedValue(null);

      await expect(
        service.recordOutcome('nonexistent', { milestoneId: 'ms-1', actualDay: 0, status: 'DONE' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('getAnalytics', () => {
    it('should return analytics data with completion and deviation rates', async () => {
      mockPrisma.clinicalPathway.findMany.mockResolvedValue([
        { id: 'pw-1', name: '슬관절 전치환술', code: 'CP-TKR-001', department: 'ORTHOPEDICS', totalDays: 7 },
      ]);
      mockPrisma.pathwayAssignment.findMany.mockResolvedValue([
        { status: 'COMPLETED', deviations: 0, actualDays: 7 },
        { status: 'COMPLETED', deviations: 2, actualDays: 9 },
        { status: 'ACTIVE', deviations: 0, actualDays: null },
      ]);

      const result = await service.getAnalytics();

      expect(result).toHaveLength(1);
      expect(result[0].totalAssignments).toBe(3);
      expect(result[0].completedCount).toBe(2);
      expect(result[0].completionRate).toBe(67);
      expect(result[0].deviationRate).toBe(50);
      expect(result[0].avgActualDays).toBe(8);
      expect(result[0].activeCount).toBe(1);
    });

    /**
     * 🔴 표본 0 인데 completionRate:0 / deviationRate:0 을 주면
     *    화면이 "이탈 0% = 이탈 없음(양호)"으로 읽는다(W7 ⑭ · P1). 표본이 없으면 산출 불가(null).
     */
    it('should return null rates when there is no assignment sample', async () => {
      mockPrisma.clinicalPathway.findMany.mockResolvedValue([
        { id: 'pw-1', name: '슬관절 전치환술', code: 'CP-TKR-001', department: 'ORTHOPEDICS', totalDays: 7 },
      ]);
      mockPrisma.pathwayAssignment.findMany.mockResolvedValue([]);

      const result = await service.getAnalytics();

      expect(result[0].totalAssignments).toBe(0);
      expect(result[0].completionRate).toBeNull();
      expect(result[0].deviationRate).toBeNull();
      expect(result[0].avgActualDays).toBeNull();
    });

    it('should return null deviationRate when nothing has completed yet', async () => {
      mockPrisma.clinicalPathway.findMany.mockResolvedValue([
        { id: 'pw-1', name: '슬관절 전치환술', code: 'CP-TKR-001', department: 'ORTHOPEDICS', totalDays: 7 },
      ]);
      mockPrisma.pathwayAssignment.findMany.mockResolvedValue([
        { status: 'ACTIVE', deviations: 3, actualDays: null },
      ]);

      const result = await service.getAnalytics();

      expect(result[0].completionRate).toBe(0); // 배정 1건 중 완료 0건 = 진짜 0%
      expect(result[0].deviationRate).toBeNull(); // 완료 표본 없음 = 산출 불가
    });

    it('should return empty array when no pathways exist', async () => {
      mockPrisma.clinicalPathway.findMany.mockResolvedValue([]);

      const result = await service.getAnalytics();

      expect(result).toEqual([]);
    });
  });
});
