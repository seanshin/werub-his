import { Injectable, BadRequestException, NotFoundException, ForbiddenException, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { VoucherPolicyService } from './voucher-policy.service';
import { VoucherLedgerService } from './voucher-ledger.service';
import { VoucherBillingService } from './voucher-billing.service';
import { AuditAction } from '@prisma/client';
import { VOUCHER_ERROR, commissionCapFor } from './voucher-legal.constants';
import { decryptField } from '../../common/crypto/field-encryption';
import { AuditService } from '../audit/audit.service';
import { AllocateDto, SellDto } from './dto/distributor.dto';
import { hashActivation } from './voucher-serial';
import { VoucherEmailService, isVoucherEmailDelivered } from './voucher-email.service';
import { VoucherFxService } from './voucher-fx.service';

interface FromCtx { type: 'HOSPITAL' | 'DISTRIBUTOR'; id: string | null; actorId: string; actorType: string }

@Injectable()
export class VoucherTradeService {
  private readonly logger = new Logger(VoucherTradeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: VoucherPolicyService,
    private readonly ledger: VoucherLedgerService,
    private readonly billing: VoucherBillingService,
    private readonly audit: AuditService,
    private readonly email: VoucherEmailService,
    private readonly fx: VoucherFxService,
  ) {}

  /** 외화 라인레벨 환율 스탬프 — ERP 외화계좌(GL) 환산·라우팅용. KRW는 빈 객체. */
  private async fxFields(currency?: string | null): Promise<Record<string, unknown>> {
    if (!currency || currency.toUpperCase() === 'KRW') return {};
    const fx = await this.fx.getKrwRate(currency);
    return { fxRate: fx.rate, fxRateSource: fx.source };
  }

  /**
   * 배치를 딜러에게 발송(채널분리) — 병원 보유분을 딜러에 배분(ALLOCATED·dealerConfirmedAt=null) +
   * 활성화코드를 별도 이메일(Resend/시뮬)로 전달. 딜러가 수령확인(코드 입력)해야 판매 가능.
   */
  async sendBatchToDealer(
    batchId: string,
    dto: { distributorId: string; supplyPrice?: number; recipientEmail?: string; idempotencyKey: string },
    actor: { actorId: string; actorType: string },
  ) {
    const dup = await this.prisma.voucherAllocation.findUnique({ where: { idempotencyKey: dto.idempotencyKey } });
    if (dup) return { allocationId: dup.id, quantity: dup.quantity, idempotent: true };

    const dealer = await this.prisma.distributor.findUnique({ where: { id: dto.distributorId } });
    if (!dealer) throw new NotFoundException('딜러를 찾을 수 없습니다');
    if (dealer.status !== 'ACTIVE') throw new BadRequestException({ code: 'DEALER_SUSPENDED', message: `딜러 상태 ${dealer.status}` });

    const acct = await this.prisma.distributorAccount.findFirst({ where: { distributorId: dealer.id }, select: { email: true } });
    const recipient = dto.recipientEmail || acct?.email;
    if (!recipient) throw new BadRequestException('딜러 이메일이 없습니다 — recipientEmail을 지정하세요');

    // 배치의 병원 보유분(미배분)
    const stock = await this.prisma.checkupVoucher.findMany({
      where: { batchId, currentOwnerType: 'HOSPITAL', status: 'ISSUED' },
      select: { id: true, serial: true, headHash: true, activationCodeEnc: true },
    });
    if (!stock.length) throw new BadRequestException('발송할 병원 보유 검진권이 없습니다(이미 배분됐거나 빈 배치)');

    const supplyPrice = dto.supplyPrice ?? 0;
    const result = await this.prisma.$transaction(async (tx) => {
      const alloc = await tx.voucherAllocation.create({
        data: {
          idempotencyKey: dto.idempotencyKey, fromType: 'HOSPITAL', fromId: null, toDistributorId: dealer.id,
          quantity: stock.length, supplyPrice, status: 'FULFILLED', recipientEmail: recipient, deliveryChannel: 'PENDING',
        },
      });
      for (const v of stock) {
        const head = await this.ledger.append(tx, {
          voucherId: v.id, serial: v.serial, type: 'ALLOCATE', prevHash: v.headHash,
          actorType: actor.actorType, actorId: actor.actorId, payload: { allocationId: alloc.id, toDistributorId: dealer.id, supplyPrice, channel: 'email' },
        });
        await tx.checkupVoucher.update({
          where: { id: v.id },
          data: { status: 'ALLOCATED', currentOwnerType: 'DISTRIBUTOR', currentOwnerId: dealer.id, headHash: head, dealerConfirmedAt: null },
        });
      }
      return { allocationId: alloc.id };
    });

    // 활성화코드 이메일(채널분리) — 커밋 후
    const codes = stock
      .map((v) => ({ serial: v.serial, activationCode: (decryptField(v.activationCodeEnc) as string | null) ?? '' }))
      .filter((c) => c.activationCode);
    const sent = await this.email.sendActivationCodes(recipient, dealer.name, codes);
    const delivered = isVoucherEmailDelivered(sent.channel);
    // 🔴 실제로 나간 것만 시각을 남긴다. 종전엔 채널과 무관하게 `new Date()` 를 찍어
    //    차단·실패·모의에도 원장이 "이 시각에 보냈다"고 말했다(모르는 시각은 원장에 박지 않는다).
    await this.prisma.voucherAllocation
      .update({ where: { id: result.allocationId }, data: { emailedAt: delivered ? new Date() : null, deliveryChannel: sent.channel } })
      // 🔴 삼키면 채널이 'PENDING' 인 채로 남아 실패조차 기록되지 않는다.
      .catch((e) => this.logger.error(`검진권 배분 ${result.allocationId} 발송결과 기록 실패(${sent.channel}): ${(e as Error).message}`));
    if (!delivered) {
      const msg = `검진권 활성화코드가 딜러 ${dealer.id}(${recipient}) 에게 발송되지 않았습니다 — channel=${sent.channel}. 배분 ${result.allocationId} 은 확정됐으므로 코드 전달을 별도로 처리해야 합니다.`;
      // 🔴 설정상 모의(SIMULATION)는 예상된 상태다 — 이것까지 error 로 울리면
      //    거짓 경보가 진짜 실패(FAILED·BLOCKED)를 묻는다.
      if (sent.channel === 'SIMULATION') this.logger.warn(msg);
      else this.logger.error(msg);
    }
    this.auditCodeDisclosure(actor.actorId, `batch:${batchId}`, `email:dealer:${dealer.id}:${sent.channel}`);

    // ERP 매입(B1) — 커밋 후
    this.billing.emit('purchase', result.allocationId, {
      allocationId: result.allocationId, fromType: 'HOSPITAL', fromId: null, toDistributorId: dealer.id,
      toDealerType: dealer.dealerType, quantity: stock.length, supplyPrice, totalAmount: supplyPrice * stock.length, currency: dealer.currency,
      ...(await this.fxFields(dealer.currency)),
    });

    return { allocationId: result.allocationId, quantity: stock.length, emailedTo: recipient, channel: sent.channel, delivered, pendingConfirmation: true };
  }

  /** 딜러 수령확인 — 이메일로 받은 활성화코드 입력 → 본인 보유·미확인 검진권을 확인 처리(판매 게이트 해제). */
  async confirmReceipt(distributorId: string, activationCodes: string[], actorAccountId: string) {
    const out = { confirmed: 0, failed: [] as string[], total: 0 };
    for (const raw of activationCodes ?? []) {
      const code = (raw ?? '').trim().toUpperCase();
      if (!code) continue;
      out.total++;
      const v = await this.prisma.checkupVoucher.findFirst({
        where: { currentOwnerType: 'DISTRIBUTOR', currentOwnerId: distributorId, activationHash: hashActivation(code), dealerConfirmedAt: null },
        select: { id: true, serial: true },
      });
      if (!v) { out.failed.push(code); continue; }
      await this.prisma.checkupVoucher.update({ where: { id: v.id }, data: { dealerConfirmedAt: new Date() } });
      this.auditCodeDisclosure(actorAccountId, v.serial, `confirm-receipt:distributor:${distributorId}`);
      out.confirmed++;
    }
    return out;
  }

  /** 수령확인 대기 목록(본인 보유·미확인) — 시리얼만(코드 미노출). */
  async pendingReceipts(distributorId: string) {
    return this.prisma.checkupVoucher.findMany({
      where: { currentOwnerType: 'DISTRIBUTOR', currentOwnerId: distributorId, dealerConfirmedAt: null, status: 'ALLOCATED' },
      select: { serial: true, form: true, faceValue: true, status: true, createdAt: true },
      orderBy: { createdAt: 'desc' }, take: 1000,
    });
  }

  /** 활성화코드 열람 감사(G1·READ) — 누가·언제·어느 시리얼 코드를 봤는지 */
  private auditCodeDisclosure(actorId: string, serial: string, context: string) {
    void this.audit.log({ userId: actorId, action: AuditAction.READ, resourceType: 'VOUCHER_ACTIVATION_CODE', resourceId: serial, changes: { disclosure: { old: null, new: context } } });
  }

  /** 선결제 매입 배분(병원→딜러 / 딜러→하위딜러). 소유 이전 + TRANSFER 이벤트. */
  async allocate(dto: AllocateDto, from: FromCtx) {
    const dup = await this.prisma.voucherAllocation.findUnique({ where: { idempotencyKey: dto.idempotencyKey } });
    if (dup) return { allocationId: dup.id, quantity: dup.quantity, idempotent: true };

    const pol = await this.policy.getActive();
    const to = await this.prisma.distributor.findUnique({ where: { id: dto.toDistributorId } });
    if (!to) throw new NotFoundException('대상 딜러를 찾을 수 없습니다');
    if (to.status !== 'ACTIVE') throw new BadRequestException({ code: 'DEALER_SUSPENDED', message: `대상 딜러 상태 ${to.status}` });
    // 권한 경계(C-1): 딜러발 배분은 본인 하위(parentId===me)에게만 — 임의 딜러로의 재고 무단 이전 차단
    if (from.type === 'DISTRIBUTOR' && to.parentId !== from.id)
      throw new ForbiddenException({ code: 'NOT_SUBORDINATE', message: '본인 하위 딜러에게만 배분할 수 있습니다' });
    /**
     * 🔴 선결제 강제. `paymentRef` 는 **결제가 있었다는 사람의 단언**이고, 아래에서 그 존재만으로
     *    `paidAt` 이 찍히며 ERP 청구에도 그 시각이 나간다. 그래서 화면이 이 값을 **지어내면 안 된다**
     *    — 2026-08-27 실측: 배분 화면 2곳이 비어 있으면 `PAY-<Date.now()>`/`SUB-<Date.now()>` 를
     *    만들어 보내 게이트를 통과시키고 있었다(결제된 적 없는 거래에 `paidAt`=지금).
     *    코드를 붙여 화면이 사유를 정확히 말할 수 있게 한다.
     */
    if (pol.prepaymentRequired && !dto.paymentRef?.trim())
      throw new BadRequestException({
        code: 'PREPAYMENT_REF_REQUIRED',
        message: '선결제 매입은 결제 참조번호가 필요합니다 — 실제 입금·결제 건의 참조번호를 입력하세요(입력 시 결제완료로 기록됩니다).',
      });

    // 공급원 보유 검진권 선택
    const where = from.type === 'HOSPITAL'
      ? { currentOwnerType: 'HOSPITAL', status: 'ISSUED' }
      : { currentOwnerType: 'DISTRIBUTOR', currentOwnerId: from.id!, status: 'ALLOCATED' };
    const stock = await this.prisma.checkupVoucher.findMany({ where, select: { id: true, serial: true, headHash: true }, take: dto.quantity });
    if (stock.length < dto.quantity)
      throw new BadRequestException(`재고 부족(요청 ${dto.quantity}, 가용 ${stock.length})`);

    const result = await this.prisma.$transaction(async (tx) => {
      const alloc = await tx.voucherAllocation.create({
        data: {
          idempotencyKey: dto.idempotencyKey, fromType: from.type, fromId: from.id, toDistributorId: dto.toDistributorId,
          quantity: dto.quantity, supplyPrice: dto.supplyPrice, paymentRef: dto.paymentRef,
          paidAt: dto.paymentRef ? new Date() : null, status: 'FULFILLED',
        },
      });
      for (const v of stock) {
        const head = await this.ledger.append(tx, {
          voucherId: v.id, serial: v.serial, type: from.type === 'HOSPITAL' ? 'ALLOCATE' : 'TRANSFER', prevHash: v.headHash,
          actorType: from.actorType, actorId: from.actorId, payload: { allocationId: alloc.id, toDistributorId: dto.toDistributorId, supplyPrice: dto.supplyPrice },
        });
        await tx.checkupVoucher.update({
          where: { id: v.id },
          // 선결제 매입 배분/하위배분은 직접 거래 → 자동 수령확인(dealerConfirmedAt). 채널분리 게이트는 send-to-dealer(발송)만.
          data: { status: 'ALLOCATED', currentOwnerType: 'DISTRIBUTOR', currentOwnerId: dto.toDistributorId, headHash: head, dealerConfirmedAt: new Date() },
        });
      }
      return { allocationId: alloc.id, quantity: stock.length, paymentRef: dto.paymentRef };
    });
    // 선결제 매입 ERP 발행(B1) — 커밋 후(W-2)·최초 호출만(W-3 idempotent-return 위에서 분기). 병원→딜러=purchase / 딜러→하위=sub_purchase
    this.billing.emit(from.type === 'HOSPITAL' ? 'purchase' : 'sub_purchase', result.allocationId, {
      allocationId: result.allocationId, fromType: from.type, fromId: from.id,
      toDistributorId: dto.toDistributorId, toDealerType: to.dealerType,
      quantity: result.quantity, supplyPrice: dto.supplyPrice, totalAmount: dto.supplyPrice * result.quantity,
      paymentRef: dto.paymentRef ?? null, paidAt: dto.paymentRef ? new Date().toISOString() : null, currency: to.currency,
      ...(await this.fxFields(to.currency)),
    });
    return result;
  }

  /** 재판매(딜러→외국인환자/하위). L1(외국인)·L4(수수료 상한). */
  async sell(dto: SellDto, distributorId: string, actorAccountId: string) {
    const dup = await this.prisma.voucherSale.findUnique({ where: { idempotencyKey: dto.idempotencyKey } });
    if (dup) return { saleId: dup.id, idempotent: true };

    const dealer = await this.prisma.distributor.findUnique({ where: { id: distributorId } });
    if (!dealer) throw new NotFoundException('딜러를 찾을 수 없습니다');
    const pol = await this.policy.getActive();
    const cap = commissionCapFor(pol, dealer.dealerType);
    if (dealer.commissionRate > cap)
      throw new BadRequestException({ code: 'COMMISSION_EXCEEDED', message: `${dealer.dealerType === 'DOMESTIC' ? '국내' : '해외'} 수수료율 상한(${cap}%) 초과` });

    const v = await this.prisma.checkupVoucher.findUnique({ where: { serial: dto.serial } });
    if (!v) throw new NotFoundException({ code: VOUCHER_ERROR.NOT_FOUND, message: '검진권을 찾을 수 없습니다' });
    if (v.currentOwnerType !== 'DISTRIBUTOR' || v.currentOwnerId !== distributorId)
      throw new ForbiddenException('본인 보유 검진권이 아닙니다');
    if (v.status !== 'ALLOCATED') throw new BadRequestException({ code: VOUCHER_ERROR.INVALID_STATE, message: `재판매 불가 상태: ${v.status}` });
    // 채널분리 승인 게이트: 딜러가 활성화코드로 수령확인해야 판매 가능
    if (!v.dealerConfirmedAt) throw new BadRequestException({ code: 'RECEIPT_NOT_CONFIRMED', message: '수령 확인(활성화코드 입력) 후 판매할 수 있습니다' });

    // L1: 구매자가 등록 환자면 외국인 검증(외부 고객은 활성화 시 검증)
    if (pol.foreignerOnly && dto.buyerType === 'PATIENT' && dto.buyerId) {
      const patient = await this.prisma.patient.findUnique({ where: { id: dto.buyerId }, select: { nationality: true } });
      if (patient && (patient.nationality ?? 'KR') === 'KR')
        throw new BadRequestException({ code: VOUCHER_ERROR.NOT_FOREIGNER, message: '외국인환자만 구매 가능합니다' });
    }

    const commissionAmount = Math.floor((dto.salePrice * dealer.commissionRate) / 100);
    const result = await this.prisma.$transaction(async (tx) => {
      const head = await this.ledger.append(tx, {
        voucherId: v.id, serial: v.serial, type: 'TRANSFER', prevHash: v.headHash,
        actorType: 'DISTRIBUTOR', actorId: actorAccountId, payload: { sale: true, buyerType: dto.buyerType, buyerId: dto.buyerId, salePrice: dto.salePrice, commissionAmount },
      });
      const sale = await tx.voucherSale.create({
        data: {
          idempotencyKey: dto.idempotencyKey, voucherId: v.id, distributorId, buyerType: dto.buyerType, buyerId: dto.buyerId,
          buyerName: dto.buyerName, buyerContact: dto.buyerContact,
          salePrice: dto.salePrice, commissionRate: dealer.commissionRate, commissionAmount, currency: dealer.currency, paymentRef: dto.paymentRef,
        },
      });
      await tx.checkupVoucher.update({ where: { id: v.id }, data: { status: 'SOLD', headHash: head } });
      // G1: 활성화코드를 딜러에게 전달(구매자 손에 도달). 감사로그(누가·언제·어느 시리얼).
      const activationCode = decryptField(v.activationCodeEnc) as string | null;
      this.auditCodeDisclosure(actorAccountId, v.serial, `sell:distributor:${distributorId}`);
      return { saleId: sale.id, serial: v.serial, salePrice: dto.salePrice, commissionRate: dealer.commissionRate, commissionAmount, currency: dealer.currency, activationCode };
    });
    // 자금흐름(§14.5): 재판매 + 수수료 — 커밋 후 emit(H-1: 롤백 시 유령 ERP 라인 차단·outbox 별도 커넥션)
    const fxf = await this.fxFields(dealer.currency);   // 외화 라인레벨 환율(ERP 외화계좌 라우팅용)
    this.billing.emit('resale', result.saleId, { serial: v.serial, salePrice: dto.salePrice, distributorId, dealerType: dealer.dealerType, dealerName: dealer.name, currency: dealer.currency, ...fxf });
    this.billing.emit('commission', result.saleId, { serial: v.serial, commissionAmount, commissionRate: dealer.commissionRate, distributorId, dealerType: dealer.dealerType, dealerName: dealer.name, currency: dealer.currency, ...fxf });
    return result;
  }

  async mySales(distributorId: string) {
    return this.prisma.voucherSale.findMany({ where: { distributorId }, orderBy: { soldAt: 'desc' }, take: 200 });
  }

  /** 딜러 활성화코드 재발급(분실 시·G1) — 본인 현재보유 또는 본인이 판매한 시리얼만. 감사. */
  async dealerActivationCode(serial: string, distributorId: string, actorAccountId: string) {
    const v = await this.prisma.checkupVoucher.findUnique({ where: { serial } });
    if (!v) throw new NotFoundException({ code: VOUCHER_ERROR.NOT_FOUND, message: '검진권을 찾을 수 없습니다' });
    const ownsNow = v.currentOwnerType === 'DISTRIBUTOR' && v.currentOwnerId === distributorId;
    const soldByMe = await this.prisma.voucherSale.findFirst({ where: { voucherId: v.id, distributorId } });
    if (!ownsNow && !soldByMe) throw new ForbiddenException('본인 보유·판매 검진권이 아닙니다');
    if (!v.activationCodeEnc) throw new BadRequestException({ code: VOUCHER_ERROR.INVALID_STATE, message: '활성화코드 없음(이미 활성화/소각됨)' });
    this.auditCodeDisclosure(actorAccountId, serial, `reissue:distributor:${distributorId}`);
    return { serial, activationCode: decryptField(v.activationCodeEnc) as string, status: v.status };
  }
}
