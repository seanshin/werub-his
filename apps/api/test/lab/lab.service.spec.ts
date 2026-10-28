import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { LabService } from '../../src/modules/lab/lab.service';
import { LabResultStatus } from '@prisma/client';

describe('LabService', () => {
  let service: LabService;
  let mockPrisma: any;
  let mockReferenceRangeRef: any;

  beforeEach(() => {
    mockPrisma = {
      order: {
        findMany: vi.fn(),
        findUnique: vi.fn(),
        update: vi.fn(),
      },
      labResult: {
        create: vi.fn(),
        findUnique: vi.fn(),
        findMany: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      labResultItem: {
        deleteMany: vi.fn(),
        createMany: vi.fn(),
      },
      labResultAmendment: {
        create: vi.fn().mockResolvedValue({ id: 'amd-1' }),
        findFirst: vi.fn().mockResolvedValue(null),
      },
      patient: { findUnique: vi.fn().mockResolvedValue(null) },
      labTestCode: { findMany: vi.fn().mockResolvedValue([]) },
      // 위급값 경보는 결과 확정과 같은 트랜잭션에서 영속된다(유실 방지 — 2026-07 트랜잭션 경계 전수)
      criticalValueAlert: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
    };
    mockPrisma.$transaction = vi.fn().mockImplementation((cb: any) => cb(mockPrisma));

    mockPrisma.order.update.mockResolvedValue({
      id: 'ord-1', status: 'COMPLETED',
      prescription: { encounterId: 'enc-1', encounter: { patientId: 'pat-1' } },
    });
    const mockEventEmitter = { emit: vi.fn() };
    const computeFlag = (value: number, r: { low: number | null; high: number | null; criticalLow: number | null; criticalHigh: number | null }) => {
      if (Number.isNaN(value)) return null;
      if (r.criticalLow != null && value <= r.criticalLow) return 'LL';
      if (r.criticalHigh != null && value >= r.criticalHigh) return 'HH';
      if (r.low != null && value < r.low) return 'L';
      if (r.high != null && value > r.high) return 'H';
      if (r.low != null || r.high != null) return 'N';
      return null;
    };
    const mockReferenceRange = {
      resolve: vi.fn().mockResolvedValue(null),
      computeFlag,
      flagValue: (raw: string, r: { low: number | null; high: number | null; criticalLow: number | null; criticalHigh: number | null; textNormal?: string | null }) => {
        const num = Number(raw);
        if (!Number.isNaN(num) && raw.trim() !== '') return computeFlag(num, r);
        if (r.textNormal != null && r.textNormal.trim() !== '') return raw.trim().toLowerCase() === r.textNormal.trim().toLowerCase() ? 'N' : 'A';
        return null;
      },
    };
    mockReferenceRangeRef = mockReferenceRange;
    service = new LabService(mockPrisma, mockEventEmitter as any, undefined as any, mockReferenceRange as any);
  });

  describe('getQueue', () => {
    it('should return lab orders in ORDERED/RECEIVED/IN_PROGRESS status', async () => {
      const mockOrders = [
        {
          id: 'ord-1',
          department: 'LAB',
          status: 'ORDERED',
          createdAt: new Date(),
          prescription: {
            encounter: {
              patient: { id: 'pat-1', mrn: 'MR001', familyName: '김', givenName: '환자' },
            },
            procedureCode: { code: 'CBC', nameKo: '일반혈액검사' },
          },
        },
      ];

      mockPrisma.order.findMany.mockResolvedValue(mockOrders);

      const result = await service.getQueue();

      expect(result).toHaveLength(1);
      expect(result[0].status).toBe('ORDERED');
      expect(mockPrisma.order.findMany).toHaveBeenCalledWith({
        where: { department: 'LAB', status: { in: ['ORDERED', 'RECEIVED', 'IN_PROGRESS'] } },
        orderBy: { createdAt: 'asc' },
        include: expect.anything(),
      });
    });

    it('should return empty queue when no orders pending', async () => {
      mockPrisma.order.findMany.mockResolvedValue([]);

      const result = await service.getQueue();

      expect(result).toEqual([]);
    });
  });

  describe('collect', () => {
    it('should collect sample successfully', async () => {
      mockPrisma.order.findUnique.mockResolvedValue({
        id: 'ord-1',
        status: 'ORDERED',
        prescription: { encounter: { patientId: 'pat-1' } },
      });

      const mockLabResult = {
        id: 'lab-1',
        orderId: 'ord-1',
        patientId: 'pat-1',
        technicianId: 'tech-1',
        status: LabResultStatus.COLLECTED,
        collectedAt: new Date(),
        notes: '정상 채혈',
        technician: { id: 'tech-1', familyName: '이', givenName: '검사사' },
        order: { prescription: {} },
      };

      mockPrisma.labResult.create.mockResolvedValue(mockLabResult);

      const result = await service.collect('ord-1', 'tech-1', '정상 채혈');

      expect(result.status).toBe(LabResultStatus.COLLECTED);
      expect(mockPrisma.order.update).toHaveBeenCalledWith({
        where: { id: 'ord-1' },
        data: { status: 'IN_PROGRESS', receivedAt: expect.any(Date), receivedById: expect.any(String), startedAt: expect.any(Date), startedById: expect.any(String) },
      });
    });

    it('should collect sample from RECEIVED order', async () => {
      mockPrisma.order.findUnique.mockResolvedValue({
        id: 'ord-1',
        status: 'RECEIVED',
        prescription: { encounter: { patientId: 'pat-1' } },
      });

      const mockLabResult = { id: 'lab-1', status: LabResultStatus.COLLECTED };
      mockPrisma.labResult.create.mockResolvedValue(mockLabResult);

      const result = await service.collect('ord-1', 'tech-1');

      expect(result.status).toBe(LabResultStatus.COLLECTED);
    });

    it('should throw NotFoundException if order not found', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(null);

      await expect(service.collect('ord-1', 'tech-1')).rejects.toThrow(NotFoundException);
    });

    it('should throw ConflictException if order status is IN_PROGRESS', async () => {
      mockPrisma.order.findUnique.mockResolvedValue({
        id: 'ord-1',
        status: 'IN_PROGRESS',
      });

      await expect(service.collect('ord-1', 'tech-1')).rejects.toThrow(ConflictException);
    });

    it('should throw ConflictException if order is COMPLETED', async () => {
      mockPrisma.order.findUnique.mockResolvedValue({
        id: 'ord-1',
        status: 'COMPLETED',
      });

      await expect(service.collect('ord-1', 'tech-1')).rejects.toThrow(ConflictException);
    });
  });

  describe('submitResult', () => {
    it('[LOINC 훅] testCode 지정 시 코드마스터에서 LOINC 해소·저장', async () => {
      mockPrisma.labResult.findUnique
        .mockResolvedValueOnce({ id: 'lab-1', orderId: 'ord-1', status: LabResultStatus.COLLECTED, items: [] })
        .mockResolvedValueOnce({ id: 'lab-1', orderId: 'ord-1', status: LabResultStatus.COMPLETED, items: [], technician: null });
      mockPrisma.labTestCode = { findMany: vi.fn().mockResolvedValue([{ code: 'L0101', loincCode: '2160-0' }]) };
      await service.submitResult('ord-1', [{ testName: 'Creatinine', value: '1.0', unit: 'mg/dL', testCode: 'L0101' }]);
      expect(mockPrisma.labResultItem.createMany).toHaveBeenCalledWith({
        data: expect.arrayContaining([expect.objectContaining({ testName: 'Creatinine', testCode: 'L0101', loincCode: '2160-0' })]),
      });
    });

    it('[LOINC 훅] testCode 없으면 마스터 조회 안 함(이름 매칭 금지)', async () => {
      mockPrisma.labResult.findUnique
        .mockResolvedValueOnce({ id: 'lab-1', orderId: 'ord-1', status: LabResultStatus.COLLECTED, items: [] })
        .mockResolvedValueOnce({ id: 'lab-1', orderId: 'ord-1', status: LabResultStatus.COMPLETED, items: [], technician: null });
      mockPrisma.labTestCode = { findMany: vi.fn() };
      await service.submitResult('ord-1', [{ testName: 'WBC', value: '7.5', unit: '10^3/µL' }]);
      expect(mockPrisma.labTestCode.findMany).not.toHaveBeenCalled();
    });

    it('should submit results with normal values', async () => {
      // First findUnique call in submitResult
      mockPrisma.labResult.findUnique.mockResolvedValueOnce({
        id: 'lab-1',
        orderId: 'ord-1',
        status: LabResultStatus.COLLECTED,
        items: [],
      });

      // Final findUnique call to return updated result
      mockPrisma.labResult.findUnique.mockResolvedValueOnce({
        id: 'lab-1',
        orderId: 'ord-1',
        status: LabResultStatus.COMPLETED,
        items: [{ testName: 'WBC', value: '7.5', flag: 'N' }],
        technician: { id: 'tech-1', familyName: '이', givenName: '검사사' },
      });

      const items = [
        { testName: 'WBC', value: '7.5', unit: '10^3/µL', normalMin: 4.5, normalMax: 11.0 },
      ];

      const result = await service.submitResult('ord-1', items);

      expect(result.status).toBe(LabResultStatus.COMPLETED);
      expect(mockPrisma.labResultItem.createMany).toHaveBeenCalledWith({
        data: expect.arrayContaining([
          expect.objectContaining({ testName: 'WBC', flag: 'N' }),
        ]),
      });
    });

    it('should flag low results', async () => {
      mockPrisma.labResult.findUnique.mockResolvedValueOnce({
        id: 'lab-1',
        orderId: 'ord-1',
        status: LabResultStatus.COLLECTED,
        items: [],
      });

      mockPrisma.labResult.findUnique.mockResolvedValueOnce({
        id: 'lab-1',
        status: LabResultStatus.COMPLETED,
        items: [{ testName: 'WBC', value: '3.5', flag: 'L' }],
      });

      const items = [
        { testName: 'WBC', value: '3.5', unit: '10^3/µL', normalMin: 4.5, normalMax: 11.0 },
      ];

      await service.submitResult('ord-1', items);

      expect(mockPrisma.labResultItem.createMany).toHaveBeenCalledWith({
        data: expect.arrayContaining([
          expect.objectContaining({ testName: 'WBC', flag: 'L' }),
        ]),
      });
    });

    it('should flag high results', async () => {
      mockPrisma.labResult.findUnique.mockResolvedValueOnce({
        id: 'lab-1',
        orderId: 'ord-1',
        status: LabResultStatus.COLLECTED,
        items: [],
      });

      mockPrisma.labResult.findUnique.mockResolvedValueOnce({
        id: 'lab-1',
        status: LabResultStatus.COMPLETED,
        items: [{ testName: 'WBC', value: '15.5', flag: 'H' }],
      });

      const items = [
        { testName: 'WBC', value: '15.5', unit: '10^3/µL', normalMin: 4.5, normalMax: 11.0 },
      ];

      await service.submitResult('ord-1', items);

      expect(mockPrisma.labResultItem.createMany).toHaveBeenCalledWith({
        data: expect.arrayContaining([
          expect.objectContaining({ testName: 'WBC', flag: 'H' }),
        ]),
      });
    });

    it('[P0 safety] does NOT apply a resolved range whose unit differs from the result unit', async () => {
      mockPrisma.labResult.findUnique.mockResolvedValueOnce({ id: 'lab-1', orderId: 'ord-1', status: LabResultStatus.COLLECTED, items: [] });
      mockPrisma.labResult.findUnique.mockResolvedValueOnce({ id: 'lab-1', status: LabResultStatus.COMPLETED, items: [] });
      // 마스터: Ca mmol/L, criticalLow 2.0. 결과는 mg/dL로 14(고칼슘). 단위 불일치 → 적용 안 함 → LL 오판정 방지.
      mockReferenceRangeRef.resolve.mockResolvedValueOnce({ id: 'r1', low: 2.1, high: 2.6, criticalLow: 2.0, criticalHigh: 3.0, unit: 'mmol/L', textNormal: null });
      await service.submitResult('ord-1', [{ testName: 'Ca', value: '14', unit: 'mg/dL', testCode: 'CA' }]);
      const arg = mockPrisma.labResultItem.createMany.mock.calls[0][0].data[0];
      expect(arg.flag).not.toBe('LL'); // 단위 불일치 범위를 적용하지 않았음
      expect(arg.normalMin).toBeNull();
    });

    it('[P0 safety] fetches critical thresholds from master even when normal bounds are provided', async () => {
      mockPrisma.labResult.findUnique.mockResolvedValueOnce({ id: 'lab-1', orderId: 'ord-1', status: LabResultStatus.COLLECTED, items: [] });
      mockPrisma.labResult.findUnique.mockResolvedValueOnce({ id: 'lab-1', status: LabResultStatus.COMPLETED, items: [] });
      // K 결과에 정상범위만 제공(위급역치 없음). 마스터가 criticalHigh 6.5 제공 → 7.8은 HH여야(H 아님).
      mockReferenceRangeRef.resolve.mockResolvedValueOnce({ id: 'r2', low: 3.5, high: 5.1, criticalLow: 2.8, criticalHigh: 6.5, unit: 'mEq/L', textNormal: null });
      await service.submitResult('ord-1', [{ testName: 'K', value: '7.8', unit: 'mEq/L', testCode: 'L0202', normalMin: 3.5, normalMax: 5.1 }]);
      const arg = mockPrisma.labResultItem.createMany.mock.calls[0][0].data[0];
      expect(arg.flag).toBe('HH');
    });

    it('should handle results without normal ranges', async () => {
      mockPrisma.labResult.findUnique.mockResolvedValueOnce({
        id: 'lab-1',
        orderId: 'ord-1',
        status: LabResultStatus.COLLECTED,
        items: [],
      });

      mockPrisma.labResult.findUnique.mockResolvedValueOnce({
        id: 'lab-1',
        status: LabResultStatus.COMPLETED,
      });

      const items = [
        { testName: 'Comment', value: 'Normal', unit: '' },
      ];

      await service.submitResult('ord-1', items);

      expect(mockPrisma.labResultItem.createMany).toHaveBeenCalledWith({
        data: expect.arrayContaining([
          expect.objectContaining({ testName: 'Comment', flag: null }),
        ]),
      });
    });

    it('should throw NotFoundException if lab result not found', async () => {
      mockPrisma.labResult.findUnique.mockResolvedValue(null);

      await expect(service.submitResult('ord-1', [])).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException if no items provided', async () => {
      mockPrisma.labResult.findUnique.mockResolvedValue({
        id: 'lab-1',
        status: LabResultStatus.COLLECTED,
      });

      await expect(service.submitResult('ord-1', [])).rejects.toThrow(BadRequestException);
    });

    it('should throw ConflictException if result already completed', async () => {
      mockPrisma.labResult.findUnique.mockResolvedValue({
        id: 'lab-1',
        status: LabResultStatus.COMPLETED,
      });

      await expect(
        service.submitResult('ord-1', [{ testName: 'WBC', value: '7.5', unit: '10^3/µL' }])
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('getResult', () => {
    it('should return lab result with items', async () => {
      const mockResult = {
        id: 'lab-1',
        orderId: 'ord-1',
        patientId: 'pat-1',
        status: LabResultStatus.COMPLETED,
        items: [{ testName: 'WBC', value: '7.5', flag: 'N' }],
        technician: { id: 'tech-1', familyName: '이', givenName: '검사사' },
        patient: { id: 'pat-1', mrn: 'MR001', familyName: '김', givenName: '환자' },
      };

      mockPrisma.labResult.findUnique.mockResolvedValue(mockResult);

      const result = await service.getResult('ord-1');

      expect(result.id).toBe('lab-1');
      expect(result.items).toHaveLength(1);
    });

    it('should throw NotFoundException if result not found', async () => {
      mockPrisma.labResult.findUnique.mockResolvedValue(null);

      await expect(service.getResult('ord-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('getPatientResults', () => {
    it('should return all patient results ordered by creation date', async () => {
      const mockResults = [
        {
          id: 'lab-1',
          patientId: 'pat-1',
          status: LabResultStatus.COMPLETED,
          createdAt: new Date('2026-05-13'),
          items: [],
          technician: { id: 'tech-1', familyName: '이', givenName: '검사사' },
        },
        {
          id: 'lab-2',
          patientId: 'pat-1',
          status: LabResultStatus.COMPLETED,
          createdAt: new Date('2026-05-10'),
          items: [],
          technician: { id: 'tech-1', familyName: '이', givenName: '검사사' },
        },
      ];

      mockPrisma.labResult.findMany.mockResolvedValue(mockResults);

      const result = await service.getPatientResults('pat-1');

      expect(result).toHaveLength(2);
      expect(result[0].createdAt > result[1].createdAt).toBe(true); // Latest first
      expect(mockPrisma.labResult.findMany).toHaveBeenCalledWith({
        where: { patientId: 'pat-1' },
        orderBy: { createdAt: 'desc' },
        take: 200,
        include: expect.anything(),
      });
    });
  });

  describe('startTesting', () => {
    it('should start testing from COLLECTED status', async () => {
      mockPrisma.labResult.findUnique.mockResolvedValue({
        id: 'lab-1',
        status: LabResultStatus.COLLECTED,
      });

      const mockUpdated = {
        id: 'lab-1',
        status: LabResultStatus.IN_PROGRESS,
        items: [],
      };

      mockPrisma.labResult.update.mockResolvedValue(mockUpdated);

      const result = await service.startTesting('lab-1');

      expect(result.status).toBe(LabResultStatus.IN_PROGRESS);
    });

    it('should throw NotFoundException if result not found', async () => {
      mockPrisma.labResult.findUnique.mockResolvedValue(null);

      await expect(service.startTesting('lab-1')).rejects.toThrow(NotFoundException);
    });

    it('should throw ConflictException if not in COLLECTED status', async () => {
      mockPrisma.labResult.findUnique.mockResolvedValue({
        id: 'lab-1',
        status: LabResultStatus.PENDING,
      });

      await expect(service.startTesting('lab-1')).rejects.toThrow(ConflictException);
    });
  });

  describe('cancelTesting', () => {
    it('should cancel testing with reason', async () => {
      mockPrisma.labResult.findUnique.mockResolvedValue({
        id: 'lab-1',
        orderId: 'ord-1',
        status: LabResultStatus.IN_PROGRESS,
        notes: 'Initial note',
        order: { id: 'ord-1' },
      });

      const mockUpdated = {
        id: 'lab-1',
        status: LabResultStatus.PENDING,
        notes: 'Initial note\n취소사유: 검체 손상',
      };

      mockPrisma.labResult.update.mockResolvedValue(mockUpdated);

      const result = await service.cancelTesting('lab-1', '검체 손상');

      expect(result.status).toBe(LabResultStatus.PENDING);
      expect(mockPrisma.order.update).toHaveBeenCalledWith({
        where: { id: 'ord-1' },
        data: { status: 'RECEIVED', startedAt: null },
      });
    });

    it('should cancel testing without reason', async () => {
      mockPrisma.labResult.findUnique.mockResolvedValue({
        id: 'lab-1',
        orderId: 'ord-1',
        status: LabResultStatus.IN_PROGRESS,
        notes: null,
        order: { id: 'ord-1' },
      });

      const mockUpdated = {
        id: 'lab-1',
        status: LabResultStatus.PENDING,
      };

      mockPrisma.labResult.update.mockResolvedValue(mockUpdated);

      const result = await service.cancelTesting('lab-1', '');

      expect(result.status).toBe(LabResultStatus.PENDING);
    });

    it('should throw NotFoundException if result not found', async () => {
      mockPrisma.labResult.findUnique.mockResolvedValue(null);

      await expect(service.cancelTesting('lab-1', 'reason')).rejects.toThrow(NotFoundException);
    });

    it('should throw ConflictException if already completed', async () => {
      mockPrisma.labResult.findUnique.mockResolvedValue({
        id: 'lab-1',
        status: LabResultStatus.COMPLETED,
      });

      await expect(service.cancelTesting('lab-1', 'reason')).rejects.toThrow(ConflictException);
    });
  });

  describe('getPendingVerification (검증 대기 목록)', () => {
    // 🔴 verify EP 는 있었는데 대기 목록이 없어 검증 단계가 미운영이었다(COMPLETED 256 vs VERIFIED 2)
    it('COMPLETED 만 오래된 순으로 — 최신순이면 묵은 건이 영영 묻힌다', async () => {
      mockPrisma.labResult.findMany.mockResolvedValue([{
        id: 'lr-1', orderId: 'ord-1', completedAt: new Date(), notes: null,
        patient: { id: 'p1', familyName: '김', givenName: '영수', mrn: 'P-1' },
        technician: { id: 'tech-1', familyName: '이', givenName: '검사', },
        items: [
          { testName: 'Hb', value: '8.1', unit: 'g/dL', flag: 'L', normalMin: '13', normalMax: '17.5' },
          { testName: 'WBC', value: '6.2', unit: '10^3/µL', flag: null, normalMin: '4', normalMax: '10' },
          // 🔴 정상도 flag='N'/'NORMAL' 로 채워진다 — truthy 판정이면 정상이 이상으로 계수돼
          //    검증 화면 전 행이 붉게 물들었다(2026-08-13 실측 1873/1877). 정본 isAbnormalFlag 경유.
          { testName: 'PLT', value: '250', unit: '10^3/µL', flag: 'N', normalMin: '150', normalMax: '400' },
          { testName: 'RBC', value: '4.8', unit: '10^6/µL', flag: 'NORMAL', normalMin: '4.2', normalMax: '6.1' },
        ],
        amendments: [{ id: 'am-1' }],
      }]);
      const rows = await service.getPendingVerification();
      expect(mockPrisma.labResult.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { status: 'COMPLETED' },
        orderBy: { completedAt: 'asc' },
      }));
      expect(rows[0].abnormalCount).toBe(1); // 이상(L)만 — N/NORMAL/null 은 계수 금지
      expect(rows[0].amended).toBe(true);    // 정정 이력 → 재검증 대상 표시
    });
  });

  describe('verifyResult (독립 검증·확정)', () => {
    it('COMPLETED → VERIFIED, 입력자와 다른 검사자', async () => {
      mockPrisma.labResult.findUnique
        .mockResolvedValueOnce({ id: 'lr-1', orderId: 'ord-1', status: 'COMPLETED', technicianId: 'tech-1', patientId: 'pat-1' })
        .mockResolvedValueOnce({ id: 'lr-1', status: 'VERIFIED' });
      const res = await service.verifyResult('ord-1', 'tech-2');
      expect(mockPrisma.labResult.updateMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 'lr-1', status: 'COMPLETED' },
        data: expect.objectContaining({ status: 'VERIFIED', verifiedBy: 'tech-2' }),
      }));
      expect(res.status).toBe('VERIFIED');
    });

    it('입력자 본인 검증 거부(독립검증)', async () => {
      mockPrisma.labResult.findUnique.mockResolvedValue({ id: 'lr-1', orderId: 'ord-1', status: 'COMPLETED', technicianId: 'tech-1' });
      await expect(service.verifyResult('ord-1', 'tech-1')).rejects.toThrow(ConflictException);
    });

    it('COMPLETED 아닌 상태 검증 거부', async () => {
      mockPrisma.labResult.findUnique.mockResolvedValue({ id: 'lr-1', orderId: 'ord-1', status: 'IN_PROGRESS', technicianId: 'tech-1' });
      await expect(service.verifyResult('ord-1', 'tech-2')).rejects.toThrow(ConflictException);
    });

    it('이미 VERIFIED면 거부', async () => {
      mockPrisma.labResult.findUnique.mockResolvedValue({ id: 'lr-1', orderId: 'ord-1', status: 'VERIFIED', technicianId: 'tech-1' });
      await expect(service.verifyResult('ord-1', 'tech-2')).rejects.toThrow(ConflictException);
    });

    it('없는 결과 → NotFound', async () => {
      mockPrisma.labResult.findUnique.mockResolvedValue(null);
      await expect(service.verifyResult('ord-x', 'tech-2')).rejects.toThrow(NotFoundException);
    });
  });

  describe('amendResult (정정·재통보)', () => {
    const items = [{ testName: 'Potassium', value: '7.0', unit: 'mEq/L', normalMin: 3.5, normalMax: 5.1 }];

    it('COMPLETED 결과 정정 — 이전값 스냅샷·상태 COMPLETED·검증정보 제거·위급 재통보', async () => {
      mockPrisma.labResult.findUnique
        .mockResolvedValueOnce({ id: 'lr-1', orderId: 'ord-1', status: 'VERIFIED', patientId: 'pat-1', items: [{ testName: 'Potassium', value: '4.0', unit: 'mEq/L', flag: 'N', normalMin: 3.5, normalMax: 5.1 }] })
        .mockResolvedValueOnce({ id: 'lr-1', status: 'COMPLETED', items, amendments: [] });
      mockPrisma.order.findUnique.mockResolvedValue({ prescription: { id: 'rx-1', encounterId: 'enc-1', encounter: { patientId: 'pat-1' } } });
      const emit = (service as any).eventEmitter.emit;
      await service.amendResult('ord-1', items, '재검 정정', 'tech-2');
      // 이전값 스냅샷 보존
      expect(mockPrisma.labResultAmendment.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ previousStatus: 'VERIFIED', reason: '재검 정정' }),
      }));
      // 검증 무효화(COMPLETED·verified 제거)
      expect(mockPrisma.labResult.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ status: 'COMPLETED', verifiedBy: null, verifiedAt: null }),
      }));
      // 정정된 위급값(K 7.0) 재통보
      expect(emit).toHaveBeenCalledWith('lab.critical.value', expect.anything());
    });

    it('정정 시 기존 항목의 LOINC/testCode 이월(동일 검사명·정정이 LOINC 소실하던 것 방지)', async () => {
      mockPrisma.labResult.findUnique
        .mockResolvedValueOnce({ id: 'lr-1', orderId: 'ord-1', status: 'COMPLETED', patientId: 'pat-1', items: [{ testName: 'Potassium', value: '4.0', unit: 'mEq/L', flag: 'N', loincCode: '2823-3', testCode: 'K', normalMin: 3.5, normalMax: 5.1 }] })
        .mockResolvedValueOnce({ id: 'lr-1', status: 'COMPLETED', items, amendments: [] });
      mockPrisma.order.findUnique.mockResolvedValue({ prescription: { id: 'rx-1', encounterId: 'enc-1', encounter: { patientId: 'pat-1' } } });
      await service.amendResult('ord-1', items, '재검 정정', 'tech-2');
      expect(mockPrisma.labResultItem.createMany).toHaveBeenCalledWith({
        data: expect.arrayContaining([expect.objectContaining({ testName: 'Potassium', loincCode: '2823-3', testCode: 'K' })]),
      });
    });

    it('사유 없으면 거부', async () => {
      await expect(service.amendResult('ord-1', items, '  ', 'tech-2')).rejects.toThrow(BadRequestException);
    });

    it('입력 전(IN_PROGRESS) 결과 정정 거부', async () => {
      mockPrisma.labResult.findUnique.mockResolvedValue({ id: 'lr-1', orderId: 'ord-1', status: 'IN_PROGRESS', items: [] });
      await expect(service.amendResult('ord-1', items, '사유', 'tech-2')).rejects.toThrow(ConflictException);
    });

    it('없는 결과 → NotFound', async () => {
      mockPrisma.labResult.findUnique.mockResolvedValue(null);
      await expect(service.amendResult('ord-x', items, '사유', 'tech-2')).rejects.toThrow(NotFoundException);
    });
  });

  describe('detectCriticalValues (위급값 감지)', () => {
    // P0-a②(2026-08-04)에서 ReferenceRange 마스터 우선 판정으로 async 전환 — await 필수.
    // 이 목은 referenceRange 모델이 없어 마스터 로드가 실패 → 하드코딩 폴백 경로를 검증한다(fail-safe).
    const detect = (items: any[]) => (service as any).detectCriticalValues(items) as Promise<any[]>;

    it('[P0] 전체 검사명(Potassium)도 위급값 감지(부분문자열 K 미포함이라 과거 누락)', async () => {
      const r = await detect([{ testName: 'Potassium', value: '7.0', unit: 'mEq/L', flag: 'H' }]);
      expect(r.length).toBe(1);
    });

    it('[P0] Sodium 저나트륨 감지', async () => {
      const r = await detect([{ testName: 'Sodium', value: '115', unit: 'mmol/L', flag: 'L' }]);
      expect(r.length).toBe(1);
    });

    it('[P0] 오매칭 방지 — Alkaline Phosphatase는 pH로 오발동하지 않음', async () => {
      const r = await detect([{ testName: 'Alkaline Phosphatase', value: '500', unit: 'U/L', flag: 'H' }]);
      expect(r.length).toBe(0);
    });

    it('[P0] 오매칭 방지 — Bicarbonate는 Ca로 오발동하지 않음', async () => {
      const r = await detect([{ testName: 'Bicarbonate', value: '10', unit: 'mmol/L', flag: 'L' }]);
      expect(r.length).toBe(0);
    });

    it('[P0] PLT 스케일 — 250 ×10³/µL(정상)은 미발동, 15 ×10³/µL은 발동', async () => {
      expect((await detect([{ testName: 'PLT', value: '250', unit: 'x10^3/uL', flag: 'N' }])).length).toBe(0);
      expect((await detect([{ testName: 'PLT', value: '15', unit: 'x10^3/uL', flag: 'L' }])).length).toBe(1);
    });

    it('[P1] 비수치 센티넬 — >500 Glucose·HI Troponin도 위급 감지', async () => {
      expect((await detect([{ testName: 'Glucose', value: '>500', unit: 'mg/dL', flag: 'H' }])).length).toBe(1);
      expect((await detect([{ testName: 'Troponin I', value: 'HI', unit: 'ng/mL', flag: 'H' }])).length).toBe(1);
    });

    it('정상 칼륨은 미발동', async () => {
      expect((await detect([{ testName: 'Potassium', value: '4.2', unit: 'mEq/L', flag: 'N' }])).length).toBe(0);
    });

    it('[P1] SI 단위 트로포닌 ng/L(현행 표준) 위급 감지(과거 누락)', async () => {
      // 50 ng/L = 0.05 ng/mL > 0.04 → 위급. 과거엔 ng/L 미등록으로 스킵됐음.
      expect((await detect([{ testName: 'Troponin I', value: '50', unit: 'ng/L', flag: 'H' }])).length).toBe(1);
      // 정상 5 ng/L는 미발동(단위별 임계라 오발동 없음)
      expect((await detect([{ testName: 'Troponin I', value: '5', unit: 'ng/L', flag: 'N' }])).length).toBe(0);
    });

    it('[P1] 혈소판 10^9/L·상첨자 10⁹/L 스케일 감지(과거 누락)', async () => {
      expect((await detect([{ testName: 'Platelet', value: '15', unit: '10^9/L', flag: 'L' }])).length).toBe(1);
      expect((await detect([{ testName: 'Platelet', value: '15', unit: '10⁹/L', flag: 'L' }])).length).toBe(1);
      expect((await detect([{ testName: 'Platelet', value: '250', unit: '10⁹/L', flag: 'N' }])).length).toBe(0);
    });

    it('[P1] 혈소판 단위 없으면 스케일 모호로 스킵(오발동 방지)', async () => {
      expect((await detect([{ testName: 'Platelet', value: '250', unit: '', flag: 'N' }])).length).toBe(0);
    });

    it('SI 단위 저혈당(mmol/L)·저혈색소(g/L) 감지', async () => {
      expect((await detect([{ testName: 'Glucose', value: '2.0', unit: 'mmol/L', flag: 'L' }])).length).toBe(1);
      expect((await detect([{ testName: 'Hemoglobin', value: '65', unit: 'g/L', flag: 'L' }])).length).toBe(1);
    });

    it('[P1] ≥/≤ 센티넬·콤마 파싱', async () => {
      expect((await detect([{ testName: 'Glucose', value: '≥500', unit: 'mg/dL', flag: 'H' }])).length).toBe(1);
      expect((await detect([{ testName: 'Glucose', value: '1,050', unit: 'mg/dL', flag: 'H' }])).length).toBe(1);
    });

    it('미등록 단위는 스킵(오판 방지)·예외 없음', async () => {
      await expect(detect([{ testName: 'Potassium', value: '7.0', unit: 'weird/x', flag: 'H' }])).resolves.toBeDefined();
      expect((await detect([{ testName: 'Potassium', value: '7.0', unit: 'weird/x', flag: 'H' }])).length).toBe(0);
    });
  });
});
