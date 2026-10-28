import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AdmissionController } from '../../src/modules/admission/admission.controller';
import { AdmissionService } from '../../src/modules/admission/admission.service';
import { AdmissionStatus, BedStatus } from '@prisma/client';

describe('AdmissionController', () => {
  let controller: AdmissionController;
  let service: AdmissionService;

  beforeEach(() => {
    service = {
      create: vi.fn(),
      discharge: vi.fn(),
      transferBed: vi.fn(),
      getDetail: vi.fn(),
      getPatientAdmissions: vi.fn(),
      getActiveAdmissions: vi.fn(),
      updateAdmission: vi.fn(),
    } as any;

    controller = new AdmissionController(service);
  });

  describe('create', () => {
    it('should create admission with all fields', async () => {
      const dto = {
        patientId: 'pat-1',
        bedId: 'bed-1',
        admittingDoctorId: 'doc-1',
        admitDate: '2026-05-13',
        admitReason: '위경련',
        dietType: '일반식',
      };

      const mockAdmission = {
        id: 'adm-1',
        ...dto,
        status: AdmissionStatus.ADMITTED,
        patient: { id: 'pat-1', mrn: 'MR001', familyName: '김', givenName: '환자' },
        bed: { id: 'bed-1', roomNumber: '101', bedNumber: 'A' },
      };

      vi.mocked(service.create).mockResolvedValue(mockAdmission);

      const result = await controller.create(dto);

      expect(result.data.id).toBe('adm-1');
      expect(result.data.status).toBe(AdmissionStatus.ADMITTED);
      expect(service.create).toHaveBeenCalledWith(
        'pat-1',
        'bed-1',
        'doc-1',
        '2026-05-13',
        '위경련',
        '일반식'
      );
    });

    it('should create admission without optional fields', async () => {
      const dto = {
        patientId: 'pat-1',
        bedId: 'bed-1',
        admittingDoctorId: 'doc-1',
        admitDate: '2026-05-13',
      };

      const mockAdmission = {
        id: 'adm-1',
        ...dto,
        admitReason: null,
        dietType: null,
      };

      vi.mocked(service.create).mockResolvedValue(mockAdmission);

      const result = await controller.create(dto);

      expect(result.data.admitReason).toBeNull();
      expect(result.data.dietType).toBeNull();
      expect(service.create).toHaveBeenCalledWith('pat-1', 'bed-1', 'doc-1', '2026-05-13', undefined, undefined);
    });
  });

  describe('discharge', () => {
    it('should discharge admission with summary', async () => {
      const dto = {
        dischargeDate: '2026-05-20',
        dischargeSummary: '회복되어 퇴원',
      };

      const mockAdmission = {
        id: 'adm-1',
        status: AdmissionStatus.DISCHARGED,
        dischargeDate: new Date('2026-05-20'),
        dischargeSummary: '회복되어 퇴원',
      };

      vi.mocked(service.discharge).mockResolvedValue(mockAdmission);

      const result = await controller.discharge('adm-1', dto);

      expect(result.data.status).toBe(AdmissionStatus.DISCHARGED);
      expect(service.discharge).toHaveBeenCalledWith('adm-1', '2026-05-20', '회복되어 퇴원');
    });

    it('should discharge without summary', async () => {
      const dto = { dischargeDate: '2026-05-20' };

      const mockAdmission = {
        id: 'adm-1',
        status: AdmissionStatus.DISCHARGED,
        dischargeSummary: null,
      };

      vi.mocked(service.discharge).mockResolvedValue(mockAdmission);

      const result = await controller.discharge('adm-1', dto);

      expect(result.data.status).toBe(AdmissionStatus.DISCHARGED);
      expect(service.discharge).toHaveBeenCalledWith('adm-1', '2026-05-20', undefined);
    });
  });

  describe('transferBed', () => {
    it('should transfer bed with reason', async () => {
      const dto = {
        newBedId: 'bed-2',
        reason: '상태 악화로 인한 전동',
      };

      const mockAdmission = {
        id: 'adm-1',
        bedId: 'bed-2',
        bed: { id: 'bed-2', roomNumber: '102', bedNumber: 'B' },
      };

      vi.mocked(service.transferBed).mockResolvedValue(mockAdmission);

      const result = await controller.transferBed('adm-1', dto);

      expect(result.data.bedId).toBe('bed-2');
      expect(service.transferBed).toHaveBeenCalledWith('adm-1', 'bed-2', '상태 악화로 인한 전동');
    });

    it('should transfer bed without reason', async () => {
      const dto = { newBedId: 'bed-2' };

      const mockAdmission = {
        id: 'adm-1',
        bedId: 'bed-2',
      };

      vi.mocked(service.transferBed).mockResolvedValue(mockAdmission);

      const result = await controller.transferBed('adm-1', dto);

      expect(result.data.bedId).toBe('bed-2');
      expect(service.transferBed).toHaveBeenCalledWith('adm-1', 'bed-2', undefined);
    });
  });

  describe('getDetail', () => {
    it('should return admission detail', async () => {
      const mockAdmission = {
        id: 'adm-1',
        patientId: 'pat-1',
        bedId: 'bed-1',
        status: AdmissionStatus.ADMITTED,
        patient: { id: 'pat-1', mrn: 'MR001', familyName: '김', givenName: '환자' },
        bed: { id: 'bed-1', roomNumber: '101', bedNumber: 'A', ward: { name: '내과' } },
      };

      vi.mocked(service.getDetail).mockResolvedValue(mockAdmission);

      const result = await controller.getDetail('adm-1');

      expect(result.data.id).toBe('adm-1');
      expect(result.data.patient.mrn).toBe('MR001');
      expect(service.getDetail).toHaveBeenCalledWith('adm-1');
    });
  });

  describe('getPatientAdmissions', () => {
    it('should return all admissions for patient', async () => {
      const mockAdmissions = [
        {
          id: 'adm-1',
          patientId: 'pat-1',
          admitDate: new Date('2026-05-13'),
          status: AdmissionStatus.ADMITTED,
          bed: { roomNumber: '101', bedNumber: 'A', ward: { name: '내과' } },
        },
        {
          id: 'adm-2',
          patientId: 'pat-1',
          admitDate: new Date('2026-04-01'),
          status: AdmissionStatus.DISCHARGED,
          bed: { roomNumber: '102', bedNumber: 'B', ward: { name: '외과' } },
        },
      ];

      vi.mocked(service.getPatientAdmissions).mockResolvedValue(mockAdmissions);

      const result = await controller.getPatientAdmissions('pat-1');

      expect(result.data).toHaveLength(2);
      expect(result.data[0].status).toBe(AdmissionStatus.ADMITTED);
      expect(service.getPatientAdmissions).toHaveBeenCalledWith('pat-1');
    });

    it('should return empty list when patient has no admissions', async () => {
      vi.mocked(service.getPatientAdmissions).mockResolvedValue([]);

      const result = await controller.getPatientAdmissions('pat-1');

      expect(result.data).toEqual([]);
    });
  });

  describe('getActiveAdmissions', () => {
    it('should return all active admissions', async () => {
      const mockAdmissions = [
        {
          id: 'adm-1',
          patientId: 'pat-1',
          admitDate: new Date('2026-05-13'),
          status: AdmissionStatus.ADMITTED,
          patient: { id: 'pat-1', mrn: 'MR001', familyName: '김', givenName: '환자' },
          bed: { roomNumber: '101', bedNumber: 'A', ward: { name: '내과' } },
        },
        {
          id: 'adm-2',
          patientId: 'pat-2',
          admitDate: new Date('2026-05-10'),
          status: AdmissionStatus.ADMITTED,
          patient: { id: 'pat-2', mrn: 'MR002', familyName: '이', givenName: '환자' },
          bed: { roomNumber: '102', bedNumber: 'B', ward: { name: '외과' } },
        },
      ];

      vi.mocked(service.getActiveAdmissions).mockResolvedValue(mockAdmissions);

      const result = await controller.getActiveAdmissions();

      expect(result.data).toHaveLength(2);
      expect(result.data[0].status).toBe(AdmissionStatus.ADMITTED);
      expect(result.data[1].status).toBe(AdmissionStatus.ADMITTED);
      expect(service.getActiveAdmissions).toHaveBeenCalled();
    });

    it('should return empty list when no active admissions', async () => {
      vi.mocked(service.getActiveAdmissions).mockResolvedValue([]);

      const result = await controller.getActiveAdmissions();

      expect(result.data).toEqual([]);
    });
  });

  describe('updateAdmission', () => {
    it('should update diet type', async () => {
      const dto = { dietType: '연식' };

      const mockAdmission = {
        id: 'adm-1',
        dietType: '연식',
      };

      vi.mocked(service.updateAdmission).mockResolvedValue(mockAdmission);

      const result = await controller.updateAdmission('adm-1', dto);

      expect(result.data.dietType).toBe('연식');
      expect(service.updateAdmission).toHaveBeenCalledWith('adm-1', '연식', undefined);
    });

    it('should update attending doctor', async () => {
      const dto = { attendingDoctorId: 'doc-2' };

      const mockAdmission = {
        id: 'adm-1',
        attendingDoctorId: 'doc-2',
      };

      vi.mocked(service.updateAdmission).mockResolvedValue(mockAdmission);

      const result = await controller.updateAdmission('adm-1', dto);

      expect(result.data.attendingDoctorId).toBe('doc-2');
      expect(service.updateAdmission).toHaveBeenCalledWith('adm-1', undefined, 'doc-2');
    });

    it('should update both diet type and attending doctor', async () => {
      const dto = {
        dietType: '연식',
        attendingDoctorId: 'doc-2',
      };

      const mockAdmission = {
        id: 'adm-1',
        dietType: '연식',
        attendingDoctorId: 'doc-2',
      };

      vi.mocked(service.updateAdmission).mockResolvedValue(mockAdmission);

      const result = await controller.updateAdmission('adm-1', dto);

      expect(result.data.dietType).toBe('연식');
      expect(result.data.attendingDoctorId).toBe('doc-2');
      expect(service.updateAdmission).toHaveBeenCalledWith('adm-1', '연식', 'doc-2');
    });
  });
});
