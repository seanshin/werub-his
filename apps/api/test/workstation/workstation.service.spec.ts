import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WorkstationService } from '../../src/modules/workstation/workstation.service';
import { NotFoundException, BadRequestException } from '@nestjs/common';

describe('WorkstationService', () => {
  let service: WorkstationService;
  let mockPrisma: any;
  let mockEmitter: any;

  const mockOrder = {
    id: 'ord-1', prescriptionId: 'rx-1', department: 'LAB',
    status: 'ORDERED', priority: 'ROUTINE',
    createdAt: new Date(), receivedAt: null, startedAt: null,
    prescription: {
      encounter: {
        id: 'enc-1', patientId: 'pat-1',
        patient: { id: 'pat-1', mrn: 'MR001', familyName: '김', givenName: '환자', gender: 'MALE', dateOfBirth: new Date('1990-01-01') },
      },
      procedureCode: { code: 'L001', nameKo: 'CBC' },
      instructions: 'CBC 검사',
      status: 'ACTIVE',
    },
    labResult: null, imagingResult: null,
  };

  beforeEach(() => {
    mockPrisma = {
      workstationConfig: { findMany: vi.fn(), findUnique: vi.fn() },
      order: {
        findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn(), create: vi.fn(),
      },
      labResult: {
        findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), findFirst: vi.fn(),
      },
      labResultItem: { create: vi.fn(), createMany: vi.fn(), deleteMany: vi.fn() },
      labTestTemplate: {
        findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(),
      },
      imagingResult: {
        findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), findMany: vi.fn(),
      },
      therapyOrder: {
        findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(),
      },
      prescription: { create: vi.fn() },
      encounter: { findMany: vi.fn() },
      checkupVisit: { findMany: vi.fn(), findFirst: vi.fn() },
      admission: { findMany: vi.fn() },
      patient: { findMany: vi.fn() },
    };
    // 결과 완료·치료 오더는 한 트랜잭션에서 쓴다(F3) — 정본의 실제 호출 모양(콜백·배열 둘 다)
    mockPrisma.$transaction = vi.fn((arg: any) => (typeof arg === 'function' ? arg(mockPrisma) : Promise.all(arg)));
    mockEmitter = { emit: vi.fn() };
    service = new WorkstationService(mockPrisma, undefined, mockEmitter);
  });

  // ═══════════════════════════════════════════
  // getStations
  // ═══════════════════════════════════════════

  describe('getStations', () => {
    it('should return active stations', async () => {
      mockPrisma.workstationConfig.findMany.mockResolvedValue([
        { stationId: 'lab-phlebotomy', category: 'LAB' },
      ]);
      const result = await service.getStations();
      expect(result).toHaveLength(1);
      expect(mockPrisma.workstationConfig.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { isActive: true } }),
      );
    });

    it('should filter by category', async () => {
      mockPrisma.workstationConfig.findMany.mockResolvedValue([]);
      await service.getStations('IMAGING');
      expect(mockPrisma.workstationConfig.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { isActive: true, category: 'IMAGING' } }),
      );
    });
  });

  // ═══════════════════════════════════════════
  // getQueue
  // ═══════════════════════════════════════════

  describe('getQueue', () => {
    it('should return orders for a LAB station', async () => {
      mockPrisma.workstationConfig.findUnique.mockResolvedValue({
        stationId: 'lab-phlebotomy', category: 'LAB', orderCodes: [],
      });
      mockPrisma.order.findMany.mockResolvedValue([mockOrder]);

      const result = await service.getQueue('lab-phlebotomy');

      expect(result).toHaveLength(1);
      expect(result[0].orderId).toBe('ord-1');
      expect(result[0].patient.familyName).toBe('김');
    });

    it('should calculate patient age', async () => {
      mockPrisma.workstationConfig.findUnique.mockResolvedValue({
        stationId: 'lab-phlebotomy', category: 'LAB', orderCodes: [],
      });
      mockPrisma.order.findMany.mockResolvedValue([mockOrder]);

      const result = await service.getQueue('lab-phlebotomy');
      expect(result[0].patient.age).toBeGreaterThan(30);
    });

    it('should handle therapy station (tx-*)', async () => {
      mockPrisma.workstationConfig.findUnique.mockResolvedValue(null);
      mockPrisma.therapyOrder.findMany.mockResolvedValue([]);

      const result = await service.getQueue('tx-pt');
      expect(result).toEqual([]);
    });
  });

  // ═══════════════════════════════════════════
  // receiveOrder
  // ═══════════════════════════════════════════

  describe('receiveOrder', () => {
    it('should receive ORDERED order', async () => {
      mockPrisma.order.findUnique.mockResolvedValue({ id: 'ord-1', status: 'ORDERED' });
      mockPrisma.order.update.mockResolvedValue({ id: 'ord-1', status: 'RECEIVED' });
      mockPrisma.labResult.findUnique.mockResolvedValue(null);

      const result = await service.receiveOrder('ord-1');
      expect(result.status).toBe('RECEIVED');
    });

    // 🔴 (2026-10-01) 종전 계약은 "접수하면 collectedAt 을 접수 순간으로" 였다 — 접수를 채취로 찍는 **결함을 계약으로 못박은 테스트**였다.
    //    이제: 기록된 채취가 있으면 그 값을 옮겨 적고, 없으면 결과 행을 건드리지 않는다.
    it('copies the recorded specimen collection time to the lab result (not the receipt time)', async () => {
      const collected = new Date('2026-10-01T08:30:00Z');
      mockPrisma.order.findUnique.mockResolvedValue({ id: 'ord-1', status: 'ORDERED', specimenCollectedAt: collected });
      mockPrisma.order.update.mockResolvedValue({ id: 'ord-1', status: 'RECEIVED' });
      mockPrisma.labResult.findUnique.mockResolvedValue({ id: 'lr-1', orderId: 'ord-1' });
      mockPrisma.labResult.update.mockResolvedValue({});

      await service.receiveOrder('ord-1');
      expect(mockPrisma.labResult.update).toHaveBeenCalledWith(expect.objectContaining({ data: { collectedAt: collected } }));
    });

    it('does not stamp the receipt time as collection when no collection was recorded', async () => {
      mockPrisma.order.findUnique.mockResolvedValue({ id: 'ord-1', status: 'ORDERED', specimenCollectedAt: null });
      mockPrisma.order.update.mockResolvedValue({ id: 'ord-1', status: 'RECEIVED' });
      mockPrisma.labResult.findUnique.mockResolvedValue({ id: 'lr-1', orderId: 'ord-1' });
      mockPrisma.labResult.update.mockResolvedValue({});

      await service.receiveOrder('ord-1');
      expect(mockPrisma.labResult.update).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException for missing order', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(null);
      await expect(service.receiveOrder('bad')).rejects.toThrow(NotFoundException);
    });

    it('should reject receive on terminal status (COMPLETED) — FSM 2026-07: IN_PROGRESS→RECEIVED 재작업 롤백은 허용', async () => {
      mockPrisma.order.findUnique.mockResolvedValue({ id: 'ord-1', status: 'COMPLETED' });
      await expect(service.receiveOrder('ord-1')).rejects.toThrow(BadRequestException);
      mockPrisma.order.findUnique.mockResolvedValue({ id: 'ord-1', status: 'IN_PROGRESS' });
      await service.receiveOrder('ord-1'); // 역전이 허용 — throw 없이 통과
    });
  });

  // ═══════════════════════════════════════════
  // startOrder
  // ═══════════════════════════════════════════

  describe('startOrder', () => {
    it('should start RECEIVED order', async () => {
      mockPrisma.order.findUnique.mockResolvedValue({ id: 'ord-1', status: 'RECEIVED' });
      mockPrisma.order.update.mockResolvedValue({ id: 'ord-1', status: 'IN_PROGRESS' });

      const result = await service.startOrder('ord-1');
      expect(result.status).toBe('IN_PROGRESS');
    });

    it('should reject start on terminal status — FSM 2026-07: ORDERED→IN_PROGRESS 병합 전이는 허용(접수 생략 시행)', async () => {
      mockPrisma.order.findUnique.mockResolvedValue({ id: 'ord-1', status: 'CANCELLED' });
      await expect(service.startOrder('ord-1')).rejects.toThrow(BadRequestException);
      mockPrisma.order.findUnique.mockResolvedValue({ id: 'ord-1', status: 'ORDERED' });
      await service.startOrder('ord-1'); // 병합 전이 허용 — throw 없이 통과
    });
  });

  // ═══════════════════════════════════════════
  // completeLabResult
  // ═══════════════════════════════════════════

  describe('completeLabResult', () => {
    it('should complete lab result with items', async () => {
      mockPrisma.order.findUnique.mockResolvedValue({
        ...mockOrder,
        status: 'IN_PROGRESS',
        prescription: { ...mockOrder.prescription, encounter: { patientId: 'pat-1' } },
      });
      mockPrisma.labResult.findUnique.mockResolvedValue(null);
      mockPrisma.labResult.create.mockResolvedValue({ id: 'lr-1' });
      mockPrisma.labResultItem.createMany.mockResolvedValue({ count: 2 });
      mockPrisma.order.update.mockResolvedValue({});

      const result = await service.completeLabResult('ord-1', {
        items: [
          { name: 'WBC', value: '7500', unit: '/μL', refRange: '4000-10000' },
          { name: 'Hgb', value: '8.0', unit: 'g/dL', refRange: '12-16', finding: 'ABNORMAL' },
        ],
      }, 'tech-1');

      expect(result.completed).toBe(true);
      // N+1 → 1 쿼리: createMany 1회에 2개 item
      expect(mockPrisma.labResultItem.createMany).toHaveBeenCalledTimes(1);
      expect(mockPrisma.labResultItem.createMany.mock.calls[0][0].data).toHaveLength(2);
    });

    it('should update existing lab result (upsert)', async () => {
      mockPrisma.order.findUnique.mockResolvedValue({
        ...mockOrder,
        status: 'IN_PROGRESS',
        prescription: { ...mockOrder.prescription, encounter: { patientId: 'pat-1' } },
      });
      mockPrisma.labResult.findUnique.mockResolvedValue({ id: 'lr-1' });
      mockPrisma.labResult.update.mockResolvedValue({});
      mockPrisma.labResultItem.deleteMany.mockResolvedValue({});
      mockPrisma.labResultItem.createMany.mockResolvedValue({ count: 1 });
      mockPrisma.order.update.mockResolvedValue({});

      const result = await service.completeLabResult('ord-1', {
        items: [{ name: 'WBC', value: '7500' }],
      }, 'tech-1');

      expect(result.completed).toBe(true);
      expect(mockPrisma.labResultItem.deleteMany).toHaveBeenCalled();
    });

    it('should throw NotFoundException for missing order', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(null);
      await expect(service.completeLabResult('bad', { items: [] }, 'u'))
        .rejects.toThrow(NotFoundException);
    });

    it('should parse reference range for flagging', async () => {
      mockPrisma.order.findUnique.mockResolvedValue({
        ...mockOrder,
        status: 'IN_PROGRESS',
        prescription: { ...mockOrder.prescription, encounter: { patientId: 'pat-1' } },
      });
      mockPrisma.labResult.findUnique.mockResolvedValue(null);
      mockPrisma.labResult.create.mockResolvedValue({ id: 'lr-1' });
      mockPrisma.labResultItem.createMany.mockResolvedValue({ count: 1 });
      mockPrisma.order.update.mockResolvedValue({});

      await service.completeLabResult('ord-1', {
        items: [{ name: 'Glucose', value: '150', refRange: '70-110', finding: 'ABNORMAL' }],
      }, 'tech-1');

      // createMany 데이터 배열 첫 항목의 파싱된 참조범위/플래그 검증
      expect(mockPrisma.labResultItem.createMany.mock.calls[0][0].data[0]).toEqual(
        expect.objectContaining({ normalMin: 70, normalMax: 110, flag: 'H' }),
      );
    });

    it('should emit lab.result.completed (progressive billing) and lab.critical.value on CRITICAL', async () => {
      mockPrisma.order.findUnique.mockResolvedValue({
        ...mockOrder,
        status: 'IN_PROGRESS',
        prescription: { id: 'rx-1', encounterId: 'enc-1', encounter: { patientId: 'pat-1' } },
      });
      mockPrisma.labResult.findUnique.mockResolvedValue(null);
      mockPrisma.labResult.create.mockResolvedValue({ id: 'lr-1' });
      mockPrisma.labResultItem.createMany.mockResolvedValue({ count: 2 });
      mockPrisma.order.update.mockResolvedValue({});

      const res = await service.completeLabResult('ord-1', {
        items: [
          { name: 'K', value: '7.2', unit: 'mEq/L', finding: 'CRITICAL' },
          { name: 'Na', value: '140', unit: 'mEq/L' },
        ],
      }, 'tech-1');

      expect(res.hasCritical).toBe(true);
      // progressive billing 트리거 이벤트(prescriptionId 동봉)
      expect(mockEmitter.emit).toHaveBeenCalledWith('lab.result.completed', expect.objectContaining({
        prescriptionId: 'rx-1', patientId: 'pat-1', encounterId: 'enc-1', hasCritical: true,
      }));
      // 위급값 통보 이벤트
      expect(mockEmitter.emit).toHaveBeenCalledWith('lab.critical.value', expect.objectContaining({
        patientId: 'pat-1',
        criticalValues: [expect.objectContaining({ testName: 'K', value: '7.2' })],
      }));
    });

    it('should NOT emit lab.critical.value when no CRITICAL finding', async () => {
      mockPrisma.order.findUnique.mockResolvedValue({
        ...mockOrder,
        status: 'IN_PROGRESS',
        prescription: { id: 'rx-1', encounterId: 'enc-1', encounter: { patientId: 'pat-1' } },
      });
      mockPrisma.labResult.findUnique.mockResolvedValue(null);
      mockPrisma.labResult.create.mockResolvedValue({ id: 'lr-1' });
      mockPrisma.labResultItem.createMany.mockResolvedValue({ count: 1 });
      mockPrisma.order.update.mockResolvedValue({});

      await service.completeLabResult('ord-1', {
        items: [{ name: 'WBC', value: '7500', finding: 'ABNORMAL' }],
      }, 'tech-1');

      expect(mockEmitter.emit).toHaveBeenCalledWith('lab.result.completed', expect.objectContaining({ hasCritical: false }));
      const criticalCalls = mockEmitter.emit.mock.calls.filter((c: unknown[]) => c[0] === 'lab.critical.value');
      expect(criticalCalls).toHaveLength(0);
    });

    it('should reject ORDERED (접수 전) and CANCELLED orders', async () => {
      mockPrisma.order.findUnique.mockResolvedValue({
        ...mockOrder,
        status: 'ORDERED',
        prescription: { ...mockOrder.prescription, encounter: { patientId: 'pat-1' } },
      });
      await expect(service.completeLabResult('ord-1', { items: [] }, 'tech-1'))
        .rejects.toThrow(BadRequestException);

      mockPrisma.order.findUnique.mockResolvedValue({
        ...mockOrder,
        status: 'CANCELLED',
        prescription: { ...mockOrder.prescription, encounter: { patientId: 'pat-1' } },
      });
      await expect(service.completeLabResult('ord-1', { items: [] }, 'tech-1'))
        .rejects.toThrow(BadRequestException);
    });

    it('should stamp completedById and implicit start when completing from RECEIVED', async () => {
      mockPrisma.order.findUnique.mockResolvedValue({
        ...mockOrder,
        status: 'RECEIVED',
        prescription: { ...mockOrder.prescription, encounter: { patientId: 'pat-1' } },
      });
      mockPrisma.labResult.findUnique.mockResolvedValue(null);
      mockPrisma.labResult.create.mockResolvedValue({ id: 'lr-1' });
      mockPrisma.labResultItem.createMany.mockResolvedValue({ count: 1 });
      mockPrisma.order.update.mockResolvedValue({});

      await service.completeLabResult('ord-1', {
        items: [{ name: 'WBC', value: '7500' }],
      }, 'tech-1');

      expect(mockPrisma.order.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            completedById: 'tech-1',
            startedById: 'tech-1',
            startedAt: expect.any(Date),
          }),
        }),
      );
    });
  });

  // ═══════════════════════════════════════════
  // acquireImaging / reportImaging
  // ═══════════════════════════════════════════

  describe('acquireImaging', () => {
    it('should create imaging result if not exists', async () => {
      mockPrisma.order.findUnique.mockResolvedValue({
        ...mockOrder, department: 'IMAGING',
        prescription: { ...mockOrder.prescription, encounter: { patientId: 'pat-1' } },
      });
      mockPrisma.imagingResult.findUnique.mockResolvedValue(null);
      mockPrisma.imagingResult.create.mockResolvedValue({});
      mockPrisma.order.update.mockResolvedValue({});

      const result = await service.acquireImaging('ord-1', {});
      expect(result.acquired).toBe(true);
    });

    it('should update existing imaging result', async () => {
      mockPrisma.order.findUnique.mockResolvedValue({
        ...mockOrder, department: 'IMAGING',
        prescription: { ...mockOrder.prescription, encounter: { patientId: 'pat-1' } },
      });
      mockPrisma.imagingResult.findUnique.mockResolvedValue({ id: 'ir-1' });
      mockPrisma.imagingResult.update.mockResolvedValue({});
      mockPrisma.order.update.mockResolvedValue({});

      const result = await service.acquireImaging('ord-1', {});
      expect(result.acquired).toBe(true);
    });

    /**
     * 🔴 2026-08-27 — 방사선사가 입력한 콘솔 판독값이 **조용히 버려지던** 자리.
     *
     * 종전 조건은 `safety?.ionizing` 이었다. 그 값은 게이트가 판정한 modality 에서 나오는데
     * 시술코드가 없으면 `OT`(미상) → `false` 다(운영 실측: 영상결과 209건 중 시술코드 46건뿐,
     * **CT 36건·MG 16건은 전건 0**). 그래서 CT 를 찍고 DLP 를 입력해도 저장되지 않고
     * 응답은 성공이었다 — 성공 응답 + 데이터 소실.
     *
     * 이제 **실제로 저장되는 modality** 로 판정한다(추정이 아니라 방금 적은 사실).
     */
    it('🔴 게이트가 modality 를 미상(OT)으로 봐도, 저장되는 modality 가 전리방사선이면 선량을 기록한다', async () => {
      mockPrisma.order.findUnique.mockResolvedValue({
        ...mockOrder, department: 'IMAGING',
        prescription: { ...mockOrder.prescription, encounter: { patientId: 'pat-1' } },
      });
      mockPrisma.imagingResult.findUnique.mockResolvedValue({ id: 'ir-1', modality: 'CT' });
      mockPrisma.imagingResult.update.mockResolvedValue({});
      mockPrisma.order.update.mockResolvedValue({});
      const mockSafety = {
        assertAcquireGate: vi.fn().mockResolvedValue({
          evaluatedAt: new Date().toISOString(), modality: 'OT', usesContrast: false, ionizing: false, checks: [],
        }),
        recordExposure: vi.fn(),
      };
      const svc = new (service.constructor as any)(mockPrisma, undefined, mockEmitter, mockSafety);

      const r = await svc.acquireImaging('ord-1', { dlp: 620, effectiveDoseMsv: 9.3 }, 'user-1');

      expect(mockSafety.recordExposure).toHaveBeenCalledWith(
        expect.objectContaining({ modality: 'CT', dlp: 620, effectiveDoseMsv: 9.3, enteredBy: 'user-1' }),
      );
      expect(r.doseRecorded).toBe(true);
      expect(r.doseSkippedReason).toBeNull();
    });

    it('🔴 기록하지 못하면 그 사실을 응답에 담는다 — 조용히 버리지 않는다', async () => {
      mockPrisma.order.findUnique.mockResolvedValue({
        ...mockOrder, department: 'IMAGING',
        prescription: { ...mockOrder.prescription, encounter: { patientId: 'pat-1' } },
      });
      mockPrisma.imagingResult.findUnique.mockResolvedValue({ id: 'ir-1', modality: 'US' });
      mockPrisma.imagingResult.update.mockResolvedValue({});
      mockPrisma.order.update.mockResolvedValue({});
      const mockSafety = {
        assertAcquireGate: vi.fn().mockResolvedValue({
          evaluatedAt: new Date().toISOString(), modality: 'US', usesContrast: false, ionizing: false, checks: [],
        }),
        recordExposure: vi.fn(),
      };
      const svc = new (service.constructor as any)(mockPrisma, undefined, mockEmitter, mockSafety);

      const r = await svc.acquireImaging('ord-1', { effectiveDoseMsv: 1.2 }, 'user-1');

      expect(mockSafety.recordExposure).not.toHaveBeenCalled();
      expect(r.doseRecorded).toBe(false);
      expect(r.doseSkippedReason).toBe('NON_IONIZING'); // 화면이 이 사유를 사람 말로 옮긴다
    });

    it('선량을 입력하지 않았으면 아무 말도 하지 않는다(할 말이 없다)', async () => {
      mockPrisma.order.findUnique.mockResolvedValue({
        ...mockOrder, department: 'IMAGING',
        prescription: { ...mockOrder.prescription, encounter: { patientId: 'pat-1' } },
      });
      mockPrisma.imagingResult.findUnique.mockResolvedValue({ id: 'ir-1', modality: 'CT' });
      mockPrisma.imagingResult.update.mockResolvedValue({});
      mockPrisma.order.update.mockResolvedValue({});

      const r = await service.acquireImaging('ord-1', {}, 'user-1');
      expect(r).not.toHaveProperty('doseRecorded');
      expect(r).not.toHaveProperty('doseSkippedReason');
    });

    it('should preserve stored modality on re-acquire when gate detects OT(미상)', async () => {
      mockPrisma.order.findUnique.mockResolvedValue({
        ...mockOrder, department: 'IMAGING',
        prescription: { ...mockOrder.prescription, encounter: { patientId: 'pat-1' } },
      });
      mockPrisma.imagingResult.findUnique.mockResolvedValue({ id: 'ir-1', modality: 'MR' });
      mockPrisma.imagingResult.update.mockResolvedValue({});
      mockPrisma.order.update.mockResolvedValue({});
      const mockSafety = {
        assertAcquireGate: vi.fn().mockResolvedValue({
          evaluatedAt: new Date().toISOString(), modality: 'OT', usesContrast: false, ionizing: false, checks: [],
        }),
        recordExposure: vi.fn(),
      };
      const svc = new (service.constructor as any)(mockPrisma, undefined, mockEmitter, mockSafety);

      await svc.acquireImaging('ord-1', {});

      expect(mockPrisma.imagingResult.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ modality: 'MR' }) }),
      );
    });
  });

  describe('reportImaging', () => {
    it('should report imaging result', async () => {
      mockPrisma.imagingResult.findUnique.mockResolvedValue({ id: 'ir-1', orderId: 'ord-1' });
      mockPrisma.imagingResult.update.mockResolvedValue({});
      mockPrisma.order.update.mockResolvedValue({});

      const result = await service.reportImaging('ord-1', {
        finding: '정상', conclusion: '이상 소견 없음',
      }, 'rad-1');

      expect(result.reported).toBe(true);
    });

    it('should throw NotFoundException if no imaging result', async () => {
      mockPrisma.imagingResult.findUnique.mockResolvedValue(null);
      await expect(service.reportImaging('bad', { finding: '', conclusion: '' }, 'u'))
        .rejects.toThrow(NotFoundException);
    });
  });

  // ═══════════════════════════════════════════
  // getReadingQueue
  // ═══════════════════════════════════════════

  describe('getReadingQueue', () => {
    it('should return ACQUIRED imaging results', async () => {
      mockPrisma.imagingResult.findMany.mockResolvedValue([{ id: 'ir-1', status: 'ACQUIRED' }]);
      const result = await service.getReadingQueue();
      expect(result).toHaveLength(1);
    });
  });

  // ═══════════════════════════════════════════
  // Templates
  // ═══════════════════════════════════════════

  describe('getTemplates', () => {
    it('should return active templates', async () => {
      mockPrisma.labTestTemplate.findMany.mockResolvedValue([{ procedureCode: 'L001' }]);
      const result = await service.getTemplates();
      expect(result).toHaveLength(1);
    });
  });

  describe('createTemplate', () => {
    it('should create template', async () => {
      mockPrisma.labTestTemplate.create.mockResolvedValue({ procedureCode: 'L002' });
      const result = await service.createTemplate({
        procedureCode: 'L002', testName: 'CBC', stationId: 'lab-hematology',
        items: [{ name: 'WBC', unit: '/μL', refRange: '4000-10000' }],
      });
      expect(result.procedureCode).toBe('L002');
    });
  });

  describe('deleteTemplate', () => {
    it('should deactivate template', async () => {
      mockPrisma.labTestTemplate.update.mockResolvedValue({ isActive: false });
      const result = await service.deleteTemplate('L002');
      expect(result.isActive).toBe(false);
    });
  });

  // ═══════════════════════════════════════════
  // getDeltaCheck
  // ═══════════════════════════════════════════

  describe('getDeltaCheck', () => {
    it('should return previous result', async () => {
      mockPrisma.order.findUnique.mockResolvedValue({
        ...mockOrder,
        prescription: {
          ...mockOrder.prescription,
          encounter: { patientId: 'pat-1' },
          procedureCode: { code: 'L001' },
        },
      });
      mockPrisma.labResult.findFirst.mockResolvedValue({
        id: 'lr-prev', completedAt: new Date(), items: [],
      });

      const result = await service.getDeltaCheck('ord-1');
      expect(result).not.toBeNull();
      expect(result!.id).toBe('lr-prev');
    });

    it('should return null if no previous result', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(null);
      const result = await service.getDeltaCheck('bad');
      expect(result).toBeNull();
    });
  });

  // ═══════════════════════════════════════════
  // createTherapyOrder
  // ═══════════════════════════════════════════

  describe('createTherapyOrder', () => {
    it('should create therapy order chain (prescription → order → therapyOrder)', async () => {
      mockPrisma.prescription.create.mockResolvedValue({ id: 'rx-1' });
      mockPrisma.order.create.mockResolvedValue({ id: 'ord-1' });
      mockPrisma.therapyOrder.create.mockResolvedValue({
        id: 'to-1', therapyType: 'PT', sessionNo: 1,
      });

      const result = await service.createTherapyOrder({
        encounterId: 'enc-1', therapyType: 'PT', stationId: 'tx-pt',
        scheduledDate: '2026-06-01',
      }, 'doc-1');

      expect(result.therapyType).toBe('PT');
      expect(mockPrisma.prescription.create).toHaveBeenCalled();
      expect(mockPrisma.order.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ department: 'THERAPY' }),
        }),
      );
    });

    it('should create recurring sessions', async () => {
      mockPrisma.prescription.create.mockResolvedValue({ id: 'rx-1' });
      mockPrisma.order.create.mockResolvedValue({ id: 'ord-1' });
      mockPrisma.therapyOrder.create.mockResolvedValue({
        id: 'to-1', therapyType: 'PT', sessionNo: 1,
      });

      await service.createTherapyOrder({
        encounterId: 'enc-1', therapyType: 'PT', stationId: 'tx-pt',
        scheduledDate: '2026-06-01', isRecurring: true, recurPattern: 'MWF',
        totalSessions: 3,
      }, 'doc-1');

      // 첫 세션 + 2 추가 = prescription 3번, order 3번
      expect(mockPrisma.prescription.create).toHaveBeenCalledTimes(3);
      expect(mockPrisma.order.create).toHaveBeenCalledTimes(3);
    });
  });

  // ═══════════════════════════════════════════
  // completeTherapySession
  // ═══════════════════════════════════════════

  describe('completeTherapySession', () => {
    it('should complete therapy session', async () => {
      // 정본 therapy-completion — 오더 상태를 읽고 조건부 갱신(updateMany)으로 완료한다
      mockPrisma.therapyOrder.findUnique.mockResolvedValue({ id: 'to-1', orderId: 'ord-1', order: { id: 'ord-1', status: 'IN_PROGRESS' } });
      mockPrisma.therapyOrder.update.mockResolvedValue({});
      mockPrisma.order.updateMany = vi.fn().mockResolvedValue({ count: 1 });
      mockPrisma.order.findUnique.mockResolvedValue({ id: 'ord-1', prescriptionId: null, department: 'THERAPY' });
      mockPrisma.$transaction = vi.fn((fn: (tx: unknown) => unknown) => fn(mockPrisma));

      const result = await service.completeTherapySession('to-1', { notes: '완료' });
      expect(result.completed).toBe(true);
    });

    it('should throw NotFoundException for missing therapy order', async () => {
      mockPrisma.therapyOrder.findUnique.mockResolvedValue(null);
      await expect(service.completeTherapySession('bad', {}))
        .rejects.toThrow(NotFoundException);
    });
  });

  // ═══════════════════════════════════════════
  // getSmartPatients
  // ═══════════════════════════════════════════

  describe('getSmartPatients', () => {
    it('should return categorized patients', async () => {
      mockPrisma.encounter.findMany.mockResolvedValue([]);
      mockPrisma.checkupVisit.findMany.mockResolvedValue([]);
      mockPrisma.admission.findMany.mockResolvedValue([]);

      const result = await service.getSmartPatients();

      expect(result.checkedInPatients).toEqual([]);
      expect(result.checkupPatients).toEqual([]);
      expect(result.admittedPatients).toEqual([]);
      expect(result.searchResults).toEqual([]);
    });

    it('should include search results when search provided', async () => {
      mockPrisma.encounter.findMany.mockResolvedValue([]);
      mockPrisma.checkupVisit.findMany.mockResolvedValue([]);
      mockPrisma.admission.findMany.mockResolvedValue([]);
      mockPrisma.patient.findMany.mockResolvedValue([
        { id: 'p-1', mrn: 'MR001', familyName: '이', givenName: '환자', gender: 'MALE', dateOfBirth: new Date('1985-03-15'), phone: '010-1234' },
      ]);

      const result = await service.getSmartPatients('이');

      expect(result.searchResults).toHaveLength(1);
    });
  });

  // ═══════════════════════════════════════════
  // getPatientPendingOrders
  // ═══════════════════════════════════════════

  describe('getPatientPendingOrders', () => {
    it('should return pending orders and checkup visit', async () => {
      mockPrisma.order.findMany.mockResolvedValue([{
        id: 'ord-1', status: 'ORDERED', createdAt: new Date(),
        prescription: { instructions: 'CBC', type: 'LAB', procedureCode: { nameKo: 'CBC' } },
      }]);
      mockPrisma.checkupVisit.findFirst.mockResolvedValue({
        id: 'v-1', program: { name: '종합검진', items: [] },
        items: [{ testName: '혈액검사' }],
      });

      const result = await service.getPatientPendingOrders('pat-1');

      expect(result.hasExistingOrders).toBe(true);
      expect(result.orders).toHaveLength(1);
      expect(result.checkupVisit).not.toBeNull();
    });
  });
});
