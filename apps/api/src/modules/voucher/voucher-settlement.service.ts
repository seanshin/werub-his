import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { VoucherPolicyService } from './voucher-policy.service';
import { VoucherLedgerService } from './voucher-ledger.service';
import { VoucherBillingService } from './voucher-billing.service';
import { VoucherFxService } from './voucher-fx.service';
import { VOUCHER_ERROR } from './voucher-legal.constants';
import { GenerateSettlementDto, RefundVoucherDto, ErpSettlementCallbackDto } from './dto/settlement.dto';

@Injectable()
export class VoucherSettlementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: VoucherPolicyService,
    private readonly ledger: VoucherLedgerService,
    private readonly billing: VoucherBillingService,
    private readonly fx: VoucherFxService,
  ) {}

  /** 환불 + 딜러 수수료 claw-back(§14.1 #6/#9, §14.5). SOLD/ACTIVE → REFUNDED. */
  async refund(serial: string, dto: RefundVoucherDto, actorId: string) {
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${serial}))`;
      const v = await tx.checkupVoucher.findUnique({ where: { serial } });
      if (!v) throw new NotFoundException({ code: VOUCHER_ERROR.NOT_FOUND, message: '검진권을 찾을 수 없습니다' });
      if (!['SOLD', 'ACTIVE'].includes(v.status))
        throw new BadRequestException({ code: VOUCHER_ERROR.INVALID_STATE, message: `환불 불가 상태: ${v.status}` });

      // 잔액 환불(L5: ACTIVE는 잔액, SOLD는 액면 전액)
      const refundAmount = v.status === 'ACTIVE' ? v.balance : v.faceValue;
      // 수수료 claw-back: 해당 검진권 판매기록의 수수료 회수
      const sale = await tx.voucherSale.findFirst({ where: { voucherId: v.id }, orderBy: { soldAt: 'desc' } });
      const clawbackAmount = sale?.commissionAmount ?? 0;

      const head = await this.ledger.append(tx, {
        voucherId: v.id, serial, type: 'REFUND', prevHash: v.headHash,
        actorType: 'ADMIN', actorId, payload: { reason: dto.reason, refundAmount, clawbackAmount, saleId: sale?.id },
      });
      await tx.checkupVoucher.update({ where: { serial }, data: { status: 'REFUNDED', balance: 0, headHash: head } });
      const ref = await tx.voucherRefund.create({
        data: { voucherId: v.id, serial, reason: dto.reason, refundAmount, clawbackAmount, saleId: sale?.id, distributorId: sale?.distributorId ?? null, refundedBy: actorId },
      });
      return { serial, status: 'REFUNDED', refundAmount, clawbackAmount, refundId: ref.id, distributorId: sale?.distributorId ?? null, currency: sale?.currency ?? null };
    });
    // 자금흐름(§14.5): 소비자 환급 + 딜러 수수료 회수 — 커밋 후 emit(H-1: 롤백 시 유령 ERP 라인 차단·outbox 별도 커넥션)
    // 외화 딜러 라인은 fxRate·currency 동봉(ERP 외화계좌 환산·라우팅 — 없으면 DEAD)
    const fxf = result.currency && result.currency.toUpperCase() !== 'KRW'
      ? await this.fx.getKrwRate(result.currency).then((f) => ({ fxRate: f.rate, fxRateSource: f.source }))
      : {};
    this.billing.emit('refund', result.refundId, { serial, refundAmount: result.refundAmount, distributorId: result.distributorId ?? undefined, currency: result.currency ?? undefined, ...fxf });
    if (result.clawbackAmount > 0 && result.distributorId)
      this.billing.emit('commission', `claw:${result.refundId}`, { serial, commissionAmount: -result.clawbackAmount, distributorId: result.distributorId, currency: result.currency ?? undefined, clawback: true, ...fxf });
    return { serial: result.serial, status: result.status, refundAmount: result.refundAmount, clawbackAmount: result.clawbackAmount, refundId: result.refundId };
  }

  /** 딜러 기간 정산 — gross − commission − refund clawback = netPayable. */
  async generate(dto: GenerateSettlementDto, createdBy: string) {
    const dealer = await this.prisma.distributor.findUnique({ where: { id: dto.distributorId } });
    if (!dealer) throw new NotFoundException('딜러를 찾을 수 없습니다');
    const start = new Date(`${dto.periodStart}T00:00:00.000Z`);
    const end = new Date(`${dto.periodEnd}T23:59:59.999Z`); // 종료일 전체 포함(자정 파싱 시 당일 거래 누락 방지)

    // 환율 스냅샷(DB-2): 정산통화→KRW. BOK 기준환율(키설정) 또는 시뮬레이션. tx 밖(외부 호출).
    const fx = await this.fx.getKrwRate(dealer.currency);

    const settlement = await this.prisma.$transaction(async (tx) => {
      // 이중 정산 방지(C-2): 딜러+기간 단위 직렬화 후 기존 정산 존재 검사
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`settle:${dto.distributorId}:${dto.periodStart}:${dto.periodEnd}`}))`;
      const existing = await tx.voucherSettlement.findFirst({ where: { distributorId: dto.distributorId, periodStart: start, periodEnd: end } });
      if (existing) throw new BadRequestException({ code: 'SETTLEMENT_EXISTS', message: `해당 기간 정산이 이미 존재합니다(${existing.status})` });

      const sales = await tx.voucherSale.findMany({ where: { distributorId: dto.distributorId, soldAt: { gte: start, lte: end } } });
      const grossSales = sales.reduce((s, x) => s + x.salePrice, 0);
      const commissionTotal = sales.reduce((s, x) => s + x.commissionAmount, 0);
      // claw-back 이월(H-3): 기간이 아닌 "미정산(settledAt=null)" 환불 전부 집계 → 정산 확정 후 발생한 환불도 차기 정산에서 회수
      const pendingRefunds = await tx.voucherRefund.findMany({
        where: { distributorId: dto.distributorId, settledAt: null, clawbackAmount: { gt: 0 } },
      });
      const refundClawback = pendingRefunds.reduce((s, r) => s + r.clawbackAmount, 0);
      const netPayable = grossSales - commissionTotal - refundClawback;

      const created = await tx.voucherSettlement.create({
        data: {
          distributorId: dto.distributorId, periodStart: start, periodEnd: end,
          grossSales, commissionTotal, refundClawback, netPayable, currency: dealer.currency,
          fxRate: fx.rate, fxRateSource: fx.source, status: 'DRAFT', createdBy,
        },
      });
      // 집계한 환불을 이 정산에 귀속(이중 회수 방지)
      if (pendingRefunds.length)
        await tx.voucherRefund.updateMany({
          where: { id: { in: pendingRefunds.map((r) => r.id) } },
          data: { settledAt: new Date(), settlementId: created.id },
        });
      return created;
    });
    // DRAFT 산출 시점에는 ERP 미통지 — 4-eyes 확정(confirm) 후에만 voucher.settled emit(아래 confirm).
    return settlement;
  }

  async confirm(id: string, confirmedBy: string) {
    const s = await this.prisma.voucherSettlement.findUnique({ where: { id } });
    if (!s) throw new NotFoundException('정산을 찾을 수 없습니다');
    if (s.status !== 'DRAFT') throw new BadRequestException('이미 확정/지급됨');
    // 4-eyes(H-2): 산출자와 확정자가 동일인이면 거부. 산출자 미상(null)이면 검증 불가 → 방어적 거부(L-1).
    if (!s.createdBy || s.createdBy === confirmedBy)
      throw new BadRequestException({ code: 'FOUR_EYES_REQUIRED', message: '정산 산출자와 다른 담당자가 확정해야 합니다' });
    // 원자적 확정(동시 2요청 시 1건만 성공)
    const res = await this.prisma.voucherSettlement.updateMany({
      where: { id, status: 'DRAFT' },
      data: { status: 'CONFIRMED', confirmedBy, confirmedAt: new Date() },
    });
    if (res.count !== 1) throw new BadRequestException('이미 확정/지급됨');
    const confirmed = await this.prisma.voucherSettlement.findUnique({ where: { id } });
    // 4-eyes 확정 후에만 ERP 통지(voucher.settled) — 미확정 정산은 ERP가 부킹/지급 못 하도록 게이트.
    const dealer = await this.prisma.distributor.findUnique({ where: { id: s.distributorId } });
    this.billing.emit('settlement', s.id, {
      distributorId: s.distributorId, dealerType: dealer?.dealerType, dealerName: dealer?.name,
      grossSales: s.grossSales, commissionTotal: s.commissionTotal, refundClawback: s.refundClawback,
      netPayable: s.netPayable, currency: s.currency,
      // DB-2 환율 스냅샷: 정산통화→KRW 환산용(BOK/SIMULATION 소스 투명)
      fxRate: s.fxRate, fxRateSource: s.fxRateSource, baseCurrency: 'KRW',
      netPayableKrw: s.fxRate ? Math.round(s.netPayable * s.fxRate) : s.netPayable,
    });
    return confirmed;
  }

  /**
   * ERP→HIS 정산 지급 회신(settlement.paid 콜백·B3/DB-4) — 멱등·상태가드.
   * settlementId 우선, 없으면 distributorId+period(YYYY-MM)로 식별.
   */
  async applyPaymentCallback(dto: ErpSettlementCallbackDto) {
    let settlement = dto.settlementId
      ? await this.prisma.voucherSettlement.findUnique({ where: { id: dto.settlementId } })
      : null;
    if (!settlement && dto.distributorId && dto.period) {
      const [y, m] = dto.period.split('-');
      const start = new Date(Date.UTC(Number(y), Number(m) - 1, 1));
      const end = new Date(Date.UTC(Number(y), Number(m), 1));
      settlement = await this.prisma.voucherSettlement.findFirst({
        where: { distributorId: dto.distributorId, periodStart: { gte: start, lt: end } },
        orderBy: { createdAt: 'desc' },
      });
    }
    if (!settlement) throw new NotFoundException({ code: 'SETTLEMENT_NOT_FOUND', message: '정산을 찾을 수 없습니다' });

    // 멱등: 동일 event_id 재전송 또는 이미 PAID → 무시(중복 반영 금지)
    if (settlement.paidCallbackEventId === dto.event_id || settlement.status === 'PAID')
      return { received: true, idempotent: true, settlementId: settlement.id, status: settlement.status };
    // 상태가드: DRAFT/CONFIRMED/PARTIAL → PAID/PARTIAL만. 역전이 금지.
    if (!['DRAFT', 'CONFIRMED', 'PARTIAL'].includes(settlement.status))
      throw new BadRequestException({ code: VOUCHER_ERROR.INVALID_STATE, message: `지급 반영 불가 상태: ${settlement.status}` });

    const res = await this.prisma.voucherSettlement.updateMany({
      where: { id: settlement.id, status: { in: ['DRAFT', 'CONFIRMED', 'PARTIAL'] } },
      data: {
        status: dto.status, paidAt: new Date(dto.paidAt), erpVoucherRef: dto.erpVoucherRef,
        amountPaidKrw: dto.amountPaidKrw, withholdingKrw: dto.withholdingKrw ?? null,
        paidCallbackEventId: dto.event_id, fxRate: dto.fxRateApplied ?? settlement.fxRate,
      },
    });
    if (res.count !== 1) return { received: true, idempotent: true, settlementId: settlement.id };
    return { received: true, settlementId: settlement.id, status: dto.status };
  }

  async list(distributorId?: string) {
    return this.prisma.voucherSettlement.findMany({ where: distributorId ? { distributorId } : undefined, orderBy: { createdAt: 'desc' }, take: 100 });
  }

  /** 딜러 본인 정산 조회(스코프) */
  async listForDealer(distributorId: string) {
    return this.prisma.voucherSettlement.findMany({ where: { distributorId }, orderBy: { createdAt: 'desc' }, take: 50 });
  }

  /** 관리자 대시보드 — 발행/유통/사용/환불/앵커 집계 */
  async dashboard() {
    const [byStatus, salesAgg, refundAgg, batches, anchors, dealers, dealersByType] = await Promise.all([
      this.prisma.checkupVoucher.groupBy({ by: ['status'], _count: true, _sum: { faceValue: true } }),
      this.prisma.voucherSale.aggregate({ _count: true, _sum: { salePrice: true, commissionAmount: true } }),
      this.prisma.voucherRefund.aggregate({ _count: true, _sum: { refundAmount: true, clawbackAmount: true } }),
      this.prisma.voucherBatch.count(),
      this.prisma.blockchainAnchor.count({ where: { anchorType: 'CHECKUP_VOUCHER' } }),
      this.prisma.distributor.groupBy({ by: ['status'], _count: true }),
      this.prisma.distributor.groupBy({ by: ['dealerType'], _count: true }),
    ]);
    return {
      vouchers: byStatus.reduce((a, c) => ({ ...a, [c.status]: { count: c._count, faceValue: c._sum.faceValue ?? 0 } }), {} as Record<string, { count: number; faceValue: number }>),
      sales: { count: salesAgg._count, gross: salesAgg._sum.salePrice ?? 0, commission: salesAgg._sum.commissionAmount ?? 0 },
      refunds: { count: refundAgg._count, amount: refundAgg._sum.refundAmount ?? 0, clawback: refundAgg._sum.clawbackAmount ?? 0 },
      batches, anchors,
      dealers: dealers.reduce((a, c) => ({ ...a, [c.status]: c._count }), {} as Record<string, number>),
      dealersByType: dealersByType.reduce((a, c) => ({ ...a, [c.dealerType]: c._count }), {} as Record<string, number>),
    };
  }
}
