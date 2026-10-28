import { describe, it, expect, vi } from 'vitest';
import { BloodBankService } from '../../src/modules/blood-bank/blood-bank.service';

/**
 * 🔴 수혈 오더 생애주기 가드 — 이연 회수 T2-4(2026-08-18).
 *
 * 시행(BloodTransfusion)은 VERIFIED → IN_PROGRESS → COMPLETED 로 전이하는데
 * **오더(TransfusionOrder)는 출고(ISSUED)에서 멈춰 있었다.** 오더 어휘에는
 * IN_PROGRESS·COMPLETED 가 정의돼 있는데 아무도 그 상태로 만들지 않았다 —
 * 수혈이 끝난 뒤에도 오더 목록에는 '출고됨'으로 남아, 남은 일과 끝난 일이 구분되지 않았다.
 *
 * 규약: 오더는 **요청 단위 수를 다 수혈했을 때만** 완료다(부분 수혈은 진행 중).
 */

function makeService(opts: {
  transfusion?: Record<string, unknown>;
  order?: { id: string; units: number; status: string };
  completedCount?: number;
} = {}) {
  const transfusion = opts.transfusion ?? {
    id: 'tf-1', orderId: 'ord-1', status: 'VERIFIED',
    verifiedByNurse1: 'n1', verifiedByNurse2: 'n2', patientId: 'pt-1',
  };
  const order = opts.order ?? { id: 'ord-1', units: 2, status: 'ISSUED' };
  const orderUpdates: Record<string, unknown>[] = [];

  const prisma = {
    bloodTransfusion: {
      findUnique: vi.fn().mockResolvedValue(transfusion),
      update: vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ id: 'tf-1', ...data })),
      count: vi.fn().mockResolvedValue(opts.completedCount ?? 0),
    },
    transfusionOrder: {
      findUnique: vi.fn().mockResolvedValue(order),
      update: vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => {
        orderUpdates.push(data);
        return Promise.resolve({ id: order.id, ...data });
      }),
      updateMany: vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => {
        orderUpdates.push(data);
        return Promise.resolve({ count: 1 });
      }),
    },
    // 시행과 오더 상태는 한 트랜잭션(F3) — 정본의 실제 호출 모양
    $transaction: vi.fn((arg: any) => (typeof arg === 'function' ? arg(prisma) : Promise.all(arg))),
  };
  return { svc: new BloodBankService(prisma as never), orderUpdates, prisma };
}

describe('수혈 시행이 오더 상태를 끌고 간다', () => {
  it('🔴 시행을 시작하면 오더가 진행 중이 된다(출고됨에 멈추지 않는다)', async () => {
    const { svc, orderUpdates } = makeService();
    await svc.startTransfusion('tf-1');
    expect(orderUpdates).toContainEqual({ status: 'IN_PROGRESS' });
  });

  it('🔴 요청 단위를 다 수혈해야 오더가 완료된다 — 2단위 중 1단위는 진행 중', async () => {
    const { svc, orderUpdates } = makeService({
      transfusion: { id: 'tf-1', orderId: 'ord-1', status: 'IN_PROGRESS', patientId: 'pt-1' },
      order: { id: 'ord-1', units: 2, status: 'IN_PROGRESS' },
      completedCount: 1,
    });
    await svc.completeTransfusion('tf-1', 250);
    expect(orderUpdates.find((u) => u.status === 'COMPLETED')).toBeUndefined();
  });

  it('마지막 단위를 마치면 오더가 완료된다', async () => {
    const { svc, orderUpdates } = makeService({
      transfusion: { id: 'tf-1', orderId: 'ord-1', status: 'IN_PROGRESS', patientId: 'pt-1' },
      order: { id: 'ord-1', units: 2, status: 'IN_PROGRESS' },
      completedCount: 2,
    });
    await svc.completeTransfusion('tf-1', 250);
    expect(orderUpdates).toContainEqual({ status: 'COMPLETED' });
  });

  it('취소된 오더는 되살리지 않는다', async () => {
    const { svc, orderUpdates } = makeService({
      transfusion: { id: 'tf-1', orderId: 'ord-1', status: 'IN_PROGRESS', patientId: 'pt-1' },
      order: { id: 'ord-1', units: 1, status: 'CANCELLED' },
      completedCount: 1,
    });
    await svc.completeTransfusion('tf-1', 250);
    expect(orderUpdates).toEqual([]);
  });
});
