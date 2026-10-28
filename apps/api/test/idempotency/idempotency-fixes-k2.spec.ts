import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { scanIdempotency } from '../architecture/idempotency-scan';

/**
 * K2 — 재시도가 결과를 한 벌 더 만들거나, 법정 보고를 조용히 잃던 자리.
 *
 * 🔴 전부 **동작**을 본다(소스 문자열이 아니라). 이 저장소는 목이 정본의 실제 호출 모양과 달라
 *    "다른 이유로 통과한" 가드를 여러 번 만들었다 — 그래서 목은 정본이 실제로 부르는 것만 준다.
 */

const P2002 = Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });

// ── ① 입원료 이중 청구(check-then-act) ─────────────────────────────────────
describe('🔴 입원료 Billing — 잠그고 세지 않으면 같은 입원료가 두 벌 청구된다', () => {
  let prisma: any;
  let service: any;

  const admission = () => ({
    id: 'adm-1', admitDate: new Date('2026-09-01T00:00:00+09:00'), dischargeDate: new Date('2026-09-06T00:00:00+09:00'),
    bed: { bedClass: 'GENERAL' }, patient: { id: 'p-1', insuranceType: 'NHI' },
  });

  beforeEach(async () => {
    const { BillingService } = await import('../../src/modules/billing/billing.service');
    prisma = {
      admission: { findUnique: vi.fn().mockResolvedValue(admission()) },
      encounter: { findFirst: vi.fn().mockResolvedValue({ id: 'enc-9', patientId: 'p-1' }) },
      procedureCode: { findFirst: vi.fn().mockResolvedValue({ id: 'proc-stay', code: 'AB1A0100', nameKo: '입원료', unitPrice: 60000 }) },
      billing: {
        findUnique: vi.fn().mockResolvedValue({ id: 'bill-1', status: 'PENDING' }), // P5-4: 미납일 때만 증분
        create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'bill-new', ...data })),
        update: vi.fn().mockResolvedValue({}),
      },
      billingItem: { create: vi.fn().mockResolvedValue({}), count: vi.fn().mockResolvedValue(0) },
      $queryRaw: vi.fn().mockResolvedValue([{ id: 'bill-1' }]),
      $transaction: vi.fn().mockImplementation((arg: any) => (typeof arg === 'function' ? arg(prisma) : Promise.all(arg))),
    };
    service = new BillingService(
      prisma, {} as any, { enqueue: vi.fn() } as any,
      { get: vi.fn().mockResolvedValue(null) } as any,
      { copayRateFor: vi.fn().mockResolvedValue(0.2) } as any, {} as any, {} as any,
    );
    vi.spyOn(service as any, 'resolveCopay').mockResolvedValue({ rate: 0.2, copayCategory: 'NHI', eligibilityStatus: null, eligibilityCheckId: null, specialCaseType: null });
    vi.spyOn(service as any, 'emitBillingLines').mockResolvedValue(undefined);
  });

  it('🔴 라인을 세기 전에 행을 잠근다(순서가 뒤집히면 경합 상대의 라인을 못 본다)', async () => {
    await service.createInpatientStayBilling('adm-1');
    expect(prisma.$queryRaw).toHaveBeenCalled();
    expect(prisma.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(prisma.billingItem.count.mock.invocationCallOrder[0]);
  });

  it('🔴 잠근 뒤 읽어 이미 입원료 라인이 있으면 쓰지 않는다(ALREADY_BILLED)', async () => {
    prisma.billingItem.count.mockResolvedValue(1);
    const r: any = await service.createInpatientStayBilling('adm-1');
    expect(r).toEqual({ created: false, reason: 'ALREADY_BILLED' });
    expect(prisma.billingItem.create).not.toHaveBeenCalled();
    expect(prisma.billing.update).not.toHaveBeenCalled();
  });

  it('대조군 — 라인이 없으면 정상으로 증분한다(막기만 하고 끝내지 않는다)', async () => {
    const r: any = await service.createInpatientStayBilling('adm-1');
    expect(r).toEqual(expect.objectContaining({ created: true, billingId: 'bill-1', amount: 300000 }));
    expect(prisma.billingItem.create).toHaveBeenCalledTimes(1);
    expect(prisma.billing.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { totalAmount: { increment: 300000 }, patientCopay: { increment: 60000 }, insuranceCovered: { increment: 240000 } },
    }));
  });

  it('🔴 동시 생성의 패자(유니크 위반)는 500 이 아니라 "이미 청구됨"이다', async () => {
    prisma.billing.findUnique.mockResolvedValue(null); // 둘 다 "없다"를 읽은 상황
    prisma.billing.create.mockRejectedValue(P2002);
    const r: any = await service.createInpatientStayBilling('adm-1');
    expect(r).toEqual({ created: false, reason: 'ALREADY_BILLED' });
  });
});

// ── ② 특수영양(EN·TPN) 활성 처방은 종류마다 하나 ───────────────────────────
describe('🔴 특수영양 처방 — 같은 종류의 활성 처방이 둘로 남지 않는다', () => {
  let prisma: any;
  let service: any;

  beforeEach(async () => {
    const { NutritionAdvancedService } = await import('../../src/modules/nutrition/nutrition-advanced.service');
    prisma = {
      specialNutritionOrder: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'sn-new', ...data })),
      },
      $transaction: vi.fn().mockImplementation((arg: any) => (typeof arg === 'function' ? arg(prisma) : Promise.all(arg))),
    };
    service = new NutritionAdvancedService(prisma, { create: vi.fn() } as any);
  });

  const dto = (over: Record<string, unknown> = {}) => ({
    admissionId: 'adm-1', patientId: 'p-1', kind: 'ENTERAL', startDate: '2026-09-16', ...over,
  });

  it('🔴 같은 종류의 열린 처방을 닫고 새 처방을 만든다(모니터링이 두 줄로 갈리지 않는다)', async () => {
    await service.createSpecialNutrition(dto() as any, 'dr-1');
    expect(prisma.specialNutritionOrder.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ admissionId: 'adm-1', kind: 'ENTERAL', status: { not: 'DISCONTINUED' } }),
      data: expect.objectContaining({ status: 'DISCONTINUED' }),
    }));
    expect(prisma.specialNutritionOrder.create).toHaveBeenCalledTimes(1);
  });

  it('🔴 닫기와 만들기는 한 트랜잭션이다(중간에 실패하면 둘 다 없다)', async () => {
    await service.createSpecialNutrition(dto() as any, 'dr-1');
    expect(prisma.$transaction).toHaveBeenCalled();
  });

  it('대조군 — 경장(EN) 등록이 정맥(TPN) 처방을 끄지 않는다(병용은 정당하다)', async () => {
    await service.createSpecialNutrition(dto({ kind: 'PARENTERAL' }) as any, 'dr-1');
    const where = prisma.specialNutritionOrder.updateMany.mock.calls[0][0].where;
    expect(where.kind).toBe('PARENTERAL'); // admission 전체를 닫지 않는다
  });
});

// ── ③ 마약류 NIMS 취급보고 — 누락과 중복 ──────────────────────────────────
describe('🔴 NIMS 취급보고 — 적재 실패가 조용히 사라지지 않는다', () => {
  let prisma: any;
  let service: any;

  const log = (over: Record<string, unknown> = {}) => ({
    id: 'cl-1', patientId: 'p-1', drugName: '모르핀', drugCode: 'M1', narcoticType: null,
    quantity: 2, administeredQty: null, unit: '앰플', status: 'DISPENSED',
    prescribedAt: new Date('2026-09-16T01:00:00Z'), dispensedAt: new Date('2026-09-16T02:00:00Z'),
    administeredAt: null, ...over,
  });

  beforeEach(async () => {
    const { ControlledSubstanceService } = await import('../../src/modules/controlled-substance/controlled-substance.service');
    prisma = {
      controlledSubstanceLog: { findMany: vi.fn().mockResolvedValue([]), findUnique: vi.fn().mockResolvedValue(log()) },
      nimsReport: { create: vi.fn().mockResolvedValue({}), count: vi.fn().mockResolvedValue(0), findMany: vi.fn().mockResolvedValue([]) },
    };
    service = new ControlledSubstanceService(prisma);
  });

  it('🔴 적재 실패는 삼키지 않고 결과로 말한다(임상 흐름은 막지 않는다)', async () => {
    prisma.nimsReport.create.mockRejectedValue(new Error('DB down'));
    const r = await (service as any).enqueueNims({ reportType: 'DISPENSE', refId: 'cl-1', drugName: '모르핀', quantity: 2, unit: '앰플', eventAt: new Date(), payload: {} });
    expect(r).toEqual({ recorded: false, reason: 'WRITE_FAILED' });
  });

  it('🔴 같은 사건(reportType+refId)을 두 번 보고하지 않는다', async () => {
    prisma.nimsReport.count.mockResolvedValue(1);
    const r = await (service as any).enqueueNims({ reportType: 'DISPENSE', refId: 'cl-1', drugName: '모르핀', quantity: 2, unit: '앰플', eventAt: new Date(), payload: {} });
    expect(r).toEqual({ recorded: false, reason: 'DUPLICATE' });
    expect(prisma.nimsReport.create).not.toHaveBeenCalled();
  });

  it('대조군 — 처음 적재는 그대로 기록된다', async () => {
    const r = await (service as any).enqueueNims({ reportType: 'DISPENSE', refId: 'cl-1', drugName: '모르핀', quantity: 2, unit: '앰플', eventAt: new Date(), payload: {} });
    expect(r).toEqual({ recorded: true });
    expect(prisma.nimsReport.create).toHaveBeenCalledTimes(1);
  });

  it('🔴 원장은 전이됐는데 보고 행이 없으면 누락으로 센다', async () => {
    prisma.controlledSubstanceLog.findMany.mockResolvedValue([log({ status: 'ADMINISTERED', administeredAt: new Date('2026-09-16T03:00:00Z') })]);
    prisma.nimsReport.findMany.mockResolvedValue([{ refId: 'cl-1', reportType: 'DISPENSE' }]); // 조제 보고만 있다
    const missing = await (service as any).findMissingNims();
    expect(missing).toEqual([expect.objectContaining({ logId: 'cl-1', reportType: 'ADMINISTER' })]);
  });

  it('대조군 — 보고가 전부 있으면 누락은 없다(있는 것을 없다고 말하지 않는다)', async () => {
    prisma.controlledSubstanceLog.findMany.mockResolvedValue([log()]);
    prisma.nimsReport.findMany.mockResolvedValue([{ refId: 'cl-1', reportType: 'DISPENSE' }]);
    expect(await (service as any).findMissingNims()).toEqual([]);
  });

  it('🔴 누락분을 원장에서 다시 담는다(재시도 경로) — 지어내지 않고 원장 값만 옮긴다', async () => {
    prisma.controlledSubstanceLog.findMany.mockResolvedValue([log()]);
    prisma.nimsReport.findMany.mockResolvedValue([]);
    const r = await service.reenqueueMissingNims('pharm-1');
    expect(r).toEqual({ missing: 1, requeued: 1, failed: 0 });
    expect(prisma.nimsReport.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ reportType: 'DISPENSE', refId: 'cl-1', drugName: '모르핀' }),
    }));
  });
});

// ── ④ 스캐너 자신 — 눈이 멀면 "무방비가 줄었다"고 거짓 안심을 말한다 ──────────
describe('🔴 멱등 스캐너 — 본문을 반환 타입으로 잘라 먹지 않는다', () => {
  let dir: string;

  const write = (body: string) => {
    writeFileSync(join(dir, 'x.service.ts'), `class X {\n${body}\n}\n`, 'utf8');
    return scanIdempotency(dir);
  };

  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'k2-scan-')); mkdirSync(dir, { recursive: true }); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('🔴 제네릭 반환 타입(`): Promise<{…}> {`) 안의 create 를 본다', () => {
    const rows = write(`  async f(a: string): Promise<{ ok: boolean; reason?: 'X' }> {
    await this.prisma.prescription.create({ data: {} });
    return { ok: true };
  }`);
    expect(rows.map((r) => r.method)).toContain('f');
  });

  it('🔴 여러 줄 유니온 반환 타입 안의 create 도 본다', () => {
    const rows = write(`  async g(a: string): Promise<
    { created: true; id: string }
    | { created: false; reason: string }
  > {
    await this.prisma.billing.create({ data: {} });
    return { created: false, reason: 'x' };
  }`);
    expect(rows.map((r) => r.method)).toContain('g');
  });

  it('🔴 한 줄 본문인 생성자가 다음 메서드의 create 를 제 것으로 세지 않는다', () => {
    const rows = write(`  constructor(
    private readonly prisma: any,
  ) {}

  async h(): Promise<void> {
    await this.prisma.dispensing.create({ data: {} });
  }`);
    expect(rows.map((r) => r.method)).toEqual(['h']);
  });

  it('대조군 — 결과가 남지 않는 모델은 여전히 세지 않는다(분모를 거짓으로 부풀리지 않는다)', () => {
    const rows = write(`  async i(): Promise<{ ok: true }> {
    await this.prisma.auditLog.create({ data: {} });
    return { ok: true };
  }`);
    expect(rows).toEqual([]);
  });
});
