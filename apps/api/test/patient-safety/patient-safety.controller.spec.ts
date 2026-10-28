import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PatientSafetyController } from '../../src/modules/patient-safety/patient-safety.controller';
import { PatientSafetyService } from '../../src/modules/patient-safety/patient-safety.service';

describe('PatientSafetyController', () => {
  let controller: PatientSafetyController;
  let service: PatientSafetyService;
  let permissions: { hasPermission: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    service = {
      reportIncident: vi.fn(),
      getIncidents: vi.fn(),
      updateIncidentStatus: vi.fn(),
      assessFallRisk: vi.fn(),
      getPatientFallRisk: vi.fn(),
    } as any;

    // 🔴 전담인력 권한 스텁 — 컨트롤러가 열람 범위를 권한으로 정한다(2026-08-18)
    permissions = { hasPermission: vi.fn().mockReturnValue(true) } as any;
    controller = new PatientSafetyController(service, permissions);
  });

  describe('POST /api/v1/safety/incidents (report)', () => {
    it('should report a safety incident', async () => {
      const dto = {
        patientId: 'patient-1',
        type: 'FALL',
        severity: 'HIGH',
        description: '환자가 화장실에서 낙상',
        location: 'Bathroom',
        occurredAt: '2026-05-13T10:30:00Z',
      };

      const mockIncident = {
        id: 'incident-1',
        ...dto,
        reporterId: 'user-1',
        occurredAt: new Date(dto.occurredAt),
        status: 'OPEN',
        createdAt: new Date(),
      };

      vi.mocked(service.reportIncident).mockResolvedValue(mockIncident);

      const result = await controller.report(dto, 'user-1');

      expect(result.data.id).toBe('incident-1');
      expect(result.data.type).toBe('FALL');
      expect(result.data.severity).toBe('HIGH');
      expect(service.reportIncident).toHaveBeenCalledWith({
        ...dto,
        reporterId: 'user-1',
      });
    });

    it('should report incident without patient ID', async () => {
      const dto = {
        type: 'MEDICATION_ERROR',
        severity: 'MEDIUM',
        description: '약물 용량 오류',
        occurredAt: '2026-05-13T11:00:00Z',
      };

      const mockIncident = {
        id: 'incident-2',
        patientId: null,
        ...dto,
        reporterId: 'user-1',
        occurredAt: new Date(dto.occurredAt),
        status: 'OPEN',
      };

      vi.mocked(service.reportIncident).mockResolvedValue(mockIncident);

      const result = await controller.report(dto, 'user-1');

      expect(result.data.id).toBe('incident-2');
      expect(result.data.type).toBe('MEDICATION_ERROR');
      expect(service.reportIncident).toHaveBeenCalledWith({
        ...dto,
        reporterId: 'user-1',
      });
    });

    it('should include location in response', async () => {
      const dto = {
        patientId: 'patient-1',
        type: 'PRESSURE_ULCER',
        severity: 'MEDIUM',
        description: '욕창 발생',
        location: 'ICU - Bed 5',
        occurredAt: '2026-05-13T12:00:00Z',
      };

      const mockIncident = {
        id: 'incident-3',
        ...dto,
        reporterId: 'user-1',
        occurredAt: new Date(dto.occurredAt),
        status: 'OPEN',
      };

      vi.mocked(service.reportIncident).mockResolvedValue(mockIncident);

      const result = await controller.report(dto, 'user-1');

      expect(result.data.location).toBe('ICU - Bed 5');
    });
  });

  describe('GET /api/v1/safety/incidents (getIncidents)', () => {
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

      vi.mocked(service.getIncidents).mockResolvedValue(mockIncidents);

      const result = await controller.getIncidents({ id: 'user-1', role: 'ADMIN' as any });

      expect(result.data).toHaveLength(2);
      expect(service.getIncidents).toHaveBeenCalledWith(
        { type: undefined, severity: undefined, status: undefined, },
        { userId: 'user-1', canReviewAll: true },
      );
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

      vi.mocked(service.getIncidents).mockResolvedValue(mockIncidents);

      const result = await controller.getIncidents({ id: 'user-1', role: 'ADMIN' as any }, 'FALL');

      expect(result.data).toHaveLength(1);
      expect(result.data[0].type).toBe('FALL');
      expect(service.getIncidents).toHaveBeenCalledWith(
        { type: 'FALL', severity: undefined, status: undefined, },
        { userId: 'user-1', canReviewAll: true },
      );
    });

    it('should filter incidents by severity', async () => {
      const mockIncidents = [
        {
          id: 'incident-1',
          type: 'FALL',
          severity: 'CRITICAL',
          status: 'OPEN',
          occurredAt: new Date(),
        },
      ];

      vi.mocked(service.getIncidents).mockResolvedValue(mockIncidents);

      const result = await controller.getIncidents({ id: 'user-1', role: 'ADMIN' as any }, undefined, 'CRITICAL');

      expect(result.data[0].severity).toBe('CRITICAL');
      expect(service.getIncidents).toHaveBeenCalledWith(
        { type: undefined, severity: 'CRITICAL', status: undefined, },
        { userId: 'user-1', canReviewAll: true },
      );
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

      vi.mocked(service.getIncidents).mockResolvedValue(mockIncidents);

      const result = await controller.getIncidents({ id: 'user-1', role: 'ADMIN' as any }, undefined, undefined, 'OPEN');

      expect(result.data[0].status).toBe('OPEN');
      expect(service.getIncidents).toHaveBeenCalledWith(
        { type: undefined, severity: undefined, status: 'OPEN', },
        { userId: 'user-1', canReviewAll: true },
      );
    });

    it('should filter with multiple criteria', async () => {
      const mockIncidents = [
        {
          id: 'incident-1',
          type: 'FALL',
          severity: 'HIGH',
          status: 'OPEN',
          occurredAt: new Date(),
        },
      ];

      vi.mocked(service.getIncidents).mockResolvedValue(mockIncidents);

      const result = await controller.getIncidents({ id: 'user-1', role: 'ADMIN' as any }, 'FALL', 'HIGH', 'OPEN');

      expect(result.data).toHaveLength(1);
      expect(service.getIncidents).toHaveBeenCalledWith(
        { type: 'FALL', severity: 'HIGH', status: 'OPEN', },
        { userId: 'user-1', canReviewAll: true },
      );
    });

    it('should return empty list when no matches', async () => {
      vi.mocked(service.getIncidents).mockResolvedValue([]);

      const result = await controller.getIncidents({ id: 'user-1', role: 'ADMIN' as any }, 'NON_EXISTENT');

      expect(result.data).toEqual([]);
    });
  });

  describe('PATCH /api/v1/safety/incidents/:id/status (updateStatus)', () => {
    it('should update incident status', async () => {
      const mockUpdated = {
        id: 'incident-1',
        type: 'FALL',
        severity: 'HIGH',
        status: 'CLOSED',
        actionTaken: 'Non-slip mat placed',
        updatedAt: new Date(),
      };

      vi.mocked(service.updateIncidentStatus).mockResolvedValue(mockUpdated);

      const result = await controller.updateStatus('incident-1', {
        status: 'CLOSED',
        actionTaken: 'Non-slip mat placed',
      });

      expect(result.data.status).toBe('CLOSED');
      expect(result.data.actionTaken).toBe('Non-slip mat placed');
      expect(service.updateIncidentStatus).toHaveBeenCalledWith(
        'incident-1',
        'CLOSED',
        'Non-slip mat placed',
        undefined,
      );
    });

    it('should update status without action taken', async () => {
      const mockUpdated = {
        id: 'incident-1',
        type: 'FALL',
        severity: 'HIGH',
        status: 'IN_PROGRESS',
        actionTaken: undefined,
        updatedAt: new Date(),
      };

      vi.mocked(service.updateIncidentStatus).mockResolvedValue(mockUpdated);

      const result = await controller.updateStatus('incident-1', {
        status: 'IN_PROGRESS',
      });

      expect(result.data.status).toBe('IN_PROGRESS');
      expect(service.updateIncidentStatus).toHaveBeenCalledWith('incident-1', 'IN_PROGRESS', undefined, undefined);
    });

    it('should update to INVESTIGATING status', async () => {
      const mockUpdated = {
        id: 'incident-2',
        type: 'MEDICATION_ERROR',
        status: 'INVESTIGATING',
        actionTaken: 'Root cause analysis initiated',
      };

      vi.mocked(service.updateIncidentStatus).mockResolvedValue(mockUpdated);

      const result = await controller.updateStatus('incident-2', {
        status: 'INVESTIGATING',
        actionTaken: 'Root cause analysis initiated',
      });

      expect(result.data.status).toBe('INVESTIGATING');
      expect(result.data.actionTaken).toBe('Root cause analysis initiated');
    });
  });

  describe('POST /api/v1/safety/fall-risk (assessFall)', () => {
    it('should assess fall risk', async () => {
      const dto = {
        patientId: 'patient-1',
        score: 45,
        riskLevel: 'HIGH',
        factors: { age: 75, medications: 5, mobility: 'limited' },
        interventions: { bed_alarm: true, walker: true },
      };

      const mockAssessment = {
        id: 'assessment-1',
        ...dto,
        assessorId: 'user-1',
        assessedAt: new Date(),
      };

      vi.mocked(service.assessFallRisk).mockResolvedValue(mockAssessment);

      const result = await controller.assessFall(dto, 'user-1');

      expect(result.data.id).toBe('assessment-1');
      expect(result.data.score).toBe(45);
      expect(result.data.riskLevel).toBe('HIGH');
      expect(service.assessFallRisk).toHaveBeenCalledWith({
        ...dto,
        assessorId: 'user-1',
      });
    });

    it('should assess with critical risk level', async () => {
      const dto = {
        patientId: 'patient-1',
        score: 65,
        riskLevel: 'CRITICAL',
        factors: { age: 85, medications: 8, mobility: 'bed-bound' },
        interventions: { bed_alarm: true, supervision: 'constant' },
      };

      const mockAssessment = {
        id: 'assessment-2',
        ...dto,
        assessorId: 'user-1',
        assessedAt: new Date(),
      };

      vi.mocked(service.assessFallRisk).mockResolvedValue(mockAssessment);

      const result = await controller.assessFall(dto, 'user-1');

      expect(result.data.riskLevel).toBe('CRITICAL');
      expect(result.data.score).toBe(65);
    });

    it('should assess with low risk', async () => {
      const dto = {
        patientId: 'patient-2',
        score: 15,
        riskLevel: 'LOW',
        factors: { age: 45, medications: 1, mobility: 'independent' },
        interventions: { education: true },
      };

      const mockAssessment = {
        id: 'assessment-3',
        ...dto,
        assessorId: 'user-1',
        assessedAt: new Date(),
      };

      vi.mocked(service.assessFallRisk).mockResolvedValue(mockAssessment);

      const result = await controller.assessFall(dto, 'user-1');

      expect(result.data.riskLevel).toBe('LOW');
      expect(result.data.score).toBe(15);
    });

    it('should include assessment factors in response', async () => {
      const dto = {
        patientId: 'patient-1',
        score: 50,
        riskLevel: 'MODERATE',
        factors: {
          age: 70,
          medications: 4,
          mobility: 'walker',
          mental_status: 'alert',
        },
        interventions: { walker: true, bed_alarm: true },
      };

      const mockAssessment = {
        id: 'assessment-4',
        ...dto,
        assessorId: 'user-1',
        assessedAt: new Date(),
      };

      vi.mocked(service.assessFallRisk).mockResolvedValue(mockAssessment);

      const result = await controller.assessFall(dto, 'user-1');

      expect(result.data.factors).toHaveProperty('age');
      expect(result.data.factors).toHaveProperty('medications');
      expect(result.data.factors).toHaveProperty('mobility');
    });
  });

  describe('GET /api/v1/safety/fall-risk/:patientId (getFallRisk)', () => {
    it('should return fall risk history for patient', async () => {
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

      vi.mocked(service.getPatientFallRisk).mockResolvedValue(mockAssessments);

      const result = await controller.getFallRisk('patient-1');

      expect(result.data).toHaveLength(2);
      expect(result.data[0].riskLevel).toBe('HIGH');
      expect(result.data[1].riskLevel).toBe('MODERATE');
      expect(service.getPatientFallRisk).toHaveBeenCalledWith('patient-1');
    });

    it('should return empty array when no assessments exist', async () => {
      vi.mocked(service.getPatientFallRisk).mockResolvedValue([]);

      const result = await controller.getFallRisk('patient-999');

      expect(result.data).toEqual([]);
      expect(service.getPatientFallRisk).toHaveBeenCalledWith('patient-999');
    });

    it('should return assessments in chronological order', async () => {
      const mockAssessments = [
        {
          id: 'assessment-3',
          patientId: 'patient-1',
          score: 35,
          riskLevel: 'LOW',
          factors: { age: 75 },
          assessedAt: new Date('2026-05-13T12:00:00Z'),
        },
        {
          id: 'assessment-2',
          patientId: 'patient-1',
          score: 40,
          riskLevel: 'MODERATE',
          factors: { age: 75 },
          assessedAt: new Date('2026-05-10T12:00:00Z'),
        },
        {
          id: 'assessment-1',
          patientId: 'patient-1',
          score: 45,
          riskLevel: 'HIGH',
          factors: { age: 75 },
          assessedAt: new Date('2026-05-07T12:00:00Z'),
        },
      ];

      vi.mocked(service.getPatientFallRisk).mockResolvedValue(mockAssessments);

      const result = await controller.getFallRisk('patient-1');

      expect(result.data).toHaveLength(3);
      expect(result.data[0].assessedAt > result.data[1].assessedAt).toBe(true);
    });

    it('should include risk assessment details', async () => {
      const mockAssessments = [
        {
          id: 'assessment-1',
          patientId: 'patient-1',
          assessorId: 'user-1',
          score: 45,
          riskLevel: 'HIGH',
          factors: {
            age: 75,
            medications: 5,
            mobility: 'limited',
            mental_status: 'alert',
          },
          interventions: {
            bed_alarm: true,
            walker: true,
            supervision: 'regular',
          },
          assessedAt: new Date(),
        },
      ];

      vi.mocked(service.getPatientFallRisk).mockResolvedValue(mockAssessments);

      const result = await controller.getFallRisk('patient-1');

      expect(result.data[0]).toHaveProperty('factors');
      expect(result.data[0]).toHaveProperty('interventions');
      expect(result.data[0]).toHaveProperty('score');
      expect(result.data[0]).toHaveProperty('riskLevel');
    });

    it('should return last 5 assessments only', async () => {
      const mockAssessments = Array.from({ length: 5 }, (_, i) => ({
        id: `assessment-${i + 1}`,
        patientId: 'patient-1',
        score: 50 - i * 5,
        riskLevel: 'HIGH',
        factors: { age: 75 },
        assessedAt: new Date(new Date().getTime() - i * 86400000),
      }));

      vi.mocked(service.getPatientFallRisk).mockResolvedValue(mockAssessments);

      const result = await controller.getFallRisk('patient-1');

      expect(result.data.length).toBeLessThanOrEqual(5);
    });
  });
});
