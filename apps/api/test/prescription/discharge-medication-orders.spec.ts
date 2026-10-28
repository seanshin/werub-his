import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrescriptionService } from '../../src/modules/prescription/prescription.service';

/**
 * 퇴원약 오더화 — 2026-09-30.
 *  · 퇴원약은 처방 원장에(dischargeMed) — 발행 정본 create() 를 그대로 지난다(DUR·처방집·사전승인·약국 오더)
 *  · 일수·총량은 의사가 정한다 · 입원 중일 때만 · DUR 은 이 입원의 입원 중 약을 비교에서 뺀다
 *  · 입원 흐름에서 빠진다(투약 예정·갱신 대기·미결 오더) · 퇴원 준비는 출처를 가른다
 */
function mk(opts: { admission?: Record<string, unknown> | null; encounter?: Record<string, unknown> | null; inpatient?: { id: string }[] } = {}) {
  const created: Record<string, unknown>[] = [];
  const checkInteractions = vi.fn(async () => []);
  const prisma: Record<string, unknown> = {
    admission: { findUnique: vi.fn(async () => (opts.admission === undefined ? { id: 'a1', status: 'ADMITTED', patientId: 'p1' } : opts.admission)) },
    encounter: {
      findFirst: vi.fn(async () => (opts.encounter === undefined ? { id: 'e1' } : opts.encounter)),
      findUnique: vi.fn(async () => ({ id: 'e1', status: 'DRAFT', patientId: 'p1', admissionId: 'a1' })),
    },
    prescription: {
      findMany: vi.fn(async () => opts.inpatient ?? [{ id: 'in1' }, { id: 'in2' }]),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { created.push(data); return { id: 'new-rx', ...data }; }),
    },
    medicationCode: { findUnique: vi.fn(async () => ({ maxSingleDose: null })) },
    order: { create: vi.fn(async () => ({ id: 'new-order' })) },
  };
  (prisma as { $transaction: unknown }).$transaction = vi.fn(async (fn: (tx: unknown) => unknown) => fn(prisma));
  const config = { get: vi.fn(async () => null) };
  const svc = new PrescriptionService(prisma as never, { checkInteractions } as never, { emit: vi.fn() } as never, {} as never, config as never, {} as never, {} as never, { safeLog: vi.fn() } as never,
    { assertOrderGate: vi.fn(async () => ({})), linkPostFacto: vi.fn() } as never);
  vi.spyOn(svc as unknown as { applyDurGate: () => Promise<void> }, 'applyDurGate').mockResolvedValue(undefined);
  vi.spyOn(svc as unknown as { assertFormularyForOrder: () => Promise<void> }, 'assertFormularyForOrder').mockResolvedValue(undefined);
  vi.spyOn(svc as unknown as { assertPreAuthForOrder: () => Promise<unknown> }, 'assertPreAuthForOrder').mockResolvedValue({ postFactoId: null });
  vi.spyOn(svc as unknown as { resolvePrescriber: () => Promise<string> }, 'resolvePrescriber').mockResolvedValue('doc');
  return { svc, prisma, created, checkInteractions };
}
const dto = { type: 'MEDICATION', medicationCodeId: '11111111-1111-4111-8111-111111111111', dosage: '500mg', frequency: 'bid', duration: 7, quantity: 14, dispensingType: 'INTERNAL' } as never;
const code = (e: unknown) => (e as { response?: { code?: string } })?.response?.code;

describe('퇴원약 처방 — 발행 정본을 그대로 지난다', () => {
  it('처방 원장에 dischargeMed=true·source DISCHARGE 로 남고 약국 오더가 생긴다 · DUR 은 입원 중 약을 뺀다', async () => {
    const { svc, prisma, created, checkInteractions } = mk();
    const r = await svc.createDischargePrescription('a1', dto, 'doc');
    expect(r.prescription.id).toBe('new-rx');
    expect(created[0]).toMatchObject({ dischargeMed: true, source: 'DISCHARGE', encounterId: 'e1', duration: 7, quantity: 14 });
    expect((prisma.order as { create: ReturnType<typeof vi.fn> }).create).toHaveBeenCalledTimes(1);
    expect((checkInteractions.mock.calls[0] as unknown[])[3]).toMatchObject({ excludePrescriptionIds: ['in1', 'in2'] });
    // 입원 중 약을 고르는 조건 — 퇴원약 제외·활성만·이 입원
    expect((prisma.prescription as { findMany: ReturnType<typeof vi.fn> }).findMany.mock.calls[0][0]).toMatchObject({ where: { dischargeMed: false, status: 'ACTIVE', encounter: { admissionId: 'a1' } } });
  });
  it('대조군 — 일반 처방(create)은 dischargeMed 를 적지 않고 DUR 비교에서 아무것도 빼지 않는다', async () => {
    const { svc, created, checkInteractions } = mk();
    await svc.create('e1', dto, 'doc');
    expect(created[0]).not.toHaveProperty('dischargeMed');
    expect((checkInteractions.mock.calls[0] as unknown[])[3]).not.toHaveProperty('excludePrescriptionIds');
  });
  it('일수·총량이 없으면 400 · 약이 아니면 400 — 입원 약 값을 복사하지 않는다', async () => {
    await expect(mk().svc.createDischargePrescription('a1', { ...(dto as object), duration: undefined } as never, 'doc')).rejects.toSatisfy((e) => code(e) === 'DISCHARGE_DAYS_REQUIRED');
    await expect(mk().svc.createDischargePrescription('a1', { ...(dto as object), quantity: undefined } as never, 'doc')).rejects.toSatisfy((e) => code(e) === 'DISCHARGE_QUANTITY_REQUIRED');
    await expect(mk().svc.createDischargePrescription('a1', { ...(dto as object), type: 'LAB' } as never, 'doc')).rejects.toSatisfy((e) => code(e) === 'DISCHARGE_MEDICATION_ONLY');
  });
  it('입원 중이 아니면 409 · 붙일 진료가 없으면 409 — 어느 쪽도 처방을 만들지 않는다', async () => {
    const done = mk({ admission: { id: 'a1', status: 'DISCHARGED' } });
    await expect(done.svc.createDischargePrescription('a1', dto, 'doc')).rejects.toSatisfy((e) => code(e) === 'ADMISSION_NOT_ACTIVE');
    expect(done.created).toHaveLength(0);
    const noEnc = mk({ encounter: null });
    await expect(noEnc.svc.createDischargePrescription('a1', dto, 'doc')).rejects.toSatisfy((e) => code(e) === 'NO_ADMISSION_ENCOUNTER');
    expect(noEnc.created).toHaveLength(0);
  });
});

describe('입원 흐름에서 빠진다 · 퇴원 준비는 출처를 가른다', () => {
  const src = (p: string) => readFileSync(join(__dirname, '../../src/modules', p), 'utf8');
  it('투약 예정(MAR)을 만들지 않는다 — 409 DISCHARGE_MED_NO_MAR', async () => {
    const { NursingService } = await import('../../src/modules/nursing/nursing.service');
    const prisma = { prescription: { findUnique: vi.fn(async () => ({ id: 'rx', type: 'MEDICATION', status: 'ACTIVE', dischargeMed: true, frequency: 'bid', duration: 3, encounter: { patientId: 'p' } })) }, medicationAdministration: { createMany: vi.fn() } };
    const svc = Object.create(NursingService.prototype) as { prisma: unknown; generateSchedule: (id: string) => Promise<unknown> };
    svc.prisma = prisma;
    await expect(svc.generateSchedule('rx')).rejects.toSatisfy((e) => code(e) === 'DISCHARGE_MED_NO_MAR');
    expect(prisma.medicationAdministration.createMany).not.toHaveBeenCalled();
  });
  it('갱신 대기는 퇴원약을 올리지 않는다', async () => {
    const { svc, prisma } = mk();
    (prisma.prescription as Record<string, unknown>).count = vi.fn(async () => 0);
    await svc.renewalsDue('doc');
    expect((prisma.prescription as { findMany: ReturnType<typeof vi.fn> }).findMany.mock.calls[0][0].where).toMatchObject({ dischargeMed: false });
  });
  it('퇴원 준비 — 퇴원약 오더는 미결 오더가 아니다 · 원내 조제 완료를 센다 · 요약 글자뿐이면 SUMMARY_TEXT', async () => {
    const { InpatientService } = await import('../../src/modules/inpatient/inpatient.service');
    const run = async (rx: unknown[], meds: unknown) => {
      const orderCount = vi.fn(async () => 0);
      const prisma = {
        admission: { findUnique: vi.fn(async () => ({ id: 'a1', status: 'ADMITTED', expectedDischargeDate: null })) },
        dischargeSummary: { findUnique: vi.fn(async () => ({ status: 'SIGNED', signedAt: new Date(), followUpDate: null, dischargeMedications: meds, patientEducation: null })) },
        order: { count: orderCount },
        prescription: { findMany: vi.fn(async () => rx) },
        patientEducationRecord: { count: vi.fn(async () => 0) },
      };
      const svc = Object.create(InpatientService.prototype) as Record<string, unknown>;
      svc.prisma = prisma;
      svc.logger = { error: vi.fn() };
      svc.getDischargeSettlement = vi.fn(async () => ({ data: { balanceDue: 0 } }));
      const r = await (svc as unknown as { getDischargeReadiness: (id: string) => Promise<Record<string, any>> }).getDischargeReadiness('a1');
      return { r, orderWhere: (orderCount.mock.calls[0] as unknown[])[0] as { where: Record<string, any> } };
    };
    const a = await run([
      { id: 'd1', dispensingType: 'INTERNAL', orders: [{ status: 'COMPLETED' }] },
      { id: 'd2', dispensingType: 'INTERNAL', orders: [{ status: 'ORDERED' }] },
      { id: 'd3', dispensingType: 'EXTERNAL', orders: [{ status: 'ORDERED' }] },
    ], null);
    expect(a.orderWhere.where.prescription).toMatchObject({ dischargeMed: false });
    expect(a.r.dischargeMeds).toEqual({ source: 'ORDERS', ordered: 3, internal: 2, dispensed: 1, external: 1, summaryListed: 0 });
    expect(a.r.dischargeMedsPrepared).toBe(true);
    const b = await run([], ['아스피린']);
    expect(b.r.dischargeMeds.source).toBe('SUMMARY_TEXT');
    const c = await run([], null);
    expect(c.r.dischargeMeds.source).toBeNull();
    expect(c.r.dischargeMedsPrepared).toBe(false);
  });
  it('퇴원요약 서명 때 처방 원장 퇴원약을 스냅샷(name·drugName 동시) · 프리필은 출처를 싣는다', () => {
    const s = src('discharge-summary/discharge-summary.service.ts');
    expect(s).toMatch(/structured\.length > 0 \? \{ dischargeMedications: structured/);
    expect(s).toMatch(/drugName: m\.medicationCode\?\.nameKo/);
    expect(s).toContain("dischargeMedicationsSource: structured.length > 0 ? 'ORDERS' : activeMeds.length > 0 ? 'INPATIENT_ACTIVE' : null");
  });
});

describe('포털 — 본인 퇴원약 확인이 요약 정본 키(name)를 본다', () => {
  it('요약에 name 으로 적힌 약을 본인 퇴원약으로 인정한다', async () => {
    const { DrugExplainService } = await import('../../src/modules/portal/drug-explain.service');
    const prisma = {
      dischargeSummary: { findMany: vi.fn(async () => [{ dischargeMedications: [{ name: '타이레놀정500mg' }] }]) },
      prescription: { count: vi.fn(async () => 0) },
      medicationCode: { findMany: vi.fn(async () => []) },
    };
    const svc = Object.create(DrugExplainService.prototype) as Record<string, unknown>;
    svc.prisma = prisma;
    svc.assertEnabled = vi.fn(async () => undefined);
    const r = await (svc as unknown as { explainByName: (p: string, n: string) => Promise<{ status: string }> }).explainByName('p1', '타이레놀정500mg');
    // 소유 확인을 지나 약품 매칭 단계까지 갔다(0건 → UNAVAILABLE). 종전엔 여기서 404 였다
    expect(r.status).toBe('UNAVAILABLE');
    expect(prisma.prescription.count).not.toHaveBeenCalled();
  });
  it('요약에 없어도 처방 원장의 본인 퇴원약이면 인정 · 둘 다 없으면 404', async () => {
    const { DrugExplainService } = await import('../../src/modules/portal/drug-explain.service');
    const mkSvc = (n: number) => {
      const prisma = { dischargeSummary: { findMany: vi.fn(async () => []) }, prescription: { count: vi.fn(async () => n) }, medicationCode: { findMany: vi.fn(async () => []) } };
      const svc = Object.create(DrugExplainService.prototype) as Record<string, unknown>;
      svc.prisma = prisma; svc.assertEnabled = vi.fn(async () => undefined);
      return { svc: svc as unknown as { explainByName: (p: string, n: string) => Promise<{ status: string }> }, prisma };
    };
    const ok = mkSvc(1);
    expect((await ok.svc.explainByName('p1', 'X')).status).toBe('UNAVAILABLE');
    expect(ok.prisma.prescription.count.mock.calls[0][0]).toMatchObject({ where: { dischargeMed: true, status: 'ACTIVE', encounter: { patientId: 'p1' } } });
    await expect(mkSvc(0).svc.explainByName('p1', 'X')).rejects.toThrow();
  });
});
