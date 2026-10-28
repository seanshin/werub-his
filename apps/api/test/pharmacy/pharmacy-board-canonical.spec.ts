import { describe, it, expect, vi } from 'vitest';
import { PharmacyBoardService } from '../../src/modules/pharmacy/pharmacy-board.service';
import { PharmacyService } from '../../src/modules/pharmacy/pharmacy.service';

/**
 * 약국 보드 — 정본 정렬 계약 (2026-08-13 W3 · 패턴 P12).
 *
 * 🔴 같은 사실은 /pharmacy 화면과 같은 모수로 센다. 종전 결함 세 가지:
 * 1. '조제 대기'가 dispensing.PENDING(=이미 조제 시작)을 세면서 딥링크는
 *    /pharmacy?status=ORDERED — 보드 "대기 없음 ✓" 인데 약국 목록 10건.
 * 2. '검수 대기'가 원내/원외 총계 — 딥링크가 여는 원내 탭과 KPI 가 어긋남(5 vs 4).
 * 3. '재고 부족'이 원내 소모품 마스터(inventoryItem·약품 0건)를 모수로 —
 *    약이 바닥나도 영원히 "부족 품목 없음 ✓". 약품 재고 정본은 MedicationBatch(getLowStock).
 */

function makeSvc() {
  const orderCount = vi.fn().mockResolvedValue(3);
  const orderFindMany = vi.fn().mockResolvedValue([]);
  const dispensingCount = vi.fn().mockResolvedValue(0);
  const getLowStock = vi.fn().mockResolvedValue([
    { id: 'm1', code: 'C1', nameKo: '세파렉신캡슐', batches: [{ remainingQty: 3 }, { remainingQty: 4 }] },
  ]);
  const prisma = {
    order: { count: orderCount, findMany: orderFindMany },
    dispensing: { count: dispensingCount },
  } as never;
  const svc = new PharmacyBoardService(prisma, { getLowStock } as unknown as PharmacyService);
  return { svc, orderCount, orderFindMany, dispensingCount, getLowStock };
}

describe('약국 보드 정본 정렬', () => {
  it('🔴 조제 대기 = 원내·약(MEDICATION)·접수 대기(ORDERED/RECEIVED) — /pharmacy 접수 대기와 같은 모수', async () => {
    const { svc, orderCount } = makeSvc();
    await svc.getBoard();
    const where = orderCount.mock.calls[0][0].where;
    expect(where.pharmacyType, '원외 처방전은 조제 대기가 아니다').toBe('INTERNAL');
    expect(where.prescription?.type, '비약물이 조제 대기에 섞인다').toBe('MEDICATION');
    expect(where.status).toEqual({ in: ['ORDERED', 'RECEIVED'] });
  });

  it('🔴 검수 대기는 원내/원외를 갈라 준다 — 딥링크(원내 탭)와 KPI 가 같은 것을 세도록', async () => {
    const { svc, dispensingCount } = makeSvc();
    const board = await svc.getBoard();
    const wheres = dispensingCount.mock.calls.map((c) => JSON.stringify(c[0].where));
    expect(wheres.some((w) => w.includes('"INTERNAL"') && w.includes('DISPENSED'))).toBe(true);
    expect(wheres.some((w) => w.includes('"EXTERNAL"') && w.includes('DISPENSED'))).toBe(true);
    expect(board.summary).toHaveProperty('verifyWaitExternal');
  });

  it('🔴 재고 부족 모수는 약품 재고 정본(getLowStock) — 소모품 마스터가 아니다', async () => {
    const { svc, getLowStock } = makeSvc();
    const board = await svc.getBoard();
    expect(getLowStock).toHaveBeenCalled();
    expect(board.summary.lowStockCount).toBe(1);
    expect(board.lowStock[0]).toEqual({ id: 'm1', name: '세파렉신캡슐', code: 'C1', remainingQty: 7 });
  });

  it('조제 대기 목록(take 50)과 별개로 총 건수는 count 로 센다 — 상한이 KPI 를 누르지 않게', async () => {
    const { svc, orderFindMany } = makeSvc();
    const board = await svc.getBoard();
    expect(board.summary.pending).toBe(3); // count 결과
    expect(orderFindMany.mock.calls[0][0].take).toBe(50);
  });
});
