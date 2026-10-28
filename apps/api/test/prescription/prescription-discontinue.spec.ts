import { describe, it, expect, vi } from 'vitest';
import { PrescriptionService } from '../../src/modules/prescription/prescription.service';
import { fhirMedicationRequestStatus } from '../../src/common/fhir-medication-status';

/**
 * 처방 중단(DISCONTINUED) — 2026-09-30 오더 중단 설계.
 * 🔴 종전엔 투약 중인 약을 멈추는 것도 '취소'라 처방 원장이 "처음부터 무효"로 남았다(일어난 사실의 소급).
 *    취소 = 발효 전 무효 · 중단 = 그 시각 이후 멈춤(이미 조제·투약된 사실은 유효).
 */
type Rx = { id: string; status: string; prescriberId: string | null; createdBy: string; encounter: { id: string; admissionId: string | null; doctor: { id: string } | null } };
function mk(rx: Rx | null, opts: { documentedMar?: number; startedOrders?: number; updateCount?: number } = {}) {
  const calls: { orderUpdate?: unknown; marDelete?: unknown; rxUpdate?: unknown } = {};
  const prisma: Record<string, unknown> = {
    prescription: {
      findUnique: vi.fn(async () => (rx ? { ...rx, status: calls.rxUpdate ? 'DISCONTINUED' : rx.status } : null)),
      update: vi.fn(async ({ data }: { data: unknown }) => ({ ...rx, ...(data as object) })),
      updateMany: vi.fn(async (a: unknown) => { calls.rxUpdate = a; return { count: opts.updateCount ?? 1 }; }),
    },
    medicationAdministration: {
      count: vi.fn(async () => opts.documentedMar ?? 0),
      deleteMany: vi.fn(async (a: unknown) => { calls.marDelete = a; return { count: 2 }; }),
    },
    order: {
      count: vi.fn(async () => opts.startedOrders ?? 0),
      findMany: vi.fn(async () => [{ id: 'o-ordered' }]),
      updateMany: vi.fn(async (a: unknown) => { calls.orderUpdate = a; return { count: 1 }; }),
    },
    user: { findUnique: vi.fn(async () => ({ role: 'DOCTOR' })) },
  };
  (prisma as { $transaction: unknown }).$transaction = vi.fn(async (fn: (tx: unknown) => unknown) => fn(prisma));
  const emit = vi.fn();
  const audit = { safeLog: vi.fn() };
  const svc = new PrescriptionService(prisma as never, {} as never, { emit } as never, {} as never, { get: vi.fn(async () => null) } as never, {} as never, {} as never, audit as never, {} as never);
  return { svc, prisma, calls, emit, audit };
}
const base: Rx = { id: 'rx1', status: 'ACTIVE', prescriberId: 'doc', createdBy: 'doc', encounter: { id: 'e1', admissionId: 'a1', doctor: { id: 'doc' } } };
const code = (e: unknown) => (e as { response?: { code?: string } })?.response?.code;

describe('취소는 발효 전만', () => {
  it('🔴 투약 기록이 있으면 취소(무효)를 거부하고 중단을 말한다', async () => {
    await expect(mk(base, { documentedMar: 1 }).svc.cancel('rx1', 'doc')).rejects.toSatisfy((e) => code(e) === 'PRESCRIPTION_TOOK_EFFECT');
  });
  it('🔴 접수 이후로 넘어간 오더(조제·검사 시행)가 있어도 거부', async () => {
    await expect(mk(base, { startedOrders: 1 }).svc.cancel('rx1', 'doc')).rejects.toSatisfy((e) => code(e) === 'PRESCRIPTION_TOOK_EFFECT');
  });
  it('중단된 처방은 취소로 바꿀 수 없다', async () => {
    await expect(mk({ ...base, status: 'DISCONTINUED' }).svc.cancel('rx1', 'doc')).rejects.toSatisfy((e) => code(e) === 'PRESCRIPTION_DISCONTINUED');
  });
  it('대조군 — 발효 전(예정·접수 전만)이면 종전대로 취소된다', async () => {
    const { svc, prisma } = mk(base);
    await svc.cancel('rx1', 'doc');
    expect((prisma.prescription as { update: ReturnType<typeof vi.fn> }).update).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'CANCELLED' } }));
  });
});

describe('중단 — 지금 이후만 멈춘다', () => {
  it('상태·시각·행위자·사유를 남기고, 접수 전 오더만 취소, 중단 시각 이후 예정 투약만 지운다', async () => {
    const { svc, calls, emit, audit } = mk(base, { documentedMar: 3 });
    const r = await svc.discontinue('rx1', 'doc', '  부작용(발진)  ');
    expect(r.alreadyDiscontinued).toBe(false);
    expect(calls.rxUpdate).toMatchObject({ where: { id: 'rx1', status: 'ACTIVE' }, data: { status: 'DISCONTINUED', discontinuedBy: 'doc', discontinueReason: '부작용(발진)' } });
    expect(calls.orderUpdate).toMatchObject({ where: { prescriptionId: 'rx1', status: 'ORDERED' } });
    // 🔴 시각이 지났는데 기록되지 않은 예정 투약은 남긴다 — 지우는 것은 중단 시각 이후뿐
    expect((calls.marDelete as { where: { scheduledAt?: { gte?: Date } } }).where.scheduledAt?.gte).toBeInstanceOf(Date);
    expect(emit).toHaveBeenCalledWith('order.cancelled', expect.objectContaining({ reason: 'PRESCRIPTION_DISCONTINUED' }));
    expect(audit.safeLog).toHaveBeenCalled();
  });
  it('사유가 비면 400', async () => {
    await expect(mk(base).svc.discontinue('rx1', 'doc', '   ')).rejects.toSatisfy((e) => code(e) === 'DISCONTINUE_REASON_REQUIRED');
  });
  it('취소된 처방은 중단할 수 없고 · 이미 중단이면 먼저 남은 기록을 덮지 않는다', async () => {
    await expect(mk({ ...base, status: 'CANCELLED' }).svc.discontinue('rx1', 'doc', 'x')).rejects.toSatisfy((e) => code(e) === 'PRESCRIPTION_CANCELLED');
    const a = mk({ ...base, status: 'DISCONTINUED' });
    await expect(a.svc.discontinue('rx1', 'doc', 'x')).resolves.toMatchObject({ alreadyDiscontinued: true });
    expect((a.prisma.prescription as { updateMany: ReturnType<typeof vi.fn> }).updateMany).not.toHaveBeenCalled();
  });
});

describe('FHIR 반출 상태', () => {
  it('중단은 stopped · 취소는 cancelled · 모르면 unknown(active 로 지어내지 않는다)', () => {
    expect(fhirMedicationRequestStatus('DISCONTINUED')).toBe('stopped');
    expect(fhirMedicationRequestStatus('CANCELLED')).toBe('cancelled');
    expect(fhirMedicationRequestStatus('ACTIVE')).toBe('active');
    expect(fhirMedicationRequestStatus(undefined)).toBe('unknown');
  });
});

describe('오더 취소 연쇄가 처방을 소급 무효로 만들지 않는다', () => {
  it('🔴 활성·미발효 처방만 따라 취소한다(중단 처방·발효된 처방은 그대로)', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const src = readFileSync(join(process.cwd(), 'src/modules/order/order.service.ts'), 'utf8');
    expect(src).toMatch(/if \(rx && rx\.status === 'ACTIVE' && !tookEffect\) \{/);
    expect(src).not.toMatch(/if \(rx && rx\.status !== 'CANCELLED'\) \{/);
  });
});
