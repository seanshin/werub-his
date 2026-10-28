import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ChemoService } from '../../src/modules/chemo/chemo.service';

const DAY = 86400_000;

describe('항암 사이클 엔진 (R4)', () => {
  let service: ChemoService;
  let mockPrisma: any;
  let mockCompounding: any;
  let mockEmitter: any;
  let configMap: Record<string, string>;

  const regimen = {
    id: 'reg-1',
    code: 'FOLFOX6',
    name: 'mFOLFOX6',
    status: 'ACTIVE',
    cycleLengthDays: 14,
    defaultCycles: 12,
    drugs: [
      { id: 'd1', role: 'CHEMO', drugName: 'Oxaliplatin', dosePerM2: 85, fixedDose: null, capMg: null, bandMg: null, dayOffsets: [1], infusionNote: null, sortOrder: 0 },
      { id: 'd2', role: 'PREMED', drugName: 'Ondansetron', dosePerM2: null, fixedDose: 16, capMg: null, bandMg: null, dayOffsets: [1], infusionNote: null, sortOrder: 1 },
      { id: 'd3', role: 'CHEMO', drugName: '5-FU bolus', dosePerM2: 400, fixedDose: null, capMg: null, bandMg: null, dayOffsets: [1, 2], infusionNote: null, sortOrder: 2 },
    ],
  };

  beforeEach(() => {
    configMap = {};
    mockPrisma = {
      chemoRegimen: { findUnique: vi.fn().mockResolvedValue(regimen), create: vi.fn(), findMany: vi.fn() },
      chemoCourse: { create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'course-1', ...data })), update: vi.fn().mockResolvedValue({}), findUnique: vi.fn() },
      chemoCycle: {
        findUnique: vi.fn(),
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(0),
        update: vi.fn().mockImplementation(({ where, data }: any) => Promise.resolve({ id: where.id, ...data })),
      },
      preVisitVitals: { findFirst: vi.fn().mockResolvedValue({ height: 170, weight: 65 }) },
      patientTreatmentSchedule: { create: vi.fn().mockResolvedValue({ id: 'sched-1' }) },
      patientScheduleItem: { createMany: vi.fn().mockResolvedValue({ count: 1 }), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      labResultItem: { findFirst: vi.fn().mockResolvedValue(null) },
      // 🔴 (2026-09-16 J4) startCycle 은 조제 지시를 만들기 전에 **직전 실패가 남긴 고아 지시**를
      //    자연키로 찾는다(findMany) — 목이 그 모양을 갖지 않으면 정본과 다른 것을 시험하게 된다.
      compoundingOrder: { findMany: vi.fn().mockResolvedValue([]) },
      cancerTreatment: { create: vi.fn().mockResolvedValue({}) },
      $transaction: vi.fn(async (arg: any) => (typeof arg === 'function' ? arg(mockPrisma) : Promise.all(arg))),
    };
    mockCompounding = {
      computeBsa: vi.fn((h: number, w: number) => Math.round(Math.sqrt((h * w) / 3600) * 100) / 100),
      computeChemoDose: vi.fn((p: any) => {
        const bsa = Math.round(Math.sqrt((p.heightCm * p.weightKg) / 3600) * 100) / 100;
        return { bsa, rawDose: bsa * p.dosePerM2, finalDose: Math.round(bsa * p.dosePerM2 * 100) / 100, banded: false, capped: false, unit: 'mg' };
      }),
      createOrder: vi.fn().mockResolvedValue({ id: 'cpd-1' }),
    };
    mockEmitter = { emit: vi.fn() };
    const config = { get: vi.fn(async (k: string) => configMap[k] ?? null) };
    service = new ChemoService(mockPrisma, mockCompounding, mockEmitter, config as any);
  });

  describe('createCourse', () => {
    it('바이탈 폴백으로 BSA 스냅샷·사이클 간격(cycleLengthDays)·치료일정 전개', async () => {
      const start = new Date('2026-07-16');
      await service.createCourse({ patientId: 'pt-1', regimenId: 'reg-1', startDate: '2026-07-16' } as any, 'u-1');
      const created = mockPrisma.chemoCourse.create.mock.calls[0][0].data;
      expect(created.bsa).toBeCloseTo(1.75, 2); // √(170×65/3600)
      expect(created.plannedCycles).toBe(12);
      const cycles = created.cycles.create;
      expect(cycles).toHaveLength(12);
      expect(cycles[1].plannedDate.getTime() - cycles[0].plannedDate.getTime()).toBe(14 * DAY);
      expect(cycles[0].plannedDate.getTime()).toBe(start.getTime());
      const sched = mockPrisma.patientTreatmentSchedule.create.mock.calls[0][0].data;
      expect(sched.items.create).toHaveLength(12);
      expect(sched.items.create[2].title).toBe('C3D1 FOLFOX6');
    });

    it('신체계측 부재 시 400', async () => {
      mockPrisma.preVisitVitals.findFirst.mockResolvedValue(null);
      await expect(service.createCourse({ patientId: 'pt-1', regimenId: 'reg-1', startDate: '2026-07-16' } as any)).rejects.toThrow(/신체계측/);
    });

    it('ACTIVE 아닌 레지멘 거부', async () => {
      mockPrisma.chemoRegimen.findUnique.mockResolvedValue({ ...regimen, status: 'DRAFT' });
      await expect(service.createCourse({ patientId: 'pt-1', regimenId: 'reg-1', startDate: '2026-07-16' } as any)).rejects.toThrow(/ACTIVE/);
    });
  });

  describe('nadir 게이트', () => {
    beforeEach(() => {
      mockPrisma.chemoCycle.findUnique.mockResolvedValue({ id: 'cyc-1', status: 'PLANNED', course: { patientId: 'pt-1' } });
    });

    it('10³/µL 단위 정규화 — ANC 1.2×10³=1200<1500 미통과·혈소판 210×10³ 통과', async () => {
      mockPrisma.labResultItem.findFirst
        .mockResolvedValueOnce({ value: '1.2', unit: '10*3/uL', labResult: { completedAt: new Date() } })
        .mockResolvedValueOnce({ value: '210', unit: '10^3/uL', labResult: { completedAt: new Date() } });
      const r = await service.checkCycleGate('cyc-1');
      expect(r.pass).toBe(false);
      expect(r.checks[0]).toMatchObject({ normalized: 1200, pass: false });
      expect(r.checks[1]).toMatchObject({ normalized: 210000, pass: true });
    });

    it('최근 결과 부재 → 미통과 사유 명시', async () => {
      const r = await service.checkCycleGate('cyc-1');
      expect(r.pass).toBe(false);
      expect(r.checks[0].reason).toContain('결과 없음');
    });
  });

  describe('startCycle', () => {
    const cycleWithCourse = (over: any = {}) => ({
      id: 'cyc-1',
      status: 'PLANNED',
      cycleNumber: 1,
      doseReductionPct: null,
      delayReason: null,
      course: {
        id: 'course-1', status: 'ACTIVE', patientId: 'pt-1', heightCm: 170, weightKg: 65,
        doseReductionPct: 0, scheduleId: 'sched-1', regimen,
      },
      ...over,
    });

    it('BLOCK 모드 게이트 미통과 → GATE_HOLD 전환 + CHEMO_GATE_HOLD', async () => {
      configMap['chemo.cycleGate'] = 'BLOCK';
      mockPrisma.chemoCycle.findUnique.mockResolvedValue(cycleWithCourse());
      await expect(service.startCycle('cyc-1', 'u-1')).rejects.toThrow(/nadir 게이트 미통과/);
      expect(mockPrisma.chemoCycle.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'GATE_HOLD' }) }),
      );
      expect(mockCompounding.createOrder).not.toHaveBeenCalled();
    });

    it('🔴 BLOCK 게이트 오버라이드는 사유가 있어야 한다 · 사유·누가·언제가 사이클 원장(gateResult)에 남는다(2026-10-10 — 종전 응답에만)', async () => {
      configMap['chemo.cycleGate'] = 'BLOCK';
      mockPrisma.chemoCycle.findUnique.mockResolvedValue(cycleWithCourse());
      await expect(service.startCycle('cyc-1', 'u-1', { overrideGate: true })).rejects.toMatchObject({ response: { code: 'CHEMO_GATE_OVERRIDE_REASON_REQUIRED' } });
      expect(mockCompounding.createOrder).not.toHaveBeenCalled();
      await service.startCycle('cyc-1', 'u-1', { overrideGate: true, overrideReason: '임상시험 프로토콜상 진행' });
      const started = mockPrisma.chemoCycle.update.mock.calls.find((c: any) => c[0].data.status === 'IN_PROGRESS')[0].data;
      expect(started.gateResult.startedDespiteFail).toMatchObject({ by: 'u-1', override: true, reason: '임상시험 프로토콜상 진행' });
    });

    it('대조군 — 게이트 통과면 오버라이드 기록이 없다', async () => {
      mockPrisma.chemoCycle.findUnique.mockResolvedValue(cycleWithCourse());
      await service.startCycle('cyc-1', 'u-1');
      const started = mockPrisma.chemoCycle.update.mock.calls.find((c: any) => c[0].data.status === 'IN_PROGRESS')[0].data;
      expect(started.gateResult?.startedDespiteFail).toBeUndefined();
    });

    it('통과 시 D1 무균조제 생성 — CHEMO만 감량 적용·PREMED 고정, D2+ 일정 전개', async () => {
      configMap['chemo.cycleGate'] = 'BLOCK';
      configMap['chemo.gate.ancMin'] = '1500';
      mockPrisma.labResultItem.findFirst.mockImplementation(({ where }: any) =>
        Promise.resolve(
          where.loincCode.in.includes('777-3')
            ? { value: '250', unit: '10^3/uL', labResult: { completedAt: new Date() } }
            : { value: '2500', unit: '/uL', labResult: { completedAt: new Date() } },
        ),
      );
      mockPrisma.chemoCycle.findUnique.mockResolvedValue(cycleWithCourse({ course: { ...cycleWithCourse().course, doseReductionPct: 20 } }));
      const r = await service.startCycle('cyc-1', 'u-1');
      const order = mockCompounding.createOrder.mock.calls[0][0];
      expect(order.sourceType).toBe('CHEMO');
      // Oxaliplatin 85×0.8=68mg/m² 로 감량된 dosePerM2 전달
      expect(mockCompounding.computeChemoDose).toHaveBeenCalledWith(expect.objectContaining({ dosePerM2: 68 }));
      // PREMED 고정용량은 감량 미적용(16mg 유지)
      const premed = order.components.find((c: any) => c.name.includes('Ondansetron'));
      expect(premed.orderedAmount).toBe(16);
      // D2 투여분(5-FU) 일정 전개
      const items = mockPrisma.patientScheduleItem.createMany.mock.calls[0][0].data;
      expect(items).toHaveLength(1);
      expect(items[0].title).toBe('C1D2 5-FU bolus');
      expect(r.cycle.status).toBe('IN_PROGRESS');
      expect(mockEmitter.emit).toHaveBeenCalledWith('chemo.cycle.started', expect.objectContaining({ cycleId: 'cyc-1' }));
    });

    it('이전 사이클 미완료 시 거부', async () => {
      mockPrisma.chemoCycle.findUnique.mockResolvedValue(cycleWithCourse({ cycleNumber: 3 }));
      mockPrisma.chemoCycle.count.mockResolvedValue(1);
      await expect(service.startCycle('cyc-1', 'u-1')).rejects.toThrow(/이전 사이클/);
    });
  });

  describe('delayCycle', () => {
    it('본 사이클+이후 PLANNED 연쇄 이동·지연 사유 기록·캘린더 동반 이동', async () => {
      const base = new Date('2026-08-01').getTime();
      mockPrisma.chemoCycle.findUnique.mockResolvedValue({ id: 'cyc-2', courseId: 'course-1', cycleNumber: 2, status: 'PLANNED', course: { scheduleId: 'sched-1' } });
      mockPrisma.chemoCycle.findMany.mockResolvedValue([
        { id: 'cyc-2', plannedDate: new Date(base), cycleNumber: 2 },
        { id: 'cyc-3', plannedDate: new Date(base + 14 * DAY), cycleNumber: 3 },
      ]);
      const r = await service.delayCycle('cyc-2', 7, '호중구감소증');
      expect(r.delayed).toBe(2);
      const calls = mockPrisma.chemoCycle.update.mock.calls;
      expect(calls[0][0].data.plannedDate.getTime()).toBe(base + 7 * DAY);
      expect(calls[0][0].data.delayReason).toBe('호중구감소증');
      expect(calls[1][0].data.plannedDate.getTime()).toBe(base + 21 * DAY);
      expect(calls[1][0].data.delayReason).toBeUndefined();
      // 캘린더 CnD1 항목도 동일 이동
      const itemCalls = mockPrisma.patientScheduleItem.updateMany.mock.calls;
      expect(itemCalls[0][0].where.title.startsWith).toBe('C2D1 ');
      expect(itemCalls[0][0].data.plannedAt.getTime()).toBe(base + 7 * DAY);
    });

    it('사유 누락 거부', async () => {
      await expect(service.delayCycle('cyc-2', 7, '')).rejects.toThrow(/사유/);
    });
  });

  describe('completeCycle', () => {
    it('마지막 사이클 완료 → 코스 COMPLETED + 암등록 치료요약 자동 기록', async () => {
      mockPrisma.chemoCycle.findUnique.mockResolvedValue({
        id: 'cyc-12', courseId: 'course-1', status: 'IN_PROGRESS',
        course: { id: 'course-1', registryId: 'crg-1', startDate: new Date('2026-07-16'), regimen: { code: 'FOLFOX6', name: 'mFOLFOX6' } },
      });
      mockPrisma.chemoCycle.count.mockResolvedValueOnce(0).mockResolvedValueOnce(12);
      const r = await service.completeCycle('cyc-12', 'u-1');
      expect(r.courseCompleted).toBe(true);
      expect(mockPrisma.chemoCourse.update).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'COMPLETED' } }));
      expect(mockPrisma.cancerTreatment.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ treatmentType: 'CHEMOTHERAPY', cycles: 12 }) }),
      );
    });

    it('PLANNED 사이클 완료 시도 거부(상태기계)', async () => {
      mockPrisma.chemoCycle.findUnique.mockResolvedValue({ id: 'cyc-1', status: 'PLANNED', course: { registryId: null, regimen: {} } });
      await expect(service.completeCycle('cyc-1')).rejects.toThrow(/전이 불가/);
    });
  });

  describe('코스 중단·감량(2026-10-10)', () => {
    it('🔴 끝난 코스의 감량률은 바꾸지 않는다 · 빈 중단 사유 거절 · 상태 조건부 갱신', async () => {
      mockPrisma.chemoCourse.updateMany = vi.fn().mockResolvedValue({ count: 1 });
      mockPrisma.chemoCourse.findUnique.mockResolvedValue({ status: 'COMPLETED' });
      await expect(service.updateCourse('course-1', { doseReductionPct: 20 })).rejects.toMatchObject({ response: { code: 'CHEMO_COURSE_NOT_ACTIVE' } });
      mockPrisma.chemoCourse.findUnique.mockResolvedValue({ status: 'ACTIVE' });
      await expect(service.updateCourse('course-1', { stopReason: '   ' })).rejects.toMatchObject({ response: { code: 'CHEMO_STOP_REASON_REQUIRED' } });
      await service.updateCourse('course-1', { stopReason: ' 진행성 독성 ' });
      expect(mockPrisma.chemoCourse.updateMany).toHaveBeenCalledWith({ where: { id: 'course-1', status: 'ACTIVE' }, data: { status: 'STOPPED', stopReason: '진행성 독성' } });
      mockPrisma.chemoCourse.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.updateCourse('course-1', { stopReason: '다시' })).rejects.toMatchObject({ response: { code: 'CHEMO_COURSE_STATE_CHANGED' } });
    });
  });
});
