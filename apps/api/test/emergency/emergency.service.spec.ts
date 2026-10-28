import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EmergencyService } from '../../src/modules/emergency/emergency.service';
import { NotFoundException } from '@nestjs/common';
import { KtasLevel, EmergencyDisposition } from '../../src/modules/emergency/dto/emergency.dto';

describe('EmergencyService', () => {
  let service: EmergencyService;
  let mockPrisma: any;
  let mockAdmissions: any;

  beforeEach(() => {
    mockPrisma = {
      // 정본이 처분 원장·방문 상태를 한 트랜잭션에서 쓴다(I2) — 목도 같은 호출 모양을 준다
      $transaction: vi.fn(async (arg: any) => (typeof arg === 'function' ? arg(mockPrisma) : Promise.all(arg))),
      // 🔴 처분 원장 — 목에 이 모델이 없으면 "처분이 원장 없이 필드에만 쓰인다"는 결함을 원리적으로 못 잡는다
      emergencyDispositionRecord: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({ id: 'dr-x' }), update: vi.fn() },
      patient: {
        findUnique: vi.fn(),
      },
      user: {
        findUnique: vi.fn(),
      },
      emergencyVisit: {
        create: vi.fn(),
        findUnique: vi.fn(),
        findMany: vi.fn(),
        update: vi.fn(),
      },
      bed: {
        findUnique: vi.fn(),
      },
      admission: {
        create: vi.fn(),
      },
    };

    // 응급 경유 입원은 AdmissionService.create로 위임(병상 선점·중복가드·정합) — 목 주입
    mockAdmissions = { create: vi.fn() };

    service = new EmergencyService(mockPrisma, undefined, undefined, undefined, undefined, mockAdmissions);
  });

  describe('createTriage', () => {
    it('should create triage for patient', async () => {
      const dto = {
        patientId: 'pat-1',
        chiefComplaint: '가슴 통증',
        triageLevel: KtasLevel.LEVEL_2,
      };

      mockPrisma.patient.findUnique.mockResolvedValue({ id: 'pat-1' });
      mockPrisma.emergencyVisit.create.mockResolvedValue({
        id: 'emg-1',
        ...dto,
        arrivalAt: new Date(),
        patient: { familyName: '김', givenName: '환자' },
      });

      const result = await service.createTriage(dto);

      expect(result.chiefComplaint).toBe('가슴 통증');
      expect(result.triageLevel).toBe(KtasLevel.LEVEL_2);
    });

    it('should throw NotFoundException if patient not found', async () => {
      mockPrisma.patient.findUnique.mockResolvedValue(null);

      await expect(
        service.createTriage({
          patientId: 'pat-1',
          chiefComplaint: '가슴 통증',
          triageLevel: KtasLevel.LEVEL_2,
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('recordVitalSigns', () => {
    it('should record vital signs for patient', async () => {
      mockPrisma.emergencyVisit.findUnique.mockResolvedValue({
        id: 'emg-1',
        patientId: 'pat-1',
      });

      mockPrisma.emergencyVisit.update.mockResolvedValue({
        id: 'emg-1',
        vitalSigns: {
          systolicBP: 140,
          diastolicBP: 90,
          heartRate: 95,
          temperature: 37.5,
        },
      });

      const result = await service.recordVitalSigns('emg-1', {
        systolicBP: 140,
        diastolicBP: 90,
        heartRate: 95,
        temperature: 37.5,
      });

      expect(result.vitalSigns.systolicBP).toBe(140);
    });
  });

  describe('getEmergencyQueue', () => {
    it('should return emergency visits sorted by triage level', async () => {
      const mockVisits = [
        {
          id: 'emg-1',
          patientId: 'pat-1',
          patient: { familyName: '김', givenName: '환자' },
          chiefComplaint: '가슴 통증',
          triageLevel: KtasLevel.LEVEL_2,
          arrivalAt: new Date(),
          disposition: null,
        },
      ];

      mockPrisma.emergencyVisit.findMany.mockResolvedValue(mockVisits);

      const result = await service.getEmergencyQueue();

      expect(result).toHaveLength(1);
      expect(result[0].triageLevel).toBe(KtasLevel.LEVEL_2);
      expect(result[0].patientName).toBe('김환자');
    });
  });

  describe('updateEmergencyStatus (§6 회수 — 고아 EP 가 정본 makeDisposition 에 위임한다)', () => {
    it('🔴 처분이 원장(EmergencyDispositionRecord)에 결정자와 함께 남는다 — 필드만 쓰던 종전으로 되돌리면 실패한다', async () => {
      mockPrisma.emergencyVisit.findUnique.mockResolvedValue({ id: 'emg-1', disposition: null, patientId: 'p-1' });
      mockPrisma.emergencyDispositionRecord.findUnique.mockResolvedValue(null);
      mockPrisma.emergencyDispositionRecord.create.mockResolvedValue({ id: 'dr-1', visitId: 'emg-1', decidedBy: 'u-1', disposition: 'DISCHARGE' });
      mockPrisma.emergencyVisit.update.mockResolvedValue({
        id: 'emg-1',
        disposition: EmergencyDisposition.DISCHARGE,
        patient: { familyName: '김', givenName: '환자' },
      });

      const result = await service.updateEmergencyStatus('emg-1', 'u-1', {
        status: EmergencyDisposition.DISCHARGE,
      });

      // 원장에 결정자가 남는다 — 이 단언이 이 테스트의 존재 이유다
      expect(mockPrisma.emergencyDispositionRecord.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ visitId: 'emg-1', decidedBy: 'u-1', disposition: 'DISCHARGE' }) }),
      );
      expect(result.disposition).toBe(EmergencyDisposition.DISCHARGE);
    });

    it('대조군 — 위임 후 마무리 update 가 disposition 을 다시 쓰지 않는다(멱등 시각 보존을 깨지 않게)', async () => {
      mockPrisma.emergencyVisit.findUnique.mockResolvedValue({ id: 'emg-1', disposition: null, patientId: 'p-1' });
      mockPrisma.emergencyDispositionRecord.findUnique.mockResolvedValue(null);
      mockPrisma.emergencyDispositionRecord.create.mockResolvedValue({ id: 'dr-1' });
      mockPrisma.emergencyVisit.update.mockResolvedValue({ id: 'emg-1', patient: {} });

      await service.updateEmergencyStatus('emg-1', 'u-1', { status: EmergencyDisposition.DISCHARGE, notes: '메모' });
      const finalCall = mockPrisma.emergencyVisit.update.mock.calls.at(-1)[0];
      expect(finalCall.data).not.toHaveProperty('disposition');
      expect(finalCall.data).not.toHaveProperty('dispositionAt');
      expect(finalCall.data.treatmentNote).toBe('메모');
    });
  });

  describe('getEmergencyAnalytics', () => {
    it('should return emergency statistics', async () => {
      const mockVisits = [
        {
          id: 'emg-1',
          triageLevel: KtasLevel.LEVEL_2,
          disposition: EmergencyDisposition.DISCHARGE,
          arrivalAt: new Date('2026-05-01'),
          dispositionAt: new Date('2026-05-01T02:00:00'),
          admissionId: null,
        },
        {
          id: 'emg-2',
          triageLevel: KtasLevel.LEVEL_3,
          disposition: EmergencyDisposition.ADMISSION,
          arrivalAt: new Date('2026-05-01'),
          dispositionAt: new Date('2026-05-01T03:00:00'),
          admissionId: 'adm-1',
        },
      ];

      mockPrisma.emergencyVisit.findMany.mockResolvedValue(mockVisits);

      const result = await service.getEmergencyAnalytics();

      expect(result.totalPatients).toBe(2);
      expect(result.byTriageLevel[KtasLevel.LEVEL_2]).toBe(1);
      expect(result.dischargeRate).toBeGreaterThan(0);
    });
  });

  describe('transferToAdmission', () => {
    it('should transfer to admission with bed assignment', async () => {
      mockPrisma.emergencyVisit.findUnique.mockResolvedValue({
        id: 'emg-1',
        patientId: 'pat-1',
        chiefComplaint: '가슴 통증',
      });

      mockPrisma.emergencyVisit.update.mockResolvedValue({
        id: 'emg-1',
        disposition: EmergencyDisposition.ADMISSION,
      });

      // AdmissionService.create가 병상 선점·중복가드·정합을 처리하고 입원 레코드 반환
      mockAdmissions.create.mockResolvedValue({
        id: 'adm-1',
        patientId: 'pat-1',
        bedId: 'bed-1',
        admittingDoctorId: 'doc-1',
        admitDate: new Date(),
      });

      const result = await service.transferToAdmission('emg-1', 'bed-1', 'doc-1', 'u-1');

      expect(result.patientId).toBe('pat-1');
      expect(result.bedId).toBe('bed-1');
      // 정합 admit 위임 + 응급방문↔입원 연계(admissionId) 확인
      expect(mockAdmissions.create).toHaveBeenCalledWith('pat-1', 'bed-1', 'doc-1', expect.any(String), expect.any(String));
      // 🔴 §6 회수 — 입원 처분이 원장에 결정자와 함께 남는다(종전엔 필드만 써서 결정자 미상)
      expect(mockPrisma.emergencyDispositionRecord.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ visitId: 'emg-1', decidedBy: 'u-1', disposition: 'ADMISSION', admissionId: 'adm-1' }) }),
      );
      expect(mockPrisma.emergencyVisit.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ admissionId: 'adm-1', status: 'COMPLETED' }) }),
      );
    });

    it('should throw NotFoundException if emergency visit not found', async () => {
      mockPrisma.emergencyVisit.findUnique.mockResolvedValue(null);

      await expect(
        service.transferToAdmission('emg-1', 'bed-1', 'doc-1', 'u-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should propagate bed-conflict error from AdmissionService (병상 선점 위임)', async () => {
      mockPrisma.emergencyVisit.findUnique.mockResolvedValue({
        id: 'emg-1',
        patientId: 'pat-1',
      });
      // 병상 점유/미존재 검증은 AdmissionService.create 내부(비관적 선점)에서 수행 → 에러 전파만 확인
      mockAdmissions.create.mockRejectedValue(new NotFoundException('Bed not found'));

      await expect(
        service.transferToAdmission('emg-1', 'bed-1', 'doc-1', 'u-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
