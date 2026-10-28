/**
 * 🔴 CSSD 재고 쓰기는 원자적이어야 한다(2026-09-30 · 백로그 §X 잔여).
 *
 * 원 결함: 수동 입고·ERP 입고·재포장 소모가 전부 `findUnique → stock ± qty → update({ stock: 새값 })`
 * (읽고-덮어쓰기)였다. 두 요청이 같은 행을 동시에 읽으면 **하나의 입고/출고가 재고에서 사라지고**
 * 원장(SupplyTransaction)의 잔량(balanceAfter)은 둘 다 같은 값을 적는다. 발주 입고(cssd-po)만 `increment` 였다.
 *
 * 재주입 검증: 각 경로를 읽은 값으로 덮어쓰는 형태로 되돌리면 '동시' 3건이 실패한다.
 */
import { describe, it, expect, vi } from 'vitest';
import { CssdInventoryService } from '../../src/modules/cssd/cssd-inventory.service';

type StockData = { stock: number | { increment?: number; decrement?: number } };

/** 읽기와 쓰기 사이에 다른 요청이 끼어들 수 있는 가짜 DB(한 틱 양보) */
function fakeDb(initial: number) {
  const row = { id: 'i1', code: 'C1', name: '켈리 겸자', stock: initial, safetyStock: 0 };
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const ledger: { qty: number; balanceAfter: number }[] = [];
  const apply = (data: StockData) => {
    const s = data.stock;
    if (typeof s === 'number') row.stock = s;
    else row.stock += (s.increment ?? 0) - (s.decrement ?? 0);
    return { ...row };
  };
  const instrumentItem = {
    findUnique: vi.fn(async () => { const snap = { ...row }; await tick(); return snap; }),
    findFirst: vi.fn(async () => { const snap = { ...row }; await tick(); return snap; }),
    update: vi.fn(async ({ data }: { data: StockData }) => apply(data)),
  };
  const prisma = {
    instrumentItem,
    supplyTransaction: { create: vi.fn(async ({ data }: { data: { qty: number; balanceAfter: number } }) => { ledger.push(data); return data; }) },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({
      $queryRaw: vi.fn(async (strings: TemplateStringsArray) => { expect(strings.join('?')).toMatch(/FOR UPDATE/); return [{ stock: row.stock }]; }),
      instrumentItem,
    })),
  };
  const svc = new CssdInventoryService(prisma as never, {} as never, { enqueue: vi.fn() } as never);
  vi.spyOn(svc as unknown as { notifyErp: () => Promise<void> }, 'notifyErp').mockResolvedValue(undefined);
  return { svc, row, ledger, prisma };
}

describe('CSSD 재고 — 동시 쓰기에서 하나가 사라지지 않는다', () => {
  it('🔴 동시 수동 입고 2건 → 둘 다 반영 · 원장 잔량이 서로 다르다', async () => {
    const { svc, row, ledger } = fakeDb(10);
    await Promise.all([svc.supply('i1', { type: 'IN', qty: 3 }), svc.supply('i1', { type: 'IN', qty: 5 })]);
    expect(row.stock).toBe(18);
    expect(ledger.map((l) => l.balanceAfter).sort((a, b) => a - b)).toEqual([13, 18]);
  });

  it('🔴 동시 ERP 입고 2건 → 둘 다 반영', async () => {
    const { svc, row } = fakeDb(0);
    const r = await Promise.all([svc.erpInbound({ code: 'C1', qty: 4 }), svc.erpInbound({ code: 'C1', qty: 6 })]);
    expect(row.stock).toBe(10);
    expect(r.map((x) => x.stock).sort((a, b) => a - b)).toEqual([4, 10]);
  });

  it('🔴 재포장 소모와 입고가 겹쳐도 둘 다 반영', async () => {
    const { svc, row } = fakeDb(10);
    await Promise.all([svc.consumeForRepackage([{ itemId: 'i1', qty: 2 }], 'LOT-1'), svc.supply('i1', { type: 'RETURN', qty: 1 })]);
    expect(row.stock).toBe(9);
  });

  it('조정(ADJUST)은 잠근 행에서 차이를 재고 목표값을 쓴다', async () => {
    const { svc, row, ledger, prisma } = fakeDb(7);
    const r = await svc.supply('i1', { type: 'ADJUST', qty: 4 });
    expect(r.stock).toBe(4);
    expect(row.stock).toBe(4);
    expect(ledger[0]).toMatchObject({ qty: -3, balanceAfter: 4 });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('대조군 — 없는 품목은 404 · 0 이하 입고는 400', async () => {
    const { svc, prisma } = fakeDb(1);
    prisma.instrumentItem.findUnique.mockResolvedValueOnce(null as never);
    await expect(svc.supply('x', { type: 'IN', qty: 1 })).rejects.toThrow('품목 없음');
    await expect(svc.supply('i1', { type: 'IN', qty: 0 })).rejects.toThrow('수량은 1 이상');
  });
});
