// 🔴 검진권 발행은 활성화코드를 봉투암호화해 저장한다(`encryptField`) — 키가 없으면 그 경로에서 죽는다.
//    foreign-patient 스펙과 같은 방식으로 테스트용 키를 세운다(정본 암호화 경로를 그대로 지나기 위해).
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? 'a3f9'.repeat(16);

import { describe, it, expect, beforeEach, vi } from 'vitest';

import { makeSerial } from '../../src/modules/voucher/voucher-serial';

/**
 * 🔴 재시도가 결과를 **한 벌 더** 만들지 않는다 — J4 봉합분의 동작 가드(2026-09-16).
 *
 * 소스 문자열이 아니라 **목이 받은 실제 인자**를 본다. 건마다 "정상 1회 호출은 그대로"라는 대조군을 둔다 —
 * 막기만 하고 끝내면 기능을 죽인 것을 테스트가 통과시킨다(이 저장소가 반복해 배운 것).
 */
describe('🔴 J4 — 재시도가 한 벌 더 만들지 않는다', () => {
  // ── 1. 항암 사이클 개시: 직전 실패가 남긴 고아 조제 지시를 재사용한다 ──
  describe('항암 D1 무균조제 — 개시 재시도가 조제 지시를 두 벌 만들지 않는다', () => {
    let prisma: any;
    let compounding: any;
    let svc: any;

    const regimen = {
      code: 'FOLFOX',
      drugs: [{ drugName: 'Oxaliplatin', role: 'CHEMO', dayOffsets: [1], dosePerM2: 85, sortOrder: 0, medicationCodeId: null, capMg: null, bandMg: null, infusionNote: null, fixedDose: null }],
    };
    const cycle = () => ({
      id: 'cyc-1', courseId: 'course-1', cycleNumber: 1, status: 'PLANNED', doseReductionPct: null, delayReason: null,
      course: { id: 'course-1', status: 'ACTIVE', patientId: 'pt-1', heightCm: 170, weightKg: 65, doseReductionPct: 0, scheduleId: null, regimen },
    });

    beforeEach(async () => {
      prisma = {
        chemoCycle: {
          findUnique: vi.fn().mockResolvedValue(cycle()),
          findMany: vi.fn().mockResolvedValue([]),
          count: vi.fn().mockResolvedValue(0),
          update: vi.fn().mockImplementation(({ where, data }: any) => Promise.resolve({ id: where.id, ...data })),
        },
        compoundingOrder: { findMany: vi.fn().mockResolvedValue([]) },
        labResultItem: { findFirst: vi.fn().mockResolvedValue(null) },
        patientScheduleItem: { createMany: vi.fn(), updateMany: vi.fn() },
        $transaction: vi.fn(async (arg: any) => (typeof arg === 'function' ? arg(prisma) : Promise.all(arg))),
      };
      compounding = {
        computeBsa: vi.fn(() => 1.75),
        computeChemoDose: vi.fn(() => ({ bsa: 1.75, finalDose: 148.75, banded: false, capped: false, unit: 'mg' })),
        createOrder: vi.fn().mockResolvedValue({ id: 'new-order' }),
      };
      const { ChemoService } = await import('../../src/modules/chemo/chemo.service');
      // 정본 생성자 순서: (prisma, compounding, eventEmitter, config?, preAuthGate?)
      svc = new ChemoService(prisma, compounding, { emit: vi.fn() } as any, { get: vi.fn().mockResolvedValue('OFF') } as any);
    });

    it('대조군 — 고아 지시가 없으면 새로 만든다(정상 1회 개시)', async () => {
      await svc.startCycle('cyc-1', 'u-1');
      expect(compounding.createOrder).toHaveBeenCalledTimes(1);
    });

    it('🔴 어느 사이클도 링크하지 않은 살아 있는 지시가 있으면 재사용한다(새로 만들지 않는다)', async () => {
      prisma.compoundingOrder.findMany.mockResolvedValue([{ id: 'orphan-1' }]);
      prisma.chemoCycle.findMany.mockResolvedValue([]); // 아무 사이클도 링크하지 않음 = 고아
      const r = await svc.startCycle('cyc-1', 'u-1');
      expect(compounding.createOrder).not.toHaveBeenCalled();
      expect(r.compoundingOrder.id).toBe('orphan-1');
    });

    it('대조군 — 이미 다른 사이클이 쓰는 지시는 재사용하지 않는다(새로 만든다)', async () => {
      prisma.compoundingOrder.findMany.mockResolvedValue([{ id: 'used-1' }]);
      prisma.chemoCycle.findMany.mockResolvedValue([{ compoundingOrderId: 'used-1' }]);
      await svc.startCycle('cyc-1', 'u-1');
      expect(compounding.createOrder).toHaveBeenCalledTimes(1);
    });

    it('자연키로 찾는다 — 환자 + `<레지멘> C<사이클>D1` · 취소된 것은 제외', async () => {
      await svc.startCycle('cyc-1', 'u-1');
      const where = prisma.compoundingOrder.findMany.mock.calls[0][0].where;
      expect(where.patientId).toBe('pt-1');
      expect(where.sourceType).toBe('CHEMO');
      expect(where.notes.startsWith).toBe('FOLFOX C1D1');
      expect(where.status).toEqual({ not: 'CANCELLED' });
    });
  });

  // ── 2. 근태: 같은 분 중복 탭이 행을 두 개 만들지 않는다 ──
  describe('근태 — 같은 분 중복 탭', () => {
    let prisma: any;
    let svc: any;

    beforeEach(async () => {
      prisma = {
        attendanceRecord: {
          findFirst: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'ar-new', at: new Date(), ...data })),
        },
        // staffOf() 는 findUnique({ where: { userId } }) 를 부른다
        staff: { findUnique: vi.fn().mockResolvedValue({ id: 's-1', employeeNumber: 'E1', clinicUserId: null }) },
        // audit() 은 create(...).catch(...) 로 삼킨다 — 목도 Promise 를 돌려줘야 한다
        auditLog: { create: vi.fn().mockResolvedValue({}) },
      };
      const { EssService } = await import('../../src/modules/ess/ess.service');
      // configRuntime.get() 은 Promise 를 돌려준다(코드가 `.catch` 를 건다)
      const cfg = { get: vi.fn().mockResolvedValue(undefined) };
      svc = new EssService(prisma, { enqueue: vi.fn() } as any, cfg as any, cfg as any, {} as any, {} as any, {} as any, {} as any);
    });

    it('대조군 — 같은 분에 기록이 없으면 만든다', async () => {
      await svc.clock('u-1', 'CLOCK_IN');
      expect(prisma.attendanceRecord.create).toHaveBeenCalledTimes(1);
    });

    it('🔴 같은 사람·같은 종류가 같은 분에 이미 있으면 그 행을 돌려준다(두 벌 금지)', async () => {
      prisma.attendanceRecord.findFirst.mockResolvedValue({ id: 'ar-existing', at: new Date() });
      const r = await svc.clock('u-1', 'CLOCK_IN');
      expect(prisma.attendanceRecord.create).not.toHaveBeenCalled();
      expect(r.id).toBe('ar-existing');
    });

    it('아웃박스 멱등키와 같은 자연키(사용자·종류·분)로 본다', async () => {
      await svc.clock('u-1', 'CLOCK_OUT');
      const where = prisma.attendanceRecord.findFirst.mock.calls[0][0].where;
      expect(where.userId).toBe('u-1');
      expect(where.type).toBe('CLOCK_OUT');
      expect(where.at.gte.getSeconds()).toBe(0);
      expect(where.at.gte.getMilliseconds()).toBe(0);
    });
  });

  // ── 3. 휴가 신청: 같은 기간 대기 신청이 두 건 생기지 않는다 ──
  describe('휴가 신청 — 같은 기간 중복', () => {
    let prisma: any;
    let svc: any;

    beforeEach(async () => {
      prisma = {
        dutyLeaveRequest: {
          findFirst: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'lv-new', ...data })),
        },
        // staffPool() 은 prisma.user.findMany 를 부른다(staff 가 아니다)
        user: { findMany: vi.fn().mockResolvedValue([{ id: 's-1', familyName: '김', givenName: '간호', role: 'NURSE', department: '내과' }]) },
        dutyEntry: { findMany: vi.fn().mockResolvedValue([]) },
      };
      const { DutyScheduleService } = await import('../../src/modules/duty-schedule/duty-schedule.service');
      svc = new DutyScheduleService(prisma);
    });

    const req = { staffId: 's-1', startDate: '2026-10-01', endDate: '2026-10-03', type: 'ANNUAL', reason: '개인' };

    it('대조군 — 대기 중 동일 신청이 없으면 등록한다', async () => {
      await svc.requestLeave(req);
      expect(prisma.dutyLeaveRequest.create).toHaveBeenCalledTimes(1);
    });

    it('🔴 같은 사람·기간·종류의 대기 신청이 있으면 두 번째를 만들지 않는다(이중 차감 방지)', async () => {
      prisma.dutyLeaveRequest.findFirst.mockResolvedValue({ id: 'lv-1', status: 'PENDING' });
      const r = await svc.requestLeave(req);
      expect(prisma.dutyLeaveRequest.create).not.toHaveBeenCalled();
      expect(r.data.id).toBe('lv-1');
    });

    it('대기(PENDING) 상태만 중복으로 본다 — 지난 신청은 새 신청을 막지 않는다', async () => {
      await svc.requestLeave(req);
      expect(prisma.dutyLeaveRequest.findFirst.mock.calls[0][0].where.status).toBe('PENDING');
    });
  });

  // ── 4. 검진권 배치: 부분 발행을 "전량 발행"이라 말하지 않는다 ──
  describe('검진권 배치 — 부분 발행 재개', () => {
    let prisma: any;
    let svc: any;
    let ledger: any;

    const batchRow = {
      id: 'b-1', idempotencyKey: 'K1', form: 'AMOUNT', programId: null, faceValue: 100000, quantity: 10,
      serialRule: { prefix: 'WV', group: 'A', year2: '26', batchSeq: 7 }, status: 'DRAFT',
    };

    beforeEach(async () => {
      prisma = {
        voucherBatch: {
          findUnique: vi.fn().mockResolvedValue(batchRow),
          update: vi.fn().mockResolvedValue({}),
          count: vi.fn().mockResolvedValue(6),
          create: vi.fn(),
        },
        checkupVoucher: {
          count: vi.fn().mockResolvedValue(3), // 10장 중 3장만 발행됨(중간 청크 실패)
          // 🔴 일련번호는 정본 `makeSerial` 이 만든 것을 그대로 쓴다 — 지어낸 형식을 픽스처에 넣으면
          //    "건너뛰기"가 한 번도 일어나지 않아 가드가 헛돈다(내 첫 판이 그랬다).
          findMany: vi.fn().mockResolvedValue(
            [1, 2, 3].map((n) => ({
              serial: makeSerial({ prefix: 'WV', group: 'A', year2: '26', batchSeq: 7, serialNo: n }),
              expiresAt: new Date('2027-01-01'),
            })),
          ),
          createMany: vi.fn().mockResolvedValue({ count: 7 }),
        },
        voucherEvent: { createMany: vi.fn().mockResolvedValue({ count: 7 }) },
        $transaction: vi.fn(async (ops: any) => (Array.isArray(ops) ? Promise.all(ops) : ops(prisma))),
      };
      ledger = { anchorBatch: vi.fn().mockResolvedValue({ merkleRoot: 'mr', anchorId: 'an' }) };
      const { VoucherService } = await import('../../src/modules/voucher/voucher.service');
      svc = new VoucherService(
        prisma,
        { getActive: vi.fn().mockResolvedValue({ enabledForms: ['AMOUNT'], allowedCategories: [], serialPrefix: 'WV', validityMonths: 12, version: 1, anchorChainType: 'INTERNAL' }) } as any,
        ledger,
        {} as any,
        {} as any,
      );
    });

    it('🔴 부분 발행 상태에서 같은 키로 다시 부르면 "전량 발행"이라 말하지 않는다', async () => {
      const r = await svc.issueBatch({ idempotencyKey: 'K1', form: 'AMOUNT', faceValue: 100000, quantity: 10 } as any, 'u-1');
      // 종전엔 { quantity: 10, idempotent: true } 만 돌려줘 3장뿐인 배치를 10장이라 말했다
      expect(r.issued).toBeDefined();
      expect(r.issued).not.toBe(3); // 이어서 발행했으므로 3장에 머물지 않는다
      expect(prisma.checkupVoucher.createMany).toHaveBeenCalled();
    });

    it('🔴 이미 발행된 일련번호는 건너뛰고 빠진 것만 만든다(중복 발행 금지)', async () => {
      await svc.issueBatch({ idempotencyKey: 'K1', form: 'AMOUNT', faceValue: 100000, quantity: 10 } as any, 'u-1');
      const created = prisma.checkupVoucher.createMany.mock.calls[0][0].data as any[];
      expect(created).toHaveLength(7); // 10 - 이미 있는 3
      const serials = created.map((v) => v.serial);
      expect(serials).not.toContain(makeSerial({ prefix: 'WV', group: 'A', year2: '26', batchSeq: 7, serialNo: 1 }));
    });

    it('🔴 재개는 **저장된** serialRule 을 쓴다(다시 계산하면 다른 일련번호가 찍힌다)', async () => {
      await svc.issueBatch({ idempotencyKey: 'K1', form: 'AMOUNT', faceValue: 100000, quantity: 10 } as any, 'u-1');
      const created = prisma.checkupVoucher.createMany.mock.calls[0][0].data as any[];
      // batchSeq 7 이 유지돼야 한다 — voucherBatch.count() 로 다시 세면 6+1=7 이 우연히 같아질 수 있으므로
      // 저장된 규칙을 읽었는지는 prefix/group/year2 조합으로 본다
      expect(created[0].serial).toBe(makeSerial({ prefix: 'WV', group: 'A', year2: '26', batchSeq: 7, serialNo: 4 }));
      expect(prisma.voucherBatch.count).not.toHaveBeenCalled();
    });

    it('🔴 만료일은 이미 발행된 장과 맞춘다(같은 배치 안에서 갈리지 않는다)', async () => {
      await svc.issueBatch({ idempotencyKey: 'K1', form: 'AMOUNT', faceValue: 100000, quantity: 10 } as any, 'u-1');
      const created = prisma.checkupVoucher.createMany.mock.calls[0][0].data as any[];
      expect(created[0].expiresAt).toEqual(new Date('2027-01-01'));
    });

    it('대조군 — 전량 발행된 배치는 그대로 멱등 반환하고 다시 만들지 않는다', async () => {
      prisma.checkupVoucher.count.mockResolvedValue(10);
      const r = await svc.issueBatch({ idempotencyKey: 'K1', form: 'AMOUNT', faceValue: 100000, quantity: 10 } as any, 'u-1');
      expect(r.idempotent).toBe(true);
      expect(r.partial).toBe(false);
      expect(r.issued).toBe(10);
      expect(prisma.checkupVoucher.createMany).not.toHaveBeenCalled();
    });
  });

  // ── 5. 워크스테이션 치료 오더: 같은 슬롯 중복 탭 ──
  describe('치료 오더 — 같은 시각 슬롯 중복', () => {
    let prisma: any;
    let svc: any;

    beforeEach(async () => {
      prisma = {
        therapyOrder: {
          findFirst: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'to-new', ...data })),
        },
        prescription: { create: vi.fn().mockResolvedValue({ id: 'rx-1' }) },
        order: { create: vi.fn().mockResolvedValue({ id: 'ord-1' }) },
        $transaction: vi.fn(async (arg: any) => (typeof arg === 'function' ? arg(prisma) : Promise.all(arg))),
      };
      const { WorkstationService } = await import('../../src/modules/workstation/workstation.service');
      svc = new WorkstationService(prisma);
    });

    const body = { encounterId: 'enc-1', therapyType: '물리치료', stationId: 'st-1', scheduledDate: '2026-10-01', scheduledTime: '10:00' };

    it('대조군 — 같은 슬롯에 살아 있는 오더가 없으면 만든다', async () => {
      await svc.createTherapyOrder(body, 'u-1');
      expect(prisma.prescription.create).toHaveBeenCalledTimes(1);
      expect(prisma.therapyOrder.create).toHaveBeenCalledTimes(1);
    });

    it('🔴 같은 진료·치료·치료실·시각에 살아 있는 오더가 있으면 한 벌 더 만들지 않는다(이중 청구 방지)', async () => {
      prisma.therapyOrder.findFirst.mockResolvedValue({ id: 'to-1', order: { id: 'ord-1' } });
      const r = await svc.createTherapyOrder(body, 'u-1');
      expect(prisma.prescription.create).not.toHaveBeenCalled();
      expect(prisma.therapyOrder.create).not.toHaveBeenCalled();
      expect((r as any).duplicate).toBe(true);
    });

    it('대조군 — 시각이 지정되지 않으면 슬롯 판정을 하지 않는다(하루 여러 회차가 정당하다)', async () => {
      await svc.createTherapyOrder({ ...body, scheduledTime: undefined } as any, 'u-1');
      expect(prisma.therapyOrder.findFirst).not.toHaveBeenCalled();
      expect(prisma.therapyOrder.create).toHaveBeenCalledTimes(1);
    });

    it('취소·완료된 오더는 중복으로 보지 않는다(같은 슬롯 재예약 가능)', async () => {
      await svc.createTherapyOrder(body, 'u-1');
      const where = prisma.therapyOrder.findFirst.mock.calls[0][0].where;
      expect(where.order.status).toEqual({ notIn: ['CANCELLED', 'COMPLETED'] });
      expect(where.order.prescription.encounterId).toBe('enc-1');
    });
  });
});
