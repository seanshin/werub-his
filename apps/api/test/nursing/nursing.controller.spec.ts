import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NursingController, MedicationAdministrationController, NursingDiagnosisController } from '../../src/modules/nursing/nursing.controller';
import { NursingService } from '../../src/modules/nursing/nursing.service';

describe('NursingController', () => {
  let controller: NursingController;
  let service: NursingService;

  beforeEach(() => {
    service = {
      createAssessment: vi.fn(),
      getAssessment: vi.fn(),
      createNote: vi.fn(),
      getNotes: vi.fn(),
      lateEntryRule: vi.fn(async () => ({ graceMinutes: null, configured: false })),
      createIntakeOutput: vi.fn(),
      getIntakeOutputs: vi.fn(),
      getIntakeOutputSummary: vi.fn(),
      getMedicationSchedule: vi.fn(),
    } as any;

    controller = new NursingController(service);
  });

  describe('createAssessment', () => {
    it('should create nursing assessment', async () => {
      const dto = {
        consciousness: 'Alert',
        mobility: 'Independent',
        painScore: 3,
        bradenScore: 20,
        allergyConfirmed: true,
      };

      const mockResult = {
        id: 'na-1',
        admissionId: 'adm-1',
        ...dto,
      };

      vi.mocked(service.createAssessment).mockResolvedValue(mockResult);

      const result = await controller.createAssessment('adm-1', dto as any, 'nurse-1');

      expect(result.data).toEqual(mockResult);
      expect(service.createAssessment).toHaveBeenCalledWith('adm-1', dto, 'nurse-1');
    });
  });

  describe('getAssessment', () => {
    it('should return nursing assessment', async () => {
      const mockAssessment = {
        id: 'na-1',
        admissionId: 'adm-1',
        consciousness: 'Alert',
        painScore: 3,
      };

      vi.mocked(service.getAssessment).mockResolvedValue(mockAssessment);

      const result = await controller.getAssessment('adm-1');

      expect(result.data).toEqual(mockAssessment);
      expect(service.getAssessment).toHaveBeenCalledWith('adm-1');
    });
  });

  describe('createNote', () => {
    it('should create nursing note', async () => {
      const dto = {
        noteType: 'DAR',
        focus: '통증 관리',
        data: '좌측 하복부 통증',
        action: '진통제 투약',
        response: '환자 안정',
        shiftType: 'D',
      };

      const mockNote = {
        id: 'nn-1',
        admissionId: 'adm-1',
        nurseId: 'nurse-1',
        ...dto,
      };

      vi.mocked(service.createNote).mockResolvedValue(mockNote);

      const result = await controller.createNote('adm-1', dto as any, 'nurse-1');

      expect(result.data).toEqual(mockNote);
      expect(service.createNote).toHaveBeenCalledWith('adm-1', dto, 'nurse-1');
    });
  });

  describe('getNotes', () => {
    it('should return nursing notes', async () => {
      const mockNotes = [
        {
          id: 'nn-1',
          focus: '통증',
          shiftType: 'D',
          recordedAt: new Date(),
        },
      ];

      vi.mocked(service.getNotes).mockResolvedValue(mockNotes);

      const result = await controller.getNotes('adm-1');

      expect(result.data).toEqual(mockNotes);
      expect(service.getNotes).toHaveBeenCalledWith('adm-1', { shiftType: undefined, date: undefined });
    });

    it('should filter by shiftType', async () => {
      vi.mocked(service.getNotes).mockResolvedValue([]);

      await controller.getNotes('adm-1', 'D');

      expect(service.getNotes).toHaveBeenCalledWith('adm-1', { shiftType: 'D', date: undefined });
    });
  });

  describe('createIntakeOutput', () => {
    it('should create I/O record', async () => {
      const dto = {
        intakeType: 'Oral',
        intakeAmount: 500,
        outputType: 'Urine',
        outputAmount: 450,
      };

      const mockIO = {
        id: 'io-1',
        admissionId: 'adm-1',
        ...dto,
      };

      vi.mocked(service.createIntakeOutput).mockResolvedValue(mockIO);

      const result = await controller.createIntakeOutput('adm-1', dto as any, 'nurse-1');

      expect(result.data).toEqual(mockIO);
      expect(service.createIntakeOutput).toHaveBeenCalledWith('adm-1', dto, 'nurse-1');
    });
  });

  describe('getIntakeOutputs', () => {
    it('should return I/O records', async () => {
      const mockRecords = [
        { id: 'io-1', intakeAmount: 500, outputAmount: 450 },
      ];

      vi.mocked(service.getIntakeOutputs).mockResolvedValue(mockRecords);

      const result = await controller.getIntakeOutputs('adm-1');

      expect(result.data).toEqual(mockRecords);
      expect(result.data).toHaveLength(1);
    });
  });

  describe('getIntakeOutputSummary', () => {
    it('should return 24-hour I/O summary', async () => {
      const mockSummary = {
        date: '2026-05-13',
        totalIntake: 800,
        totalOutput: 450,
        balance: 350,
        byHour: Array(24).fill(0).map((_, i) => ({ hour: i, intake: 0, output: 0 })),
      };

      vi.mocked(service.getIntakeOutputSummary).mockResolvedValue(mockSummary);

      const result = await controller.getIntakeOutputSummary('adm-1', '2026-05-13');

      expect(result.data.totalIntake).toBe(800);
      expect(result.data.balance).toBe(350);
      expect(result.data.byHour).toHaveLength(24);
    });
  });

  describe('getMedicationSchedule', () => {
    it('should return medication schedule', async () => {
      const mockSchedule = [
        {
          id: 'ma-1',
          scheduledAt: new Date(),
          status: 'SCHEDULED',
          dose: '500mg',
          route: 'PO',
        },
      ];

      vi.mocked(service.getMedicationSchedule).mockResolvedValue(mockSchedule);

      const result = await controller.getMedicationSchedule('adm-1');

      expect(result.data).toEqual(mockSchedule);
      expect(service.getMedicationSchedule).toHaveBeenCalledWith('adm-1', undefined, false);
    });
  });
});

describe('MedicationAdministrationController', () => {
  let controller: MedicationAdministrationController;
  let service: NursingService;

  beforeEach(() => {
    service = {
      generateSchedule: vi.fn(),
      administerMed: vi.fn(),
      holdMed: vi.fn(),
    } as any;

    controller = new MedicationAdministrationController(service);
  });

  describe('generateSchedule', () => {
    it('should generate medication schedule from prescription', async () => {
      const mockSchedules = [
        { id: 'ma-1', scheduledAt: new Date(), status: 'SCHEDULED' },
      ];

      vi.mocked(service.generateSchedule).mockResolvedValue(mockSchedules);

      const result = await controller.generateSchedule('rx-1');

      expect(result.data).toEqual(mockSchedules);
      expect(service.generateSchedule).toHaveBeenCalledWith('rx-1');
    });
  });

  describe('administer', () => {
    it('should administer medication', async () => {
      const body = {
        dose: '500mg',
        route: 'PO',
        verifiedBy: 'pharmacist-1',
        notes: '정상적으로 복용',
      };

      const mockResult = {
        id: 'ma-1',
        status: 'ADMINISTERED',
        administeredAt: new Date(),
      };

      vi.mocked(service.administerMed).mockResolvedValue(mockResult);

      const result = await controller.administer('ma-1', body, 'nurse-1');

      expect(result.data.status).toBe('ADMINISTERED');
      expect(service.administerMed).toHaveBeenCalledWith('ma-1', body, 'nurse-1');
    });
  });

  describe('hold', () => {
    it('should hold medication', async () => {
      const body = { reason: '환자 거절' };

      const mockResult = {
        id: 'ma-1',
        status: 'HELD',
        holdReason: '환자 거절',
      };

      vi.mocked(service.holdMed).mockResolvedValue(mockResult);

      const result = await controller.hold('ma-1', body, 'nurse-1');

      expect(result.data.status).toBe('HELD');
      expect(service.holdMed).toHaveBeenCalledWith('ma-1', '환자 거절', 'nurse-1');
    });
  });
});

describe('NursingDiagnosisController', () => {
  let controller: NursingDiagnosisController;
  let service: NursingService;

  beforeEach(() => {
    service = {
      createDiagnosis: vi.fn(),
      getDiagnoses: vi.fn(),
      resolveDiagnosis: vi.fn(),
    } as any;

    controller = new NursingDiagnosisController(service);
  });

  describe('create', () => {
    it('should create nursing diagnosis', async () => {
      const body = {
        nandaCode: '00132',
        nandaName: '급성 통증',
        relatedFactors: '수술 후',
        expectedOutcome: '통증 완화',
      };

      const mockDiagnosis = {
        id: 'nd-1',
        assessmentId: 'na-1',
        ...body,
      };

      vi.mocked(service.createDiagnosis).mockResolvedValue(mockDiagnosis);

      const result = await controller.create('na-1', body, 'nurse-1');

      expect(result.data).toEqual(mockDiagnosis);
      expect(service.createDiagnosis).toHaveBeenCalledWith('na-1', body, 'nurse-1');
    });
  });

  describe('findByAssessment', () => {
    it('should return diagnoses for assessment', async () => {
      const mockDiagnoses = [
        {
          id: 'nd-1',
          nandaCode: '00132',
          nandaName: '급성 통증',
          status: 'ACTIVE',
        },
      ];

      vi.mocked(service.getDiagnoses).mockResolvedValue(mockDiagnoses);

      const result = await controller.findByAssessment('na-1');

      expect(result.data).toEqual(mockDiagnoses);
      expect(service.getDiagnoses).toHaveBeenCalledWith('na-1');
    });
  });

  describe('resolve', () => {
    it('should resolve nursing diagnosis', async () => {
      const mockResolved = {
        id: 'nd-1',
        status: 'RESOLVED',
      };

      vi.mocked(service.resolveDiagnosis).mockResolvedValue(mockResolved);

      const result = await controller.resolve('nd-1');

      expect(result.data.status).toBe('RESOLVED');
      expect(service.resolveDiagnosis).toHaveBeenCalledWith('nd-1');
    });
  });
});
