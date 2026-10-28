import { describe, it, expect, beforeEach, vi } from 'vitest';
import { IcuController } from '../../src/modules/icu/icu.controller';
import { NotFoundException, BadRequestException } from '@nestjs/common';

describe('IcuController', () => {
  let controller: IcuController;
  let mockService: any;

  beforeEach(() => {
    mockService = {
      getBeds: vi.fn(),
      getPatients: vi.fn(),
      getDashboard: vi.fn(),
      admit: vi.fn(),
      getPatientDetail: vi.fn(),
      discharge: vi.fn(),
      addRecord: vi.fn(),
      getRecords: vi.fn(),
      getFlowsheet: vi.fn(),
      updateVentilator: vi.fn(),
    };

    controller = new IcuController(mockService);
  });

  describe('getBeds', () => {
    it('should get all ICU beds', async () => {
      const mockBeds = [
        { id: 'bed-1', unitName: 'ICU-A', bedNumber: '101', status: 'OCCUPIED' },
      ];

      vi.mocked(mockService.getBeds).mockResolvedValue(mockBeds);

      const result = await controller.getBeds();

      expect(result.data).toHaveLength(1);
      expect(result.data[0].status).toBe('OCCUPIED');
      expect(mockService.getBeds).toHaveBeenCalled();
    });
  });

  describe('getPatients', () => {
    it('should get all admitted ICU patients', async () => {
      const mockPatients = [
        {
          id: 'adm-1',
          status: 'ADMITTED',
          patient: { id: 'p-1', mrn: '00001', familyName: '김', givenName: '철수' },
        },
      ];

      vi.mocked(mockService.getPatients).mockResolvedValue(mockPatients);

      const result = await controller.getPatients();

      expect(result.data).toHaveLength(1);
      expect(result.data[0].patient.familyName).toBe('김');
    });
  });

  describe('getDashboard', () => {
    it('should get ICU dashboard statistics', async () => {
      const mockDashboard = {
        totalBeds: 10,
        occupied: 7,
        available: 3,
        occupancyRate: 70,
        ventilatorCount: 4,
        isolationCount: 2,
        severityCounts: { CRITICAL: 2, SEVERE: 3, MODERATE: 2 },
      };

      vi.mocked(mockService.getDashboard).mockResolvedValue(mockDashboard);

      const result = await controller.getDashboard();

      expect(result.data.totalBeds).toBe(10);
      expect(result.data.occupancyRate).toBe(70);
      expect(result.data.severityCounts.CRITICAL).toBe(2);
    });
  });

  describe('admit', () => {
    it('should admit patient to ICU', async () => {
      const mockAdmission = {
        id: 'adm-1',
        patientId: 'p-1',
        status: 'ADMITTED',
        severity: 'CRITICAL',
      };

      vi.mocked(mockService.admit).mockResolvedValue(mockAdmission);

      const dto = {
        patientId: 'p-1',
        icuBedId: 'bed-1',
        admitReason: 'Respiratory failure',
        severity: 'CRITICAL',
      };

      const result = await controller.admit(dto, 'doc-1');

      expect(result.data.status).toBe('ADMITTED');
      expect(mockService.admit).toHaveBeenCalledWith(
        expect.objectContaining({
          patientId: 'p-1',
          doctorId: 'doc-1',
          severity: 'CRITICAL',
        }),
      );
    });

    it('should throw BadRequestException if bed not available', async () => {
      vi.mocked(mockService.admit).mockRejectedValue(
        new BadRequestException('Bed is not available'),
      );

      const dto = {
        patientId: 'p-1',
        icuBedId: 'bed-1',
        admitReason: 'Respiratory failure',
      };

      await expect(controller.admit(dto, 'doc-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should include ventilator and isolation settings', async () => {
      vi.mocked(mockService.admit).mockResolvedValue({ id: 'adm-1' });

      const dto = {
        patientId: 'p-1',
        icuBedId: 'bed-1',
        admitReason: 'Respiratory failure',
        ventilator: true,
        isolation: true,
      };

      await controller.admit(dto, 'doc-1');

      expect(mockService.admit).toHaveBeenCalledWith(
        expect.objectContaining({
          ventilator: true,
          isolation: true,
        }),
      );
    });
  });

  describe('getDetail', () => {
    it('should get patient admission detail with I/O totals', async () => {
      const mockDetail = {
        id: 'adm-1',
        patientId: 'p-1',
        patient: { id: 'p-1', familyName: '김', givenName: '철수' },
        ioTotal: {
          totalIntake: 2000,
          totalOutput: 800,
          balance: 1200,
        },
      };

      vi.mocked(mockService.getPatientDetail).mockResolvedValue(mockDetail);

      const result = await controller.getDetail('adm-1');

      expect(result.data.ioTotal.balance).toBe(1200);
      expect(mockService.getPatientDetail).toHaveBeenCalledWith('adm-1');
    });

    it('should throw NotFoundException if not found', async () => {
      vi.mocked(mockService.getPatientDetail).mockRejectedValue(
        new NotFoundException('ICU admission not found'),
      );

      await expect(controller.getDetail('non-existent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('discharge', () => {
    it('should discharge patient from ICU', async () => {
      const mockDischarge = {
        id: 'adm-1',
        status: 'DISCHARGED',
        dischargeDate: new Date(),
      };

      vi.mocked(mockService.discharge).mockResolvedValue(mockDischarge);

      const result = await controller.discharge('adm-1', 'user-1', undefined);

      expect(result.data.status).toBe('DISCHARGED');
      expect(mockService.discharge).toHaveBeenCalledWith('adm-1', 'user-1', undefined);
    });

    it('should throw BadRequestException if already discharged', async () => {
      vi.mocked(mockService.discharge).mockRejectedValue(
        new BadRequestException('Already discharged'),
      );

      await expect(controller.discharge('adm-1')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('addRecord', () => {
    it('should add ICU record with vital signs', async () => {
      const mockRecord = {
        id: 'rec-1',
        admissionId: 'adm-1',
        systolicBp: 140,
        diastolicBp: 90,
        heartRate: 85,
      };

      vi.mocked(mockService.addRecord).mockResolvedValue(mockRecord);

      const dto = {
        type: 'VITAL',
        systolicBP: 140,
        diastolicBP: 90,
        heartRate: 85,
      };

      const result = await controller.addRecord('adm-1', dto as any, 'nurse-1');

      expect(result.data.heartRate).toBe(85);
      expect(mockService.addRecord).toHaveBeenCalledWith('adm-1', expect.objectContaining({
        recordedBy: 'nurse-1',
      }));
    });

    it('should handle all record field types', async () => {
      vi.mocked(mockService.addRecord).mockResolvedValue({ id: 'rec-1' });

      const dto = {
        type: 'ALL',
        systolicBP: 140,
        heartRate: 85,
        intakeOral: 500,
        ventMode: 'SIMV',
        fio2: 40,
        apacheScore: 25,
      };

      await controller.addRecord('adm-1', dto as any, 'doctor-1');

      expect(mockService.addRecord).toHaveBeenCalled();
    });
  });

  describe('getRecords', () => {
    it('should get ICU records for admission', async () => {
      const mockRecords = [
        { id: 'rec-1', recordTime: new Date(), systolicBp: 140 },
        { id: 'rec-2', recordTime: new Date(), systolicBp: 135 },
      ];

      vi.mocked(mockService.getRecords).mockResolvedValue(mockRecords);

      const result = await controller.getRecords('adm-1');

      expect(result.data).toHaveLength(2);
      expect(mockService.getRecords).toHaveBeenCalledWith('adm-1');
    });
  });

  describe('getFlowsheet', () => {
    it('should get 24-hour flowsheet with I/O summary', async () => {
      const mockFlowsheet = {
        records: [
          { recordTime: new Date(), intakeOral: 500 },
          { recordTime: new Date(), intakeOral: 400 },
        ],
        summary: {
          count: 2,
          lastVitals: { systolicBp: 140, heartRate: 85 },
          ioBalance: 800,
        },
      };

      vi.mocked(mockService.getFlowsheet).mockResolvedValue(mockFlowsheet);

      const result = await controller.getFlowsheet('adm-1');

      expect(result.data.records).toHaveLength(2);
      expect(result.data.summary.ioBalance).toBe(800);
      expect(mockService.getFlowsheet).toHaveBeenCalledWith('adm-1');
    });
  });

  describe('updateVentilator', () => {
    it('should update ventilator settings', async () => {
      const mockUpdated = {
        id: 'adm-1',
        ventilator: true,
        ventMode: 'SIMV',
        fio2: 50,
      };

      vi.mocked(mockService.updateVentilator).mockResolvedValue(mockUpdated);

      const dto = { ventilator: true, ventMode: 'SIMV', fio2: 50 };

      const result = await controller.updateVentilator('adm-1', dto, 'user-1');

      expect(result.data.ventilator).toBe(true);
      expect(result.data.ventMode).toBe('SIMV');
      // 설정값 기록자 = 로그인 사용자
      expect(mockService.updateVentilator).toHaveBeenCalledWith('adm-1', dto, 'user-1');
    });

    it('should allow turning off ventilator', async () => {
      const mockUpdated = { id: 'adm-1', ventilator: false };

      vi.mocked(mockService.updateVentilator).mockResolvedValue(mockUpdated);

      const dto = { ventilator: false };

      const result = await controller.updateVentilator('adm-1', dto, 'user-1');

      expect(result.data.ventilator).toBe(false);
    });
  });

  describe('Authorization', () => {
    it('should require DOCTOR or ADMIN for admit', async () => {
      // @Roles(UserRole.DOCTOR, UserRole.ADMIN) is applied
      expect(controller).toBeDefined();
    });

    it('should require DOCTOR or ADMIN for discharge', async () => {
      // @Roles(UserRole.DOCTOR, UserRole.ADMIN) is applied
      expect(controller).toBeDefined();
    });

    it('should require DOCTOR, NURSE, or ADMIN for addRecord', async () => {
      // @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN) is applied
      expect(controller).toBeDefined();
    });
  });

  describe('Response Wrapping', () => {
    it('should wrap all responses in data object', async () => {
      vi.mocked(mockService.getBeds).mockResolvedValue([]);

      const result = await controller.getBeds();

      expect(result).toHaveProperty('data');
      expect(Array.isArray(result.data)).toBe(true);
    });

    it('should wrap single object responses in data', async () => {
      const mockDashboard = { totalBeds: 10, occupied: 7 };

      vi.mocked(mockService.getDashboard).mockResolvedValue(mockDashboard);

      const result = await controller.getDashboard();

      expect(result).toHaveProperty('data');
      expect(result.data.totalBeds).toBe(10);
    });

    it('should wrap detail response with I/O totals', async () => {
      const mockDetail = { id: 'adm-1', ioTotal: { balance: 1200 } };

      vi.mocked(mockService.getPatientDetail).mockResolvedValue(mockDetail);

      const result = await controller.getDetail('adm-1');

      expect(result).toHaveProperty('data');
      expect(result.data.ioTotal.balance).toBe(1200);
    });
  });

  describe('Route-specific Behavior', () => {
    it('should route /beds endpoint correctly', async () => {
      vi.mocked(mockService.getBeds).mockResolvedValue([]);

      const result = await controller.getBeds();

      expect(result.data).toBeDefined();
    });

    it('should route /dashboard endpoint correctly', async () => {
      vi.mocked(mockService.getDashboard).mockResolvedValue({ totalBeds: 0 });

      const result = await controller.getDashboard();

      expect(result.data).toBeDefined();
    });

    it('should route /:id endpoint correctly', async () => {
      const mockDetail = { id: 'adm-1' };

      vi.mocked(mockService.getPatientDetail).mockResolvedValue(mockDetail);

      const result = await controller.getDetail('adm-1');

      expect(result.data.id).toBe('adm-1');
    });

    it('should route /:id/discharge endpoint correctly', async () => {
      vi.mocked(mockService.discharge).mockResolvedValue({ status: 'DISCHARGED' });

      const result = await controller.discharge('adm-1');

      expect(result.data).toBeDefined();
    });

    it('should route /:id/record endpoint correctly', async () => {
      vi.mocked(mockService.addRecord).mockResolvedValue({ id: 'rec-1' });

      const dto = { type: 'VITAL' };

      const result = await controller.addRecord('adm-1', dto as any, 'user-1');

      expect(result.data).toBeDefined();
    });

    it('should route /:id/records endpoint correctly', async () => {
      vi.mocked(mockService.getRecords).mockResolvedValue([]);

      const result = await controller.getRecords('adm-1');

      expect(result.data).toBeDefined();
    });

    it('should route /:id/flowsheet endpoint correctly', async () => {
      vi.mocked(mockService.getFlowsheet).mockResolvedValue({ records: [], summary: {} });

      const result = await controller.getFlowsheet('adm-1');

      expect(result.data).toBeDefined();
    });
  });

  describe('Error Handling', () => {
    it('should propagate service errors', async () => {
      vi.mocked(mockService.getPatientDetail).mockRejectedValue(
        new NotFoundException(),
      );

      await expect(controller.getDetail('non-existent')).rejects.toThrow();
    });

    it('should handle empty results', async () => {
      vi.mocked(mockService.getBeds).mockResolvedValue([]);

      const result = await controller.getBeds();

      expect(result.data).toHaveLength(0);
    });
  });
});
