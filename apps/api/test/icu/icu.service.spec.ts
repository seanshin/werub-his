import { describe, it, expect, beforeEach, vi } from 'vitest';
import { IcuService } from '../../src/modules/icu/icu.service';
import { NotFoundException, BadRequestException } from '@nestjs/common';

describe('IcuService', () => {
  let service: IcuService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      icuBed: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
      icuAdmission: { findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), count: vi.fn() },
      icuRecord: { findMany: vi.fn(), create: vi.fn() },
      $transaction: vi.fn(),
    };
    service = new IcuService(mockPrisma);
  });

  describe('getBeds', () => {
    it('should get all ICU beds with admitted patients', async () => {
      const mockBeds = [{ id: 'bed-1', unitName: 'ICU-A', bedNumber: '1', status: 'OCCUPIED' }];
      vi.mocked(mockPrisma.icuBed.findMany).mockResolvedValue(mockBeds);

      const result = await service.getBeds();
      expect(result).toHaveLength(1);
    });

    it('should include only ADMITTED patients', async () => {
      vi.mocked(mockPrisma.icuBed.findMany).mockResolvedValue([]);

      await service.getBeds();
      expect(mockPrisma.icuBed.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: expect.objectContaining({
            admissions: expect.objectContaining({
              where: { status: 'ADMITTED' },
            }),
          }),
        }),
      );
    });
  });

  describe('getPatients', () => {
    it('should list ADMITTED ICU patients', async () => {
      const mockPatients = [{ id: 'adm-1', status: 'ADMITTED' }];
      vi.mocked(mockPrisma.icuAdmission.findMany).mockResolvedValue(mockPatients);
      vi.mocked(mockPrisma.icuRecord.findMany).mockResolvedValue([]);

      const result = await service.getPatients();
      expect(result).toHaveLength(1);
    });

    /**
     * 🔴 APACHE II·SOFA 는 활력처럼 매번 적는 값이 아니다 — 입실 시 산출하고 갱신하지 않는다.
     *    '최신 활력 기록'에서만 찾으면 **영원히 비어 보인다**(실측: 점수는 9건 있는데
     *    재실 3명의 최신 기록엔 전부 NULL → 화면 APACHE 열이 늘 `-`).
     */
    it('🔴 점수가 실제로 기록된 가장 최근 값을 시점과 함께 붙인다', async () => {
      vi.mocked(mockPrisma.icuAdmission.findMany).mockResolvedValue([{ id: 'adm-1', status: 'ADMITTED' }]);
      const scoredAt = new Date('2026-07-01T00:00:00Z');
      vi.mocked(mockPrisma.icuRecord.findMany).mockResolvedValue([
        { admissionId: 'adm-1', recordTime: scoredAt, apacheScore: 18, sofaScore: 6 },
        { admissionId: 'adm-1', recordTime: new Date('2026-06-01T00:00:00Z'), apacheScore: 12, sofaScore: 4 },
      ]);

      const [row] = await service.getPatients();
      expect(row.latestScores).toEqual({ apacheScore: 18, sofaScore: 6, scoredAt });
    });

    it('점수 기록이 없으면 null — 0 이나 빈 객체로 말하지 않는다', async () => {
      vi.mocked(mockPrisma.icuAdmission.findMany).mockResolvedValue([{ id: 'adm-1', status: 'ADMITTED' }]);
      vi.mocked(mockPrisma.icuRecord.findMany).mockResolvedValue([]);

      const [row] = await service.getPatients();
      expect(row.latestScores).toBeNull();
    });

    it('점수 조회는 apache/sofa 중 하나라도 있는 기록만 본다', async () => {
      vi.mocked(mockPrisma.icuAdmission.findMany).mockResolvedValue([{ id: 'adm-1', status: 'ADMITTED' }]);
      vi.mocked(mockPrisma.icuRecord.findMany).mockResolvedValue([]);

      await service.getPatients();
      const where = vi.mocked(mockPrisma.icuRecord.findMany).mock.calls[0][0].where;
      expect(where.OR).toEqual([{ apacheScore: { not: null } }, { sofaScore: { not: null } }]);
    });
  });

  describe('getPatientDetail', () => {
    it('should calculate I/O totals', async () => {
      const mockAdmission = {
        id: 'adm-1',
        records: [
          { intakeOral: 500, intakeIv: 500, outputUrine: 800, recordTime: new Date() },
          { intakeOral: 300, intakeIv: 400, outputUrine: 600, recordTime: new Date() },
        ],
      };
      vi.mocked(mockPrisma.icuAdmission.findUnique).mockResolvedValue(mockAdmission);

      const result = await service.getPatientDetail('adm-1');
      expect(result.ioTotal.totalIntake).toBe(1700);
      expect(result.ioTotal.totalOutput).toBe(1400);
      expect(result.ioTotal.balance).toBe(300);
    });

    it('should throw NotFoundException when admission not found', async () => {
      vi.mocked(mockPrisma.icuAdmission.findUnique).mockResolvedValue(null);

      await expect(service.getPatientDetail('nonexistent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('admit', () => {
    it('should throw NotFoundException when bed not found', async () => {
      vi.mocked(mockPrisma.icuBed.findUnique).mockResolvedValue(null);

      await expect(
        service.admit({ patientId: 'p-1', icuBedId: 'b-1', doctorId: 'd-1', admitReason: 'Critical' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when bed not available', async () => {
      vi.mocked(mockPrisma.icuBed.findUnique).mockResolvedValue({ status: 'OCCUPIED' });

      await expect(
        service.admit({ patientId: 'p-1', icuBedId: 'b-1', doctorId: 'd-1', admitReason: 'Critical' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should use transaction for admit', async () => {
      const mockBed = { id: 'b-1', status: 'AVAILABLE' };
      const mockAdmission = { id: 'adm-1', status: 'ADMITTED' };
      vi.mocked(mockPrisma.icuBed.findUnique).mockResolvedValue(mockBed);
      vi.mocked(mockPrisma.icuAdmission.findFirst).mockResolvedValue(null); // 이중입원 없음
      vi.mocked(mockPrisma.$transaction).mockResolvedValue(mockAdmission);

      await service.admit({ patientId: 'p-1', icuBedId: 'b-1', doctorId: 'd-1', admitReason: 'Critical' });
      expect(mockPrisma.$transaction).toHaveBeenCalled();
    });

    it('[P1] 이미 재원 중이면 이중입원 차단', async () => {
      vi.mocked(mockPrisma.icuBed.findUnique).mockResolvedValue({ id: 'b-1', status: 'AVAILABLE' });
      vi.mocked(mockPrisma.icuAdmission.findFirst).mockResolvedValue({ id: 'adm-x' });
      await expect(service.admit({ patientId: 'p-1', icuBedId: 'b-1', doctorId: 'd-1', admitReason: 'x' })).rejects.toThrow(BadRequestException);
    });

    it('[P1] 동시 입원 충돌(updateMany count 0) → Conflict', async () => {
      vi.mocked(mockPrisma.icuBed.findUnique).mockResolvedValue({ id: 'b-1', status: 'AVAILABLE' });
      vi.mocked(mockPrisma.icuAdmission.findFirst).mockResolvedValue(null);
      vi.mocked(mockPrisma.$transaction).mockImplementation(async (cb: any) => cb({
        icuBed: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
        icuAdmission: { create: vi.fn() },
      }));
      await expect(service.admit({ patientId: 'p-1', icuBedId: 'b-1', doctorId: 'd-1', admitReason: 'x' })).rejects.toThrow();
    });
  });

  describe('discharge', () => {
    it('should throw BadRequestException if already discharged', async () => {
      vi.mocked(mockPrisma.icuAdmission.findUnique).mockResolvedValue({ status: 'DISCHARGED' });

      await expect(service.discharge('adm-1')).rejects.toThrow(BadRequestException);
    });

    it('should use transaction for discharge', async () => {
      const mockAdm = { id: 'adm-1', status: 'ADMITTED', icuBedId: 'b-1' };
      vi.mocked(mockPrisma.icuAdmission.findUnique).mockResolvedValue(mockAdm);
      vi.mocked(mockPrisma.$transaction).mockResolvedValue({ status: 'DISCHARGED' });

      await service.discharge('adm-1');
      expect(mockPrisma.$transaction).toHaveBeenCalled();
    });
  });

  describe('addRecord', () => {
    it('should create ICU record with vital signs', async () => {
      vi.mocked(mockPrisma.icuAdmission.findUnique).mockResolvedValue({ id: 'adm-1' });
      vi.mocked(mockPrisma.icuRecord.create).mockResolvedValue({ id: 'rec-1' });

      await service.addRecord('adm-1', {
        recordedBy: 'u-1',
        heartRate: 80,
        systolicBp: 120,
        diastolicBp: 80,
        spo2: 98,
      });

      expect(mockPrisma.icuRecord.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            admissionId: 'adm-1',
            heartRate: 80,
          }),
        }),
      );
    });

    /**
     * 🔴 수집 포트 수렴(2026-08-20) 이후의 계약.
     * 종전엔 `v ? Number(v) : undefined` 라 **실측 0 이 미측정으로 사라졌다** —
     * RASS 0(각성)·통증 0·PEEP 0·SpO2 0(프로브 이탈)·심박 0(무수축)이 기록되지 않았다.
     */
    it('실측 0 을 미측정으로 버리지 않는다(0 은 결측이 아니다)', async () => {
      vi.mocked(mockPrisma.icuAdmission.findUnique).mockResolvedValue({ id: 'adm-1' });
      vi.mocked(mockPrisma.icuRecord.create).mockResolvedValue({ id: 'rec-1' });

      await service.addRecord('adm-1', {
        recordedBy: 'u-1', painScore: 0, sedationScore: 0, peep: 0, spo2: 0,
      });

      const data = vi.mocked(mockPrisma.icuRecord.create).mock.calls[0][0].data;
      expect(data.painScore).toBe(0);
      expect(data.sedationScore).toBe(0);
      expect(data.peep).toBe(0);
      expect(data.spo2).toBe(0);
    });

    it('미측정은 null — 0 이나 기본값으로 접지 않는다', async () => {
      vi.mocked(mockPrisma.icuAdmission.findUnique).mockResolvedValue({ id: 'adm-1' });
      vi.mocked(mockPrisma.icuRecord.create).mockResolvedValue({ id: 'rec-1' });

      await service.addRecord('adm-1', { recordedBy: 'u-1', heartRate: 80 });

      const data = vi.mocked(mockPrisma.icuRecord.create).mock.calls[0][0].data;
      expect(data.spo2).toBeNull();
      expect(data.temperature).toBeNull();
      expect(data.painScore).toBeNull();
    });

    it('기록자가 없으면 저장하지 않는다 — 사람 ID 를 빌려 쓰지 않는다(recordedBy NOT NULL)', async () => {
      vi.mocked(mockPrisma.icuAdmission.findUnique).mockResolvedValue({ id: 'adm-1' });
      vi.mocked(mockPrisma.icuRecord.create).mockResolvedValue({ id: 'rec-1' });

      const r = await service.addRecord('adm-1', { recordedBy: '', heartRate: 80 });

      expect(mockPrisma.icuRecord.create).not.toHaveBeenCalled();
      expect(r).toBeNull();
    });
  });

  describe('getFlowsheet', () => {
    it('should get 24-hour records with I/O balance', async () => {
      const mockRecords = [
        { intakeOral: 500, outputUrine: 800, recordTime: new Date() },
      ];
      vi.mocked(mockPrisma.icuRecord.findMany).mockResolvedValue(mockRecords);

      const result = await service.getFlowsheet('adm-1');
      expect(result.summary.count).toBe(1);
      expect(result.summary.ioBalance).toBeLessThan(0);
    });
  });

  describe('getDashboard', () => {
    it('should calculate occupancy rate', async () => {
      const mockBeds = [
        { status: 'OCCUPIED' },
        { status: 'OCCUPIED' },
        { status: 'AVAILABLE' },
      ];
      vi.mocked(mockPrisma.icuBed.findMany).mockResolvedValue(mockBeds);
      vi.mocked(mockPrisma.icuAdmission.count).mockResolvedValue(0);
      vi.mocked(mockPrisma.icuAdmission.findMany).mockResolvedValue([]);

      const result = await service.getDashboard();
      expect(result.totalBeds).toBe(3);
      expect(result.occupied).toBe(2);
      expect(result.occupancyRate).toBe(67);
    });

    it('should count severity distribution', async () => {
      vi.mocked(mockPrisma.icuBed.findMany).mockResolvedValue([]);
      vi.mocked(mockPrisma.icuAdmission.count).mockResolvedValue(0);
      vi.mocked(mockPrisma.icuAdmission.findMany).mockResolvedValue([
        { severity: 'CRITICAL' },
        { severity: 'CRITICAL' },
        { severity: 'SEVERE' },
      ]);

      const result = await service.getDashboard();
      expect(result.severityCounts.CRITICAL).toBe(2);
      expect(result.severityCounts.SEVERE).toBe(1);
    });
  });
});
