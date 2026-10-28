import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WorkstationController } from '../../src/modules/workstation/workstation.controller';
import { WorkstationService } from '../../src/modules/workstation/workstation.service';

describe('WorkstationController', () => {
  let controller: WorkstationController;
  let svc: WorkstationService;

  const mockReq = { user: { sub: 'user-1' } };

  beforeEach(() => {
    svc = {
      getSmartPatients: vi.fn().mockResolvedValue({ checkedInPatients: [], checkupPatients: [], admittedPatients: [], searchResults: [] }),
      getPatientPendingOrders: vi.fn().mockResolvedValue({ hasExistingOrders: false, orders: [], checkupVisit: null }),
      getStations: vi.fn().mockResolvedValue([]),
      getQueue: vi.fn().mockResolvedValue([]),
      // 설정 불일치를 meta 로 알리는 계약(2026-08-12) — 별칭 설정 때문에 18스테이션이 영원히 0건이던 것
      getStationConfigHealth: vi.fn().mockResolvedValue({ configuredCodes: 0, matchedCodes: 0, configMismatch: false }),
      receiveOrder: vi.fn().mockResolvedValue({ id: 'ord-1', status: 'RECEIVED' }),
      startOrder: vi.fn().mockResolvedValue({ id: 'ord-1', status: 'IN_PROGRESS' }),
      getLabTemplate: vi.fn().mockResolvedValue(null),
      completeLabResult: vi.fn().mockResolvedValue({ completed: true }),
      getDeltaCheck: vi.fn().mockResolvedValue(null),
      acquireImaging: vi.fn().mockResolvedValue({ acquired: true }),
      reportImaging: vi.fn().mockResolvedValue({ reported: true }),
      getReadingQueue: vi.fn().mockResolvedValue([]),
      getTemplates: vi.fn().mockResolvedValue([]),
      createTemplate: vi.fn().mockResolvedValue({ procedureCode: 'L001' }),
      updateTemplate: vi.fn().mockResolvedValue({}),
      deleteTemplate: vi.fn().mockResolvedValue({ isActive: false }),
      getTherapySchedule: vi.fn().mockResolvedValue([]),
      createTherapyOrder: vi.fn().mockResolvedValue({ id: 'to-1' }),
      completeTherapySession: vi.fn().mockResolvedValue({ completed: true }),
    } as any;

    // Add prisma mock for getLabTemplate endpoint
    (svc as any).prisma = {
      order: { findUnique: vi.fn().mockResolvedValue(null) },
    };

    controller = new WorkstationController(svc);
  });

  describe('getSmartPatients', () => {
    it('should return smart patient list', async () => {
      const result = await controller.getSmartPatients(undefined, undefined);
      expect(result.data).toHaveProperty('checkedInPatients');
    });

    it('should pass q param', async () => {
      await controller.getSmartPatients('김', undefined);
      expect(svc.getSmartPatients).toHaveBeenCalledWith('김');
    });

    it('should fallback to search param', async () => {
      await controller.getSmartPatients(undefined, '박');
      expect(svc.getSmartPatients).toHaveBeenCalledWith('박');
    });
  });

  describe('getPatientPendingOrders', () => {
    it('should return pending orders', async () => {
      const result = await controller.getPatientPendingOrders('pat-1');
      expect(result.data.hasExistingOrders).toBe(false);
    });
  });

  describe('getStations', () => {
    it('should return station list', async () => {
      const result = await controller.getStations();
      expect(result.data).toEqual([]);
    });
  });

  /**
   * 🔴 **픽스처를 고치는 것만으로는 아무것도 보증하지 않는다** — 인자가 하나 늘어서
   *    기존 호출이 깨졌을 뿐이다. **새로 생긴 범위 제한이 실제로 막는지**를 함께 센다.
   */
  describe('🔴 급양은 급양 스테이션 밖을 못 본다', () => {
    it('급양 계정이 검사 스테이션 큐를 부르면 막힌다', async () => {
      await expect(controller.getQueue('lab-phlebotomy', 'NUTRITION')).rejects.toThrow(/급양 스테이션/);
    });

    it('급양 스테이션은 부를 수 있다(대조군 — 전부 막으면 화면이 죽는다)', async () => {
      await expect(controller.getQueue('nutrition', 'NUTRITION')).resolves.toBeDefined();
      await expect(controller.getQueue('nut-kitchen', 'NUTRITION')).resolves.toBeDefined();
    });

    it('다른 직군은 종전대로 전 스테이션을 본다(대조군 — 과하게 좁히지 않았다)', async () => {
      await expect(controller.getQueue('lab-phlebotomy', 'LAB_TECH')).resolves.toBeDefined();
      await expect(controller.getQueue('imaging-ct', 'NURSE')).resolves.toBeDefined();
    });
  });

  describe('getQueue', () => {
    it('should return queue for station', async () => {
      const result = await controller.getQueue('lab-phlebotomy', 'LAB_TECH');
      expect(result.data).toEqual([]);
      expect(svc.getQueue).toHaveBeenCalledWith('lab-phlebotomy', false);
      // 화면이 "부서 전체를 보는 중"을 표시하려면 meta 가 반드시 따라와야 한다
      expect(result.meta).toEqual({ configuredCodes: 0, matchedCodes: 0, configMismatch: false });
    });

    it('should pass stat filter', async () => {
      await controller.getQueue('lab-phlebotomy', 'LAB_TECH', 'true');
      expect(svc.getQueue).toHaveBeenCalledWith('lab-phlebotomy', true);
    });
  });

  describe('receiveOrder', () => {
    it('should receive order with performer', async () => {
      const result = await controller.receiveOrder('ord-1', mockReq as any);
      expect(result.data.status).toBe('RECEIVED');
      expect(svc.receiveOrder).toHaveBeenCalledWith('ord-1', 'user-1');
    });
  });

  describe('startOrder', () => {
    it('should start order with performer', async () => {
      const result = await controller.startOrder('ord-1', mockReq as any);
      expect(result.data.status).toBe('IN_PROGRESS');
      expect(svc.startOrder).toHaveBeenCalledWith('ord-1', 'user-1');
    });
  });

  describe('completeLabResult', () => {
    it('should complete lab result', async () => {
      const result = await controller.completeLabResult(
        'ord-1', { items: [{ name: 'WBC', value: '7500' }] }, mockReq as any,
      );
      expect(result.data.completed).toBe(true);
      expect(svc.completeLabResult).toHaveBeenCalledWith('ord-1', expect.anything(), 'user-1');
    });
  });

  describe('acquireImaging', () => {
    it('should acquire imaging with performer', async () => {
      const result = await controller.acquireImaging('ord-1', {}, mockReq as any);
      expect(result.data.acquired).toBe(true);
      expect(svc.acquireImaging).toHaveBeenCalledWith('ord-1', {}, 'user-1');
    });
  });

  describe('reportImaging', () => {
    it('should report imaging', async () => {
      const result = await controller.reportImaging(
        'ord-1', { finding: '정상', conclusion: '이상 없음' }, mockReq as any,
      );
      expect(result.data.reported).toBe(true);
    });
  });

  describe('getReadingQueue', () => {
    it('should return reading queue', async () => {
      const result = await controller.getReadingQueue();
      expect(result.data).toEqual([]);
    });
  });

  describe('templates', () => {
    it('should list templates', async () => {
      const result = await controller.getTemplates();
      expect(result.data).toEqual([]);
    });

    it('should create template', async () => {
      const result = await controller.createTemplate({
        procedureCode: 'L001', testName: 'CBC', stationId: 'lab',
        items: [{ name: 'WBC', unit: '/μL', refRange: '4000-10000' }],
      });
      expect(result.data.procedureCode).toBe('L001');
    });

    it('should delete template', async () => {
      const result = await controller.deleteTemplate('L001');
      expect(result.data.isActive).toBe(false);
    });
  });

  describe('getLabTemplate', () => {
    it('should return lab template for order', async () => {
      (svc as any).prisma.order.findUnique.mockResolvedValue({
        prescription: { procedureCode: { code: 'L001' } },
      });
      (svc.getLabTemplate as ReturnType<typeof vi.fn>).mockResolvedValue({
        procedureCode: 'L001', testName: 'CBC',
        items: [{ name: 'WBC', unit: '/μL', refRange: '4000-10000' }],
      });
      const result = await controller.getLabTemplate('ord-1');
      expect(svc.getLabTemplate).toHaveBeenCalledWith('L001');
      expect(result.data.procedureCode).toBe('L001');
    });

    it('should return null when order not found', async () => {
      (svc as any).prisma.order.findUnique.mockResolvedValue(null);
      const result = await controller.getLabTemplate('nonexist');
      expect(result.data).toBeNull();
    });
  });

  describe('getTemplate', () => {
    it('should return single template by code', async () => {
      (svc.getTemplates as ReturnType<typeof vi.fn>).mockResolvedValue([
        { procedureCode: 'L001', testName: 'CBC' },
      ]);
      const result = await controller.getTemplates('L001');
      expect(svc.getTemplates).toHaveBeenCalled();
    });
  });

  describe('updateTemplate', () => {
    it('should update existing template', async () => {
      const result = await controller.updateTemplate('L001', {
        testName: 'CBC (수정)',
        items: [{ name: 'WBC', unit: '/μL', refRange: '4500-11000' }],
      });
      expect(svc.updateTemplate).toHaveBeenCalledWith('L001', expect.objectContaining({ testName: 'CBC (수정)' }));
    });
  });

  describe('therapy', () => {
    it('should get therapy schedule', async () => {
      const result = await controller.getTherapySchedule('tx-pt', '2026-06-01');
      expect(result.data).toEqual([]);
    });

    it('should create therapy order', async () => {
      const result = await controller.createTherapyOrder({
        encounterId: 'enc-1', therapyType: 'PT', stationId: 'tx-pt',
        scheduledDate: '2026-06-01',
      }, mockReq as any);
      expect(result.data.id).toBe('to-1');
    });

    it('should complete therapy session', async () => {
      const result = await controller.completeTherapySession('to-1', { resultData: {} }, mockReq as any);
      expect(result.data.completed).toBe(true);
      expect(svc.completeTherapySession).toHaveBeenCalledWith('to-1', {}, 'user-1');
    });
  });
});
