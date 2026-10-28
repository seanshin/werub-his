import { Injectable, Logger, Optional, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { InventoryTxType, Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import {
  CreateItemDto, UpdateItemDto, CreateStorageDto, UpdateStorageDto,
  CreateSupplierDto, AddItemSupplierDto, CreatePurchaseOrderDto,
  CreateRequestDto, CreateRepackOrderDto,
} from './dto/inventory.dto';
import { IntegrationOutboxService } from '../integration/integration-outbox.service';
import { ConfigRuntimeService } from '../config/config-runtime.service';
import { gateMode, GateMode } from '../../common/gate-mode';
import { recordGateViolation } from '../../common/gate-violation-record';
import { withAdvisoryLock } from '../../common/util/advisory-lock';

const ERP_SYSTEM_USER = '00000000-0000-4000-a000-000000000001';

/**
 * 발주·부서청구·소분·실사 **문서번호 채번**(2026-09-28 재판정 a13360).
 *
 * 🔴 종전엔 `PO-<날짜>-${String(Date.now()).slice(-3)}` 였다. epoch ms 끝 세 자리는 1초마다 같은 값으로
 *    돌아온다 — 같은 날 두 문서가 부딪히면 `@unique` 번호가 **P2002 → 500** 을 낸다(중복이 생기는 게 아니라
 *    **정상 생성이 실패**한다). 그리고 번호를 호출마다 새로 뽑으므로 그 유니크는 **재시도의 심판도 아니다**.
 *    → 정본 `withAdvisoryLock` 으로 그날 접두 단위 직렬화 + 그날치 **최대 번호 + 1**.
 *    count+1 이 아니라 최대값인 이유: 배포 당일에는 옛 방식 번호(`-123` 같은 시계 꼬리)가 이미 섞여 있어
 *    count+1 이 그중 하나와 부딪힐 수 있다.
 * 🔴 **번호 충돌을 없앤 것이지 중복 제출을 막은 것이 아니다.** 같은 내용을 두 번 올리면 문서가 두 벌 생긴다 —
 *    무엇을 같은 제출로 볼지는 구매·물류 정책이라 사람 결정이다(`test/architecture/idempotency-judgment.ts`
 *    `IDEMPOTENCY_HUMAN_DECISIONS`). 그래서 멱등 계측에서 이 4자리는 **여전히 무방비로 센다**.
 * 🔴 날짜 접두는 종전과 같이 UTC 날짜다(번호 체계를 바꾸지 않는다 — KST 00~09시 문서가 전날 번호를 받는 것은
 *    종전과 같은 별도 사실이다).
 */
export function nextDailyDocNumber(prefix: string, taken: readonly string[]): string {
  let max = 0;
  for (const n of taken) {
    if (!n.startsWith(prefix)) continue;
    const tail = n.slice(prefix.length);
    if (/^\d+$/.test(tail)) max = Math.max(max, Number(tail));
  }
  return `${prefix}${String(max + 1).padStart(3, '0')}`;
}

function docDatePrefix(kind: 'PO' | 'REQ' | 'RPK' | 'CNT'): string {
  return `${kind}-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-`;
}

@Injectable()
export class InventoryService {
  private readonly logger = new Logger(InventoryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: IntegrationOutboxService,
    @Optional() private readonly configRuntime?: ConfigRuntimeService,
  ) {}

  private async expiryGateMode(): Promise<GateMode> {
    return gateMode(await this.configRuntime?.get('inventory.expiryIssueEnforce'), 'WARN');
  }

  /**
   * FEFO LOT 소진 — 만료·리콜·소진 LOT은 어떤 모드에서도 절대 소진하지 않음(핵심 안전).
   * 소진분은 lot.quantity에서 원자 차감(currentStock과의 발산 방지), 0 도달 시 CONSUMED.
   * 활성 LOT 부족분은 currentStock 차감으로만 처리(레거시 LOT 미기입 입고 호환) —
   * 단 만료 LOT 재고가 남아있는 상황이면 게이트(inventory.expiryIssueEnforce)로 WARN/BLOCK.
   * 반환: LOT별 소진 내역(추적용 — 트랜잭션 로그 lotId 기록에 사용).
   */
  private async consumeLotsFefo(
    tx: Prisma.TransactionClient, itemId: string, qty: number, itemName: string, mode: GateMode,
  ): Promise<{ lotId: string; lotNumber: string; used: number }[]> {
    const now = new Date();
    const lots = await tx.inventoryLot.findMany({
      where: { itemId, status: 'ACTIVE', quantity: { gt: 0 } },
      orderBy: [{ expiryDate: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }],
      select: { id: true, lotNumber: true, quantity: true, expiryDate: true },
    });
    const usable = lots.filter((l) => !l.expiryDate || l.expiryDate > now);
    const expiredActive = lots.filter((l) => l.expiryDate && l.expiryDate <= now);

    // 만료됐는데 ACTIVE로 남은 LOT은 발견 즉시 EXPIRED 마킹(관리 가시성·재소진 원천 차단)
    for (const l of expiredActive) {
      await tx.inventoryLot.update({ where: { id: l.id }, data: { status: 'EXPIRED' } });
    }

    const used: { lotId: string; lotNumber: string; used: number }[] = [];
    let left = qty;
    for (const lot of usable) {
      if (left <= 0) break;
      const use = Math.min(lot.quantity, left);
      await tx.inventoryLot.update({
        where: { id: lot.id },
        data: { quantity: { decrement: use }, ...(lot.quantity - use === 0 ? { status: 'CONSUMED' } : {}) },
      });
      used.push({ lotId: lot.id, lotNumber: lot.lotNumber, used: use });
      left -= use;
    }

    if (left > 0) {
      // 부족분 게이트 — 이미 EXPIRED/RECALLED로 마킹된 잔량 LOT도 포함(마킹된 재고만 남은 fail-open 방지)
      const blockedCount = await tx.inventoryLot.count({
        where: { itemId, status: { in: ['EXPIRED', 'RECALLED'] }, quantity: { gt: 0 } },
      });
      if (blockedCount > 0) {
        const msg = `${itemName}: 유효 LOT 부족(부족 ${left}) — 만료/리콜 LOT ${blockedCount}건 잔존(불출 불가·폐기/반품 처리 필요)`;
        // 관제 대시보드용 위반 영속(tx 밖 — BLOCK 롤백에도 기록 보존)
        void recordGateViolation(this.prisma, this.logger, {
          gateKey: 'inventory.expiryIssueEnforce', severity: mode, message: msg, refType: 'ITEM', refId: itemId,
        });
        if (mode === 'BLOCK') {
          throw new BadRequestException({ code: 'INVENTORY_EXPIRED_LOT_BLOCKED', message: `불출 차단: ${msg}` });
        }
        if (mode === 'WARN') this.logger.warn(`inventory expiry gate WARN — ${msg}`);
      }
    }
    return used;
  }

  // ── 품목 CRUD ──

  async findAll(filters: { category?: string; lowStock?: boolean }) {
    const where: Prisma.InventoryItemWhereInput = { isActive: true };
    if (filters.category) where.category = filters.category;
    const items = await this.prisma.inventoryItem.findMany({
      where, orderBy: { name: 'asc' },
      include: { defaultStorage: { select: { id: true, name: true, code: true } } },
    });
    // Prisma는 field-to-field 비교 미지원 → JS 필터 (소규모 병원 재고 수천 건 이하 허용)
    if (filters.lowStock) return items.filter(i => i.currentStock <= i.safetyStock);
    return items;
  }

  async findById(id: string) {
    const item = await this.prisma.inventoryItem.findUnique({
      where: { id },
      include: {
        defaultStorage: true,
        itemSuppliers: { include: { supplier: { select: { id: true, code: true, name: true } } } },
        lots: { where: { status: 'ACTIVE' }, orderBy: { expiryDate: 'asc' } },
        transactions: { orderBy: { createdAt: 'desc' }, take: 20 },
      },
    });
    if (!item) throw new NotFoundException('Item not found');
    return item;
  }

  async createItem(data: CreateItemDto) {
    return this.prisma.inventoryItem.create({ data: {
      code: data.code, erpItemCode: data.erpItemCode, name: data.name, category: data.category, unit: data.unit,
      specification: data.specification, barcode: data.barcode, manufacturer: data.manufacturer,
      countryOfOrigin: data.countryOfOrigin, storageCondition: data.storageCondition,
      safetyStock: data.safetyStock ? Number(data.safetyStock) : 10,
      maxStock: data.maxStock ? Number(data.maxStock) : undefined,
      reorderPoint: data.reorderPoint ? Number(data.reorderPoint) : undefined,
      reorderQty: data.reorderQty ? Number(data.reorderQty) : undefined,
      leadTimeDays: data.leadTimeDays ? Number(data.leadTimeDays) : undefined,
      supplierName: data.supplierName, unitPrice: data.unitPrice ? Number(data.unitPrice) : undefined,
      defaultStorageId: data.defaultStorageId || undefined,
    }});
  }

  async updateItem(id: string, data: UpdateItemDto) {
    const d: Record<string, string | number | null | undefined> = {};
    const strFields = ['name', 'category', 'unit', 'specification', 'barcode', 'manufacturer', 'erpItemCode'] as const;
    const intFields = ['safetyStock', 'maxStock', 'reorderPoint', 'reorderQty'] as const;
    for (const f of strFields) { if (data[f] !== undefined) d[f] = data[f]; }
    for (const f of intFields) { if (data[f] !== undefined) d[f] = Number(data[f]); }
    if (data.defaultStorageId !== undefined) d.defaultStorageId = data.defaultStorageId || null;
    return this.prisma.inventoryItem.update({ where: { id }, data: d });
  }

  // ── 입출고 ──

  async transact(itemId: string, type: InventoryTxType, quantity: number, userId: string, reason?: string, extra?: { lotId?: string; storageId?: string; unitCost?: number; department?: string; referenceNumber?: string }) {
    const item = await this.prisma.inventoryItem.findUnique({ where: { id: itemId } });
    if (!item) throw new NotFoundException('Item not found');

    const inTypes: string[] = ['IN', 'RETURN', 'RECEIVE'];
    const isIn = inTypes.includes(type);
    const delta = isIn ? quantity : -quantity;
    const newStock = item.currentStock + delta;
    if (newStock < 0) throw new BadRequestException('Insufficient stock');
    const mode = await this.expiryGateMode();

    const result = await this.prisma.$transaction(async (tx) => {
      // LOT 지정 입출고 — 출고는 만료/리콜 LOT 차단 + 수량 원자 차감(currentStock과 발산 방지)
      // 단 폐기 계열(DISPOSAL/EXPIRED)은 만료/리콜 LOT 정리가 목적이므로 차단하지 않음(정리 경로 보장)
      const isWriteOff = type === 'DISPOSAL' || type === 'EXPIRED';
      if (extra?.lotId) {
        const lot = await tx.inventoryLot.findUnique({ where: { id: extra.lotId }, select: { id: true, status: true, expiryDate: true, quantity: true, lotNumber: true } });
        if (!lot) throw new NotFoundException('LOT을 찾을 수 없습니다');
        if (!isIn) {
          const expired = lot.expiryDate && lot.expiryDate <= new Date();
          if (!isWriteOff && (lot.status === 'RECALLED' || lot.status === 'EXPIRED' || expired)) {
            const why = lot.status === 'RECALLED' ? '리콜' : '만료';
            void recordGateViolation(this.prisma, this.logger, {
              gateKey: 'inventory.expiryIssueEnforce', severity: mode,
              message: `${why} LOT 출고 시도: ${lot.lotNumber} (${item.name})`, refType: 'LOT', refId: lot.id,
            });
            if (mode !== 'OFF') {
              throw new BadRequestException({ code: 'INVENTORY_LOT_BLOCKED', message: `${why} LOT은 출고할 수 없습니다: ${lot.lotNumber} (${item.name}) — 폐기는 DISPOSAL 타입으로 처리하세요` });
            }
            this.logger.warn(`inventory lot gate OFF — ${why} LOT 출고 허용됨: ${lot.lotNumber}`);
          }
          if (lot.quantity < quantity) throw new BadRequestException(`LOT 잔량 부족: ${lot.lotNumber} (잔량 ${lot.quantity}, 요청 ${quantity})`);
          await tx.inventoryLot.update({
            where: { id: lot.id },
            data: { quantity: { decrement: quantity }, ...(lot.quantity - quantity === 0 ? { status: 'CONSUMED' } : {}) },
          });
        } else {
          await tx.inventoryLot.update({ where: { id: lot.id }, data: { quantity: { increment: quantity }, status: 'ACTIVE' } });
        }
      } else if (!isIn && !isWriteOff) {
        // LOT 미지정 출고 — FEFO 자동 소진(만료/리콜 제외). 폐기는 LOT 지정 권장(미지정 시 LOT 미차감=구동작)
        await this.consumeLotsFefo(tx, itemId, quantity, item.name, mode);
      }
      await tx.inventoryItem.update({ where: { id: itemId }, data: { currentStock: newStock } });
      return tx.inventoryTransaction.create({
        data: {
          itemId, type, quantity, reason, performedBy: userId,
          lotId: extra?.lotId, storageId: extra?.storageId,
          unitCost: extra?.unitCost, totalCost: extra?.unitCost ? extra.unitCost * quantity : undefined,
          department: extra?.department, referenceNumber: extra?.referenceNumber,
        },
      });
    });
    // ERP 재고 변동 통보(아웃박스)
    void this.outbox.enqueue('inventory', 'inventory.changed', `inv:${item.code}:${extra?.referenceNumber ?? ''}:${Date.now()}`, {
      code: item.code, erpItemCode: item.erpItemCode, name: item.name, type, qty: delta, balanceAfter: newStock, ref: extra?.referenceNumber,
    });
    return result;
  }

  // ── ERP 연동 ──
  /** ERP 인바운드 입고 — code 또는 erpItemCode */
  async erpInbound(data: { code?: string; erpItemCode?: string; qty: number; poNo?: string; reason?: string }) {
    if (!data.qty || data.qty <= 0) throw new BadRequestException('qty는 1 이상');
    const item = data.code
      ? await this.prisma.inventoryItem.findUnique({ where: { code: data.code } })
      : await this.prisma.inventoryItem.findFirst({ where: { erpItemCode: data.erpItemCode } });
    if (!item) throw new NotFoundException('매핑된 품목을 찾을 수 없습니다(code/erpItemCode)');
    await this.transact(item.id, 'IN', data.qty, ERP_SYSTEM_USER, data.reason ?? 'ERP 입고', { referenceNumber: data.poNo });
    const updated = await this.prisma.inventoryItem.findUnique({ where: { id: item.id }, select: { code: true, currentStock: true } });
    return { ok: true, code: item.code, stock: updated?.currentStock };
  }

  /** ERP 읽기용 재고 스냅샷 */
  async erpStockSnapshot() {
    const items = await this.prisma.inventoryItem.findMany({ where: { isActive: true }, select: { code: true, erpItemCode: true, name: true, category: true, unit: true, currentStock: true, safetyStock: true } });
    return items.map((i) => ({ ...i, lowStock: i.currentStock <= i.safetyStock }));
  }

  async getTransactions(itemId?: string, limit = 100) {
    const where: Prisma.InventoryTransactionWhereInput = {};
    if (itemId) where.itemId = itemId;
    return this.prisma.inventoryTransaction.findMany({
      where, orderBy: { createdAt: 'desc' }, take: limit,
      include: { item: { select: { code: true, name: true } }, storage: { select: { name: true } } },
    });
  }

  async getLowStockAlerts() {
    // field-to-field 비교: raw query로 DB에서 직접 필터링
    return this.prisma.$queryRaw<{ id: string; code: string; name: string; category: string; unit: string; currentStock: number; safetyStock: number; maxStock: number | null; unitPrice: number | null }[]>`
      SELECT id, code, name, category, unit, current_stock AS "currentStock",
             safety_stock AS "safetyStock", max_stock AS "maxStock", unit_price AS "unitPrice"
      FROM inventory_items
      WHERE is_active = true AND current_stock <= safety_stock
      ORDER BY (safety_stock - current_stock) DESC
    `;
  }

  // ── 보관장소 CRUD ──

  async getStorages() {
    return this.prisma.inventoryStorage.findMany({
      where: { isActive: true }, orderBy: { code: 'asc' },
      include: { children: { where: { isActive: true } }, _count: { select: { lots: true } } },
    });
  }

  async createStorage(data: CreateStorageDto) {
    return this.prisma.inventoryStorage.create({ data: {
      code: data.code, name: data.name, type: data.type, location: data.location,
      parentId: data.parentId || undefined, temperature: data.temperature,
      capacity: data.capacity ? Number(data.capacity) : undefined,
      managerName: data.managerName, notes: data.notes,
    }});
  }

  async updateStorage(id: string, data: UpdateStorageDto) {
    const d: Record<string, string | number | null | undefined> = {};
    for (const f of ['name', 'type', 'location', 'temperature', 'managerName', 'notes'] as const) {
      if (data[f] !== undefined) d[f] = data[f];
    }
    if (data.capacity !== undefined) d.capacity = Number(data.capacity);
    if (data.parentId !== undefined) d.parentId = data.parentId || null;
    return this.prisma.inventoryStorage.update({ where: { id }, data: d });
  }

  async deleteStorage(id: string) {
    return this.prisma.inventoryStorage.update({ where: { id }, data: { isActive: false } });
  }

  // ── 거래처 CRUD ──

  async getSuppliers() {
    return this.prisma.inventorySupplier.findMany({
      where: { isActive: true }, orderBy: { name: 'asc' },
      include: { _count: { select: { itemSuppliers: true, purchaseOrders: true } } },
    });
  }

  async createSupplier(data: CreateSupplierDto) {
    return this.prisma.inventorySupplier.create({ data: {
      code: data.code, erpVendorCode: data.erpVendorCode, name: data.name, businessNumber: data.businessNumber,
      representative: data.representative, contactName: data.contactName,
      contactPhone: data.contactPhone, contactEmail: data.contactEmail,
      address: data.address, paymentTerms: data.paymentTerms,
      contractExpiry: data.contractExpiry ? new Date(data.contractExpiry) : undefined,
      rating: data.rating != null ? String(data.rating) : undefined, notes: data.notes,
    }});
  }

  async getSupplierDetail(id: string) {
    const s = await this.prisma.inventorySupplier.findUnique({
      where: { id },
      include: { itemSuppliers: { include: { item: { select: { code: true, name: true, unit: true } } } } },
    });
    if (!s) throw new NotFoundException('Supplier not found');
    return s;
  }

  async updateSupplier(id: string, data: Partial<CreateSupplierDto>) {
    const d: Prisma.InventorySupplierUpdateInput = {};
    for (const f of ['name', 'businessNumber', 'representative', 'contactName', 'contactPhone', 'contactEmail', 'address', 'paymentTerms', 'notes', 'erpVendorCode'] as const) {
      if (data[f] !== undefined) (d as Record<string, unknown>)[f] = data[f];
    }
    if (data.rating !== undefined) d.rating = String(data.rating);
    if (data.contractExpiry) d.contractExpiry = new Date(data.contractExpiry);
    return this.prisma.inventorySupplier.update({ where: { id }, data: d });
  }

  async addItemSupplier(supplierId: string, data: AddItemSupplierDto) {
    return this.prisma.inventoryItemSupplier.create({ data: {
      itemId: data.itemId, supplierId, supplierItemCode: data.supplierItemCode,
      unitPrice: data.unitPrice ? Number(data.unitPrice) : undefined,
      leadTimeDays: data.leadTimeDays ? Number(data.leadTimeDays) : undefined,
      isPrimary: data.isPrimary ?? false, minOrderQty: data.minOrderQty ? Number(data.minOrderQty) : undefined,
    }});
  }

  // ── LOT/유효기간 ──

  /**
   * 🔴 `status:'ACTIVE'` 고정이라 **폐기 처리한 LOT 은 즉시 화면에서 사라졌다** — 무엇을
   * 언제 폐기했는지 되짚을 경로가 없다. `status` 로 열되 기본은 종전대로 사용 가능분.
   */
  async getLots(filters: { itemId?: string; expiring?: boolean; status?: string }) {
    const where: Prisma.InventoryLotWhereInput = {};
    if (filters.status !== 'ALL') where.status = filters.status ?? 'ACTIVE';
    if (filters.itemId) where.itemId = filters.itemId;
    if (filters.expiring) {
      const d30 = new Date(); d30.setDate(d30.getDate() + 30);
      where.expiryDate = { lte: d30 };
    }
    return this.prisma.inventoryLot.findMany({
      where, orderBy: { expiryDate: 'asc' },
      include: {
        item: { select: { code: true, name: true, unit: true } },
        storage: { select: { name: true } },
      },
    });
  }

  async updateLotStatus(id: string, status: string) {
    return this.prisma.inventoryLot.update({ where: { id }, data: { status } });
  }

  // ── 발주 ──

  async getPurchaseOrders(status?: string, limit = 50) {
    const where: Prisma.PurchaseOrderWhereInput = {};
    if (status) where.status = status;
    return this.prisma.purchaseOrder.findMany({
      where, orderBy: { createdAt: 'desc' }, take: limit,
      include: { supplier: { select: { id: true, code: true, name: true } }, items: { select: { id: true, itemId: true, orderedQty: true, receivedQty: true, unitPrice: true, amount: true } }, _count: { select: { items: true } } },
    });
  }

  async createPurchaseOrder(data: CreatePurchaseOrderDto, userId: string) {
    const items = data.items ?? [];
    const totalAmount = items.reduce((s, i) => s + (Number(i.orderedQty) * Number(i.unitPrice)), 0);

    const pfx = docDatePrefix('PO');
    return withAdvisoryLock(this.prisma, `inventory:doc:${pfx}`, async (tx) => {
      const taken = await tx.purchaseOrder.findMany({ where: { orderNumber: { startsWith: pfx } }, select: { orderNumber: true } });
      return tx.purchaseOrder.create({
        data: {
          orderNumber: nextDailyDocNumber(pfx, taken.map((r) => r.orderNumber)), supplierId: data.supplierId,
          orderDate: new Date(data.orderDate || new Date().toISOString()),
          expectedDate: data.expectedDate ? new Date(data.expectedDate) : undefined,
          totalAmount, notes: data.notes, createdBy: userId,
          items: { create: items.map((i) => ({
            itemId: i.itemId, orderedQty: Number(i.orderedQty),
            unitPrice: Number(i.unitPrice), amount: Number(i.orderedQty) * Number(i.unitPrice),
          }))},
        },
        include: { items: true },
      });
    });
  }

  async getPurchaseOrderDetail(id: string) {
    const po = await this.prisma.purchaseOrder.findUnique({
      where: { id },
      include: { supplier: true, items: { include: { } } },
    });
    if (!po) throw new NotFoundException('PO not found');
    return po;
  }

  async updatePurchaseOrderStatus(id: string, status: string, userId?: string) {
    const d: Record<string, string | Date> = { status };
    if (status === 'APPROVED' && userId) { d.approvedBy = userId; d.approvedAt = new Date(); }
    if (status === 'RECEIVED') d.receivedDate = new Date();
    return this.prisma.purchaseOrder.update({ where: { id }, data: d });
  }

  async receivePurchaseOrder(id: string, items: { poItemId: string; receivedQty: number; lotNumber?: string; expiryDate?: string; storageId?: string }[], userId: string) {
    return this.prisma.$transaction(async (tx) => {
      for (const ri of items) {
        // Update PO item
        const poItem = await tx.purchaseOrderItem.update({
          where: { id: ri.poItemId },
          data: { receivedQty: { increment: ri.receivedQty }, lotNumber: ri.lotNumber, expiryDate: ri.expiryDate ? new Date(ri.expiryDate) : undefined },
        });

        // Create LOT
        if (ri.lotNumber) {
          await tx.inventoryLot.create({ data: {
            itemId: poItem.itemId, lotNumber: ri.lotNumber, quantity: ri.receivedQty,
            expiryDate: ri.expiryDate ? new Date(ri.expiryDate) : undefined,
            storageId: ri.storageId || undefined, unitCost: poItem.unitPrice,
          }});
        }

        // Update stock
        await tx.inventoryItem.update({ where: { id: poItem.itemId }, data: { currentStock: { increment: ri.receivedQty }, lastPurchaseDate: new Date(), lastPurchasePrice: poItem.unitPrice } });

        // Transaction log
        await tx.inventoryTransaction.create({ data: {
          itemId: poItem.itemId, type: 'RECEIVE', quantity: ri.receivedQty,
          performedBy: userId, storageId: ri.storageId || undefined,
          unitCost: poItem.unitPrice, totalCost: poItem.unitPrice * ri.receivedQty,
          referenceNumber: id, reason: `발주입고 LOT:${ri.lotNumber ?? '-'}`,
        }});
      }

      // Check if all items received
      const po = await tx.purchaseOrder.findUnique({ where: { id }, include: { items: true } });
      const allReceived = po!.items.every(i => i.receivedQty >= i.orderedQty);
      await tx.purchaseOrder.update({ where: { id }, data: { status: allReceived ? 'RECEIVED' : 'PARTIAL_RECEIVED', receivedDate: allReceived ? new Date() : undefined } });

      return po;
    });
  }

  // ── 부서 청구/불출 ──

  async getRequests(status?: string, limit = 50) {
    const where: Prisma.InventoryRequestWhereInput = {};
    if (status) where.status = status;
    return this.prisma.inventoryRequest.findMany({
      where, orderBy: { createdAt: 'desc' }, take: limit,
      include: { items: true, _count: { select: { items: true } } },
    });
  }

  async createRequest(data: CreateRequestDto, userId: string) {
    const pfx = docDatePrefix('REQ');
    return withAdvisoryLock(this.prisma, `inventory:doc:${pfx}`, async (tx) => {
      const taken = await tx.inventoryRequest.findMany({ where: { requestNumber: { startsWith: pfx } }, select: { requestNumber: true } });
      return tx.inventoryRequest.create({
        data: {
          requestNumber: nextDailyDocNumber(pfx, taken.map((r) => r.requestNumber)), department: data.department,
          requestedBy: userId, notes: data.notes,
          items: { create: (data.items ?? []).map((i) => ({
            itemId: i.itemId, requestedQty: Number(i.requestedQty), notes: i.notes,
          }))},
        },
        include: { items: true },
      });
    });
  }

  /**
   * 부서 청구 승인. 🔴 (2026-09-15 D1) 종전엔 현재 상태를 보지 않았다 — **이미 불출(ISSUED)된 청구를 다시 승인**하면
   * `issueRequest` 가 다시 통과해 같은 청구로 재고가 두 번 빠졌다(반려·취소된 청구도 되살아났다).
   */
  async approveRequest(id: string, userId: string, approvedItems?: { itemId: string; approvedQty: number }[]) {
    const cur = await this.prisma.inventoryRequest.findUnique({ where: { id }, select: { status: true } });
    if (!cur) throw new NotFoundException('부서 청구를 찾을 수 없습니다');
    if (cur.status !== 'REQUESTED') {
      throw new ConflictException({
        code: 'INVENTORY_REQUEST_NOT_REQUESTED',
        message: '이미 처리된 부서 청구입니다',
        details: { status: cur.status },
      });
    }
    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.inventoryRequest.updateMany({
        where: { id, status: 'REQUESTED' },
        data: { status: 'APPROVED', approvedBy: userId, approvedAt: new Date() },
      });
      if (claimed.count === 0) {
        throw new ConflictException({ code: 'INVENTORY_REQUEST_STATE_CHANGED', message: '다른 처리로 상태가 이미 바뀌었습니다 — 새로 고친 뒤 다시 확인하세요' });
      }
      if (approvedItems) {
        for (const ai of approvedItems) {
          await tx.inventoryRequestItem.updateMany({ where: { requestId: id, itemId: ai.itemId }, data: { approvedQty: ai.approvedQty } });
        }
      }
    });
  }

  async issueRequest(id: string, userId: string) {
    const req = await this.prisma.inventoryRequest.findUnique({ where: { id }, include: { items: true } });
    if (!req || req.status !== 'APPROVED') throw new BadRequestException('Request not approved');
    const mode = await this.expiryGateMode();

    return this.prisma.$transaction(async (tx) => {
      for (const item of req.items) {
        const qty = item.approvedQty ?? item.requestedQty;
        if (qty <= 0) continue;

        // 음수 재고 방지
        const current = await tx.inventoryItem.findUnique({ where: { id: item.itemId }, select: { currentStock: true, name: true } });
        if (!current) throw new BadRequestException(`품목을 찾을 수 없습니다: ${item.itemId}`);
        if (current.currentStock < qty) {
          throw new BadRequestException(`재고 부족: ${current.name} (현재 ${current.currentStock}, 요청 ${qty})`);
        }

        // FEFO LOT 소진 — 만료/리콜 LOT 절대 미소진·lot.quantity 원자 차감(currentStock 발산 방지)
        const lotUses = await this.consumeLotsFefo(tx, item.itemId, qty, current.name, mode);

        // Decrease stock
        await tx.inventoryItem.update({ where: { id: item.itemId }, data: { currentStock: { decrement: qty } } });
        await tx.inventoryRequestItem.update({ where: { id: item.id }, data: { issuedQty: qty } });

        // Transaction log — LOT별 분리 기록(리콜 역추적: 어느 LOT이 어느 부서로 나갔는지)
        const lotTotal = lotUses.reduce((s, u) => s + u.used, 0);
        for (const u of lotUses) {
          await tx.inventoryTransaction.create({ data: {
            itemId: item.itemId, type: 'ISSUE', quantity: u.used, lotId: u.lotId,
            performedBy: userId, department: req.department,
            referenceNumber: req.requestNumber, reason: `부서불출: ${req.department} LOT:${u.lotNumber}`,
          }});
        }
        if (qty - lotTotal > 0) {
          await tx.inventoryTransaction.create({ data: {
            itemId: item.itemId, type: 'ISSUE', quantity: qty - lotTotal,
            performedBy: userId, department: req.department,
            referenceNumber: req.requestNumber, reason: `부서불출: ${req.department} (LOT 미추적분)`,
          }});
        }
      }

      return tx.inventoryRequest.update({ where: { id }, data: { status: 'ISSUED', issuedBy: userId, issuedAt: new Date() } });
    });
  }

  /** 리콜 역추적 — 해당 LOT이 언제·어느 부서로 불출됐는지(불출 tx의 lotId 기록 기반) */
  async getLotTrace(lotId: string) {
    const lot = await this.prisma.inventoryLot.findUnique({
      where: { id: lotId },
      include: { item: { select: { code: true, name: true, unit: true } } },
    });
    if (!lot) throw new NotFoundException('LOT을 찾을 수 없습니다');
    const transactions = await this.prisma.inventoryTransaction.findMany({
      where: { lotId },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return { lot, transactions };
  }

  // ── 자동발주 제안 ──

  async getAutoSuggest() {
    // field-to-field 비교: raw query로 DB에서 직접 필터링
    const items = await this.prisma.$queryRaw<{ itemId: string; code: string; name: string; currentStock: number; reorderPoint: number; reorderQty: number; unitPrice: number | null; supplierName: string | null }[]>`
      SELECT id AS "itemId", code, name, current_stock AS "currentStock",
             reorder_point AS "reorderPoint",
             COALESCE(reorder_qty, safety_stock * 2) AS "reorderQty",
             unit_price AS "unitPrice", supplier_name AS "supplierName"
      FROM inventory_items
      WHERE is_active = true AND reorder_point IS NOT NULL AND current_stock <= reorder_point
      ORDER BY (reorder_point - current_stock) DESC
    `;
    return items;
  }

  // ── 재포장/키트 ──

  async getRepackOrders(status?: string) {
    const where: Prisma.RepackOrderWhereInput = {};
    if (status) where.status = status;
    return this.prisma.repackOrder.findMany({
      where, orderBy: { createdAt: 'desc' }, take: 100,
      include: { _count: { select: { items: true } } },
    });
  }

  async createRepackOrder(data: CreateRepackOrderDto, userId: string) {
    const pfx = docDatePrefix('RPK');
    return withAdvisoryLock(this.prisma, `inventory:doc:${pfx}`, async (tx) => {
      const taken = await tx.repackOrder.findMany({ where: { orderNumber: { startsWith: pfx } }, select: { orderNumber: true } });
      return tx.repackOrder.create({
        data: {
          orderNumber: nextDailyDocNumber(pfx, taken.map((r) => r.orderNumber)), type: data.type, targetItemName: data.targetItemName,
          targetItemId: data.targetItemId || undefined,
          targetQty: Number(data.targetQty), targetUnit: data.targetUnit ?? '',
          targetStorageId: data.targetStorageId || undefined,
          instructions: data.instructions, notes: data.notes, createdBy: userId,
          items: { create: (data.items ?? []).map((i) => ({
            itemId: i.itemId, lotId: i.lotId || undefined, quantity: Number(i.quantity), notes: i.notes,
          }))},
        },
        include: { items: true },
      });
    });
  }

  async getRepackOrderDetail(id: string) {
    const ro = await this.prisma.repackOrder.findUnique({
      where: { id }, include: { items: true },
    });
    if (!ro) throw new NotFoundException('Repack order not found');
    return ro;
  }

  async updateRepackOrderStatus(id: string, status: string, performedBy?: string) {
    const d: Record<string, string | Date> = { status };
    if (performedBy) d.performedBy = performedBy;
    if (status === 'COMPLETED') d.completedAt = new Date();
    return this.prisma.repackOrder.update({ where: { id }, data: d });
  }

  async completeRepackOrder(id: string, userId: string) {
    const ro = await this.prisma.repackOrder.findUnique({ where: { id }, include: { items: true } });
    if (!ro) throw new NotFoundException('Repack order not found');
    const mode = await this.expiryGateMode();

    return this.prisma.$transaction(async (tx) => {
      // Deduct source items — 음수재고 가드 + LOT 원자 차감(지정 LOT은 만료/리콜 차단)
      for (const item of ro.items) {
        const current = await tx.inventoryItem.findUnique({ where: { id: item.itemId }, select: { currentStock: true, name: true } });
        if (!current) throw new BadRequestException(`품목을 찾을 수 없습니다: ${item.itemId}`);
        if (current.currentStock < item.quantity) {
          throw new BadRequestException(`재고 부족(재포장 투입): ${current.name} (현재 ${current.currentStock}, 필요 ${item.quantity})`);
        }
        if (item.lotId) {
          const lot = await tx.inventoryLot.findUnique({ where: { id: item.lotId }, select: { id: true, status: true, expiryDate: true, quantity: true, lotNumber: true } });
          if (lot) {
            const expired = lot.expiryDate && lot.expiryDate <= new Date();
            if ((lot.status === 'RECALLED' || lot.status === 'EXPIRED' || expired) && mode !== 'OFF') {
              throw new BadRequestException({ code: 'INVENTORY_LOT_BLOCKED', message: `${lot.status === 'RECALLED' ? '리콜' : '만료'} LOT은 재포장에 투입할 수 없습니다: ${lot.lotNumber}` });
            }
            if (lot.quantity < item.quantity) throw new BadRequestException(`LOT 잔량 부족: ${lot.lotNumber} (잔량 ${lot.quantity}, 필요 ${item.quantity})`);
            await tx.inventoryLot.update({
              where: { id: lot.id },
              data: { quantity: { decrement: item.quantity }, ...(lot.quantity - item.quantity === 0 ? { status: 'CONSUMED' } : {}) },
            });
          }
        } else {
          await this.consumeLotsFefo(tx, item.itemId, item.quantity, current.name, mode);
        }
        await tx.inventoryItem.update({ where: { id: item.itemId }, data: { currentStock: { decrement: item.quantity } } });
        await tx.inventoryTransaction.create({ data: {
          itemId: item.itemId, type: 'OUT', quantity: item.quantity, lotId: item.lotId ?? undefined,
          performedBy: userId, reason: `재포장 투입: ${ro.orderNumber}`, referenceNumber: ro.orderNumber,
        }});
      }

      // 산출물 입고 — targetItemId 지정 시 자동 입고(기존: 투입만 차감되고 산출물 미입고로 재고 증발)
      if (ro.targetItemId) {
        await tx.inventoryItem.update({ where: { id: ro.targetItemId }, data: { currentStock: { increment: ro.targetQty } } });
        await tx.inventoryTransaction.create({ data: {
          itemId: ro.targetItemId, type: 'IN', quantity: ro.targetQty,
          performedBy: userId, storageId: ro.targetStorageId ?? undefined,
          reason: `재포장 산출: ${ro.orderNumber} (${ro.targetItemName})`, referenceNumber: ro.orderNumber,
        }});
      }

      return tx.repackOrder.update({ where: { id }, data: { status: 'COMPLETED', completedAt: new Date() } });
    });
  }

  // ── QR코드 ──

  async getQrLabels(labelType?: string) {
    const where: Prisma.QrLabelWhereInput = {};
    if (labelType) where.labelType = labelType;
    return this.prisma.qrLabel.findMany({ where, orderBy: { createdAt: 'desc' }, take: 200 });
  }

  async createQrLabel(data: { labelType: string; referenceId: string; referenceName: string; referenceCode?: string; qrData: string }, userId: string) {
    return this.prisma.qrLabel.create({ data: { ...data, createdBy: userId } });
  }

  async createQrLabelsBulk(labels: { labelType: string; referenceId: string; referenceName: string; referenceCode?: string; qrData: string }[], userId: string) {
    return this.prisma.qrLabel.createMany({
      data: labels.map(l => ({ ...l, createdBy: userId })),
    });
  }

  async getQrLabel(id: string) {
    const label = await this.prisma.qrLabel.findUnique({ where: { id } });
    if (!label) throw new NotFoundException('QR label not found');
    return label;
  }

  async markQrPrinted(id: string) {
    return this.prisma.qrLabel.update({ where: { id }, data: { printCount: { increment: 1 }, lastPrintedAt: new Date() } });
  }

  // ── 실사 (Inventory Count) ──

  async createCount(data: { title: string; storageId?: string; category?: string; scheduledDate: string }, userId: string) {
    const where: Prisma.InventoryItemWhereInput = { isActive: true };
    if (data.category) where.category = data.category;
    if (data.storageId) where.defaultStorageId = data.storageId;

    const items = await this.prisma.inventoryItem.findMany({ where, select: { id: true, currentStock: true } });

    const pfx = docDatePrefix('CNT');
    return withAdvisoryLock(this.prisma, `inventory:doc:${pfx}`, async (tx) => {
      const taken = await tx.inventoryCount.findMany({ where: { countNumber: { startsWith: pfx } }, select: { countNumber: true } });
      return tx.inventoryCount.create({
        data: {
          countNumber: nextDailyDocNumber(pfx, taken.map((r) => r.countNumber)), title: data.title,
          storageId: data.storageId || undefined,
          category: data.category || undefined,
          scheduledDate: new Date(data.scheduledDate),
          countedBy: userId,
          items: { create: items.map(i => ({ itemId: i.id, systemQty: i.currentStock })) },
        },
        include: { items: { include: { item: { select: { code: true, name: true, unit: true, category: true } } } } },
      });
    });
  }

  async getCounts(status?: string) {
    const where: Prisma.InventoryCountWhereInput = {};
    if (status) where.status = status;
    return this.prisma.inventoryCount.findMany({
      where, orderBy: { createdAt: 'desc' }, take: 100,
      include: { storage: { select: { name: true } }, _count: { select: { items: true } } },
    });
  }

  async getCountDetail(id: string) {
    const count = await this.prisma.inventoryCount.findUnique({
      where: { id },
      include: {
        storage: { select: { name: true } },
        items: { include: { item: { select: { id: true, code: true, name: true, unit: true, category: true } } } },
      },
    });
    if (!count) throw new NotFoundException('Inventory count not found');
    return count;
  }

  async updateCountItems(id: string, items: { itemId: string; countedQty: number; reason?: string }[]) {
    const count = await this.prisma.inventoryCount.findUnique({ where: { id } });
    if (!count) throw new NotFoundException('Inventory count not found');
    if (count.status === 'COMPLETED') throw new BadRequestException('Already completed');

    return this.prisma.$transaction(async (tx) => {
      for (const item of items) {
        const ci = await tx.inventoryCountItem.findFirst({ where: { countId: id, itemId: item.itemId } });
        if (!ci) continue;
        const diff = item.countedQty - ci.systemQty;
        await tx.inventoryCountItem.update({
          where: { id: ci.id },
          data: { countedQty: item.countedQty, difference: diff, reason: item.reason || undefined },
        });
      }

      // 상태를 IN_PROGRESS로 변경
      if (count.status === 'DRAFT') {
        await tx.inventoryCount.update({ where: { id }, data: { status: 'IN_PROGRESS' } });
      }

      return tx.inventoryCount.findUnique({
        where: { id },
        include: { items: { include: { item: { select: { code: true, name: true, unit: true } } } } },
      });
    });
  }

  async completeCount(id: string, userId: string) {
    const count = await this.prisma.inventoryCount.findUnique({
      where: { id }, include: { items: true },
    });
    if (!count) throw new NotFoundException('Inventory count not found');
    if (count.status === 'COMPLETED') throw new BadRequestException('Already completed');

    return this.prisma.$transaction(async (tx) => {
      for (const item of count.items) {
        if (item.countedQty === null || item.difference === null || item.difference === 0) continue;

        // 재고 조정
        await tx.inventoryItem.update({
          where: { id: item.itemId },
          data: { currentStock: { increment: item.difference } },
        });

        // ADJUSTMENT 트랜잭션 생성
        await tx.inventoryTransaction.create({
          data: {
            itemId: item.itemId,
            type: 'ADJUST',
            quantity: Math.abs(item.difference),
            performedBy: userId,
            reason: `실사조정 (${count.countNumber}): ${item.reason ?? '차이 조정'}`,
            referenceNumber: count.countNumber,
          },
        });

        await tx.inventoryCountItem.update({ where: { id: item.id }, data: { isAdjusted: true } });
      }

      return tx.inventoryCount.update({
        where: { id },
        data: { status: 'COMPLETED', completedDate: new Date(), approvedBy: userId },
      });
    });
  }

  // ── 리포트 ──

  async getReportSummary(filters: { category?: string }) {
    const where: Prisma.InventoryItemWhereInput = { isActive: true };
    if (filters.category) where.category = filters.category;

    const items = await this.prisma.inventoryItem.findMany({ where, select: { id: true, currentStock: true, safetyStock: true, maxStock: true, unitPrice: true } });

    const totalItems = items.length;
    const totalValue = items.reduce((s, i) => s + (i.currentStock * (i.unitPrice ?? 0)), 0);
    const lowStockItems = items.filter(i => i.currentStock <= i.safetyStock).length;
    const overStockItems = items.filter(i => i.maxStock != null && i.currentStock > i.maxStock).length;

    return { totalItems, totalValue, lowStockItems, overStockItems };
  }

  async getAbcAnalysis(filters: { category?: string }) {
    const where: Prisma.InventoryItemWhereInput = { isActive: true };
    if (filters.category) where.category = filters.category;

    const items = await this.prisma.inventoryItem.findMany({
      where, select: { id: true, code: true, name: true, category: true, currentStock: true, unitPrice: true },
    });

    // 금액 기준 정렬
    const valued = items.map(i => ({ ...i, value: i.currentStock * (i.unitPrice ?? 0) })).sort((a, b) => b.value - a.value);
    const totalValue = valued.reduce((s, i) => s + i.value, 0);

    let cumulative = 0;
    const classified = valued.map(i => {
      cumulative += i.value;
      const pct = totalValue > 0 ? (cumulative / totalValue) * 100 : 0;
      const grade = pct <= 80 ? 'A' : pct <= 95 ? 'B' : 'C';
      return { ...i, cumulativePct: Math.round(pct * 10) / 10, grade };
    });

    // 등급별 요약
    const summary = ['A', 'B', 'C'].map(grade => {
      const gradeItems = classified.filter(i => i.grade === grade);
      const gradeValue = gradeItems.reduce((s, i) => s + i.value, 0);
      return {
        grade,
        itemCount: gradeItems.length,
        totalValue: gradeValue,
        valuePercent: totalValue > 0 ? Math.round((gradeValue / totalValue) * 1000) / 10 : 0,
      };
    });

    return { summary, items: classified };
  }

  async getTurnoverReport(filters: { dateFrom?: string; dateTo?: string; category?: string }) {
    const from = filters.dateFrom ? new Date(filters.dateFrom) : new Date(new Date().setMonth(new Date().getMonth() - 3));
    const to = filters.dateTo ? new Date(filters.dateTo) : new Date();

    const itemWhere: Prisma.InventoryItemWhereInput = { isActive: true };
    if (filters.category) itemWhere.category = filters.category;

    const items = await this.prisma.inventoryItem.findMany({
      where: itemWhere,
      select: { id: true, code: true, name: true, category: true, currentStock: true, unitPrice: true },
    });

    const txs = await this.prisma.inventoryTransaction.findMany({
      where: { createdAt: { gte: from, lte: to }, itemId: { in: items.map(i => i.id) } },
      select: { itemId: true, type: true, quantity: true },
    });

    const txMap = new Map<string, { inQty: number; outQty: number }>();
    for (const tx of txs) {
      const entry = txMap.get(tx.itemId) ?? { inQty: 0, outQty: 0 };
      const inTypes = ['IN', 'RETURN', 'RECEIVE'];
      if (inTypes.includes(tx.type)) entry.inQty += tx.quantity;
      else entry.outQty += tx.quantity;
      txMap.set(tx.itemId, entry);
    }

    const result = items.map(i => {
      const tx = txMap.get(i.id) ?? { inQty: 0, outQty: 0 };
      const avgStock = i.currentStock; // 간이: 현 재고 사용
      const turnover = avgStock > 0 ? Math.round((tx.outQty / avgStock) * 100) / 100 : 0;
      return { ...i, inQty: tx.inQty, outQty: tx.outQty, avgStock, turnover };
    }).sort((a, b) => b.turnover - a.turnover);

    return { period: { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) }, items: result };
  }

  async getExpiryReport(filters: { category?: string }) {
    const now = new Date();
    const d30 = new Date(now); d30.setDate(d30.getDate() + 30);
    const d60 = new Date(now); d60.setDate(d60.getDate() + 60);
    const d90 = new Date(now); d90.setDate(d90.getDate() + 90);

    const where: Prisma.InventoryLotWhereInput = { status: 'ACTIVE', expiryDate: { lte: d90 } };
    if (filters.category) {
      where.item = { category: filters.category };
    }

    const lots = await this.prisma.inventoryLot.findMany({
      where, orderBy: { expiryDate: 'asc' },
      include: { item: { select: { code: true, name: true, category: true, unit: true } }, storage: { select: { name: true } } },
    });

    const expired = lots.filter(l => l.expiryDate && l.expiryDate <= now);
    const within30 = lots.filter(l => l.expiryDate && l.expiryDate > now && l.expiryDate <= d30);
    const within60 = lots.filter(l => l.expiryDate && l.expiryDate > d30 && l.expiryDate <= d60);
    const within90 = lots.filter(l => l.expiryDate && l.expiryDate > d60 && l.expiryDate <= d90);

    return {
      summary: { expired: expired.length, within30: within30.length, within60: within60.length, within90: within90.length },
      lots: lots.map(l => ({
        ...l,
        daysRemaining: l.expiryDate ? Math.ceil((l.expiryDate.getTime() - now.getTime()) / 86400000) : null,
      })),
    };
  }

  async getMovementReport(filters: { dateFrom?: string; dateTo?: string; category?: string }) {
    const from = filters.dateFrom ? new Date(filters.dateFrom) : new Date(new Date().setMonth(new Date().getMonth() - 1));
    const to = filters.dateTo ? new Date(filters.dateTo) : new Date();

    const txWhere: Prisma.InventoryTransactionWhereInput = { createdAt: { gte: from, lte: to } };

    const txs = await this.prisma.inventoryTransaction.findMany({
      where: txWhere, orderBy: { createdAt: 'desc' },
      include: { item: { select: { id: true, code: true, name: true, category: true, unit: true } } },
    });

    // 카테고리 필터 (JS 레벨)
    const filtered = filters.category ? txs.filter(t => t.item?.category === filters.category) : txs;

    // 품목별 그룹핑
    const groupMap = new Map<string, { item: typeof filtered[number]['item']; inQty: number; outQty: number; adjustQty: number; txCount: number }>();
    for (const tx of filtered) {
      const key = tx.itemId;
      const entry = groupMap.get(key) ?? { item: tx.item, inQty: 0, outQty: 0, adjustQty: 0, txCount: 0 };
      entry.txCount++;
      const inTypes = ['IN', 'RETURN', 'RECEIVE'];
      if (tx.type === 'ADJUST') entry.adjustQty += tx.quantity;
      else if (inTypes.includes(tx.type)) entry.inQty += tx.quantity;
      else entry.outQty += tx.quantity;
      groupMap.set(key, entry);
    }

    return {
      period: { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) },
      items: Array.from(groupMap.values()).sort((a, b) => b.txCount - a.txCount),
    };
  }
}
