import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { IntegrationOutboxService } from '../integration/integration-outbox.service';
import { CssdInventoryService } from './cssd-inventory.service';
import { withAdvisoryLock } from '../../common/util/advisory-lock';

@Injectable()
export class CssdPoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: IntegrationOutboxService,
    private readonly inventory: CssdInventoryService,
  ) {}

  /**
   * 🔴 (2026-09-28 재판정 a13360) 종전엔 `count + 1` 을 **잠금 없이** 읽었다 — 동시 발주 둘이 같은 번호를 받아
   *    `poNo @unique` 에 부딪혀 한쪽이 P2002 → 500. 재고 문서 채번과 같은 모양이라 같은 정본(`withAdvisoryLock`)으로
   *    잠근 트랜잭션 안에서만 부른다(`create` 참조). 잠금 키는 날짜 접두 단위.
   */
  private static poPrefix(): string {
    return `PO-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`;
  }

  private async genPoNo(tx: Pick<PrismaService, 'cssdPurchaseOrder'>, ymdPrefix: string) {
    const n = await tx.cssdPurchaseOrder.count({ where: { poNo: { startsWith: ymdPrefix } } });
    return `${ymdPrefix}-${String(n + 1).padStart(3, '0')}`;
  }

  /** 재주문 제안 — 안전재고 이하 품목 + 권장수량 */
  async suggestReorder() {
    const items = await this.prisma.instrumentItem.findMany({
      where: { isActive: true },
      select: { id: true, code: true, name: true, stock: true, safetyStock: true, unit: true, unitPrice: true, supplierId: true },
      orderBy: { stock: 'asc' },
    });
    return items
      .filter((i) => i.stock <= i.safetyStock)
      .map((i) => ({ ...i, suggestQty: Math.max(i.safetyStock * 2 - i.stock, i.safetyStock || 1), shortage: i.safetyStock - i.stock }));
  }

  async list(status?: string) {
    const where = status && status !== 'ALL' ? { status } : {};
    return this.prisma.cssdPurchaseOrder.findMany({ where, orderBy: { createdAt: 'desc' }, take: 100, include: { lines: true } });
  }

  async get(id: string) {
    const po = await this.prisma.cssdPurchaseOrder.findUnique({ where: { id }, include: { lines: true } });
    if (!po) throw new NotFoundException('발주 없음');
    return po;
  }

  /** 발주 생성(요청) */
  async create(data: { supplierId?: string; note?: string; requestedBy?: string; lines: { itemId: string; qty: number; unitPrice?: number }[] }) {
    if (!data.lines?.length) throw new BadRequestException('발주 품목이 없습니다');
    const ids = data.lines.map((l) => l.itemId);
    const items = await this.prisma.instrumentItem.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, unitPrice: true } });
    const imap = new Map(items.map((i) => [i.id, i]));
    if (items.length !== new Set(ids).size) throw new BadRequestException('존재하지 않는 품목 포함');
    const lines = data.lines.map((l) => {
      const it = imap.get(l.itemId)!;
      const unitPrice = l.unitPrice ?? it.unitPrice ?? null;
      return { itemId: l.itemId, itemName: it.name, qty: l.qty, unitPrice };
    });
    const totalAmount = lines.reduce((s, l) => s + (l.unitPrice ?? 0) * l.qty, 0);
    const pfx = CssdPoService.poPrefix();
    return withAdvisoryLock(this.prisma, `cssd:po-no:${pfx}`, async (tx) => {
      const poNo = await this.genPoNo(tx, pfx);
      return tx.cssdPurchaseOrder.create({
        data: { poNo, supplierId: data.supplierId ?? null, note: data.note ?? null, requestedBy: data.requestedBy ?? null, totalAmount, lines: { create: lines } },
        include: { lines: true },
      });
    });
  }

  /** 승인 → ERP 구매(procurement) 통보 */
  async approve(id: string, by?: string) {
    const po = await this.get(id);
    if (po.status !== 'REQUESTED') throw new BadRequestException('REQUESTED 상태만 승인 가능');
    const updated = await this.prisma.cssdPurchaseOrder.update({ where: { id }, data: { status: 'APPROVED', approvedBy: by ?? null, approvedAt: new Date() }, include: { lines: true } });
    void this.outbox.enqueue('procurement', 'cssd.po.approved', `cssd-po:${po.poNo}`, {
      poNo: po.poNo, supplierId: po.supplierId, totalAmount: po.totalAmount, approvedAt: updated.approvedAt,
      lines: updated.lines.map((l) => ({ itemId: l.itemId, itemName: l.itemName, qty: l.qty, unitPrice: l.unitPrice })),
    });
    return updated;
  }

  /**
   * 입고(수령) — 라인별 수량 입고 → 재고 IN. 원자적 트랜잭션(재고·원장·입고수량 정합). 전량 입고 시 RECEIVED
   *
   * 🔴 (2026-09-28 재판정 a13360) 종전 결함 두 겹:
   *   ① 상태 검사가 `['APPROVED','RECEIVED']` 였다 — 오류 문구는 "APPROVED 상태만"인데 **RECEIVED 도 통과**.
   *      RECEIVED 가 되는 조건은 "모든 라인 receivedQty >= qty" 하나뿐이라(아래 `allReceived`) 부분 입고는 APPROVED 로
   *      남는다 — 즉 그 문은 분할 입고용이 아니라 **전량 받은 발주를 한 번 더 받게** 하는 문이었다
   *      (`instrumentItem.stock` 두 번 증가 + `supply_transactions` IN 두 줄 = 재고 과다 계상).
   *   ② 상태·라인·재고를 **트랜잭션 밖에서** 읽었다 — 상태를 APPROVED 로 좁혀도 더블클릭 두 요청이 동시에 오면
   *      둘 다 APPROVED 를 읽고 둘 다 더한다. 재고도 밖에서 읽은 값 + qty 로 덮어써 다른 쓰기를 지웠다.
   *   → 발주 단위 `withAdvisoryLock` 안에서 **다시 읽고** 상태를 판정하고, 재고는 `increment` 로 더한다.
   * 🔴 여기서 막는 것은 **전량 입고 뒤 재입고**와 **동시 이중 요청**이다. 부분 입고 중(APPROVED) **순차로** 같은 요청이
   *    다시 오는 것(분할 입고인가 재전송인가)과 초과 입고는 구매 정책이라 사람 결정으로 남긴다
   *    (`test/architecture/idempotency-judgment.ts` `IDEMPOTENCY_HUMAN_DECISIONS` `cssd.partial-receipt-resend`).
   */
  async receive(id: string, receipts: { lineId: string; qty: number }[], by?: string) {
    const erpEvents: { itemId: string; qty: number; balanceAfter: number }[] = [];
    let poNo = '';
    const result = await withAdvisoryLock(this.prisma, `cssd:po-receive:${id}`, async (tx) => {
      const po = await tx.cssdPurchaseOrder.findUnique({ where: { id }, include: { lines: true } });
      if (!po) throw new NotFoundException('발주 없음');
      if (po.status !== 'APPROVED') throw new BadRequestException('APPROVED 상태만 입고 가능');
      poNo = po.poNo;
      const lmap = new Map(po.lines.map((l) => [l.id, l]));

      // 대상 품목 일괄 존재 확인(N+1 제거) — 잔량은 아래 increment 결과로 받는다
      const itemIds = [...new Set(receipts.map((r) => lmap.get(r.lineId)?.itemId).filter(Boolean) as string[])];
      const items = await tx.instrumentItem.findMany({ where: { id: { in: itemIds } }, select: { id: true } });
      const known = new Set(items.map((i) => i.id));

      for (const r of receipts) {
        const line = lmap.get(r.lineId);
        if (!line || r.qty <= 0) continue;
        if (!known.has(line.itemId)) continue;
        const updated = await tx.instrumentItem.update({ where: { id: line.itemId }, data: { stock: { increment: r.qty } } });
        const newStock = updated.stock;
        await tx.supplyTransaction.create({ data: { itemId: line.itemId, type: 'IN', qty: r.qty, balanceAfter: newStock, reason: `발주 입고 ${po.poNo}`, ref: po.poNo, performedBy: by ?? null } });
        await tx.cssdPoLine.update({ where: { id: line.id }, data: { receivedQty: { increment: r.qty } } });
        erpEvents.push({ itemId: line.itemId, qty: r.qty, balanceAfter: newStock });
      }
      const lines = await tx.cssdPoLine.findMany({ where: { poId: id } });
      const allReceived = lines.every((l) => l.receivedQty >= l.qty);
      return tx.cssdPurchaseOrder.update({
        where: { id },
        data: { status: allReceived ? 'RECEIVED' : 'APPROVED', receivedAt: allReceived ? new Date() : null },
        include: { lines: true },
      });
    });

    // 커밋 후 ERP 통보(outbox) — 트랜잭션과 분리(전송보장은 outbox 자체 재시도)
    for (const e of erpEvents) void this.inventory.notifyErpPublic(e.itemId, 'IN', e.qty, e.balanceAfter, poNo);
    return result;
  }

  async cancel(id: string) {
    const po = await this.get(id);
    if (po.status === 'RECEIVED') throw new BadRequestException('입고 완료 발주는 취소 불가');
    return this.prisma.cssdPurchaseOrder.update({ where: { id }, data: { status: 'CANCELLED' } });
  }
}
