import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { VoucherPolicyService } from './voucher-policy.service';
import { VoucherLedgerService } from './voucher-ledger.service';
import { VoucherBillingService } from './voucher-billing.service';
import { VOUCHER_ERROR } from './voucher-legal.constants';
import {
  makeSerial, groupCode, makeActivationCode, hashActivation, eventHash, verifySerialFormat, GENESIS_PREV,
} from './voucher-serial';
import { encryptField, decryptField } from '../../common/crypto/field-encryption';
import { encryptLegacyPid, hashForeignId } from '../../common/crypto/legacy-pid-crypto';
import { PatientAuthService } from '../patient-auth/patient-auth.service';
import { IssueBatchDto, ActivateVoucherDto, RedeemVoucherDto, ClaimVoucherDto } from './dto/voucher.dto';
import { addMonths } from '../../common/day-range';
import { readHospitalConfig } from '../config/hospital-facts';

const CHUNK = 5000;
// 활성화 무차별대입 잠금(M-2) — 활성화코드 5회 실패 시 15분 잠금
const ACTIVATION_MAX_FAILS = 5;
const ACTIVATION_LOCK_MS = 15 * 60 * 1000;

@Injectable()
export class VoucherService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: VoucherPolicyService,
    private readonly ledger: VoucherLedgerService,
    private readonly billing: VoucherBillingService,
    private readonly patientAuth: PatientAuthService,
  ) {}

  // ── 발행(배치) ───────────────────────────────────────────────
  async issueBatch(dto: IssueBatchDto, issuedBy: string) {
    /**
     * 🔴 (2026-09-16 J4) 종전 멱등 반환은 **요청 수량을 그대로** 돌려줬다. 그런데 발행은 청크마다 따로
     *    커밋되므로(아래 CHUNK 루프) 중간 청크가 실패하면 배치는 DRAFT 로 남고 검진권은 **일부만** 생긴다.
     *    그 상태에서 같은 키로 다시 부르면 "quantity 10 발행 완료"라고 답했다 — 실제로는 3장뿐인데.
     *    이제 **실제 발행 수를 세어** 사실대로 말하고, 모자라면 빠진 일련번호만 이어서 발행한다.
     */
    const existing = await this.prisma.voucherBatch.findUnique({ where: { idempotencyKey: dto.idempotencyKey } });
    if (existing) {
      const issued = await this.prisma.checkupVoucher.count({ where: { batchId: existing.id } });
      if (issued >= existing.quantity) {
        /**
         * 🔴 (2026-09-17 L1) 전량 발행됐는데 **앵커가 없는** 배치가 여기서 영영 굳었다 —
         *    앵커는 발행 직후 한 번만 시도되고, 그때 실패하면 이 멱등 분기가 재시도를 막았다.
         *    앵커는 해시체인 원장의 배치 확정 표식이라 없으면 ISSUE 이벤트가 `PENDING` 으로 남는다.
         *    비어 있을 때만 이어서 앵커한다(`anchorBatch` 는 이미 앵커된 배치를 다시 만들지 않는다).
         */
        const anchored = existing.anchorId
          ? { merkleRoot: existing.merkleRoot ?? undefined, anchorId: existing.anchorId }
          : await this.ledger.anchorBatch(existing.id, (await this.policy.getActive()).anchorChainType);
        return {
          batchId: existing.id, quantity: existing.quantity, issued, idempotent: true,
          partial: false as const, status: existing.status,
          incomplete: existing.status !== 'ISSUED',
          merkleRoot: anchored.merkleRoot, anchorId: anchored.anchorId,
        };
      }
      // 부분 발행 — 빠진 것만 이어서 발행하고, 무엇이 모자랐는지 응답이 말한다
      const resumed = await this.fillBatch(existing, issuedBy);
      return { batchId: existing.id, quantity: existing.quantity, idempotent: true, status: existing.status, incomplete: true, ...resumed };
    }

    const pol = await this.policy.getActive();
    if (!pol.enabledForms.includes(dto.form)) throw new BadRequestException(`비활성 형태: ${dto.form}`);

    // 형태별 검증 + 액면가/군코드
    let faceValue: number;
    let category: string | null = null;
    if (dto.form === 'PROGRAM') {
      if (!dto.programId) throw new BadRequestException('PROGRAM형은 programId 필수');
      const program = await this.prisma.checkupProgram.findUnique({ where: { id: dto.programId } });
      if (!program) throw new NotFoundException('검진 프로그램을 찾을 수 없습니다');
      if (!pol.allowedCategories.includes(program.category))
        throw new BadRequestException(`허용되지 않은 프로그램 category(비급여 한정 L2): ${program.category}`);
      faceValue = program.price;
      category = program.category;
    } else {
      if (!dto.faceValue) throw new BadRequestException('AMOUNT형은 faceValue 필수');
      faceValue = dto.faceValue;
    }

    const year2 = new Date().getFullYear().toString().slice(-2);
    const group = groupCode(dto.form, category);
    // 🔴 말일에서 굴러가면 만료일이 늘어난다(1/31+1개월 → 3/3) — 정본으로 클램프한다
    const expiresAt = addMonths(new Date(), pol.validityMonths);

    // 배치 생성(시퀀스 확보)
    const batchSeqRow = await this.prisma.voucherBatch.count();
    const batchSeq = batchSeqRow + 1;
    const batch = await this.prisma.voucherBatch.create({
      data: {
        idempotencyKey: dto.idempotencyKey, form: dto.form, programId: dto.programId, faceValue,
        quantity: dto.quantity, supplyPrice: dto.supplyPrice, policyVersion: pol.version,
        serialRule: { prefix: pol.serialPrefix, group, year2, batchSeq } as Prisma.InputJsonValue,
        status: 'DRAFT', issuedBy,
      },
    });

    const filled = await this.fillBatch(batch, issuedBy);
    return { batchId: batch.id, quantity: dto.quantity, faceValue, ...filled };
  }

  /**
   * 배치의 **빠진 일련번호만** 발행한다 — 첫 발행과 재개(부분 발행 복구)가 같은 코드를 쓴다.
   *
   * 🔴 청크마다 따로 커밋되므로 중간 실패는 **부분 발행**을 남긴다. 재개는 배치에 **저장된** `serialRule`
   *    을 쓴다 — 다시 계산하면(`voucherBatch.count()`) 배치 순번이 달라져 **다른 일련번호**가 찍힌다.
   * 🔴 만료일도 이미 발행된 장과 맞춘다(첫 장의 `expiresAt`). 재개 시점으로 다시 계산하면 같은 배치
   *    안에서 만료일이 갈린다.
   * 🔴 활성화코드는 발행 시 1회만 노출된다 — 재개에서는 **이번에 새로 만든 장의 것만** 돌려줄 수 있다.
   *    이미 발행됐던 장의 코드는 복구할 수 없으므로 그 사실을 응답이 말한다(지어내지 않는다).
   */
  private async fillBatch(
    batch: { id: string; form: string; programId: string | null; faceValue: number; quantity: number; serialRule: Prisma.JsonValue },
    issuedBy: string,
  ) {
    const rule = (batch.serialRule ?? {}) as { prefix?: string; group?: string; year2?: string; batchSeq?: number };
    const pol = await this.policy.getActive();
    const prefix = rule.prefix ?? pol.serialPrefix;
    const group = rule.group ?? '';
    const year2 = rule.year2 ?? new Date().getFullYear().toString().slice(-2);
    const batchSeq = rule.batchSeq ?? 1;

    const already = await this.prisma.checkupVoucher.findMany({
      where: { batchId: batch.id },
      select: { serial: true, expiresAt: true },
      orderBy: { serial: 'asc' },
    });
    const have = new Set(already.map((v) => v.serial));
    const expiresAt = already[0]?.expiresAt ?? addMonths(new Date(), pol.validityMonths);

    const sampleCodes: { serial: string; activationCode: string }[] = [];
    let createdNow = 0;
    for (let start = 0; start < batch.quantity; start += CHUNK) {
      const end = Math.min(start + CHUNK, batch.quantity);
      const vouchers: Prisma.CheckupVoucherCreateManyInput[] = [];
      const events: Prisma.VoucherEventCreateManyInput[] = [];
      for (let i = start; i < end; i++) {
        const serial = makeSerial({ prefix, group, year2, batchSeq, serialNo: i + 1 });
        if (have.has(serial)) continue; // 이미 발행된 장 — 건너뛴다(재개)
        const id = randomUUID();
        const { code, hash: activationHash } = makeActivationCode();
        const ts = new Date().toISOString();
        const payload = { batchId: batch.id, form: batch.form, faceValue: batch.faceValue, issuedBy };
        const genesisHash = eventHash({ prevHash: GENESIS_PREV, serial, type: 'ISSUE', payload, actorId: issuedBy, ts });
        vouchers.push({
          id, serial, batchId: batch.id, form: batch.form, programId: batch.programId ?? undefined, faceValue: batch.faceValue,
          balance: batch.faceValue, status: 'ISSUED', currentOwnerType: 'HOSPITAL', activationHash,
          activationCodeEnc: encryptField(code) as string, // 봉투암호화 저장(딜러 전달용·G1)
          genesisHash, headHash: genesisHash, expiresAt,
        });
        events.push({
          voucherId: id, serial, type: 'ISSUE', prevHash: GENESIS_PREV, hash: genesisHash,
          actorType: 'ADMIN', actorId: issuedBy, payload: payload as Prisma.InputJsonValue,
          anchorStatus: 'PENDING', createdAt: new Date(ts),
        });
        if (sampleCodes.length < 200) sampleCodes.push({ serial, activationCode: code });
      }
      if (!vouchers.length) continue;
      await this.prisma.$transaction([
        this.prisma.checkupVoucher.createMany({ data: vouchers }),
        this.prisma.voucherEvent.createMany({ data: events }),
      ]);
      createdNow += vouchers.length;
    }

    const issued = have.size + createdNow;
    const partial = issued < batch.quantity;
    // 🔴 전량 발행된 배치만 ISSUED 로 올린다 — 부분 발행을 발행 완료라 말하지 않는다
    if (!partial) await this.prisma.voucherBatch.update({ where: { id: batch.id }, data: { status: 'ISSUED' } });
    const anchor = partial ? null : await this.ledger.anchorBatch(batch.id, pol.anchorChainType);

    return {
      issued,
      partial,
      merkleRoot: anchor?.merkleRoot,
      anchorId: anchor?.anchorId,
      // 활성화코드는 발행 시 1회 노출(설계 §14.11). 대량(>200)은 봉인 전달 시스템 위임.
      activationCodes: batch.quantity <= 200 ? sampleCodes : undefined,
      /**
       * 🔴 문장을 만들지 않는다 — 화면 언어를 바꿔도 한국어로 남는다(조립 문장 기준선).
       *    값과 코드만 내려보내고 문장은 화면이 만든다.
       */
      issueState: {
        code: partial ? ('PARTIAL' as const) : have.size ? ('RESUMED' as const) : ('COMPLETE' as const),
        requested: batch.quantity,
        issued,
        /** 이번 호출에서 새로 발행한 장수 */
        createdNow,
        /** 앞서 발행돼 활성화코드를 다시 노출할 수 없는 장수 */
        codesNotReissued: have.size,
        /** 대량 발행은 활성화코드를 반환하지 않는다(봉인 전달 시스템 위임) */
        codesWithheldBulk: batch.quantity > 200,
      },
    };
  }

  /** 활성화코드 검증 + 무차별대입 잠금(M-2). 잠김/불일치 시 throw, 불일치는 실패카운트 증가·임계 시 잠금. */
  private async assertActivationCode(serial: string, v: { activationHash: string; activationFailCount: number; activationLockedUntil: Date | null }, code: string) {
    if (v.activationLockedUntil && v.activationLockedUntil > new Date())
      throw new BadRequestException({ code: 'ACTIVATION_LOCKED', message: '활성화 시도가 과다 실패로 일시 잠겼습니다. 잠시 후 다시 시도하세요' });
    if (hashActivation(code) !== v.activationHash) {
      const n = (v.activationFailCount ?? 0) + 1;
      await this.prisma.checkupVoucher.update({
        where: { serial },
        data: n >= ACTIVATION_MAX_FAILS ? { activationLockedUntil: new Date(Date.now() + ACTIVATION_LOCK_MS), activationFailCount: 0 } : { activationFailCount: n },
      });
      throw new BadRequestException({ code: VOUCHER_ERROR.ACTIVATION_MISMATCH, message: '활성화코드 불일치' });
    }
  }

  // ── 활성화(소비자) ───────────────────────────────────────────
  async activate(serial: string, dto: ActivateVoucherDto) {
    if (!verifySerialFormat(serial)) throw new BadRequestException({ code: VOUCHER_ERROR.NOT_FOUND, message: '시리얼 형식 오류' });
    if (!dto.consent) throw new BadRequestException('국외이전·약관 동의(L8) 필요');

    const v = await this.prisma.checkupVoucher.findUnique({ where: { serial } });
    if (!v) throw new NotFoundException({ code: VOUCHER_ERROR.NOT_FOUND, message: '검진권을 찾을 수 없습니다' });
    if (!['ISSUED', 'SOLD'].includes(v.status)) throw new BadRequestException({ code: VOUCHER_ERROR.INVALID_STATE, message: `활성화 불가 상태: ${v.status}` });
    if (v.expiresAt && v.expiresAt < new Date()) throw new BadRequestException({ code: VOUCHER_ERROR.EXPIRED, message: '만료된 검진권' });
    await this.assertActivationCode(serial, v, dto.activationCode); // M-2 무차별대입 잠금

    // L1 외국인환자 한정
    const pol = await this.policy.getActive();
    if (pol.foreignerOnly) {
      const patient = await this.prisma.patient.findUnique({ where: { id: dto.patientId }, select: { nationality: true } });
      if (!patient) throw new NotFoundException('환자를 찾을 수 없습니다');
      if ((patient.nationality ?? 'KR') === 'KR')
        throw new BadRequestException({ code: VOUCHER_ERROR.NOT_FOREIGNER, message: '외국인환자만 활성화 가능합니다(의료법 §27·외국인환자유치법)' });
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${serial}))`;
      const cur = await tx.checkupVoucher.findUnique({ where: { serial } });
      if (!cur || !['ISSUED', 'SOLD'].includes(cur.status)) throw new BadRequestException({ code: VOUCHER_ERROR.INVALID_STATE, message: '활성화 경합' });
      const head = await this.ledger.append(tx, {
        voucherId: cur.id, serial, type: 'ACTIVATE', prevHash: cur.headHash,
        actorType: 'PATIENT', actorId: dto.patientId, payload: { patientId: dto.patientId, consent: true },
      });
      await tx.checkupVoucher.update({
        where: { serial },
        data: { status: 'ACTIVE', boundPatientId: dto.patientId, currentOwnerType: 'PATIENT', currentOwnerId: dto.patientId, headHash: head, activationCodeEnc: null, activationFailCount: 0, activationLockedUntil: null }, // 코드 소각(G1)·잠금 리셋(M-2)
      });
      return { serial, status: 'ACTIVE', balance: cur.balance };
    });
  }

  // ── 상환(검진 사용) — 원자 ────────────────────────────────────
  async redeem(serial: string, dto: RedeemVoucherDto) {
    // visitId XOR billingId — 검진센터 경로 또는 수납 경로 중 하나 필수(C-1)
    if (!dto.visitId && !dto.billingId)
      throw new BadRequestException({ code: VOUCHER_ERROR.INVALID_STATE, message: 'visitId 또는 billingId 중 하나가 필요합니다' });
    // 멱등
    const dup = await this.prisma.voucherRedemption.findUnique({ where: { idempotencyKey: dto.idempotencyKey } });
    if (dup) return { serial, redemptionId: dup.id, amountUsed: dup.amountUsed, idempotent: true };

    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${serial}))`;
      const v = await tx.checkupVoucher.findUnique({ where: { serial } });
      if (!v) throw new NotFoundException({ code: VOUCHER_ERROR.NOT_FOUND, message: '검진권을 찾을 수 없습니다' });
      if (v.status !== 'ACTIVE') throw new BadRequestException({ code: VOUCHER_ERROR.INVALID_STATE, message: `상환 불가 상태: ${v.status}` });
      if (v.expiresAt && v.expiresAt < new Date()) throw new BadRequestException({ code: VOUCHER_ERROR.EXPIRED, message: '만료된 검진권' });
      if (v.balance <= 0) throw new BadRequestException({ code: VOUCHER_ERROR.DOUBLE_REDEEM, message: '잔액 없음' });

      const useAmount = Math.min(v.balance, dto.actualPrice);
      // 조건부 원자 차감(이중사용 방어)
      const upd = await tx.checkupVoucher.updateMany({
        where: { serial, status: 'ACTIVE', balance: { gte: useAmount } },
        data: { balance: { decrement: useAmount } },
      });
      if (upd.count !== 1) throw new BadRequestException({ code: VOUCHER_ERROR.DOUBLE_REDEEM, message: '동시 상환 충돌' });

      const newBalance = v.balance - useAmount;
      // 초과 차액(액면 초과분) — P1은 ref만 기록, 실 청구는 P3 Billing 연계
      const diffBillingRef = dto.actualPrice > useAmount ? `TOPUP-${dto.idempotencyKey}` : null;

      const head = await this.ledger.append(tx, {
        voucherId: v.id, serial, type: 'REDEEM', prevHash: v.headHash,
        actorType: 'PATIENT', actorId: v.boundPatientId, payload: { visitId: dto.visitId, billingId: dto.billingId, amountUsed: useAmount, actualPrice: dto.actualPrice, newBalance },
      });
      const redemption = await tx.voucherRedemption.create({
        data: { voucherId: v.id, visitId: dto.visitId ?? null, billingId: dto.billingId ?? null, amountUsed: useAmount, actualPrice: dto.actualPrice, diffBillingRef, idempotencyKey: dto.idempotencyKey },
      });
      await tx.checkupVoucher.update({
        where: { serial },
        data: { headHash: head, status: newBalance <= 0 ? 'REDEEMED' : 'ACTIVE' },
      });
      return { serial, redemptionId: redemption.id, amountUsed: useAmount, newBalance, status: newBalance <= 0 ? 'REDEEMED' : 'ACTIVE', diffBillingRef };
    });
    // 자금흐름(§14.5) emit은 커밋 후(H-1: 트랜잭션 롤백 시 유령 ERP 라인 차단 — outbox는 별도 커넥션)
    this.billing.emit('redeem', result.redemptionId, { serial, amountUsed: result.amountUsed, visitId: dto.visitId, billingId: dto.billingId });
    if (result.diffBillingRef) this.billing.emit('topup', result.redemptionId, { serial, amount: dto.actualPrice - result.amountUsed, visitId: dto.visitId, billingId: dto.billingId });
    return result;
  }

  /**
   * 검진권 결제 역상환(환불/취소·A2) — 잔액 복원 + REVERSAL 이벤트(append, 삭제 아님).
   * opts 없으면 전액(미역상환 잔량 전체), opts 있으면 **부분환불 비례**(refundAmount × 검진권잔량/총결제).
   * 누적 reversedAmount 추적으로 멱등·이중복원 방지.
   */
  async reverseRedemption(billingId: string, reason: string, actorId?: string | null, opts?: { refundAmount: number; totalPaid: number }) {
    const reds = await this.prisma.voucherRedemption.findMany({ where: { billingId } });
    const active = reds.filter((r) => (r.reversedAmount ?? 0) < r.amountUsed);
    const voucherRemaining = active.reduce((s, r) => s + (r.amountUsed - (r.reversedAmount ?? 0)), 0);
    if (voucherRemaining <= 0) return { reversed: [], count: 0, totalRestored: 0 };

    // 역상환 총액: 전액 또는 비례(검진권 결제분이 환불에서 차지하는 몫)
    let toReverse = voucherRemaining;
    if (opts && opts.totalPaid > 0) toReverse = Math.min(voucherRemaining, Math.round((opts.refundAmount * voucherRemaining) / opts.totalPaid));
    if (toReverse <= 0) return { reversed: [], count: 0, totalRestored: 0 };

    const reversed: { serial: string; restored: number }[] = [];
    let left = toReverse;
    for (const red of active) {
      if (left <= 0) break;
      const remaining = red.amountUsed - (red.reversedAmount ?? 0);
      const amt = Math.min(remaining, left);
      left -= amt;
      const newReversed = (red.reversedAmount ?? 0) + amt;
      const out = await this.prisma.$transaction(async (tx) => {
        const v = await tx.checkupVoucher.findUnique({ where: { id: red.voucherId } });
        if (!v) return null;
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${v.serial}))`;
        const head = await this.ledger.append(tx, {
          voucherId: v.id, serial: v.serial, type: 'REVERSAL', prevHash: v.headHash,
          actorType: 'ADMIN', actorId: actorId ?? null, payload: { reversedRedemptionId: red.id, amount: amt, billingId, reason, partial: amt < remaining },
        });
        await tx.checkupVoucher.update({
          where: { id: v.id },
          data: { balance: v.balance + amt, status: v.status === 'REDEEMED' ? 'ACTIVE' : v.status, headHash: head },
        });
        await tx.voucherRedemption.update({ where: { id: red.id }, data: { reversedAmount: newReversed, reversedAt: new Date(), reversalReason: reason } });
        return { serial: v.serial, restored: amt };
      });
      if (out) {
        reversed.push(out);
        this.billing.emit('redeem_reversal', `${red.id}:rev${newReversed}`, { serial: out.serial, amount: out.restored, billingId, reason });
      }
    }
    return { reversed, count: reversed.length, totalRestored: toReverse - left };
  }

  // ── 공개 진위검증(무인증·PHI 없음) ───────────────────────────
  async publicVerify(serial: string) {
    if (!verifySerialFormat(serial)) return { serial, valid: false, reason: 'INVALID_FORMAT' };
    const v = await this.prisma.checkupVoucher.findUnique({
      where: { serial },
      select: { serial: true, form: true, programId: true, faceValue: true, balance: true, status: true, expiresAt: true, batch: { select: { merkleRoot: true, anchorId: true } } },
    });
    if (!v) return { serial, valid: false, reason: 'NOT_FOUND' };
    const program = v.programId ? await this.prisma.checkupProgram.findUnique({ where: { id: v.programId }, select: { name: true } }) : null;

    // 🔴 '유효'는 **지금 상환할 수 있다**는 뜻이다. 종전엔 존재하기만 하면 무조건 valid:true 라
    //    환불·회수·사용완료·만료된 검진권도 공개 조회에서 "유효"라고 말했다(2026-08-13 W5 실측:
    //    REFUNDED·REVOKED·REDEEMED 3건 전부 valid:true). 이 EP 는 **무인증 공개**라 구매자·딜러가
    //    직접 보고, 회수된 권의 2차 재판매 사기에 그대로 근거가 된다.
    //    판정은 상환 게이트(redeem)와 **같은 규칙**으로 한다 — 정본이 갈라지면 또 어긋난다.
    const reason = v.status !== 'ACTIVE' ? `INVALID_STATE:${v.status}`
      : v.expiresAt && v.expiresAt < new Date() ? 'EXPIRED'
      : v.balance <= 0 ? 'NO_BALANCE'
      : null;
    // 🔴 발행 기관은 정본(DB 행만) — 종전엔 병원명이 상수 사본이었다(설정을 바꿔도 따라오지 않음 · P12).
    //    미설정이면 null(공개 진위검증 응답에 지어낸 발행자를 싣지 않는다). 조회 실패는 전파한다.
    const { 'hospital.name': issuer } = await readHospitalConfig(this.prisma, ['hospital.name'] as const);

    return {
      serial: v.serial, valid: reason === null, reason: reason ?? undefined,
      issuer, form: v.form,
      program: program?.name ?? null, faceValue: v.faceValue, balance: v.balance, status: v.status,
      expiresAt: v.expiresAt, anchored: !!v.batch?.anchorId, merkleRoot: v.batch?.merkleRoot ?? null,
    };
  }

  async getBatch(id: string) {
    const batch = await this.prisma.voucherBatch.findUnique({ where: { id } });
    if (!batch) throw new NotFoundException('배치를 찾을 수 없습니다');
    const counts = await this.prisma.checkupVoucher.groupBy({ by: ['status'], where: { batchId: id }, _count: true });
    return { ...batch, statusCounts: counts.reduce((a, c) => ({ ...a, [c.status]: c._count }), {} as Record<string, number>) };
  }

  async verifyChain(serial: string) {
    return this.ledger.verifyChain(serial);
  }

  /** 발행 배치 목록(최근순) — 발행 이력·배치별 필터용. */
  async listBatches() {
    const batches = await this.prisma.voucherBatch.findMany({ orderBy: { createdAt: 'desc' }, take: 200 });
    return batches.map((b) => ({
      id: b.id, form: b.form, programId: b.programId, faceValue: b.faceValue, quantity: b.quantity,
      supplyPrice: b.supplyPrice, status: b.status, anchorId: b.anchorId, createdAt: b.createdAt,
    }));
  }

  /** 개별 검진권 목록/검색 — 상태·배치·시리얼 필터 + 페이지네이션. 활성화코드/해시는 미반환(PHI/시크릿 보호). */
  async listVouchers(q: { status?: string; batchId?: string; serial?: string; ownerType?: string; dealer?: string; issuedFrom?: string; issuedTo?: string; expiresFrom?: string; expiresTo?: string; page?: number; limit?: number }) {
    const limit = Math.min(Math.max(q.limit ?? 50, 1), 200);
    const page = Math.max(q.page ?? 1, 1);
    // 딜러명/관리번호 검색 → 보유자(distributor) ID 필터
    let ownerIdFilter: { in: string[] } | undefined;
    if (q.dealer?.trim()) {
      const s = q.dealer.trim();
      const ds = await this.prisma.distributor.findMany({
        where: { OR: [{ name: { contains: s, mode: 'insensitive' } }, { managementNo: { contains: s, mode: 'insensitive' } }] },
        select: { id: true },
      });
      ownerIdFilter = { in: ds.length ? ds.map((d) => d.id) : ['00000000-0000-0000-0000-000000000000'] };
    }
    const range = (from?: string, to?: string) => ({
      ...(from ? { gte: new Date(`${from}T00:00:00.000Z`) } : {}),
      ...(to ? { lte: new Date(`${to}T23:59:59.999Z`) } : {}),
    });
    const where = {
      ...(q.status ? { status: q.status } : {}),
      ...(q.batchId ? { batchId: q.batchId } : {}),
      ...(q.serial ? { serial: { contains: q.serial.trim().toUpperCase() } } : {}),
      ...(q.ownerType ? { currentOwnerType: q.ownerType } : {}),
      ...(ownerIdFilter ? { currentOwnerType: 'DISTRIBUTOR', currentOwnerId: ownerIdFilter } : {}),
      ...(q.issuedFrom || q.issuedTo ? { createdAt: range(q.issuedFrom, q.issuedTo) } : {}),
      ...(q.expiresFrom || q.expiresTo ? { expiresAt: range(q.expiresFrom, q.expiresTo) } : {}),
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.checkupVoucher.count({ where }),
      this.prisma.checkupVoucher.findMany({
        where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit,
        select: {
          serial: true, batchId: true, form: true, faceValue: true, balance: true, status: true,
          currentOwnerType: true, currentOwnerId: true, boundPatientId: true, expiresAt: true, createdAt: true,
        },
      }),
    ]);
    // 보유 딜러명 해석(병원/환자는 라벨, 딜러는 명칭+관리번호)
    const distIds = [...new Set(rows.filter((r) => r.currentOwnerType === 'DISTRIBUTOR' && r.currentOwnerId).map((r) => r.currentOwnerId as string))];
    const dealers = distIds.length ? await this.prisma.distributor.findMany({ where: { id: { in: distIds } }, select: { id: true, name: true, managementNo: true } }) : [];
    const dmap = new Map(dealers.map((d) => [d.id, d]));
    const items = rows.map((r) => ({
      ...r,
      ownerName: r.currentOwnerType === 'DISTRIBUTOR' && r.currentOwnerId ? (dmap.get(r.currentOwnerId)?.name ?? null) : null,
      ownerManagementNo: r.currentOwnerType === 'DISTRIBUTOR' && r.currentOwnerId ? (dmap.get(r.currentOwnerId)?.managementNo ?? null) : null,
    }));
    return { total, page, limit, pages: Math.ceil(total / limit), items };
  }

  /** 소비자(외국인환자) 본인 셀프 활성화 — patientId는 포털 토큰에서. */
  async activateSelf(serial: string, patientId: string, activationCode: string, consent: boolean) {
    return this.activate(serial, { serial, patientId, activationCode, consent } as ActivateVoucherDto);
  }

  /**
   * 외국인 구매자 셀프 claim(무인증·G1+G2) — 코드검증→외국인환자 생성/링크→포털계정→활성화→즉시로그인.
   * 활성화코드가 사실상의 자격증명(D1: 여권번호 자기기입).
   */
  async claim(dto: ClaimVoucherDto) {
    if (!dto.consent) throw new BadRequestException('국외이전·약관 동의(L8) 필요');
    if (!verifySerialFormat(dto.serial)) throw new BadRequestException({ code: VOUCHER_ERROR.NOT_FOUND, message: '시리얼 형식 오류' });

    // 1) 코드 사전검증(환자 생성 전 — 무효 코드에 환자 생성 방지)
    const v = await this.prisma.checkupVoucher.findUnique({ where: { serial: dto.serial } });
    if (!v) throw new NotFoundException({ code: VOUCHER_ERROR.NOT_FOUND, message: '검진권을 찾을 수 없습니다' });
    if (!['ISSUED', 'SOLD'].includes(v.status)) throw new BadRequestException({ code: VOUCHER_ERROR.INVALID_STATE, message: `활성화 불가 상태: ${v.status}` });
    if (v.expiresAt && v.expiresAt < new Date()) throw new BadRequestException({ code: VOUCHER_ERROR.EXPIRED, message: '만료된 검진권' });
    await this.assertActivationCode(dto.serial, v, dto.activationCode); // M-2 무차별대입 잠금(환자 생성 전)

    // 2) L1 외국인 강제(자기기입 국적)
    const pol = await this.policy.getActive();
    const nationality = (dto.nationality || '').toUpperCase();
    if (pol.foreignerOnly && (!nationality || nationality === 'KR'))
      throw new BadRequestException({ code: VOUCHER_ERROR.NOT_FOREIGNER, message: '외국인환자만 구매·활성화 가능합니다(의료법 §27·외국인환자유치법)' });

    // 3) 외국인 환자 생성/링크(여권번호 기준 중복 방지)
    let patient = await this.prisma.patient.findFirst({ where: { passportNumberHash: hashForeignId(dto.passportNo) } });
    if (!patient) {
      const sys = await this.prisma.user.findFirst({ where: { role: 'ADMIN' } });
      if (!sys) throw new BadRequestException('시스템 사용자 미설정 — 환자 생성 불가');
      patient = await this.prisma.patient.create({
        data: {
          mrn: await this.foreignMrn(),
          familyName: dto.familyName, givenName: dto.givenName ?? '',
          dateOfBirth: new Date(dto.birthDate), gender: (dto.gender ?? 'UNKNOWN') as Prisma.PatientCreateInput['gender'],
          nationality, passportNumber: encryptLegacyPid(dto.passportNo), passportNumberHash: hashForeignId(dto.passportNo), phone: dto.contact ?? null, email: dto.email ?? null,
          preferredLanguage: dto.lang ?? 'en', patientSource: 'FOREIGN_TOURIST',
          createdBy: sys.id, updatedBy: sys.id,
        },
      });
    }

    // 4) 포털 계정 프로비저닝(여권번호=로그인ID)
    const acct = await this.patientAuth.provisionForeignAccount({
      patientId: patient.id, loginId: dto.passportNo, password: dto.password, pin: dto.pin, email: dto.email,
    });

    // 5) 활성화(바인딩·코드 소각·재검증·advisory lock)
    const activated = await this.activate(dto.serial, { serial: dto.serial, patientId: patient.id, activationCode: dto.activationCode, consent: dto.consent } as ActivateVoucherDto);

    return {
      serial: activated.serial, status: activated.status, balance: activated.balance,
      patientId: patient.id, mrn: patient.mrn, loginId: dto.passportNo,
      existingAccount: acct.existing,
      ...('accessToken' in acct ? { accessToken: acct.accessToken, refreshToken: acct.refreshToken, expiresAt: acct.expiresAt } : {}),
    };
  }

  private async foreignMrn(): Promise<string> {
    const ymd = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const count = await this.prisma.patient.count({ where: { mrn: { startsWith: `FV-${ymd}` } } });
    return `FV-${ymd}-${String(count + 1).padStart(4, '0')}`;
  }

  /** 내 검진권(바인딩된 환자) 조회 — PHI 최소. */
  async listMine(patientId: string) {
    const list = await this.prisma.checkupVoucher.findMany({
      where: { boundPatientId: patientId },
      select: { serial: true, form: true, programId: true, faceValue: true, balance: true, status: true, expiresAt: true },
      orderBy: { createdAt: 'desc' }, take: 100,
    });
    const progIds = [...new Set(list.map((v) => v.programId).filter(Boolean) as string[])];
    const progs = progIds.length ? await this.prisma.checkupProgram.findMany({ where: { id: { in: progIds } }, select: { id: true, name: true } }) : [];
    const pmap = new Map(progs.map((p) => [p.id, p.name]));
    return list.map((v) => ({ ...v, program: v.programId ? pmap.get(v.programId) ?? null : null }));
  }
}
