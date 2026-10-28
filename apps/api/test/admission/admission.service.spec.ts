import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { AdmissionService } from '../../src/modules/admission/admission.service';
import { BedStatus, AdmissionStatus } from '@prisma/client';

describe('AdmissionService', () => {
  let service: AdmissionService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      patient: {
        findUnique: vi.fn(),
      },
      bed: {
        findUnique: vi.fn(),
        update: vi.fn(),
        // transferBed 원자 선점(updateMany claim)은 {count} 반환 필수 — 기본 성공(1)
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findMany: vi.fn().mockResolvedValue([]),
      },
      admission: {
        create: vi.fn(),
        findUnique: vi.fn(),
        findFirst: vi.fn().mockResolvedValue(null), // 입원 중복 가드 — 기본 재원 없음
        findMany: vi.fn(),
        update: vi.fn(),
      },
      // 활성 식이처방 병합(2026-08-12) — 입원 목록이 영양팀 처방을 우선 표시한다
      dietOrder: { findMany: vi.fn().mockResolvedValue([]) },
      chargeOfCare: {
        create: vi.fn(),
      },
      bedAssignment: {
        create: vi.fn(),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      preVisitVitals: {
        findMany: vi.fn().mockResolvedValue([]),
        findFirst: vi.fn().mockResolvedValue(null),
      },
      // 입원 활력 읽기 정본(두 원장 · 2026-10-10) — '최근 VS'
      flowSheetEntry: { findMany: vi.fn().mockResolvedValue([]) },
      medicationAdministration: {
        groupBy: vi.fn().mockResolvedValue([]),
        findMany: vi.fn().mockResolvedValue([]),
      },
      fallRiskAssessment: { findMany: vi.fn().mockResolvedValue([]) },
      nursePatientAssignment: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
      // 환자 단위 advisory lock(pg_advisory_xact_lock) — 태그드 템플릿 호출이므로 vi.fn()으로 충분
      $executeRaw: vi.fn(),
      $queryRaw: vi.fn().mockResolvedValue([]),
      $transaction: vi.fn((cb: any) => (typeof cb === 'function' ? cb(mockPrisma) : Promise.all(cb))),
    };

    service = new AdmissionService(mockPrisma);
  });

  describe('create', () => {
    it('should create admission successfully', async () => {
      mockPrisma.patient.findUnique.mockResolvedValue({ id: 'pat-1', mrn: 'MR001' });
      mockPrisma.bed.findUnique.mockResolvedValue({
        id: 'bed-1',
        status: BedStatus.AVAILABLE,
        roomNumber: '101',
        bedNumber: 'A',
      });

      const mockAdmission = {
        id: 'adm-1',
        patientId: 'pat-1',
        bedId: 'bed-1',
        admittingDoctorId: 'doc-1',
        admitDate: new Date('2026-05-13'),
        admitReason: '위경련',
        dietType: '일반식',
        status: AdmissionStatus.ADMITTED,
        patient: { id: 'pat-1', mrn: 'MR001', familyName: '김', givenName: '환자' },
        bed: { id: 'bed-1', roomNumber: '101', bedNumber: 'A' },
      };

      mockPrisma.bed.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.admission.create.mockResolvedValue(mockAdmission);

      const result = await service.create(
        'pat-1',
        'bed-1',
        'doc-1',
        '2026-05-13',
        '위경련',
        '일반식'
      );

      expect(result.id).toBe('adm-1');
      expect(result.status).toBe(AdmissionStatus.ADMITTED);
    });

    it('should create admission without optional fields', async () => {
      mockPrisma.patient.findUnique.mockResolvedValue({ id: 'pat-1' });
      mockPrisma.bed.updateMany.mockResolvedValue({ count: 1 });

      const mockAdmission = {
        id: 'adm-1',
        patientId: 'pat-1',
        bedId: 'bed-1',
        admitReason: null,
        dietType: null,
      };

      mockPrisma.admission.create.mockResolvedValue(mockAdmission);

      const result = await service.create('pat-1', 'bed-1', 'doc-1', '2026-05-13');

      expect(result.admitReason).toBeNull();
      expect(result.dietType).toBeNull();
    });

    it('should throw NotFoundException if patient not found', async () => {
      mockPrisma.patient.findUnique.mockResolvedValue(null);

      await expect(service.create('pat-1', 'bed-1', 'doc-1', '2026-05-13')).rejects.toThrow(
        NotFoundException
      );
    });

    it('should throw NotFoundException if bed not found', async () => {
      mockPrisma.patient.findUnique.mockResolvedValue({ id: 'pat-1' });
      mockPrisma.bed.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.bed.findUnique.mockResolvedValue(null);

      await expect(service.create('pat-1', 'bed-1', 'doc-1', '2026-05-13')).rejects.toThrow(
        NotFoundException
      );
    });

    it('should throw ConflictException if bed is occupied', async () => {
      mockPrisma.patient.findUnique.mockResolvedValue({ id: 'pat-1' });
      mockPrisma.bed.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.bed.findUnique.mockResolvedValue({
        id: 'bed-1',
        status: BedStatus.OCCUPIED,
      });

      await expect(service.create('pat-1', 'bed-1', 'doc-1', '2026-05-13')).rejects.toThrow(
        ConflictException
      );
    });

    it('should allow admission to RESERVED bed', async () => {
      mockPrisma.patient.findUnique.mockResolvedValue({ id: 'pat-1' });
      mockPrisma.bed.updateMany.mockResolvedValue({ count: 1 });

      const mockAdmission = { id: 'adm-1', status: AdmissionStatus.ADMITTED };
      mockPrisma.admission.create.mockResolvedValue(mockAdmission);

      const result = await service.create('pat-1', 'bed-1', 'doc-1', '2026-05-13');

      expect(result.status).toBe(AdmissionStatus.ADMITTED);
    });
  });

  describe('discharge', () => {
    // 퇴원 정본은 InpatientService.discharge — AdmissionService는 위임(이중화 해소)
    let mockInpatient: { discharge: ReturnType<typeof vi.fn> };
    beforeEach(() => {
      mockInpatient = { discharge: vi.fn() };
      service = new AdmissionService(mockPrisma, undefined, mockInpatient as any);
    });

    it('should delegate to InpatientService.discharge with summary', async () => {
      const mockUpdated = {
        id: 'adm-1',
        status: AdmissionStatus.DISCHARGED,
        dischargeDate: new Date('2026-05-20'),
        dischargeSummary: '회복되어 퇴원',
      };
      mockInpatient.discharge.mockResolvedValue(mockUpdated);

      const result = await service.discharge('adm-1', '2026-05-20', '회복되어 퇴원');

      expect(result.status).toBe(AdmissionStatus.DISCHARGED);
      expect(mockInpatient.discharge).toHaveBeenCalledWith(
        'adm-1',
        '회복되어 퇴원',
        undefined,
        new Date('2026-05-20')
      );
    });

    it('should delegate without discharge summary', async () => {
      mockInpatient.discharge.mockResolvedValue({
        id: 'adm-1',
        status: AdmissionStatus.DISCHARGED,
        dischargeSummary: null,
      });

      const result = await service.discharge('adm-1', '2026-05-20');

      expect(result.dischargeSummary).toBeNull();
      expect(mockInpatient.discharge).toHaveBeenCalledWith('adm-1', '', undefined, new Date('2026-05-20'));
    });

    it('should propagate NotFoundException from canonical impl', async () => {
      mockInpatient.discharge.mockRejectedValue(new NotFoundException('Admission not found'));

      await expect(service.discharge('adm-1', '2026-05-20')).rejects.toThrow(
        NotFoundException
      );
    });

    it('should throw ConflictException if inpatient service unavailable', async () => {
      service = new AdmissionService(mockPrisma, undefined, undefined);

      await expect(service.discharge('adm-1', '2026-05-20')).rejects.toThrow(
        ConflictException
      );
    });
  });

  describe('transferBed', () => {
    it('should transfer bed successfully', async () => {
      mockPrisma.admission.findUnique.mockResolvedValue({
        id: 'adm-1',
        status: AdmissionStatus.ADMITTED,
        bedId: 'bed-1',
        bed: { id: 'bed-1' },
      });

      mockPrisma.bed.findUnique.mockResolvedValue({
        id: 'bed-2',
        status: BedStatus.AVAILABLE,
      });

      const mockUpdated = {
        id: 'adm-1',
        bedId: 'bed-2',
        bed: { id: 'bed-2' },
      };

      mockPrisma.admission.update.mockResolvedValue(mockUpdated);

      const result = await service.transferBed('adm-1', 'bed-2', '상태 악화로 인한 전동');

      expect(result.bedId).toBe('bed-2');
      // 🔴 (2026-09-30) 이전 배정 이력을 닫는다 — 종전엔 새 배정만 만들어 한 입원에 활성 배정이 둘 남았다
      expect(mockPrisma.bedAssignment.updateMany).toHaveBeenCalledWith({ where: { admissionId: 'adm-1', releasedAt: null }, data: { releasedAt: expect.any(Date) } });
      expect(mockPrisma.bedAssignment.create).toHaveBeenCalledWith({
        data: {
          admissionId: 'adm-1',
          bedId: 'bed-2',
          assignedAt: expect.any(Date),
          reason: '상태 악화로 인한 전동',
        },
      });
    });

    it('should transfer bed without reason', async () => {
      mockPrisma.admission.findUnique.mockResolvedValue({
        id: 'adm-1',
        status: AdmissionStatus.ADMITTED,
        bedId: 'bed-1',
      });

      mockPrisma.bed.findUnique.mockResolvedValue({
        id: 'bed-2',
        status: BedStatus.AVAILABLE,
      });

      const mockUpdated = { id: 'adm-1', bedId: 'bed-2' };
      mockPrisma.admission.update.mockResolvedValue(mockUpdated);

      const result = await service.transferBed('adm-1', 'bed-2');

      expect(result.bedId).toBe('bed-2');
      expect(mockPrisma.bedAssignment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ reason: null }),
        })
      );
    });

    it('should throw NotFoundException if admission not found', async () => {
      mockPrisma.admission.findUnique.mockResolvedValue(null);

      await expect(service.transferBed('adm-1', 'bed-2')).rejects.toThrow(
        NotFoundException
      );
    });

    it('should throw ConflictException if admission not ADMITTED', async () => {
      mockPrisma.admission.findUnique.mockResolvedValue({
        id: 'adm-1',
        status: AdmissionStatus.DISCHARGED,
      });

      await expect(service.transferBed('adm-1', 'bed-2')).rejects.toThrow(
        ConflictException
      );
    });

    it('should throw NotFoundException if new bed not found', async () => {
      mockPrisma.admission.findUnique.mockResolvedValue({
        id: 'adm-1',
        status: AdmissionStatus.ADMITTED,
        bedId: 'bed-1',
      });

      mockPrisma.bed.findUnique.mockResolvedValue(null);

      await expect(service.transferBed('adm-1', 'bed-2')).rejects.toThrow(
        NotFoundException
      );
    });

    it('should throw ConflictException if new bed not available', async () => {
      mockPrisma.admission.findUnique.mockResolvedValue({
        id: 'adm-1',
        status: AdmissionStatus.ADMITTED,
        bedId: 'bed-1',
      });

      mockPrisma.bed.findUnique.mockResolvedValue({
        id: 'bed-2',
        status: BedStatus.OCCUPIED,
      });
      // 원자 선점(updateMany claim) 실패 = 가용 아님 → count 0
      mockPrisma.bed.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.transferBed('adm-1', 'bed-2')).rejects.toThrow(
        ConflictException
      );
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
        bed: {
          id: 'bed-1',
          roomNumber: '101',
          bedNumber: 'A',
          ward: { name: '내과' },
        },
      };

      mockPrisma.admission.findUnique.mockResolvedValue(mockAdmission);

      const result = await service.getDetail('adm-1');

      expect(result.id).toBe('adm-1');
      expect(result.patient.mrn).toBe('MR001');
      expect(result.bed.ward.name).toBe('내과');
    });

    it('should throw NotFoundException if admission not found', async () => {
      mockPrisma.admission.findUnique.mockResolvedValue(null);

      await expect(service.getDetail('adm-1')).rejects.toThrow(NotFoundException);
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

      mockPrisma.admission.findMany.mockResolvedValue(mockAdmissions);

      const result = await service.getPatientAdmissions('pat-1');

      expect(result).toHaveLength(2);
      expect(result[0].admitDate > result[1].admitDate).toBe(true); // Latest first
      expect(mockPrisma.admission.findMany).toHaveBeenCalledWith({
        where: { patientId: 'pat-1' },
        orderBy: { admitDate: 'desc' },
        include: expect.anything(),
      });
    });
  });

  describe('getActiveAdmissions', () => {
    it('should return all active admissions', async () => {
      const mockAdmissions = [
        {
          id: 'adm-1',
          patientId: 'pat-1',
          bedId: 'bed-1',
          admitDate: new Date('2026-05-13'),
          admitReason: '위경련',
          status: AdmissionStatus.ADMITTED,
          patient: { id: 'pat-1', mrn: 'MR001', familyName: '김', givenName: '환자' },
          bed: { id: 'bed-1', roomNumber: '101', bedNumber: 'A', ward: { name: '내과' } },
          attendingDoctor: null,
          nursingAssessments: [],
          encounters: [],
          nursingNotes: [],
        },
      ];

      mockPrisma.admission.findMany.mockResolvedValue(mockAdmissions);

      const result = await service.getActiveAdmissions();

      expect(result).toHaveLength(1);
      expect(result[0].status).toBe(AdmissionStatus.ADMITTED);
      expect(mockPrisma.admission.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: AdmissionStatus.ADMITTED }),
          orderBy: { admitDate: 'asc' },
        }),
      );
    });
  });

  describe('updateAdmission', () => {
    it('should update diet type', async () => {
      mockPrisma.admission.findUnique.mockResolvedValue({
        id: 'adm-1',
        dietType: '일반식',
      });

      const mockUpdated = {
        id: 'adm-1',
        dietType: '연식',
      };

      mockPrisma.admission.update.mockResolvedValue(mockUpdated);

      const result = await service.updateAdmission('adm-1', '연식');

      expect(result.dietType).toBe('연식');
      expect(mockPrisma.admission.update).toHaveBeenCalledWith({
        where: { id: 'adm-1' },
        data: { dietType: '연식' },
        include: expect.anything(),
      });
    });

    it('should update attending doctor', async () => {
      mockPrisma.admission.findUnique.mockResolvedValue({
        id: 'adm-1',
        attendingDoctorId: 'doc-1',
      });

      const mockUpdated = {
        id: 'adm-1',
        attendingDoctorId: 'doc-2',
      };

      mockPrisma.admission.update.mockResolvedValue(mockUpdated);

      const result = await service.updateAdmission('adm-1', undefined, 'doc-2');

      expect(result.attendingDoctorId).toBe('doc-2');
    });

    it('should update both diet type and attending doctor', async () => {
      mockPrisma.admission.findUnique.mockResolvedValue({
        id: 'adm-1',
      });

      const mockUpdated = {
        id: 'adm-1',
        dietType: '연식',
        attendingDoctorId: 'doc-2',
      };

      mockPrisma.admission.update.mockResolvedValue(mockUpdated);

      const result = await service.updateAdmission('adm-1', '연식', 'doc-2');

      expect(result.dietType).toBe('연식');
      expect(result.attendingDoctorId).toBe('doc-2');
    });

    it('should throw NotFoundException if admission not found', async () => {
      mockPrisma.admission.findUnique.mockResolvedValue(null);

      await expect(service.updateAdmission('adm-1', '연식')).rejects.toThrow(
        NotFoundException
      );
    });

    it('should throw BadRequestException if no update data provided', async () => {
      mockPrisma.admission.findUnique.mockResolvedValue({
        id: 'adm-1',
      });

      await expect(service.updateAdmission('adm-1')).rejects.toThrow(
        BadRequestException
      );
    });
  });
});
