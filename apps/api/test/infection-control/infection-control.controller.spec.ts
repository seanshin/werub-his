import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InfectionControlController } from '../../src/modules/infection-control/infection-control.controller';
import { InfectionControlService } from '../../src/modules/infection-control/infection-control.service';
import { IsolationType, InfectionStatus } from '../../src/modules/infection-control/dto/infection-control.dto';

describe('InfectionControlController', () => {
  let controller: InfectionControlController;
  let service: InfectionControlService;

  beforeEach(() => {
    service = {
      createInfectionReport: vi.fn(),
      updateInfectionStatus: vi.fn(),
      getInfectionQueue: vi.fn(),
      addContactTrace: vi.fn(),
      addBulkContactTraces: vi.fn(),
      getInfectionAnalytics: vi.fn(),
      detectOutbreakAlert: vi.fn(),
      getIsolationProtocol: vi.fn(),
    } as any;

    controller = new InfectionControlController(service);
  });

  describe('createInfectionReport', () => {
    it('should create infection report with 201 status', async () => {
      const dto = {
        patientId: 'pat-1',
        diseaseName: '코로나19',
        confirmationDate: '2026-05-13',
        isolationType: IsolationType.DROPLET,
      };

      const mockReport = { id: 'inf-1', ...dto, status: 'SUSPECTED' };
      vi.mocked(service.createInfectionReport).mockResolvedValue(mockReport);

      const result = await controller.createInfectionReport(dto);

      expect(result.data).toEqual(mockReport);
      expect(result.meta.status).toBe('created');
    });
  });

  describe('getInfectionQueue', () => {
    it('should return list of active infections', async () => {
      const mockQueue = [
        {
          id: 'inf-1',
          patientId: 'pat-1',
          patientName: '김환자',
          diseaseName: '코로나19',
          status: InfectionStatus.SUSPECTED,
          confirmationDate: new Date(),
          isolationType: IsolationType.DROPLET,
          contactCount: 3,
        },
      ];

      vi.mocked(service.getInfectionQueue).mockResolvedValue(mockQueue);

      const result = await controller.getInfectionQueue();

      expect(result.data).toEqual(mockQueue);
      expect(result.meta.count).toBe(1);
    });
  });

  describe('updateInfectionStatus', () => {
    it('should update infection status from SUSPECTED to CONFIRMED', async () => {
      const dto = { status: InfectionStatus.CONFIRMED };
      const mockUpdated = { id: 'inf-1', status: 'CONFIRMED' };

      vi.mocked(service.updateInfectionStatus).mockResolvedValue(mockUpdated);

      const result = await controller.updateInfectionStatus('inf-1', dto);

      expect(result.data.status).toBe('CONFIRMED');
    });
  });

  describe('addContactTrace', () => {
    it('should add contact trace and return 201', async () => {
      const dto = {
        sourcePatientId: 'pat-1',
        contactPersonId: 'pat-2',
        relationshipType: 'FAMILY' as any,
        riskLevel: 'HIGH' as any,
      };

      const mockTrace = { id: 'inf-2', patientId: 'pat-2', status: 'SUSPECTED' };
      vi.mocked(service.addContactTrace).mockResolvedValue(mockTrace);

      const result = await controller.addContactTrace(dto);

      expect(result.data).toEqual(mockTrace);
      expect(result.meta.status).toBe('created');
    });
  });

  describe('addBulkContactTraces', () => {
    it('should add multiple contact traces', async () => {
      const dto = {
        sourcePatientId: 'pat-1',
        contactPersonIds: ['pat-2', 'pat-3', 'pat-4'],
        relationshipType: 'FAMILY' as any,
        riskLevel: 'HIGH' as any,
      };

      const mockResult = { created: 3, total: 3 };
      vi.mocked(service.addBulkContactTraces).mockResolvedValue(mockResult);

      const result = await controller.addBulkContactTraces(dto);

      expect(result.data.created).toBe(3);
      expect(result.meta.status).toBe('created');
    });
  });

  describe('getInfectionAnalytics', () => {
    it('should return infection statistics', async () => {
      const mockStats = {
        totalCases: 5,
        confirmedCases: 4,
        suspectedCases: 1,
        resolvedCases: 0,
        activeIsolations: 5,
        totalContacts: 15,
        highRiskContacts: 8,
        byDisease: { '코로나19': 5 },
        byWard: {},
        byIsolationType: { DROPLET: 3, CONTACT: 2 },
        dailyTrend: [],
      };

      vi.mocked(service.getInfectionAnalytics).mockResolvedValue(mockStats);

      const result = await controller.getInfectionAnalytics();

      expect(result.data.totalCases).toBe(5);
      expect(result.data.activeIsolations).toBe(5);
    });
  });

  describe('checkAlerts', () => {
    it('should return outbreak alert when detected', async () => {
      const mockAlert = {
        type: 'OUTBREAK',
        severity: 'CRITICAL',
        message: 'Potential outbreak detected',
        affectedCount: 5,
        diseaseNames: ['코로나19'],
        recommendedActions: ['Initiate outbreak investigation'],
      };

      vi.mocked(service.detectOutbreakAlert).mockResolvedValue(mockAlert);

      const result = await controller.checkAlerts();

      expect(result.data).toEqual(mockAlert);
      expect(result.meta.hasAlert).toBe(true);
    });

    it('should return null alert when no outbreak', async () => {
      vi.mocked(service.detectOutbreakAlert).mockResolvedValue(null);

      const result = await controller.checkAlerts();

      expect(result.data).toBeNull();
      expect(result.meta.hasAlert).toBe(false);
    });
  });

  describe('getIsolationProtocol', () => {
    it('should return protocol for DROPLET isolation', async () => {
      const mockProtocol = {
        isolationType: 'DROPLET',
        standardDurationDays: 5,
        requiredPPE: ['Surgical mask', 'Eye protection'],
        environmentalMeasures: ['Door closed', 'Standard cleaning'],
        visitationPolicy: 'Limited',
        staffEducationRequired: true,
      };

      vi.mocked(service.getIsolationProtocol).mockResolvedValue(mockProtocol);

      const result = await controller.getIsolationProtocol(IsolationType.DROPLET);

      expect(result.data.standardDurationDays).toBe(5);
      expect(result.data.requiredPPE).toContain('Surgical mask');
    });

    it('should return protocol for STRICT isolation with maximum precautions', async () => {
      const mockProtocol = {
        isolationType: 'STRICT',
        standardDurationDays: 14,
        requiredPPE: ['Full PPE', 'N95 respirator', 'Double gown'],
        environmentalMeasures: ['Negative pressure room', 'Triple containment'],
        visitationPolicy: 'Prohibited',
        staffEducationRequired: true,
      };

      vi.mocked(service.getIsolationProtocol).mockResolvedValue(mockProtocol);

      const result = await controller.getIsolationProtocol(IsolationType.STRICT);

      expect(result.data.standardDurationDays).toBe(14);
      expect(result.data.visitationPolicy).toBe('Prohibited');
    });
  });
});
