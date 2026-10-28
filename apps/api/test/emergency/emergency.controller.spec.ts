import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EmergencyController } from '../../src/modules/emergency/emergency.controller';
import { EmergencyService } from '../../src/modules/emergency/emergency.service';
import { KtasLevel, EmergencyDisposition } from '../../src/modules/emergency/dto/emergency.dto';

describe('EmergencyController', () => {
  let controller: EmergencyController;
  let service: EmergencyService;

  beforeEach(() => {
    service = {
      createTriage: vi.fn(),
      recordVitalSigns: vi.fn(),
      getEmergencyQueue: vi.fn(),
      updateEmergencyStatus: vi.fn(),
      getEmergencyDetail: vi.fn(),
      getEmergencyAnalytics: vi.fn(),
      transferToAdmission: vi.fn(),
    } as any;

    controller = new EmergencyController(service);
  });

  describe('createTriage', () => {
    it('should create triage and return response with meta', async () => {
      const dto = {
        patientId: 'pat-1',
        chiefComplaint: '가슴 통증',
        triageLevel: KtasLevel.LEVEL_2,
      };

      const mockTriage = {
        id: 'emg-1',
        ...dto,
        arrivalAt: new Date(),
        patient: { familyName: '김', givenName: '환자' },
      };

      vi.mocked(service.createTriage).mockResolvedValue(mockTriage);

      const result = await controller.createTriage(dto, 'nurse-1');

      expect(result.data).toEqual(mockTriage);
      expect(result.meta.status).toBe('created');
      // 🔴 분류자(triageNurseId)는 법정 기록이다 — 컨트롤러가 주체를 서비스에 넘기지 않으면
      //    원장에 누가 분류했는지 남지 않는다(5단계 실측: 개통 이래 전건 null).
      expect(service.createTriage).toHaveBeenCalledWith(dto, 'nurse-1');
    });
  });

  describe('recordVitalSigns', () => {
    it('should record vital signs and return updated data', async () => {
      const visitId = 'emg-1';
      const dto = {
        systolicBP: 140,
        diastolicBP: 90,
        heartRate: 88,
        respiratoryRate: 16,
        spO2: 98,
        temperature: 36.5,
        consciousness: 'alert',
      };

      const mockUpdated = { id: visitId, vitalSigns: dto };

      vi.mocked(service.recordVitalSigns).mockResolvedValue(mockUpdated);

      const result = await controller.recordVitalSigns(visitId, dto, 'user-1');

      expect(result.data).toEqual(mockUpdated);
      expect(result.meta.status).toBe('recorded');
      expect(service.recordVitalSigns).toHaveBeenCalledWith(visitId, dto, 'user-1');
    });
  });

  describe('getEmergencyQueue', () => {
    it('should return emergency queue with count meta', async () => {
      const mockQueue = [
        {
          id: 'emg-1',
          patientId: 'pat-1',
          patientName: '김환자',
          chiefComplaint: '가슴 통증',
          triageLevel: KtasLevel.LEVEL_2,
          waitingMinutes: 15,
        },
        {
          id: 'emg-2',
          patientId: 'pat-2',
          patientName: '이환자',
          chiefComplaint: '상처',
          triageLevel: KtasLevel.LEVEL_4,
          waitingMinutes: 45,
        },
      ];

      vi.mocked(service.getEmergencyQueue).mockResolvedValue(mockQueue);

      const result = await controller.getEmergencyQueue();

      expect(result.data).toEqual(mockQueue);
      expect(result.meta.count).toBe(2);
      expect(service.getEmergencyQueue).toHaveBeenCalled();
    });

    it('should return empty queue when no visits', async () => {
      vi.mocked(service.getEmergencyQueue).mockResolvedValue([]);

      const result = await controller.getEmergencyQueue();

      expect(result.data).toEqual([]);
      expect(result.meta.count).toBe(0);
    });
  });

  describe('updateEmergencyStatus', () => {
    it('should update emergency status', async () => {
      const id = 'emg-1';
      const dto = { status: EmergencyDisposition.DISCHARGE };

      const mockUpdated = {
        id,
        disposition: EmergencyDisposition.DISCHARGE,
        patient: { familyName: '김', givenName: '환자' },
      };

      vi.mocked(service.updateEmergencyStatus).mockResolvedValue(mockUpdated);

      const result = await controller.updateEmergencyStatus(id, dto, 'u-1');

      expect(result.data).toEqual(mockUpdated);
      // 🔴 결정자(userId)가 함께 넘어간다 — 원장 기록의 전제다
      expect(service.updateEmergencyStatus).toHaveBeenCalledWith(id, 'u-1', dto);
    });
  });

  describe('getEmergencyDetail', () => {
    it('should return emergency visit detail', async () => {
      const id = 'emg-1';
      const mockDetail = {
        id,
        patientId: 'pat-1',
        patient: { familyName: '김', givenName: '환자' },
        chiefComplaint: '가슴 통증',
        triageLevel: KtasLevel.LEVEL_2,
        vitalSigns: {
          systolicBP: 140,
          diastolicBP: 90,
          heartRate: 88,
        },
        arrivalAt: new Date(),
      };

      vi.mocked(service.getEmergencyDetail).mockResolvedValue(mockDetail);

      const result = await controller.getEmergencyDetail(id);

      expect(result.data).toEqual(mockDetail);
      expect(service.getEmergencyDetail).toHaveBeenCalledWith(id);
    });
  });

  describe('getEmergencyAnalytics', () => {
    it('should return analytics without date filters', async () => {
      const mockStats = {
        totalPatients: 150,
        byTriageLevel: { LEVEL_1: 5, LEVEL_2: 20, LEVEL_3: 50, LEVEL_4: 60, LEVEL_5: 15 },
        byDisposition: { DISCHARGE: 120, ADMISSION: 25 },
        avgWaitingTime: 0,
        avgTreatmentTime: 180,
        dischargeRate: 80,
        admissionRate: 16.67,
      };

      vi.mocked(service.getEmergencyAnalytics).mockResolvedValue(mockStats);

      const result = await controller.getEmergencyAnalytics();

      expect(result.data).toEqual(mockStats);
      expect(service.getEmergencyAnalytics).toHaveBeenCalledWith(undefined, undefined);
    });

    it('should return analytics with date filters', async () => {
      const startDate = '2026-05-01';
      const endDate = '2026-05-13';

      const mockStats = {
        totalPatients: 50,
        byTriageLevel: { LEVEL_2: 8, LEVEL_3: 20, LEVEL_4: 20, LEVEL_5: 2 },
        byDisposition: { DISCHARGE: 40, ADMISSION: 8 },
        avgWaitingTime: 0,
        avgTreatmentTime: 165,
        dischargeRate: 80,
        admissionRate: 16,
      };

      vi.mocked(service.getEmergencyAnalytics).mockResolvedValue(mockStats);

      const result = await controller.getEmergencyAnalytics(startDate, endDate);

      expect(result.data).toEqual(mockStats);
      expect(service.getEmergencyAnalytics).toHaveBeenCalledWith(
        new Date(startDate),
        new Date(endDate),
      );
    });
  });

  describe('transferToAdmission', () => {
    it('should transfer patient to admission and create record', async () => {
      const visitId = 'emg-1';
      const dto = { bedId: 'bed-101', admittingDoctorId: 'doc-1' };

      const mockAdmission = {
        id: 'adm-1',
        patientId: 'pat-1',
        bedId: 'bed-101',
        admittingDoctorId: 'doc-1',
        admitDate: new Date(),
      };

      vi.mocked(service.transferToAdmission).mockResolvedValue(mockAdmission);

      const result = await controller.transferToAdmission(visitId, dto, 'u-1');

      expect(result.data).toEqual(mockAdmission);
      expect(result.meta.status).toBe('admitted');
      expect(service.transferToAdmission).toHaveBeenCalledWith(visitId, 'bed-101', 'doc-1', 'u-1');
    });
  });
});
