import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PatientSafetyService } from '../../src/modules/patient-safety/patient-safety.service';

describe('PatientSafetyService', () => {
  let service: PatientSafetyService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      safetyIncident: {
        create: vi.fn(),
        findMany: vi.fn(),
        update: vi.fn(),
      },
      fallRiskAssessment: {
        create: vi.fn(),
        findMany: vi.fn(),
      },
      // 낙상 평가 저장 정본이 같은 트랜잭션에서 활성 Morse 재평가 일정을 갱신한다(2026-10-07)
      riskReassessmentSchedule: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
      restraintOrder: {
        create: vi.fn().mockResolvedValue({ id: 'r-new' }),
        findUnique: vi.fn(),
        update: vi.fn().mockResolvedValue({ id: 'r-1', status: 'DISCONTINUED' }),
        findMany: vi.fn(),
      },
      restraintMonitoring: {
        create: vi.fn().mockResolvedValue({ id: 'm-1' }),
      },
    };
    // 콜백형·배열형 둘 다(낙상 평가 저장은 배열형 — 평가 원장 + 재평가 일정 갱신)
    mockPrisma.$transaction = vi.fn().mockImplementation((cb: any) => (Array.isArray(cb) ? Promise.all(cb) : cb(mockPrisma)));

    service = new PatientSafetyService(mockPrisma, { emit: vi.fn() } as any);
  });

  describe('reportIncident', () => {
    it('should create a safety incident report', async () => {
      const dto = {
        patientId: 'patient-1',
        reporterId: 'user-1',
        type: 'FALL',
        severity: 'HIGH',
        description: '환자가 화장실에서 낙상',
        location: 'Bathroom',
        occurredAt: '2026-05-13T10:30:00Z',
      };

      mockPrisma.safetyIncident.create.mockResolvedValue({
        id: 'incident-1',
        ...dto,
        occurredAt: new Date(dto.occurredAt),
        status: 'OPEN',
        createdAt: new Date(),
      });

      const result = await service.reportIncident(dto);

      expect(result.id).toBe('incident-1');
      expect(result.type).toBe('FALL');
      expect(result.severity).toBe('HIGH');
      expect(mockPrisma.safetyIncident.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            patientId: 'patient-1',
            reporterId: 'user-1',
            type: 'FALL',
            severity: 'HIGH',
          }),
        })
      );
    });

    it('should report incident without patient ID', async () => {
      const dto = {
        reporterId: 'user-1',
        type: 'MEDICATION_ERROR',
        severity: 'MEDIUM',
        description: '약물 용량 오류',
        occurredAt: '2026-05-13T11:00:00Z',
      };

      mockPrisma.safetyIncident.create.mockResolvedValue({
        id: 'incident-2',
        patientId: null,
        ...dto,
        occurredAt: new Date(dto.occurredAt),
        status: 'OPEN',
      });

      const result = await service.reportIncident(dto);

      expect(result.id).toBe('incident-2');
      expect(result.patientId).toBeNull();
      expect(result.type).toBe('MEDICATION_ERROR');
    });

    it('should include location in incident report', async () => {
      const dto = {
        patientId: 'patient-1',
        reporterId: 'user-1',
        type: 'PRESSURE_ULCER',
        severity: 'MEDIUM',
        description: '욕창 발생',
        location: 'ICU - Bed 5',
        occurredAt: '2026-05-13T12:00:00Z',
      };

      mockPrisma.safetyIncident.create.mockResolvedValue({
        id: 'incident-3',
        ...dto,
        occurredAt: new Date(dto.occurredAt),
        status: 'OPEN',
      });

      const result = await service.reportIncident(dto);

      expect(result.location).toBe('ICU - Bed 5');
      expect(mockPrisma.safetyIncident.create).toHaveBeenCalled();
    });
  });

  /**
   * 🔴 열람자 컨텍스트가 생겼다(2026-08-18·보고자 보호 축). 전담인력(canReviewAll)이 아니면
   *    본인이 보고한 건만 보인다 — 서명이 바뀐 게 아니라 **없던 통제가 생긴 것**이다.
   */
  const REVIEWER = { userId: 'u-reviewer', canReviewAll: true };

  describe('getIncidents', () => {
    it('should return all incidents without filters', async () => {
      const mockIncidents = [
        {
          id: 'incident-1',
          type: 'FALL',
          severity: 'HIGH',
          status: 'OPEN',
          occurredAt: new Date(),
        },
        {
          id: 'incident-2',
          type: 'MEDICATION_ERROR',
          severity: 'MEDIUM',
          status: 'CLOSED',
          occurredAt: new Date(),
        },
      ];

      mockPrisma.safetyIncident.findMany.mockResolvedValue(mockIncidents);

      const result = await service.getIncidents({}, REVIEWER);

      expect(result).toHaveLength(2);
      const call = mockPrisma.safetyIncident.findMany.mock.calls.at(-1)[0];
      expect(call.where).toEqual({});
      expect(call.orderBy).toEqual({ occurredAt: 'desc' });
      // 🔴 select 가 반드시 있어야 한다 — 없으면 reporterId 가 응답에 실린다(환자안전법 §17)
      expect(call.select).toBeDefined();
    });

    it('should filter incidents by type', async () => {
      const mockIncidents = [
        {
          id: 'incident-1',
          type: 'FALL',
          severity: 'HIGH',
          status: 'OPEN',
          occurredAt: new Date(),
        },
      ];

      mockPrisma.safetyIncident.findMany.mockResolvedValue(mockIncidents);

      const result = await service.getIncidents({ type: 'FALL' }, REVIEWER);

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('FALL');
      // 🔴 type 도 자유 문자열이라 등가 비교로는 같은 유형의 다른 저장값을 놓친다 → 별칭 전체를 in 으로
      const call = mockPrisma.safetyIncident.findMany.mock.calls.at(-1)[0];
      expect(call.where.type.in).toEqual(expect.arrayContaining(['FALL']));
      expect(call.orderBy).toEqual({ occurredAt: 'desc' });
    });

    it('should filter incidents by severity', async () => {
      const mockIncidents = [
        {
          id: 'incident-2',
          type: 'MEDICATION_ERROR',
          severity: 'CRITICAL',
          status: 'OPEN',
          occurredAt: new Date(),
        },
      ];

      mockPrisma.safetyIncident.findMany.mockResolvedValue(mockIncidents);

      const result = await service.getIncidents({ severity: 'CRITICAL' }, REVIEWER);

      expect(result[0].severity).toBe('CRITICAL');
      // 🔴 종전 기대값은 `where: { severity: 'CRITICAL' }` 였다(2026-08-14·W7 갱신).
      //    severity 는 enum 이 아닌 자유 문자열이라 등가 비교로는 같은 등급의 다른 저장값
      //    (CATASTROPHIC·SEVERE·위해)을 놓친다 → 정본 별칭 전체를 `in` 으로 찾는다.
      const arg = mockPrisma.safetyIncident.findMany.mock.calls.at(-1)[0];
      expect(arg.where.severity.in).toEqual(expect.arrayContaining(['CRITICAL', 'CATASTROPHIC', 'SEVERE', '위해']));
      expect(arg.orderBy).toEqual({ occurredAt: 'desc' });
    });

    it('should filter incidents by status', async () => {
      const mockIncidents = [
        {
          id: 'incident-1',
          type: 'FALL',
          severity: 'HIGH',
          status: 'OPEN',
          occurredAt: new Date(),
        },
      ];

      mockPrisma.safetyIncident.findMany.mockResolvedValue(mockIncidents);

      const result = await service.getIncidents({ status: 'OPEN' }, REVIEWER);

      expect(result[0].status).toBe('OPEN');
      const call = mockPrisma.safetyIncident.findMany.mock.calls.at(-1)[0];
      expect(call.where).toEqual({ status: 'OPEN' });
    });

    it('should filter incidents with multiple criteria', async () => {
      const mockIncidents = [
        {
          id: 'incident-1',
          type: 'FALL',
          severity: 'HIGH',
          status: 'OPEN',
          occurredAt: new Date(),
        },
      ];

      mockPrisma.safetyIncident.findMany.mockResolvedValue(mockIncidents);

      const result = await service.getIncidents({
        type: 'FALL',
        severity: 'HIGH',
        status: 'OPEN',
      }, REVIEWER);

      expect(result).toHaveLength(1);
      const arg = mockPrisma.safetyIncident.findMany.mock.calls.at(-1)[0];
      expect(arg.where.type.in).toEqual(expect.arrayContaining(['FALL']));
      expect(arg.where.status).toBe('OPEN');
      // HIGH 는 정본 등급 MAJOR(중대) — 같은 등급의 저장값 후보 전부로 조회
      expect(arg.where.severity.in).toEqual(expect.arrayContaining(['MAJOR', 'HIGH', '중대']));
    });

    it('should return empty list when no incidents match', async () => {
      mockPrisma.safetyIncident.findMany.mockResolvedValue([]);

      const result = await service.getIncidents({ type: 'NON_EXISTENT' }, REVIEWER);

      expect(result).toEqual([]);
    });

    it('should sort incidents by occurredAt in descending order', async () => {
      const mockIncidents = [
        {
          id: 'incident-3',
          type: 'FALL',
          severity: 'HIGH',
          status: 'OPEN',
          occurredAt: new Date('2026-05-13T12:00:00Z'),
        },
        {
          id: 'incident-1',
          type: 'FALL',
          severity: 'HIGH',
          status: 'OPEN',
          occurredAt: new Date('2026-05-13T10:00:00Z'),
        },
      ];

      mockPrisma.safetyIncident.findMany.mockResolvedValue(mockIncidents);

      await service.getIncidents({}, REVIEWER);

      const call = mockPrisma.safetyIncident.findMany.mock.calls.at(-1)[0];
      expect(call.orderBy).toEqual({ occurredAt: 'desc' });
    });
  });

  describe('updateIncidentStatus', () => {
    // 2026-10-08 QI-FLOW P0 D2 — 전이표·사유·조건부 갱신(상세는 test/quality-flow/qi-flow-p0.spec.ts)
    beforeEach(() => {
      mockPrisma.safetyIncident.findUnique = vi.fn().mockResolvedValue({ status: 'RESOLVED' });
      mockPrisma.safetyIncident.updateMany = vi.fn().mockResolvedValue({ count: 1 });
    });
    it('should update incident status (RESOLVED → CLOSED)', async () => {
      mockPrisma.safetyIncident.findUnique
        .mockResolvedValueOnce({ status: 'RESOLVED' })
        .mockResolvedValueOnce({ id: 'incident-1', status: 'CLOSED', actionTaken: 'Non-slip mat placed' });
      const result = await service.updateIncidentStatus('incident-1', 'CLOSED', 'Non-slip mat placed');
      expect(result?.status).toBe('CLOSED');
      const upd = mockPrisma.safetyIncident.updateMany.mock.calls.at(-1)[0];
      expect(upd.where).toEqual({ id: 'incident-1', status: 'RESOLVED' });
      // 종결은 시각·종결자를 남긴다(QI 흐름 2026-10-08 — 종결 소요 시간의 원천)
      expect(upd.data).toMatchObject({ status: 'CLOSED', actionTaken: 'Non-slip mat placed', closedBy: null });
      expect(upd.data.closedAt).toBeInstanceOf(Date);
      // 🔴 돌려주는 조회도 select 로 reporterId 를 뺀다
      expect(mockPrisma.safetyIncident.findUnique.mock.calls.at(-1)[0].select).toBeDefined();
    });
    it('should update incident status without action taken when not required', async () => {
      mockPrisma.safetyIncident.findUnique.mockResolvedValueOnce({ status: 'REPORTED' }).mockResolvedValueOnce({ id: 'incident-1', status: 'INVESTIGATING' });
      await service.updateIncidentStatus('incident-1', 'INVESTIGATING');
      const upd = mockPrisma.safetyIncident.updateMany.mock.calls.at(-1)[0];
      // REPORTED 를 처음 벗어날 때 검토 시각·검토자를 남긴다(검토 지연의 원천)
      expect(upd.data).toMatchObject({ status: 'INVESTIGATING', reviewerId: null });
      expect(upd.data.reviewedAt).toBeInstanceOf(Date);
    });
    it('rejects an out-of-vocabulary status (legacy IN_PROGRESS)', async () => {
      await expect(service.updateIncidentStatus('incident-1', 'IN_PROGRESS')).rejects.toThrow();
      expect(mockPrisma.safetyIncident.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('assessFallRisk', () => {
    it('should create a fall risk assessment', async () => {
      const dto = {
        patientId: 'patient-1',
        assessorId: 'user-1',
        score: 45,
        riskLevel: 'HIGH',
        factors: { age: 75, medications: 5, mobility: 'limited' },
        interventions: { bed_alarm: true, walker: true },
      };

      mockPrisma.fallRiskAssessment.create.mockResolvedValue({
        id: 'assessment-1',
        ...dto,
        assessedAt: new Date(),
        createdAt: new Date(),
      });

      const result = await service.assessFallRisk(dto);

      expect(result.id).toBe('assessment-1');
      expect(result.score).toBe(45);
      expect(result.riskLevel).toBe('HIGH');
      expect(mockPrisma.fallRiskAssessment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            patientId: 'patient-1',
            assessorId: 'user-1',
            score: 45,
            riskLevel: 'HIGH',
          }),
        })
      );
    });

    it('should assess fall risk with factors', async () => {
      const dto = {
        patientId: 'patient-2',
        assessorId: 'user-2',
        score: 65,
        riskLevel: 'CRITICAL',
        factors: {
          age: 85,
          medications: 8,
          mobility: 'bed-bound',
          mental_status: 'confused',
        },
        interventions: { bed_alarm: true, walker: false, supervision: 'constant' },
      };

      mockPrisma.fallRiskAssessment.create.mockResolvedValue({
        id: 'assessment-2',
        ...dto,
        assessedAt: new Date(),
      });

      const result = await service.assessFallRisk(dto);

      expect(result.score).toBe(65);
      expect(result.riskLevel).toBe('CRITICAL');
      expect(result.factors).toHaveProperty('age');
    });

    it('should assess fall risk without interventions', async () => {
      const dto = {
        patientId: 'patient-3',
        assessorId: 'user-1',
        score: 25,
        riskLevel: 'LOW',
        factors: { age: 45, medications: 2, mobility: 'independent' },
      };

      mockPrisma.fallRiskAssessment.create.mockResolvedValue({
        id: 'assessment-3',
        ...dto,
        interventions: null,
        assessedAt: new Date(),
      });

      const result = await service.assessFallRisk(dto);

      expect(result.score).toBe(25);
      expect(result.riskLevel).toBe('LOW');
      expect(mockPrisma.fallRiskAssessment.create).toHaveBeenCalled();
    });

    it('should include assessedAt timestamp', async () => {
      const dto = {
        patientId: 'patient-1',
        assessorId: 'user-1',
        score: 50,
        riskLevel: 'MODERATE',
        factors: { age: 70, medications: 4, mobility: 'walker' },
      };

      const now = new Date();
      mockPrisma.fallRiskAssessment.create.mockResolvedValue({
        id: 'assessment-4',
        ...dto,
        assessedAt: now,
      });

      const result = await service.assessFallRisk(dto);

      expect(result.assessedAt).toBeDefined();
    });

    it('[P1] should derive riskLevel server-side from score (ignore client value)', async () => {
      // 자가입력 riskLevel='LOW'이지만 score 50 → 서버 파생 HIGH로 저장
      mockPrisma.fallRiskAssessment.create.mockResolvedValue({ id: 'a-d' });
      await service.assessFallRisk({ patientId: 'p', assessorId: 'u', score: 50, riskLevel: 'LOW', factors: {} });
      const arg = mockPrisma.fallRiskAssessment.create.mock.calls[0][0];
      expect(arg.data.riskLevel).toBe('HIGH');
    });

    it('[P1] should emit fall.high on HIGH derived risk', async () => {
      const emit = vi.fn();
      const svc = new PatientSafetyService(mockPrisma, { emit } as any);
      mockPrisma.fallRiskAssessment.create.mockResolvedValue({ id: 'a-h' });
      await svc.assessFallRisk({ patientId: 'p', assessorId: 'u', score: 46, factors: {} });
      expect(emit).toHaveBeenCalledWith('fall.high', expect.objectContaining({ patientId: 'p' }));
    });
  });

  /* ───── Restraint (신체보호대) ───── */

  describe('restraint safety', () => {
    it('[P2] should reject monitoring on a non-ACTIVE restraint', async () => {
      mockPrisma.restraintOrder.findUnique.mockResolvedValue({ id: 'r-1', status: 'DISCONTINUED' });
      await expect(service.recordRestraintMonitoring('r-1', 'u-1', { continued: true }))
        .rejects.toMatchObject({ response: { code: 'RESTRAINT_NOT_ACTIVE' } });
    });

    it('[P1] renew should discontinue old order and create a fresh physician order', async () => {
      mockPrisma.restraintOrder.findUnique.mockResolvedValue({ id: 'r-1', status: 'ACTIVE', patientId: 'p', type: 'WRIST', reason: '자해', bodyParts: [] });
      await service.renewRestraintOrder('doc-1', 'r-1', { plannedUntil: '2026-08-01T00:00:00Z' });
      expect(mockPrisma.restraintOrder.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ status: 'DISCONTINUED', discontinuedBy: 'doc-1' }),
      }));
      expect(mockPrisma.restraintOrder.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ orderedBy: 'doc-1', patientId: 'p' }),
      }));
    });

    it('[P1] renew should reject a non-ACTIVE order', async () => {
      mockPrisma.restraintOrder.findUnique.mockResolvedValue({ id: 'r-1', status: 'DISCONTINUED' });
      await expect(service.renewRestraintOrder('doc-1', 'r-1', {}))
        .rejects.toMatchObject({ response: { code: 'RESTRAINT_NOT_ACTIVE' } });
    });

    it('[P1] active list should flag expired (plannedUntil past)', async () => {
      mockPrisma.restraintOrder.findMany.mockResolvedValue([
        { id: 'r-1', patientId: 'p', status: 'ACTIVE', startedAt: new Date(), plannedUntil: new Date(Date.now() - 3600000), monitorings: [] },
      ]);
      mockPrisma.patient = { findMany: vi.fn().mockResolvedValue([{ id: 'p', familyName: '김', givenName: '환', mrn: 'M1' }]) };
      const list = await service.getActiveRestraints();
      expect(list[0].expired).toBe(true);
      expect(list[0].overdue).toBe(true);
    });
  });

  describe('getPatientFallRisk', () => {
    it('should return fall risk assessments for patient', async () => {
      const mockAssessments = [
        {
          id: 'assessment-1',
          patientId: 'patient-1',
          score: 45,
          riskLevel: 'HIGH',
          factors: { age: 75, mobility: 'limited' },
          assessedAt: new Date('2026-05-13T12:00:00Z'),
        },
        {
          id: 'assessment-2',
          patientId: 'patient-1',
          score: 40,
          riskLevel: 'MODERATE',
          factors: { age: 75, mobility: 'limited' },
          assessedAt: new Date('2026-05-10T12:00:00Z'),
        },
      ];

      mockPrisma.fallRiskAssessment.findMany.mockResolvedValue(mockAssessments);

      const result = await service.getPatientFallRisk('patient-1');

      expect(result).toHaveLength(2);
      expect(result[0].riskLevel).toBe('HIGH');
      expect(mockPrisma.fallRiskAssessment.findMany).toHaveBeenCalledWith({
        where: { patientId: 'patient-1' },
        orderBy: { assessedAt: 'desc' },
        take: 5,
      });
    });

    it('should return empty array when no assessments exist', async () => {
      mockPrisma.fallRiskAssessment.findMany.mockResolvedValue([]);

      const result = await service.getPatientFallRisk('patient-999');

      expect(result).toEqual([]);
    });

    it('should return only last 5 assessments', async () => {
      const mockAssessments = Array.from({ length: 5 }, (_, i) => ({
        id: `assessment-${i + 1}`,
        patientId: 'patient-1',
        score: 50 - i * 5,
        riskLevel: 'HIGH',
        factors: { age: 75 },
        assessedAt: new Date(new Date().getTime() - i * 86400000),
      }));

      mockPrisma.fallRiskAssessment.findMany.mockResolvedValue(mockAssessments);

      const result = await service.getPatientFallRisk('patient-1');

      expect(result).toHaveLength(5);
      expect(mockPrisma.fallRiskAssessment.findMany).toHaveBeenCalledWith({
        where: { patientId: 'patient-1' },
        orderBy: { assessedAt: 'desc' },
        take: 5,
      });
    });

    it('should sort assessments by assessedAt in descending order', async () => {
      const mockAssessments = [
        {
          id: 'assessment-3',
          patientId: 'patient-1',
          score: 45,
          riskLevel: 'HIGH',
          assessedAt: new Date('2026-05-13T12:00:00Z'),
        },
        {
          id: 'assessment-1',
          patientId: 'patient-1',
          score: 50,
          riskLevel: 'HIGH',
          assessedAt: new Date('2026-05-10T12:00:00Z'),
        },
      ];

      mockPrisma.fallRiskAssessment.findMany.mockResolvedValue(mockAssessments);

      await service.getPatientFallRisk('patient-1');

      expect(mockPrisma.fallRiskAssessment.findMany).toHaveBeenCalledWith({
        where: { patientId: 'patient-1' },
        orderBy: { assessedAt: 'desc' },
        take: 5,
      });
    });
  });

  describe('calculateNews2 (RCP NEWS2)', () => {
    const normal = { respiratoryRate: 16, spO2: 98, supplementalO2: false, spO2Scale: 1, systolicBp: 120, heartRate: 80, consciousness: 'ALERT', temperature: 37.0 };

    it('정상 활력 → 총점 0·LOW·에스컬레이션 없음', () => {
      const r = service.calculateNews2(normal);
      expect(r.totalScore).toBe(0);
      expect(r.riskLevel).toBe('LOW');
      expect(r.escalationRequired).toBe(false);
    });

    it('[P1] 단일 항목 3점(RR 26)은 총점<5라도 red-flag → 에스컬레이션', () => {
      const r = service.calculateNews2({ ...normal, respiratoryRate: 26 });
      expect(r.totalScore).toBe(3);
      expect(r.riskLevel).toBe('LOW_MEDIUM');
      expect(r.escalationRequired).toBe(true);
    });

    it('[P2] SpO2 Scale 2(COPD) 실내공기 SpO2 98 → 0점(과점수 아님)', () => {
      const r = service.calculateNews2({ ...normal, spO2Scale: 2, spO2: 98, supplementalO2: false });
      expect(r.scoreBreakdown.spo2).toBe(0);
    });

    it('[P2] SpO2 Scale 2 보충산소 중 SpO2 98 → 3점(가점 적용)', () => {
      const r = service.calculateNews2({ ...normal, spO2Scale: 2, spO2: 98, supplementalO2: true });
      expect(r.scoreBreakdown.spo2).toBe(3);
    });

    it('Scale 2 하단(SpO2 85)은 산소 여부 무관하게 채점', () => {
      expect(service.calculateNews2({ ...normal, spO2Scale: 2, spO2: 85, supplementalO2: false }).scoreBreakdown.spo2).toBe(2);
    });
  });

  describe('getHighRiskEws', () => {
    it('[P1] escalationRequired=true 기준으로 조회(단일3점 LOW_MEDIUM 포함)', async () => {
      mockPrisma.earlyWarningScore = { findMany: vi.fn().mockResolvedValue([]) };
      await service.getHighRiskEws();
      expect(mockPrisma.earlyWarningScore.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ escalationRequired: true }) }),
      );
    });
  });
});
