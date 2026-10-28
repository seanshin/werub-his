import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ConfigRuntimeService } from '../config/config-runtime.service';
import { IntegrationOutboxService } from '../integration/integration-outbox.service';

/**
 * 재포장 자재 소모 결과 — **부분 실패를 "부족 없음"으로 읽히지 않게** 3상태로 말한다.
 */
export interface RepackageConsumeResult {
  /** 소모 후 안전재고 이하/음수가 된 품목명 — **판정이 끝난 것만** */
  shortages: string[];
  /** 실제로 재고가 차감된 품목명 */
  consumed: string[];
  /** 차감·기록에 실패한 품목 — 이 건들의 부족 여부는 **모른다** */
  failed: { itemId: string; name?: string; message: string }[];
  /** 전 품목 판정이 끝났는가. false 면 `shortages` 는 "부족 없음"의 근거가 되지 못한다 */
  complete: boolean;
}

@Injectable()
export class CssdInventoryService {
  private readonly logger = new Logger(CssdInventoryService.name);
  constructor(private readonly prisma: PrismaService, private readonly configRuntime: ConfigRuntimeService, private readonly outbox: IntegrationOutboxService) {}

  // ── 공급업체 ──
  listSuppliers() { return this.prisma.supplier.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } }); }
  createSupplier(data: { name: string; contact?: string; phone?: string; email?: string }) {
    return this.prisma.supplier.create({ data });
  }

  // ── 품목 마스터 ──
  async listItems(opts?: { lowStock?: boolean; q?: string }) {
    const items = await this.prisma.instrumentItem.findMany({
      where: { isActive: true, ...(opts?.q ? { OR: [{ name: { contains: opts.q } }, { code: { contains: opts.q } }] } : {}) },
      orderBy: { code: 'asc' }, include: { supplier: { select: { name: true } } },
    });
    return opts?.lowStock ? items.filter((i) => i.stock <= i.safetyStock) : items;
  }

  async getItem(id: string) {
    const item = await this.prisma.instrumentItem.findUnique({
      where: { id },
      include: { supplier: true, transactions: { orderBy: { createdAt: 'desc' }, take: 30 } },
    });
    if (!item) throw new NotFoundException('품목 없음');
    // 이 품목을 사용하는 세트(템플릿)
    const templates = await this.prisma.instrumentSetTemplate.findMany({ select: { id: true, name: true, items: true } });
    const usedIn = templates.filter((t) => Array.isArray(t.items) && (t.items as { itemId?: string }[]).some((x) => x.itemId === id)).map((t) => t.name);
    return { ...item, usedIn };
  }

  private async genCode() {
    const n = (await this.prisma.instrumentItem.count()) + 1;
    return `INS-${String(n).padStart(4, '0')}`;
  }
  async createItem(data: { code?: string; name: string; category?: string; spec?: string; unit?: string; stock?: number; safetyStock?: number; location?: string; supplierId?: string; unitPrice?: number; erpItemCode?: string }) {
    const code = data.code || (await this.genCode());
    const item = await this.prisma.instrumentItem.create({
      data: {
        code, name: data.name, category: data.category ?? null, spec: data.spec ?? null,
        unit: data.unit ?? '개', stock: data.stock ?? 0, safetyStock: data.safetyStock ?? 0,
        location: data.location ?? null, supplierId: data.supplierId ?? null, unitPrice: data.unitPrice ?? null,
        erpItemCode: data.erpItemCode ?? null,
      },
    });
    if ((data.stock ?? 0) > 0) await this.tx(item.id, 'IN', data.stock!, item.stock, '초기 재고');
    return item;
  }
  updateItem(id: string, data: { name?: string; category?: string; spec?: string; unit?: string; safetyStock?: number; location?: string; supplierId?: string; unitPrice?: number; erpItemCode?: string; isActive?: boolean }) {
    return this.prisma.instrumentItem.update({ where: { id }, data });
  }

  // ── 공급/재고 거래 ──
  /** 재고 거래 후 잔량 반영. consumeStock 등 내부에서도 사용. + ERP 웹훅(설정 시) */
  async tx(itemId: string, type: 'IN' | 'OUT' | 'ADJUST' | 'RETURN', delta: number, balanceAfter: number, reason?: string, ref?: string, by?: string) {
    const row = await this.prisma.supplyTransaction.create({ data: { itemId, type, qty: delta, balanceAfter, reason: reason ?? null, ref: ref ?? null, performedBy: by ?? null } });
    void this.notifyErp(itemId, type, delta, balanceAfter, ref);
    return row;
  }

  /** 외부 호출용(발주 입고 등 트랜잭션 커밋 후 ERP 통보) */
  notifyErpPublic(itemId: string, type: string, qty: number, balanceAfter: number, ref?: string) {
    return this.notifyErp(itemId, type, qty, balanceAfter, ref);
  }

  /** ERP 재고 변동 → 아웃박스(전송보장·재시도) */
  private async notifyErp(itemId: string, type: string, qty: number, balanceAfter: number, ref?: string) {
    try {
      const item = await this.prisma.instrumentItem.findUnique({ where: { id: itemId }, select: { code: true, erpItemCode: true, name: true } });
      const idemRef = `cssd:${item?.code ?? itemId}:${ref ?? ''}:${Date.now()}`;
      await this.outbox.enqueue('cssd', 'stock.changed', idemRef, {
        code: item?.code, erpItemCode: item?.erpItemCode, name: item?.name, type, qty, balanceAfter, ref,
      });
    } catch (e) { this.logger.warn(`ERP outbox enqueue 실패: ${(e as Error).message}`); }
  }

  /** ERP 인바운드 입고 — code 또는 erpItemCode로 품목 찾아 IN */
  async erpInbound(data: { code?: string; erpItemCode?: string; qty: number; poNo?: string; reason?: string }) {
    if (!data.qty || data.qty <= 0) throw new BadRequestException('qty는 1 이상');
    const item = data.code
      ? await this.prisma.instrumentItem.findUnique({ where: { code: data.code } })
      : await this.prisma.instrumentItem.findFirst({ where: { erpItemCode: data.erpItemCode } });
    if (!item) throw new NotFoundException('매핑된 품목을 찾을 수 없습니다(code/erpItemCode 확인)');
    // 🔴 읽은 값에 더해 덮어쓰지 않는다 — 동시에 들어온 입고·출고 하나가 사라진다(원자 증감 · 잔량은 갱신된 행에서)
    const { stock: newStock } = await this.prisma.instrumentItem.update({ where: { id: item.id }, data: { stock: { increment: data.qty } }, select: { stock: true } });
    await this.tx(item.id, 'IN', data.qty, newStock, data.reason ?? 'ERP 입고', data.poNo, undefined);
    return { ok: true, code: item.code, stock: newStock };
  }

  /** ERP 읽기용 재고 스냅샷 */
  async erpStockSnapshot() {
    const items = await this.prisma.instrumentItem.findMany({ where: { isActive: true }, select: { code: true, erpItemCode: true, name: true, stock: true, safetyStock: true, unit: true } });
    return items.map((i) => ({ ...i, lowStock: i.stock <= i.safetyStock }));
  }

  async supply(id: string, data: { type: 'IN' | 'ADJUST' | 'RETURN'; qty: number; reason?: string; userId?: string }) {
    // IN/RETURN: +qty(원자 증감), ADJUST: qty를 목표재고로 설정(차이 기록)
    // 🔴 종전엔 읽고-더해-덮어쓰기라 동시 입고·재포장 소모 하나가 사라졌다. ADJUST 는 목표값이라 차이를 재야 하므로
    //    행을 잠그고(FOR UPDATE — 원자 증감 UPDATE 와도 직렬화된다) 읽은 뒤 같은 트랜잭션에서 쓴다.
    let delta: number;
    let newStock: number;
    if (data.type === 'ADJUST') {
      const target = Math.max(0, data.qty);
      const r = await this.prisma.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<{ stock: number }[]>`SELECT stock FROM instrument_items WHERE id = ${id}::uuid FOR UPDATE`;
        if (!rows.length) return null;
        await tx.instrumentItem.update({ where: { id }, data: { stock: target } });
        return { delta: target - rows[0].stock };
      });
      if (!r) throw new NotFoundException('품목 없음');
      delta = r.delta; newStock = target;
    } else {
      if (data.qty <= 0) throw new BadRequestException('수량은 1 이상');
      const item = await this.prisma.instrumentItem.findUnique({ where: { id }, select: { id: true } });
      if (!item) throw new NotFoundException('품목 없음');
      delta = data.qty;
      ({ stock: newStock } = await this.prisma.instrumentItem.update({ where: { id }, data: { stock: { increment: delta } }, select: { stock: true } }));
    }
    await this.tx(id, data.type, delta, newStock, data.reason, undefined, data.userId);
    return { ok: true, stock: newStock };
  }

  async transactions(id: string) {
    return this.prisma.supplyTransaction.findMany({ where: { itemId: id }, orderBy: { createdAt: 'desc' }, take: 50 });
  }

  /** 전체 입출고 원장 — 유형/날짜/품목 필터 */
  async ledger(opts: { type?: string; from?: string; to?: string; q?: string }) {
    const where: Record<string, unknown> = {};
    if (opts.type && opts.type !== 'ALL') where.type = opts.type;
    if (opts.from || opts.to) {
      where.createdAt = {
        // KST 경계 명시 — from(date-only) 은 UTC 자정, to 는 로컬 파싱이라 9시간 어긋났다. 둘 다 +09:00.
        ...(opts.from ? { gte: new Date(`${opts.from}T00:00:00+09:00`) } : {}),
        ...(opts.to ? { lte: new Date(`${opts.to}T23:59:59+09:00`) } : {}),
      };
    }
    if (opts.q) where.item = { OR: [{ name: { contains: opts.q } }, { code: { contains: opts.q } }] };
    const rows = await this.prisma.supplyTransaction.findMany({
      where, orderBy: { createdAt: 'desc' }, take: 300,
      include: { item: { select: { code: true, name: true, unit: true } } },
    });
    return rows.map((r) => ({ id: r.id, type: r.type, qty: r.qty, balanceAfter: r.balanceAfter, reason: r.reason, ref: r.ref, createdAt: r.createdAt, code: r.item?.code, name: r.item?.name, unit: r.item?.unit }));
  }

  /** 바코드/QR 스캔 — 코드로 품목 조회 */
  async findByCode(code: string) {
    const item = await this.prisma.instrumentItem.findUnique({ where: { code }, include: { supplier: { select: { name: true } } } });
    if (!item) throw new NotFoundException('해당 코드의 품목이 없습니다');
    return item;
  }

  /**
   * 재포장 시 세트 구성 품목 소모(OUT). items: [{itemId?, name, qty}]
   *
   * 🔴 종전엔 `string[]`(부족 품목명)만 돌려줬고 호출부가 `.catch(() => [])` 로 받았다.
   *    그래서 **한 품목에서 실패하면 앞 품목의 재고는 이미 차감된 채로 "부족 없음"** 이 됐다
   *    (부분 실패를 "없음"으로 번역한 것 — v4.6.0 `.catch(()=>[])` 축과 같은 유형).
   *    이제 3상태로 말한다: 판정 끝난 것(shortages) / 차감된 것(consumed) / **모르는 것**(failed).
   *    `complete=false` 면 `shortages` 를 "부족 없음"으로 읽으면 안 된다.
   *
   * 실패해도 계속 도는 이유: 여기서 멈추면 나머지 품목은 차감도 판정도 안 된 채 조용히 남는다.
   * 이미 차감된 것을 되돌리지도 않는다 — 원장(SupplyTransaction)에 남은 출고는 일어난 사실이다.
   */
  async consumeForRepackage(items: { itemId?: string; name?: string; qty?: number }[], lotNo: string, by?: string): Promise<RepackageConsumeResult> {
    const shortages: string[] = [];
    const consumed: string[] = [];
    const failed: { itemId: string; name?: string; message: string }[] = [];
    for (const it of items ?? []) {
      if (!it.itemId) continue;
      try {
        const item = await this.prisma.instrumentItem.findUnique({ where: { id: it.itemId } });
        if (!item) continue;
        const q = it.qty ?? 1;
        // 원자 차감 — 잔량은 갱신된 행에서(동시 입고·다른 재포장과 겹쳐도 하나가 사라지지 않는다)
        const { stock: newStock } = await this.prisma.instrumentItem.update({ where: { id: item.id }, data: { stock: { decrement: q } }, select: { stock: true } });
        consumed.push(item.name);
        // 원장 기록 실패는 차감을 되돌리지 않지만 "모르는 것"으로 세어 호출부가 알게 한다
        try {
          await this.tx(item.id, 'OUT', -q, newStock, '재포장 소모', lotNo, by);
        } catch (e) {
          failed.push({ itemId: it.itemId, name: item.name, message: `재고는 차감됐으나 입출고 원장 기록 실패: ${(e as Error).message}` });
        }
        if (newStock < 0 || newStock <= item.safetyStock) shortages.push(item.name);
      } catch (e) {
        failed.push({ itemId: it.itemId, name: it.name, message: (e as Error).message });
        this.logger.error(`재포장 소모 실패(item=${it.itemId}·LOT ${lotNo}): ${(e as Error).message}`);
      }
    }
    return { shortages, consumed, failed, complete: failed.length === 0 };
  }

  async stats() {
    const [total, low] = await Promise.all([
      this.prisma.instrumentItem.count({ where: { isActive: true } }),
      this.listItems({ lowStock: true }),
    ]);
    return { totalItems: total, lowStockCount: low.length, lowStock: low.map((i) => ({ id: i.id, code: i.code, name: i.name, stock: i.stock, safetyStock: i.safetyStock })) };
  }
}
