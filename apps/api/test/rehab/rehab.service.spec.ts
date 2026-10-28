import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RehabService } from '../../src/modules/rehab/rehab.service';
import { NotFoundException, BadRequestException } from '@nestjs/common';

describe('RehabService', () => {
  let service: RehabService;
  let mockPrisma: any;

  const mockPlan = {
    id: 'rp-1', patientId: 'pat-1', diagnosis: '뇌졸중', status: 'ACTIVE',
    frequency: '주3회', therapies: ['운동치료', '작업치료'],
    patient: { familyName: '김', givenName: '환자', mrn: 'MR001' },
  };

  beforeEach(() => {
    mockPrisma = {
      user: { findUnique: vi.fn().mockResolvedValue({ role: 'NURSE', profession: null }) }, // 시행 직종 게이트(2026-09-29) — 간호사는 종전대로 시행
            rehabAssessment: {
        create: vi.fn(), findMany: vi.fn(), count: vi.fn(),
      },
      rehabPlan: {
        create: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(),
        update: vi.fn(), count: vi.fn(),
      },
      rehabSession: {
        create: vi.fn(), createMany: vi.fn(), findMany: vi.fn(),
        findUnique: vi.fn(), update: vi.fn(), count: vi.fn(), groupBy: vi.fn(),
      },
      procedureCode: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
    };
    service = new RehabService(mockPrisma);
  });

  // ── Assessments ──

  describe('createAssessment', () => {
    it('should create assessment', async () => {
      mockPrisma.rehabAssessment.create.mockResolvedValue({
        id: 'ra-1', assessmentType: 'INITIAL', barthel: 65,
      });
      const result = await service.createAssessment({
        patientId: 'pat-1', assessmentType: 'INITIAL', diagnosis: '뇌졸중',
        barthel: 65, fim: 80, assessedBy: 'pt-1',
      });
      expect(result.barthel).toBe(65);
    });
  });

  describe('getAssessments', () => {
    it('should return patient assessments', async () => {
      mockPrisma.rehabAssessment.findMany.mockResolvedValue([{ id: 'ra-1' }]);
      const result = await service.getAssessments('pat-1');
      expect(result).toHaveLength(1);
    });
  });

  // ── Plans ──

  describe('createPlan', () => {
    it('should create rehab plan', async () => {
      mockPrisma.rehabPlan.create.mockResolvedValue(mockPlan);
      const result = await service.createPlan({
        patientId: 'pat-1', diagnosis: '뇌졸중', startDate: '2026-06-01',
        frequency: '주3회', therapies: ['운동치료'], prescribedBy: 'doc-1',
      });
      expect(result.diagnosis).toBe('뇌졸중');
    });
  });

  describe('getPlans', () => {
    it('should filter by patient and status', async () => {
      mockPrisma.rehabPlan.findMany.mockResolvedValue([mockPlan]);
      const result = await service.getPlans({ patientId: 'pat-1', status: 'ACTIVE' });
      expect(result).toHaveLength(1);
    });
  });

  describe('getPlanDetail', () => {
    it('should return plan with sessions', async () => {
      mockPrisma.rehabPlan.findUnique.mockResolvedValue({ ...mockPlan, sessions: [] });
      const result = await service.getPlanDetail('rp-1');
      expect(result.id).toBe('rp-1');
    });

    it('should throw NotFoundException', async () => {
      mockPrisma.rehabPlan.findUnique.mockResolvedValue(null);
      await expect(service.getPlanDetail('bad')).rejects.toThrow(NotFoundException);
    });
  });

  describe('updatePlan', () => {
    it('should update plan status', async () => {
      mockPrisma.rehabPlan.findUnique.mockResolvedValue(mockPlan);
      mockPrisma.rehabPlan.update.mockResolvedValue({ ...mockPlan, status: 'COMPLETED' });
      const result = await service.updatePlan('rp-1', { status: 'COMPLETED' });
      expect(result.status).toBe('COMPLETED');
    });

    it('should throw NotFoundException', async () => {
      mockPrisma.rehabPlan.findUnique.mockResolvedValue(null);
      await expect(service.updatePlan('bad', {})).rejects.toThrow(NotFoundException);
    });
  });

  // ── Sessions ──

  describe('createSession', () => {
    it('should create single session', async () => {
      mockPrisma.rehabSession.create.mockResolvedValue({
        id: 'rs-1', therapyType: '운동치료',
      });
      const result = await service.createSession({
        planId: 'rp-1', patientId: 'pat-1', therapyType: '운동치료',
        therapistId: 'pt-1', scheduledAt: '2026-06-01T09:00:00',
      });
      expect(result.therapyType).toBe('운동치료');
    });
  });

  describe('generateSessions', () => {
    it('should generate weekly sessions (주3회 → 월수금)', async () => {
      mockPrisma.rehabPlan.findUnique.mockResolvedValue(mockPlan);
      mockPrisma.rehabSession.createMany.mockResolvedValue({ count: 6 });

      const result = await service.generateSessions({
        planId: 'rp-1', startDate: '2026-06-01', weeks: 2, therapistId: 'th-1', // 🔴 P3: 치료사 필수(세션 컬럼 NOT NULL)
      });

      expect(result.created).toBeGreaterThan(0);
      expect(mockPrisma.rehabSession.createMany).toHaveBeenCalled();
    });

    it('should throw NotFoundException for missing plan', async () => {
      mockPrisma.rehabPlan.findUnique.mockResolvedValue(null);
      await expect(service.generateSessions({ planId: 'bad', startDate: '2026-06-01', weeks: 1, therapistId: 'th-1' }))
        .rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException for inactive plan', async () => {
      mockPrisma.rehabPlan.findUnique.mockResolvedValue({ ...mockPlan, status: 'COMPLETED' });
      // 치료사를 넣어야 비활성 계획 분기를 겨눈다(빼면 치료사 필수 400 이 대신 통과한다)
      await expect(service.generateSessions({ planId: 'rp-1', startDate: '2026-06-01', weeks: 1, therapistId: 'th-1' }))
        .rejects.toThrow('비활성 계획입니다');
    });
  });

  describe('startSession', () => {
    it('should start session', async () => {
      mockPrisma.rehabSession.findUnique.mockResolvedValue({ id: 'rs-1' });
      mockPrisma.rehabSession.update.mockResolvedValue({ id: 'rs-1', status: 'IN_PROGRESS' });
      const result = await service.startSession('rs-1');
      expect(result.status).toBe('IN_PROGRESS');
    });

    it('should throw NotFoundException', async () => {
      mockPrisma.rehabSession.findUnique.mockResolvedValue(null);
      await expect(service.startSession('bad')).rejects.toThrow(NotFoundException);
    });
  });

  describe('completeSession', () => {
    it('should complete session with progress', async () => {
      mockPrisma.rehabSession.findUnique.mockResolvedValue({ id: 'rs-1' });
      mockPrisma.rehabSession.update.mockResolvedValue({
        id: 'rs-1', status: 'COMPLETED', progress: '호전',
      });
      const result = await service.completeSession('rs-1', {
        progress: '호전', duration: 30, notes: '30분 운동 완료',
      });
      expect(result.status).toBe('COMPLETED');
    });
  });

  // ── Dashboard / Stats ──

  describe('getDashboard', () => {
    it('should return dashboard data', async () => {
      mockPrisma.rehabSession.count.mockResolvedValue(8);
      mockPrisma.rehabPlan.count.mockResolvedValue(5);
      mockPrisma.rehabAssessment.count.mockResolvedValue(3);
      mockPrisma.rehabSession.groupBy.mockResolvedValue([]);

      const result = await service.getDashboard();
      expect(result.todaySessions).toBe(8);
      expect(result.activePlans).toBe(5);
    });
  });

  describe('getPatientProgress', () => {
    it('should return assessments and session stats', async () => {
      mockPrisma.rehabAssessment.findMany.mockResolvedValue([
        { barthel: 65, fim: 80 }, { barthel: 75, fim: 90 },
      ]);
      mockPrisma.rehabSession.groupBy.mockResolvedValue([
        { status: 'COMPLETED', _count: 10 },
      ]);

      const result = await service.getPatientProgress('pat-1');
      expect(result.assessments).toHaveLength(2);
      expect(result.sessionStats).toHaveLength(1);
    });
  });

  describe('getStats', () => {
    it('should return overall stats', async () => {
      mockPrisma.rehabPlan.count
        .mockResolvedValueOnce(20) // total
        .mockResolvedValueOnce(10); // active
      mockPrisma.rehabSession.count.mockResolvedValue(150);
      mockPrisma.rehabSession.groupBy.mockResolvedValue([]);

      const result = await service.getStats();
      expect(result.totalPlans).toBe(20);
      expect(result.completedSessions).toBe(150);
    });
  });

  describe('startSession 안전게이트 (rehab.sessionGate)', () => {
    let mockConfig: any;
    let svc: RehabService;
    const session = { id: 's-1', patientId: 'p-1', status: 'SCHEDULED' };

    beforeEach(() => {
      mockPrisma.rehabSession = mockPrisma.rehabSession ?? {};
      mockPrisma.rehabSession.findUnique = vi.fn().mockResolvedValue(session);
      mockPrisma.rehabSession.update = vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ ...session, ...data }));
      mockPrisma.rehabAssessment = { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn(), findMany: vi.fn() };
      mockPrisma.preVisitVitals = { findFirst: vi.fn().mockResolvedValue(null) };
      mockConfig = { get: vi.fn().mockResolvedValue(undefined) };
      svc = new RehabService(mockPrisma, mockConfig);
    });

    it('should skip gate when OFF (default)', async () => {
      const result = await svc.startSession('s-1');
      expect(result.status).toBe('IN_PROGRESS');
      expect(mockPrisma.rehabAssessment.findFirst).not.toHaveBeenCalled();
    });

    it('should BLOCK on high fall risk (Berg < 21) when gate=BLOCK', async () => {
      mockConfig.get.mockImplementation(async (k: string) => (k === 'rehab.sessionGate' ? 'BLOCK' : undefined));
      mockPrisma.rehabAssessment.findFirst.mockResolvedValue({ berg: 15, gait: '보행 불가', assessedAt: new Date() });

      await expect(svc.startSession('s-1')).rejects.toThrow();
      expect(mockPrisma.rehabSession.update).not.toHaveBeenCalled();
    });

    it('should BLOCK on vital hold parameters (SBP>180)', async () => {
      mockConfig.get.mockImplementation(async (k: string) => (k === 'rehab.sessionGate' ? 'BLOCK' : undefined));
      mockPrisma.preVisitVitals.findFirst.mockResolvedValue({
        systolicBp: 195, heartRate: 88, spo2: 97, temperature: 36.5, measuredAt: new Date(),
      });

      await expect(svc.startSession('s-1')).rejects.toThrow();
    });

    it('should allow override with audit persisted in safetyChecks', async () => {
      mockConfig.get.mockImplementation(async (k: string) => (k === 'rehab.sessionGate' ? 'BLOCK' : undefined));
      mockPrisma.rehabAssessment.findFirst.mockResolvedValue({ berg: 10, gait: null, assessedAt: new Date() });

      const result: any = await svc.startSession('s-1', { overrideGate: true, overrideReason: '보조자 2인 동반', userId: 'u-1' });

      expect(result.status).toBe('IN_PROGRESS');
      const saved = mockPrisma.rehabSession.update.mock.calls[0][0].data.safetyChecks;
      expect(saved.overridden).toBe(true);
      expect(saved.overriddenBy).toBe('u-1');
    });

    it('should WARN(진행) on moderate fall risk in BLOCK mode', async () => {
      mockConfig.get.mockImplementation(async (k: string) => (k === 'rehab.sessionGate' ? 'BLOCK' : undefined));
      mockPrisma.rehabAssessment.findFirst.mockResolvedValue({ berg: 35, gait: '보조기 보행', assessedAt: new Date() });
      mockPrisma.preVisitVitals.findFirst.mockResolvedValue({
        systolicBp: 120, heartRate: 72, spo2: 98, temperature: 36.5, measuredAt: new Date(),
      });

      const result: any = await svc.startSession('s-1');
      expect(result.status).toBe('IN_PROGRESS');
      expect(result.safetyChecks.checks.some((c: any) => c.rule === 'FALL_RISK' && c.level === 'WARNING')).toBe(true);
    });
  });
});
