import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PatientService } from '../../src/modules/patient/patient.service';

/**
 * 환자 병합 오더 MRN 재전파 회귀 — mergePatients 가 이관된 encounter 의 오더 updated_at 을 bump 해야
 * LIS 증분 폴링(커서=Order.updatedAt)이 새 MRN(target)으로 재전파. bump 없으면 수혈이력 등 분절.
 */
function makeTx(movedEncounters: Array<{ id: string }>) {
  const rawCalls: string[] = [];
  const tx: any = {
    patient: {
      // 병합 가능 판정(트랜잭션 앞·안 두 번) — id 로 활성 기록을 돌려준다(2026-10-20 P2)
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => ({ id: where.id, mrn: where.id, validFrom: new Date(), validTo: null, mergedIntoId: null })),
      update: vi.fn().mockResolvedValue({}),
    },
    encounter: {
      findMany: vi.fn().mockResolvedValue(movedEncounters),
      updateMany: vi.fn().mockResolvedValue({ count: movedEncounters.length }),
    },
    appointment: { updateMany: vi.fn().mockResolvedValue({}) },
    admission: { updateMany: vi.fn().mockResolvedValue({}) },
    billing: { updateMany: vi.fn().mockResolvedValue({}) },
    dispensing: { updateMany: vi.fn().mockResolvedValue({}) },
    labResult: { updateMany: vi.fn().mockResolvedValue({}) },
    patientHistory: { create: vi.fn().mockResolvedValue({}) },
    $executeRaw: vi.fn((strings: TemplateStringsArray) => { rawCalls.push(String(strings.raw?.join('') ?? '')); return Promise.resolve(1); }),
  };
  // 병합은 이제 환자 연결 모델 전부를 등록부대로 돈다(2026-10-20 P2b) — 이 스펙이 보지 않는 모델은 빈 위임
  const noop = { updateMany: vi.fn().mockResolvedValue({ count: 0 }), count: vi.fn().mockResolvedValue(0), findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn().mockResolvedValue(null) };
  const proxied = new Proxy(tx, { get: (t, k: string) => (k in t ? t[k] : noop) });
  return { tx: proxied, rawCalls };
}

describe('환자 병합 오더 재전파(updated_at bump)', () => {
  it('이관 encounter 있으면 orders.updated_at 을 bump(LIS 재폴링 트리거)', async () => {
    const { tx, rawCalls } = makeTx([{ id: 'e1' }, { id: 'e2' }]);
    const prisma: any = { ...tx, $transaction: vi.fn((fn: any) => fn(tx)) };
    const svc = new PatientService(prisma as never, { getOrThrow: () => '00'.repeat(32) } as never) as any;

    await svc.mergePatients({ sourceId: 'src', targetId: 'tgt', reason: 'dup', acknowledgeUnmoved: true }, 'u1');

    expect(tx.encounter.findMany).toHaveBeenCalled(); // 이관 전 캡처
    const bump = rawCalls.find((s) => /orders/i.test(s) && /updated_at/i.test(s));
    expect(bump).toBeTruthy();
    expect(bump).toMatch(/prescription_id/i);
    expect(bump).toMatch(/encounter_id/i);
    // uuid=text 연산자 부재 방지 — encounter_id 를 text 로 캐스팅해 파라미터와 비교(종단검증서 실패로 확인된 버그)
    expect(bump).toMatch(/encounter_id"?::text/i);
  });

  it('이관 encounter 없으면 bump 하지 않음(불필요한 재전파 방지)', async () => {
    const { tx, rawCalls } = makeTx([]);
    const prisma: any = { ...tx, $transaction: vi.fn((fn: any) => fn(tx)) };
    const svc = new PatientService(prisma as never, { getOrThrow: () => '00'.repeat(32) } as never) as any;

    await svc.mergePatients({ sourceId: 'src', targetId: 'tgt', reason: 'dup', acknowledgeUnmoved: true }, 'u1');
    expect(rawCalls.find((s) => /orders/i.test(s))).toBeUndefined();
  });

  it('source===target 이면 병합 거부', async () => {
    const prisma: any = { $transaction: vi.fn() };
    const svc = new PatientService(prisma as never, { getOrThrow: () => '00'.repeat(32) } as never) as any;
    await expect(svc.mergePatients({ sourceId: 'x', targetId: 'x', reason: 'r' }, 'u1')).rejects.toThrow();
  });
});
