import { describe, it, expect, vi } from 'vitest';
import { PrescriptionService } from '../../src/modules/prescription/prescription.service';

/**
 * 지속 처방 갱신·만료 — 2026-09-30.
 *  · 갱신 = 새 처방으로 잇고 원처방은 같은 순간 중단(겹치면 같은 약이 두 줄로 투약된다)
 *  · 일수·총량은 의사가 정한다 · DUR 은 원처방을 비교에서 뺀다(빼지 않으면 '중복 처방'으로 막힌다)
 *  · 갱신 대기 = 만료됨·곧 만료·기간 없음 · 자동으로 끊지 않는다 · 재검토 기한 미설정이면 그렇다고 말한다
 */
const DAY = 86_400_000;
function mk(opts: { original?: Record<string, unknown> | null; stopCount?: number; rows?: Record<string, unknown>[]; config?: Record<string, unknown> } = {}) {
  const created: Record<string, unknown>[] = [];
  const checkInteractions = vi.fn(async () => []);
  const prisma: Record<string, unknown> = {
    prescription: {
      findUnique: vi.fn(async () => opts.original ?? null),
      updateMany: vi.fn(async () => ({ count: opts.stopCount ?? 1 })),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { created.push(data); return { id: 'new-rx', ...data }; }),
      findMany: vi.fn(async () => opts.rows ?? []),
      count: vi.fn(async () => (opts.rows ?? []).length),
    },
    order: { findMany: vi.fn(async () => []), updateMany: vi.fn(async () => ({ count: 0 })), create: vi.fn(async () => ({ id: 'new-order' })) },
    medicationAdministration: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    user: { findUnique: vi.fn(async () => ({ role: 'DOCTOR' })) },
  };
  (prisma as { $transaction: unknown }).$transaction = vi.fn(async (fn: (tx: unknown) => unknown) => fn(prisma));
  const config = { get: vi.fn(async (k: string) => (opts.config ?? {})[k] ?? null) };
  const svc = new PrescriptionService(prisma as never, { checkInteractions } as never, { emit: vi.fn() } as never, {} as never, config as never, {} as never, {} as never, { safeLog: vi.fn() } as never,
    { assertOrderGate: vi.fn(async () => ({})), linkPostFacto: vi.fn() } as never);
  vi.spyOn(svc as unknown as { applyDurGate: () => Promise<void> }, 'applyDurGate').mockResolvedValue(undefined);
  vi.spyOn(svc as unknown as { assertFormularyForOrder: () => Promise<void> }, 'assertFormularyForOrder').mockResolvedValue(undefined);
  vi.spyOn(svc as unknown as { assertPreAuthForOrder: () => Promise<unknown> }, 'assertPreAuthForOrder').mockResolvedValue({ postFactoId: null });
  return { svc, prisma, created, checkInteractions };
}
const original = { id: 'rx1', status: 'ACTIVE', type: 'MEDICATION', medicationCodeId: 'm1', encounterId: 'e1', dosage: '500mg', frequency: 'bid', duration: 5, quantity: 10, route: 'PO', priority: 'ROUTINE', dispensingType: 'INTERNAL', prescriberId: 'doc', createdBy: 'doc',
  encounter: { id: 'e1', status: 'DRAFT', patientId: 'p1', admissionId: 'a1', doctor: { id: 'doc' } } };
const code = (e: unknown) => (e as { response?: { code?: string } })?.response?.code;

describe('갱신 — 새 처방으로 잇고 원처방은 같은 순간 중단', () => {
  it('원처방 중단(조건부)·새 처방(일수·총량은 입력값·원처방 링크·책임 처방의=갱신자) · DUR 은 원처방을 뺀다', async () => {
    const { svc, prisma, created, checkInteractions } = mk({ original });
    const r = await svc.renew('rx1', 'doc2', { days: 7, quantity: 14 });
    expect(r.renewedFromId).toBe('rx1');
    expect((prisma.prescription as { updateMany: ReturnType<typeof vi.fn> }).updateMany.mock.calls[0][0]).toMatchObject({ where: { id: 'rx1', status: 'ACTIVE' }, data: { status: 'DISCONTINUED', discontinuedBy: 'doc2' } });
    expect(created[0]).toMatchObject({ duration: 7, quantity: 14, renewedFromId: 'rx1', source: 'RENEWAL', prescriberId: 'doc2', dosage: '500mg' });
    expect((checkInteractions.mock.calls[0] as unknown[])[3]).toMatchObject({ excludePrescriptionIds: ['rx1'] });
  });
  it('일수·총량이 없으면 400 — 원처방 값을 복사하지 않는다', async () => {
    await expect(mk({ original }).svc.renew('rx1', 'doc', { quantity: 10 })).rejects.toSatisfy((e) => code(e) === 'RENEW_DAYS_REQUIRED');
    await expect(mk({ original }).svc.renew('rx1', 'doc', { days: 3 })).rejects.toSatisfy((e) => code(e) === 'RENEW_QUANTITY_REQUIRED');
  });
  it('활성 약 처방만 · 동시에 상태가 바뀌면 새 처방을 만들지 않는다', async () => {
    await expect(mk({ original: { ...original, status: 'DISCONTINUED' } }).svc.renew('rx1', 'doc', { days: 3, quantity: 6 })).rejects.toSatisfy((e) => code(e) === 'PRESCRIPTION_NOT_ACTIVE');
    await expect(mk({ original: { ...original, type: 'LAB' } }).svc.renew('rx1', 'doc', { days: 3, quantity: 6 })).rejects.toSatisfy((e) => code(e) === 'RENEW_MEDICATION_ONLY');
    const raced = mk({ original, stopCount: 0 });
    await expect(raced.svc.renew('rx1', 'doc', { days: 3, quantity: 6 })).rejects.toSatisfy((e) => code(e) === 'PRESCRIPTION_STATE_CHANGED');
    expect(raced.created).toHaveLength(0);
  });
});

describe('갱신 대기 목록', () => {
  const now = new Date('2026-09-30T12:00:00Z');
  const row = (id: string, createdAt: Date, duration: number | null) => ({ id, createdAt, duration, discontinuedAt: null, quantity: 1, dosage: null, frequency: null, route: null, priority: 'ROUTINE', instructions: null, renewedFromId: null, medicationCode: { nameKo: id }, encounter: { id: 'e', patient: { id: 'p' }, admission: { id: 'a' } } });
  const rows = [
    row('expired', new Date(now.getTime() - 10 * DAY), 3),
    row('soon', new Date(now.getTime() - 5 * DAY + 3_600_000 * 6), 5), // 6시간 뒤 종료
    row('far', new Date(now.getTime() - 1 * DAY), 10),
    row('noend-old', new Date(now.getTime() - 9 * DAY), null),
    row('noend-new', new Date(now.getTime() - 1 * DAY), null),
  ];
  it('만료됨·곧 만료·기간 없음으로 가르고, 멀리 남은 것은 올리지 않는다 · 재검토 기한 미설정이면 기간 없음 전부', async () => {
    const r = await mk({ rows }).svc.renewalsDue('doc', now);
    const by = Object.fromEntries(r.items.map((i) => [i.id, i.bucket]));
    expect(by).toEqual({ expired: 'EXPIRED', soon: 'ENDING_SOON', 'noend-old': 'NO_END', 'noend-new': 'NO_END' });
    expect(r.noEndReviewDays).toBeNull();
    expect(r.soonHours).toBe(24);
  });
  it('재검토 기한이 설정되면 그보다 오래된 기간 없음만', async () => {
    const r = await mk({ rows, config: { 'order.renewal.noEndReviewDays': 7 } }).svc.renewalsDue('doc', now);
    expect(r.items.filter((i) => i.bucket === 'NO_END').map((i) => i.id)).toEqual(['noend-old']);
  });
  it('입원 중 · 활성 약 · 내 오더(정본)로 좁힌다', async () => {
    const { svc, prisma } = mk({ rows: [] });
    await svc.renewalsDue('doc', now);
    const where = (prisma.prescription as { findMany: ReturnType<typeof vi.fn> }).findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ type: 'MEDICATION', status: 'ACTIVE', encounter: { admission: { status: 'ADMITTED' } } });
    expect(JSON.stringify(where.AND)).toContain('"prescriberId":"doc"');
  });
});
