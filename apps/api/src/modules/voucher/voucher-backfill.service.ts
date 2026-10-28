import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { VoucherBillingService } from './voucher-billing.service';
import { VoucherFxService } from './voucher-fx.service';

/**
 * 검진권 거래 ERP 백필 — ERP webhook 활성화/emit 배선 전에 생성된 기존 거래를 ERP로 재emit.
 *
 * 배경: vendor.synced(딜러)는 재sync로 ERP에 들어갔으나, 그 이전에 발생한 allocate(purchase)·
 * sale·redeem·refund·settlement는 outbox enqueue 조건(erp.webhookEnabled) 미충족 시점에
 * 만들어져 ERP로 전달되지 않음. 본 백필이 기존 레코드를 동일 ref/payload로 재emit한다.
 *
 * 멱등: billing.emit→outbox ref=`voucher:<lineType>:<id>`. 같은 ref가 outbox에 이미 있으면 skip
 * (재실행 안전). ERP도 source_ref UNIQUE로 멱등 부킹하므로 이중 부킹 없음.
 * 정산은 CONFIRMED 이상만(4-eyes 게이트 보존). redeem_reversal은 ERP 핸들러 부재로 제외.
 */
@Injectable()
export class VoucherBackfillService {
  private readonly logger = new Logger(VoucherBackfillService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly billing: VoucherBillingService,
    private readonly fx: VoucherFxService,
  ) {}

  /** 외화 라인레벨 환율 스탬프 — ERP가 외화계좌(GL) 환산·라우팅에 사용. KRW는 빈 객체. */
  private async fxFields(currency?: string | null): Promise<Record<string, unknown>> {
    if (!currency || currency.toUpperCase() === 'KRW') return {};
    const fx = await this.fx.getKrwRate(currency);
    return { fxRate: fx.rate, fxRateSource: fx.source };
  }

  private async pending(lineType: string, ref: string): Promise<boolean> {
    const full = `voucher:${lineType}:${ref}`;
    const ex = await this.prisma.integrationOutbox.findFirst({
      where: { domain: 'voucher', ref: full }, select: { id: true },
    });
    return !ex; // 이미 있으면 false(skip)
  }

  async run(): Promise<Record<string, number>> {
    const out: Record<string, number> = {
      purchase: 0, sub_purchase: 0, resale: 0, commission: 0,
      redeem: 0, topup: 0, refund: 0, settlement: 0, skipped: 0,
    };

    // 1) Allocations → purchase / sub_purchase (REVOKED 제외)
    const allocs = await this.prisma.voucherAllocation.findMany({
      where: { status: { not: 'REVOKED' } }, include: { toDistributor: true },
    });
    for (const a of allocs) {
      const lt = a.fromType === 'HOSPITAL' ? 'purchase' : 'sub_purchase';
      if (!(await this.pending(lt, a.id))) { out.skipped++; continue; }
      this.billing.emit(lt, a.id, {
        allocationId: a.id, fromType: a.fromType, fromId: a.fromId,
        toDistributorId: a.toDistributorId, toDealerType: a.toDistributor.dealerType,
        quantity: a.quantity, supplyPrice: a.supplyPrice,
        totalAmount: a.supplyPrice * a.quantity,
        paymentRef: a.paymentRef ?? null,
        paidAt: a.paidAt ? a.paidAt.toISOString() : null,
        currency: a.toDistributor.currency,
        ...(await this.fxFields(a.toDistributor.currency)),
      });
      out[lt]++;
    }

    // 2) Sales → resale + commission
    const sales = await this.prisma.voucherSale.findMany({ include: { distributor: true } });
    for (const s of sales) {
      const v = await this.prisma.checkupVoucher.findUnique({
        where: { id: s.voucherId }, select: { serial: true },
      });
      if (!v) continue;
      const base = {
        serial: v.serial, distributorId: s.distributorId,
        dealerType: s.distributor.dealerType, dealerName: s.distributor.name, currency: s.currency,
        ...(await this.fxFields(s.currency)),
      };
      if (await this.pending('resale', s.id)) {
        this.billing.emit('resale', s.id, { ...base, salePrice: s.salePrice });
        out.resale++;
      } else { out.skipped++; }
      if (await this.pending('commission', s.id)) {
        this.billing.emit('commission', s.id, {
          ...base, commissionAmount: s.commissionAmount, commissionRate: s.commissionRate,
        });
        out.commission++;
      }
    }

    // 3) Redemptions → redeem (+ topup). 역상환(redeem_reversal)은 ERP 핸들러 부재로 제외.
    const reds = await this.prisma.voucherRedemption.findMany({ include: { voucher: true } });
    for (const r of reds) {
      if (await this.pending('redeem', r.id)) {
        this.billing.emit('redeem', r.id, {
          serial: r.voucher.serial, amountUsed: r.amountUsed,
          visitId: r.visitId, billingId: r.billingId,
        });
        out.redeem++;
      } else { out.skipped++; }
      if (r.diffBillingRef && r.actualPrice > r.amountUsed && await this.pending('topup', r.id)) {
        this.billing.emit('topup', r.id, {
          serial: r.voucher.serial, amount: r.actualPrice - r.amountUsed,
          visitId: r.visitId, billingId: r.billingId,
        });
        out.topup++;
      }
    }

    // 4) Refunds(DONE) → refund + commission clawback
    const refunds = await this.prisma.voucherRefund.findMany({ where: { status: 'DONE' } });
    for (const rf of refunds) {
      const sale = rf.saleId
        ? await this.prisma.voucherSale.findUnique({ where: { id: rf.saleId }, select: { currency: true } })
        : null;
      if (await this.pending('refund', rf.id)) {
        this.billing.emit('refund', rf.id, {
          serial: rf.serial, refundAmount: rf.refundAmount,
          distributorId: rf.distributorId ?? undefined, currency: sale?.currency ?? undefined,
          ...(await this.fxFields(sale?.currency)),
        });
        out.refund++;
      } else { out.skipped++; }
      if (rf.clawbackAmount > 0 && rf.distributorId && await this.pending('commission', `claw:${rf.id}`)) {
        this.billing.emit('commission', `claw:${rf.id}`, {
          serial: rf.serial, commissionAmount: -rf.clawbackAmount,
          distributorId: rf.distributorId, clawback: true,
        });
        out.commission++;
      }
    }

    // 5) Settlements(CONFIRMED/PAID/PARTIAL) → settlement
    const setts = await this.prisma.voucherSettlement.findMany({
      where: { status: { in: ['CONFIRMED', 'PAID', 'PARTIAL'] } },
    });
    for (const st of setts) {
      if (!(await this.pending('settlement', st.id))) { out.skipped++; continue; }
      const dealer = await this.prisma.distributor.findUnique({
        where: { id: st.distributorId }, select: { dealerType: true, name: true },
      });
      this.billing.emit('settlement', st.id, {
        distributorId: st.distributorId, dealerType: dealer?.dealerType, dealerName: dealer?.name,
        grossSales: st.grossSales, commissionTotal: st.commissionTotal, refundClawback: st.refundClawback,
        netPayable: st.netPayable, currency: st.currency,
        fxRate: st.fxRate, fxRateSource: st.fxRateSource, baseCurrency: 'KRW',
        netPayableKrw: st.fxRate ? Math.round(st.netPayable * st.fxRate) : st.netPayable,
      });
      out.settlement++;
    }

    this.logger.log(`voucher ERP backfill 완료: ${JSON.stringify(out)}`);
    return out;
  }
}
