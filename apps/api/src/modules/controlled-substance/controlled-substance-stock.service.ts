import { Injectable, NotFoundException, BadRequestException, ConflictException, Optional, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ConfigRuntimeService } from '../config/config-runtime.service';
import { gateMode } from '../../common/gate-mode';

type TxnType = 'RECEIPT' | 'ISSUE' | 'RETURN' | 'WASTE' | 'ADJUST' | 'COUNT';

/**
 * 마약류 영속재고(수불부) — 마약 금고 장부재고 + 전 이동 감사 + 실사 대사(유용 탐지).
 * 모든 이동은 SELECT..FOR UPDATE 행잠금으로 직렬화해 read-modify-write의 lost-update를 방지한다.
 */
@Injectable()
export class ControlledSubstanceStockService {
  private readonly logger = new Logger(ControlledSubstanceStockService.name);
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly config?: ConfigRuntimeService,
    @Optional() private readonly events?: EventEmitter2,
  ) {}

  async getStocks(filters: { deaSchedule?: string; location?: string } = {}) {
    const where: Prisma.ControlledSubstanceStockWhereInput = {};
    if (filters.deaSchedule) where.deaSchedule = filters.deaSchedule;
    if (filters.location) where.location = filters.location;
    return this.prisma.controlledSubstanceStock.findMany({ where, orderBy: [{ deaSchedule: 'asc' }, { drugName: 'asc' }] });
  }

  /**
   * 수불 이력 — 수행자·증인은 uuid 컬럼(관계 없음)이라 배치 조회로 이름을 채운다.
   * 🔴 이름 없이 uuid 만 보이면 화면이 "누가 만졌는지"를 말하지 못한다.
   */
  async getLedger(stockId: string) {
    const stock = await this.prisma.controlledSubstanceStock.findUnique({ where: { id: stockId } });
    if (!stock) throw new NotFoundException('재고 항목을 찾을 수 없습니다');
    const txns = await this.prisma.controlledSubstanceStockTxn.findMany({
      where: { stockId }, orderBy: { occurredAt: 'desc' }, take: 500,
    });
    return { stock, txns: await this.withActors(txns) };
  }

  /** 실사-장부 불일치(유용 의심) 이력 — 약품·수행자·증인을 함께 준다(마약류관리법상 알려야 할 사실) */
  async getDiscrepancies() {
    const txns = await this.prisma.controlledSubstanceStockTxn.findMany({
      where: { type: 'COUNT', discrepancy: { not: 0 } },
      orderBy: { occurredAt: 'desc' }, take: 200,
      include: { stock: { select: { id: true, drugName: true, deaSchedule: true, location: true, unit: true } } },
    });
    return this.withActors(txns);
  }

  /** performedBy/witnessedBy(uuid) → 성명 */
  private async withActors<T extends { performedBy: string; witnessedBy?: string | null }>(txns: T[]) {
    const ids = new Set<string>();
    for (const t of txns) { if (t.performedBy) ids.add(t.performedBy); if (t.witnessedBy) ids.add(t.witnessedBy); }
    const users = ids.size
      ? await this.prisma.user.findMany({ where: { id: { in: [...ids] } }, select: { id: true, familyName: true, givenName: true, role: true } })
      : [];
    const m = new Map(users.map((u) => [u.id, { id: u.id, familyName: u.familyName, givenName: u.givenName, role: String(u.role) }]));
    return txns.map((t) => ({
      ...t,
      performer: m.get(t.performedBy) ?? null,
      witness: t.witnessedBy ? m.get(t.witnessedBy) ?? null : null,
    }));
  }

  /** 입고 — 신규 약품이면 재고 항목 생성 */
  async receive(data: { drugCode: string; drugName: string; deaSchedule: string; unit: string; location?: string; quantity: number; reason?: string }, by: string) {
    const location = data.location ?? 'PHARMACY';
    const stock = await this.prisma.controlledSubstanceStock.upsert({
      where: { drugCode_location: { drugCode: data.drugCode, location } },
      create: { drugCode: data.drugCode, drugName: data.drugName, deaSchedule: data.deaSchedule, unit: data.unit, location, balance: new Prisma.Decimal(0) },
      update: {},
    });
    return this.move(stock.id, 'RECEIPT', new Prisma.Decimal(data.quantity), { performedBy: by, reason: data.reason });
  }

  async issue(stockId: string, quantity: number, by: string, opts: { reason?: string; refId?: string } = {}) {
    return this.move(stockId, 'ISSUE', new Prisma.Decimal(quantity).negated(), { performedBy: by, reason: opts.reason, refType: opts.refId ? 'CS_LOG' : undefined, refId: opts.refId });
  }

  /**
   * 약품코드+장소로 재고를 찾아 불출(조제 연동용). 해당 재고 미등록 시 null(불출 흐름 비차단).
   * 조제는 물리 불출이 이미 발생했으므로 장부는 반드시 반영(force) — 부족이면 음수+유용경보로 표면화하고
   * BLOCK 예외로 삼켜 장부가 물리보다 높아지는(은폐) 것을 막는다.
   */
  async issueByDrug(drugCode: string, location: string, quantity: number, by: string, refId?: string) {
    if (!drugCode) return null;
    const stock = await this.prisma.controlledSubstanceStock.findUnique({
      where: { drugCode_location: { drugCode, location } },
    });
    if (!stock) return null;
    return this.move(stock.id, 'ISSUE', new Prisma.Decimal(quantity).negated(), {
      performedBy: by, reason: '조제 불출(자동연동)', refType: 'CS_LOG', refId, force: true,
    });
  }

  async returnStock(stockId: string, quantity: number, by: string, opts: { reason?: string; refId?: string } = {}) {
    return this.move(stockId, 'RETURN', new Prisma.Decimal(quantity), { performedBy: by, reason: opts.reason, refId: opts.refId });
  }

  async waste(stockId: string, quantity: number, by: string, opts: { reason?: string; witnessedBy?: string } = {}) {
    // 마약 폐기는 증인 필수(≠수행자).
    if (!opts.witnessedBy) throw new BadRequestException('마약류 폐기에는 증인이 필요합니다');
    if (opts.witnessedBy === by) throw new BadRequestException('폐기 증인은 수행자와 달라야 합니다');
    return this.move(stockId, 'WASTE', new Prisma.Decimal(quantity).negated(), { performedBy: by, reason: opts.reason, witnessedBy: opts.witnessedBy });
  }

  async adjust(stockId: string, delta: number, reason: string, by: string, witnessedBy?: string) {
    // 조정은 유용 위험이 가장 큰 조작 — 독립 증인 필수(≠수행자).
    if (!witnessedBy) throw new BadRequestException('재고 조정에는 증인이 필요합니다(유용 방지)');
    if (witnessedBy === by) throw new BadRequestException('조정 증인은 수행자와 달라야 합니다');
    return this.move(stockId, 'ADJUST', new Prisma.Decimal(delta), { performedBy: by, reason, witnessedBy });
  }

  /** 실사 대사 — 물리 재고 입력 → 장부와 차이 기록, 차이 발생 시 증인 필수 + 유용 경보 후 장부를 물리값으로 확정 */
  async count(stockId: string, countedQty: number, by: string, opts: { witnessedBy?: string; reason?: string } = {}) {
    const counted = new Prisma.Decimal(countedQty);
    const res = await this.prisma.$transaction(async (tx) => {
      // 실사도 동시 이동과의 경쟁을 막기 위해 행잠금 후 장부를 읽는다.
      await tx.$queryRaw`SELECT id FROM controlled_substance_stocks WHERE id = ${stockId}::uuid FOR UPDATE`;
      const stock = await tx.controlledSubstanceStock.findUnique({ where: { id: stockId } });
      if (!stock) throw new NotFoundException('재고 항목을 찾을 수 없습니다');
      const before = stock.balance;
      const discrepancy = counted.minus(before);
      const mismatch = !discrepancy.isZero();
      if (mismatch && !opts.witnessedBy) {
        throw new BadRequestException('실사 불일치 시 증인이 필요합니다(유용 확인)');
      }
      if (mismatch && opts.witnessedBy === by) {
        throw new BadRequestException('실사 증인은 수행자와 달라야 합니다');
      }
      await tx.controlledSubstanceStock.update({
        where: { id: stockId },
        data: { balance: counted, lastCountedAt: new Date() },
      });
      const txn = await tx.controlledSubstanceStockTxn.create({
        data: {
          stockId, type: 'COUNT', quantity: discrepancy, balanceBefore: before, balanceAfter: counted,
          reason: opts.reason ?? (mismatch ? '실사 불일치 보정' : '실사 일치'),
          performedBy: by, witnessedBy: opts.witnessedBy ?? null, discrepancy,
        },
      });
      return { stock, before, txn, discrepancy, mismatch };
    });
    // 유용 의심 경보는 트랜잭션 커밋 후 발행(롤백 시 오경보·리스너 미커밋 조회 방지).
    if (res.mismatch) {
      this.events?.emit('controlled.discrepancy', {
        stockId, drugName: res.stock.drugName, deaSchedule: res.stock.deaSchedule,
        location: res.stock.location, bookBalance: res.before.toString(), countedQty: counted.toString(),
        discrepancy: res.discrepancy.toString(), performedBy: by, witnessedBy: opts.witnessedBy,
      });
    }
    return { stock: { ...res.stock, balance: counted }, txn: res.txn, discrepancy: res.discrepancy.toNumber(), mismatch: res.mismatch };
  }

  /**
   * 잔량 이동 원자 처리 — 행잠금으로 직렬화(lost-update 방지)·부족분(BLOCK) 차단·전후 잔량 감사.
   * force=true(조제 연동)면 BLOCK을 우회해 반드시 반영하고, 음수 도달 시 유용 경보를 낸다.
   */
  private async move(
    stockId: string, type: TxnType, delta: Prisma.Decimal,
    opts: { performedBy: string; reason?: string; witnessedBy?: string; refType?: string; refId?: string; force?: boolean },
  ) {
    const res = await this.prisma.$transaction(async (tx) => {
      // ⚠ 행잠금 — 동시 이동을 직렬화하지 않으면 read-modify-write가 서로 덮어써(lost-update)
      // 잔량이 어긋나고 BLOCK 게이트가 우회됨(마약 초과불출 은폐). FOR UPDATE로 순차화.
      await tx.$queryRaw`SELECT id FROM controlled_substance_stocks WHERE id = ${stockId}::uuid FOR UPDATE`;
      const stock = await tx.controlledSubstanceStock.findUnique({ where: { id: stockId } });
      if (!stock) throw new NotFoundException('재고 항목을 찾을 수 없습니다');
      const before = stock.balance;
      const after = before.plus(delta);
      const wentNegative = after.lessThan(0);
      if (wentNegative && !opts.force) {
        const gate = gateMode(await this.config?.get('controlled.stockEnforce'));
        if (gate === 'BLOCK') {
          throw new ConflictException(`재고 부족: 장부 잔량 ${before.toString()} < 요청 ${delta.abs().toString()} (${stock.drugName})`);
        }
        // WARN/OFF: 아래에서 음수를 기록하되, 커밋 후 경보로 신호(과거엔 무신호라 OFF와 동일했음).
      }
      await tx.controlledSubstanceStock.update({ where: { id: stockId }, data: { balance: after } });
      const txn = await tx.controlledSubstanceStockTxn.create({
        data: {
          stockId, type, quantity: delta, balanceBefore: before, balanceAfter: after,
          reason: opts.reason ?? null, performedBy: opts.performedBy,
          witnessedBy: opts.witnessedBy ?? null, refType: opts.refType ?? null, refId: opts.refId ?? null,
        },
      });
      return { stock, before, after, txn, wentNegative };
    });
    // 음수 잔량(부족 초과·강제불출) 도달 시 로그+유용 경보 — 트랜잭션 밖. WARN/OFF/force 모두 신호.
    if (res.wentNegative) {
      this.logger.warn(`마약재고 음수 도달: ${res.stock.drugName} → ${res.after.toString()} (${type})`);
      this.events?.emit('controlled.discrepancy', {
        stockId, drugName: res.stock.drugName, deaSchedule: res.stock.deaSchedule, location: res.stock.location,
        bookBalance: res.before.toString(), countedQty: res.after.toString(), discrepancy: res.after.toString(),
        performedBy: opts.performedBy, reason: `${type} 음수 잔량(부족 초과)`,
      });
    }
    return { stock: { ...res.stock, balance: res.after }, txn: res.txn };
  }
}
