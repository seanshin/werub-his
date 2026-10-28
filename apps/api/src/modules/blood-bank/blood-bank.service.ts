import { Injectable, NotFoundException, BadRequestException, ConflictException, Optional, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { parsePatientQr } from '@hospital-run/shared';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ConfigRuntimeService } from '../config/config-runtime.service';
import { PreAuthGateService } from '../pre-auth/pre-auth-gate.service';
import { JourneyService } from '../journey/journey.service';
import { checkAboRhCompatible, normalizeRh } from './blood-compat';
import { gateMode } from '../../common/gate-mode';
// 게이트 위반 원장 — 예외만 던지면 관제의 '0건'이 준수인지 미평가인지 구분되지 않는다
import { SafetyGateService } from '../safety-gate/safety-gate.service';
import { positiveNumberOr } from '../../common/qi-targets';
import { recordGateViolation } from '../../common/gate-enforce';

@Injectable()
export class BloodBankService {
  /** 🔴 게이트 위반 원장 기록이 실패하거나 원장이 미주입일 때, 그 사실을 지우지 않고 남긴다 */
  private readonly logger = new Logger(BloodBankService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly config?: ConfigRuntimeService,
    @Optional() private readonly preAuthGate?: PreAuthGateService,
    @Optional() private readonly journey?: JourneyService,
    @Optional() private readonly gates?: SafetyGateService,
  ) {}

  // ── Inventory ──

  async getInventory(productType?: string, bloodType?: string, status?: string) {
    const where: Record<string, unknown> = {};
    if (productType) where.productType = productType;
    if (bloodType) where.bloodType = bloodType;
    if (status) where.status = status;
    return this.prisma.bloodProduct.findMany({
      where,
      orderBy: { expiresAt: 'asc' }, take: 500,
    });
  }

  async addProduct(data: {
    unitNumber: string; productType: string; bloodType: string; rhFactor: string;
    volume: number; collectedAt: string; expiresAt: string;
    donorId?: string; supplierName?: string; storageLocation?: string; notes?: string;
  }) {
    return this.prisma.bloodProduct.create({
      data: {
        unitNumber: data.unitNumber,
        productType: data.productType,
        bloodType: data.bloodType,
        rhFactor: data.rhFactor,
        volume: data.volume,
        collectedAt: new Date(data.collectedAt),
        expiresAt: new Date(data.expiresAt),
        receivedAt: new Date(),
        donorId: data.donorId,
        supplierName: data.supplierName,
        storageLocation: data.storageLocation,
        notes: data.notes,
      },
    });
  }

  // 혈액제제 상태 전이 규칙 — 종말상태(TRANSFUSED/DISCARDED/EXPIRED) 부활 금지·활성 수혈 중 반납 금지.
  private static readonly PRODUCT_TRANSITIONS: Record<string, string[]> = {
    AVAILABLE: ['RESERVED', 'ISSUED', 'QUARANTINE', 'EXPIRED', 'DISCARDED'],
    RESERVED: ['AVAILABLE', 'ISSUED', 'EXPIRED', 'DISCARDED'],
    ISSUED: ['TRANSFUSED', 'AVAILABLE', 'DISCARDED'], // 반납(AVAILABLE)은 활성 수혈 없을 때만(아래 검증)
    QUARANTINE: ['AVAILABLE', 'DISCARDED'],
    TRANSFUSED: [],
    DISCARDED: [],
    EXPIRED: ['DISCARDED'],
  };

  async updateProductStatus(id: string, status: string) {
    const product = await this.prisma.bloodProduct.findUnique({ where: { id } });
    if (!product) throw new NotFoundException('혈액제제를 찾을 수 없습니다');
    const allowed = BloodBankService.PRODUCT_TRANSITIONS[product.status] ?? [];
    if (product.status !== status && !allowed.includes(status)) {
      throw new BadRequestException({ code: 'INVALID_PRODUCT_TRANSITION', message: `상태 전이 불가: ${product.status} → ${status}` });
    }
    // ISSUED→AVAILABLE(반납)은 활성 수혈(PENDING/VERIFIED/IN_PROGRESS)이 없을 때만
    if (product.status === 'ISSUED' && status === 'AVAILABLE') {
      const active = await this.prisma.bloodTransfusion.findFirst({
        where: { bloodProductId: id, status: { in: ['PENDING', 'VERIFIED', 'IN_PROGRESS'] } }, select: { id: true },
      });
      if (active) throw new BadRequestException('진행 중인 수혈이 있어 반납할 수 없습니다');
    }
    return this.prisma.bloodProduct.update({ where: { id }, data: { status } });
  }

  async getExpiringProducts(days = 7) {
    const now = new Date();
    const deadline = new Date();
    deadline.setDate(deadline.getDate() + days);
    return this.prisma.bloodProduct.findMany({
      where: {
        status: 'AVAILABLE',
        expiresAt: { gte: now, lte: deadline },
      },
      orderBy: { expiresAt: 'asc' },
    });
  }

  /**
   * 재고 통계 (제품유형 × 혈액형 × 상태).
   *
   * 🔴 원 결함(W8 이연·2026-08-14 회수): groupBy 에 **`rhFactor` 가 빠져 있었다**.
   *    `bloodType` 은 ABO(A·B·O·AB) 뿐이라 이 응답만으로는 A+/A− 를 구분할 수 없는데,
   *    화면·위젯은 "A형 6" 을 자연스럽게 "A+ 6" 으로 읽는다.
   *    운영 실측(2026-08-14): **A = POS 5 + NEG 1**. 이걸 'A+ 6' 이라고 말하면
   *    **수혈 적합성 오정보**다 — RhD 음성 수혈자에게 양성 재고를 있다고 말하는 것과 같다.
   *    혈액형은 임상 안전 직결이라 **모르면 추정하지 않는다**: Rh 를 축에 넣어 실제로 센다.
   *
   *    `rhFactor` 는 **추가**만 했다(기존 키 제거 없음) — 상태별 합만 보는 소비처는 그대로 동작한다.
   *    `rhFactor` 가 원장에 없으면(`null`) 표기를 지어내지 않고 `bloodTypeLabel` 을 ABO 로만 둔다.
   */
  async getInventoryStats() {
    const stats = await this.prisma.bloodProduct.groupBy({
      by: ['productType', 'bloodType', 'rhFactor', 'status'],
      _count: { id: true },
      where: { status: { in: ['AVAILABLE', 'RESERVED', 'ISSUED'] } },
    });
    return stats.map(s => {
      const rh = normalizeRh(s.rhFactor);
      return {
        productType: s.productType,
        bloodType: s.bloodType,
        /** POS | NEG | null(원장 미기록·불명 — 표기를 지어내지 않는다) */
        rhFactor: rh,
        /** 표시용 정본 — Rh 를 모르면 ABO 만(`A?` 같은 허위 표기 금지) */
        bloodTypeLabel: rh ? `${s.bloodType}${rh === 'POS' ? '+' : '-'}` : s.bloodType,
        /** 🔴 false 면 이 행의 Rh 는 **모르는 것**이다 — 화면이 '+' 로 단정하면 안 된다 */
        rhKnown: rh != null,
        status: s.status,
        count: s._count.id,
      };
    });
  }

  // ── Crossmatch ──

  async requestCrossmatch(data: {
    patientId: string; bloodProductId: string; method?: string; notes?: string;
  }, requestedBy: string) {
    return this.prisma.bloodCrossmatch.create({
      data: {
        patientId: data.patientId,
        bloodProductId: data.bloodProductId,
        requestedBy,
        method: data.method,
        notes: data.notes,
      },
      include: {
        patient: { select: { familyName: true, givenName: true, mrn: true } },
        bloodProduct: { select: { unitNumber: true, productType: true, bloodType: true, rhFactor: true } },
      },
    });
  }

  async submitCrossmatchResult(id: string, data: {
    result: string; antibodyScreen?: string; method?: string; notes?: string;
  }, testedBy: string) {
    const crossmatch = await this.prisma.bloodCrossmatch.findUnique({ where: { id } });
    if (!crossmatch) throw new NotFoundException('교차시험을 찾을 수 없습니다');

    // 유효기간 — config bloodbank.crossmatchValidHours(기본 72h·§7 P1). 결과 기록 시점에 validUntil 로
    // 영속되므로 개정은 신규 검사부터 적용(기존 레코드 소급 없음 — 출고 판정은 저장값을 본다).
    const validHours = positiveNumberOr(await this.config?.get('bloodbank.crossmatchValidHours').catch(() => null), 72);
    const validUntil = new Date();
    validUntil.setHours(validUntil.getHours() + validHours);

    return this.prisma.bloodCrossmatch.update({
      where: { id },
      data: {
        result: data.result,
        antibodyScreen: data.antibodyScreen,
        method: data.method ?? crossmatch.method,
        testedBy,
        testedAt: new Date(),
        validUntil,
        notes: data.notes ?? crossmatch.notes,
      },
    });
  }

  // ── Transfusion Order ──

  async createTransfusionOrder(data: {
    patientId: string; productType: string; units: number;
    urgency?: string; indication?: string;
    specialReqs?: Record<string, unknown>; preTransfusionHb?: number;
  }, orderedBy: string) {
    // 사전승인 게이트 — 수혈 오더 발행 전 결재 확인(플래그 게이트). OFF·승인존재·응급(EMERGENCY/STAT) 시 통과.
    await this.preAuthGate?.assertGate('TRANSFUSION', {
      patientId: data.patientId, requestedByUserId: orderedBy,
      emergency: data.urgency === 'EMERGENCY' || data.urgency === 'STAT', priority: data.urgency,
      draft: { productType: data.productType, units: data.units, indication: data.indication },
    });
    return this.prisma.transfusionOrder.create({
      data: {
        patientId: data.patientId,
        orderedBy,
        productType: data.productType,
        units: data.units,
        urgency: data.urgency,
        indication: data.indication,
        specialReqs: (data.specialReqs ?? undefined) as unknown as Prisma.InputJsonValue,
        preTransfusionHb: data.preTransfusionHb,
      },
      include: {
        patient: { select: { familyName: true, givenName: true, mrn: true } },
        orderer: { select: { familyName: true, givenName: true } },
      },
    });
  }

  async getTransfusionOrders(status?: string, patientId?: string) {
    const where: Record<string, unknown> = {};
    if (status) where.status = status;
    if (patientId) where.patientId = patientId;
    return this.prisma.transfusionOrder.findMany({
      where,
      orderBy: { orderedAt: 'desc' },
      include: {
        patient: { select: { familyName: true, givenName: true, mrn: true } },
        orderer: { select: { familyName: true, givenName: true } },
        transfusions: { select: { id: true, status: true, bloodProductId: true } },
      },
    });
  }

  // ── Blood Transfusion ──

  /** 출고 전 안전 게이트 — ABO/Rh 적합성·교차시험·유효기간·특수요구. mode(OFF|WARN|BLOCK) 반환 게이트. */
  private async enforceIssueGates(order: { patientId: string; specialReqs?: unknown }, product: {
    id: string; bloodType: string; rhFactor: string; productType: string; expiresAt: Date;
    irradiated: boolean; leukoreduced: boolean; cmvNegative: boolean; washed: boolean;
  }): Promise<{ hardBlocked: string[]; blocked: string[]; warnings: string[] }> {
    const hardBlocked: string[] = []; // ABO/Rh 부적합·만료 — 모드 무관 항상 차단(치명·절대)
    const blocked: string[] = [];     // 교차시험·항체·특수요구 — WARN/OFF에서 완화 가능(긴급 정당화 여지)
    const warnings: string[] = [];

    // 0) 유효기간 — 만료 제제 출고 금지(항상 강제)
    if (product.expiresAt.getTime() <= Date.now()) hardBlocked.push('혈액제제가 유효기간 경과(만료)되었습니다');

    // 1) ABO/Rh 적합성 — 항상 강제(급성 용혈 방지)
    const typing = await this.prisma.patientBloodTyping.findUnique({ where: { patientId: order.patientId } });
    const compat = checkAboRhCompatible({
      productType: product.productType,
      patientAbo: typing?.abo, patientRh: typing?.rh,
      productAbo: product.bloodType, productRh: product.rhFactor,
    });
    if (!compat.compatible) hardBlocked.push(compat.reason ?? 'ABO/Rh 부적합');

    // 2) 유의 항체
    const antibodies = await this.prisma.patientAntibody.findMany({ where: { patientId: order.patientId }, select: { significance: true } });
    if (antibodies.some((a) => a.significance === 'SIGNIFICANT')) blocked.push('유의 항체 보유 환자 — 항원음성 적합 혈액 필요(정규 출고 불가)');

    // 3) 교차시험 — 최신 결과가 COMPATIBLE·미만료·해당 (환자,제제) 존재.
    // (result:COMPATIBLE로 필터하면 이후의 INCOMPATIBLE을 무시하므로, 최신 1건을 가져와 판정)
    if (compat.category === 'RBC' || compat.category === 'PLATELET') {
      const xm = await this.prisma.bloodCrossmatch.findFirst({
        where: { patientId: order.patientId, bloodProductId: product.id },
        orderBy: { testedAt: 'desc' },
      });
      if (!xm) blocked.push('적합(COMPATIBLE) 교차시험이 없습니다');
      else if (xm.result !== 'COMPATIBLE') blocked.push(`최신 교차시험이 적합(COMPATIBLE)이 아닙니다(현재 ${xm.result ?? '미시행'})`);
      else if (!xm.validUntil || xm.validUntil.getTime() <= Date.now()) blocked.push('교차시험 유효기간 경과/미기록 — 재검 필요');
    }

    // 4) 특수요구(방사선조사·CMV음성·세척·백혈구제거)
    const reqs = (order.specialReqs ?? {}) as Record<string, unknown>;
    const need = (k: string) => reqs[k] === true || reqs[k] === 'true';
    if (need('irradiated') && !product.irradiated) blocked.push('방사선조사 제제 필요(TA-GVHD 예방)');
    if (need('cmvNegative') && !product.cmvNegative) blocked.push('CMV 음성 제제 필요');
    if (need('washed') && !product.washed) blocked.push('세척 제제 필요');
    if (need('leukoreduced') && !product.leukoreduced) blocked.push('백혈구제거 제제 필요');

    return { hardBlocked, blocked, warnings };
  }

  /**
   * 특수제제 오더 자동매칭(A-7) — 오더 요건(제제유형·ABO/Rh 적합·특수요구 4종·미만료·AVAILABLE)에
   * 맞는 재고 유닛 후보를 자동 선별해 추천. 정렬=교차시험 적합·유효(즉시 출고 가능) 우선 → FEFO(만료 임박순).
   * 게이트(enforceIssueGates)는 출고 시 재검증되므로 이 목록은 추천이며 우회 경로가 아니다.
   */
  async getCandidateUnits(orderId: string) {
    const order = await this.prisma.transfusionOrder.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('수혈 오더를 찾을 수 없습니다');
    const typing = await this.prisma.patientBloodTyping.findUnique({ where: { patientId: order.patientId } });

    const units = await this.prisma.bloodProduct.findMany({
      where: { productType: order.productType, status: 'AVAILABLE', expiresAt: { gt: new Date() } },
      orderBy: { expiresAt: 'asc' }, // FEFO
      take: 200,
    });

    const reqs = (order.specialReqs ?? {}) as Record<string, unknown>;
    const need = (k: string) => reqs[k] === true || reqs[k] === 'true';

    type Unit = (typeof units)[number];
    const matched: { u: Unit; category: string | undefined }[] = [];
    for (const u of units) {
      const compat = checkAboRhCompatible({
        productType: u.productType, patientAbo: typing?.abo, patientRh: typing?.rh,
        productAbo: u.bloodType, productRh: u.rhFactor,
      });
      if (!compat.compatible) continue;
      if (need('irradiated') && !u.irradiated) continue;
      if (need('cmvNegative') && !u.cmvNegative) continue;
      if (need('washed') && !u.washed) continue;
      if (need('leukoreduced') && !u.leukoreduced) continue;
      matched.push({ u, category: compat.category });
    }

    // 교차시험 상태 주석 — RBC/PLATELET 카테고리는 (환자,유닛) 최신 결과의 적합·유효(72h) 여부
    const ids = matched.map((m) => m.u.id);
    const xms = ids.length
      ? await this.prisma.bloodCrossmatch.findMany({
          where: { patientId: order.patientId, bloodProductId: { in: ids } },
          orderBy: { testedAt: 'desc' },
        })
      : [];
    const latestXm = new Map<string, (typeof xms)[number]>();
    for (const x of xms) if (x.bloodProductId && !latestXm.has(x.bloodProductId)) latestXm.set(x.bloodProductId, x);

    const now = Date.now();
    const items = matched.map(({ u, category }) => {
      const needsXm = category === 'RBC' || category === 'PLATELET';
      const xm = latestXm.get(u.id);
      const crossmatch = !needsXm ? 'NOT_REQUIRED'
        : !xm ? 'NONE'
          : xm.result !== 'COMPATIBLE' ? 'INCOMPATIBLE'
            : xm.validUntil && xm.validUntil.getTime() > now ? 'COMPATIBLE_VALID' : 'EXPIRED';
      return {
        id: u.id, unitNumber: u.unitNumber, bloodType: u.bloodType, rhFactor: u.rhFactor,
        volume: u.volume, expiresAt: u.expiresAt,
        irradiated: u.irradiated, leukoreduced: u.leukoreduced, cmvNegative: u.cmvNegative, washed: u.washed,
        crossmatch, // NOT_REQUIRED | COMPATIBLE_VALID | NONE | EXPIRED | INCOMPATIBLE
        readyToIssue: crossmatch === 'NOT_REQUIRED' || crossmatch === 'COMPATIBLE_VALID',
      };
    });
    items.sort((a, b) => Number(b.readyToIssue) - Number(a.readyToIssue) || new Date(a.expiresAt).getTime() - new Date(b.expiresAt).getTime());

    return {
      orderId, productType: order.productType, units: order.units,
      patientTyping: typing ? { abo: typing.abo, rh: typing.rh } : null,
      specialReqs: reqs, total: items.length, items,
    };
  }

  async issueBlood(orderId: string, bloodProductId: string) {
    const order = await this.prisma.transfusionOrder.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('수혈 오더를 찾을 수 없습니다');

    const product = await this.prisma.bloodProduct.findUnique({ where: { id: bloodProductId } });
    if (!product) throw new NotFoundException('혈액제제를 찾을 수 없습니다');
    if (product.status !== 'AVAILABLE') throw new BadRequestException('해당 혈액제제는 사용 가능 상태가 아닙니다');

    // 안전 게이트(ABO/Rh·교차시험·유효기간·항체·특수요구). config bloodbank.issueEnforce(OFF|WARN|BLOCK·기본 BLOCK·fail-closed).
    const mode = gateMode(await this.config?.get('bloodbank.issueEnforce'));
    const gate = await this.enforceIssueGates(order, product);
    // ABO/Rh 부적합·만료는 모드 무관 항상 차단(WARN/OFF로도 완화 불가 — 치명).
    /**
     * 🔴 2026-08-26: 종전엔 세 갈래(절대금지 차단·BLOCK 차단·WARN 응답) 어느 쪽도 **영속되지 않았다.**
     *    ABO 부적합·만료 혈액 출고 시도는 사후에 반드시 되짚는 사건인데 원장이 없었다.
     *    (`record` 는 별도 연결이라 아래 트랜잭션 롤백과 무관하게 남는다 — 출고되지 않았다는 사실과
     *     게이트가 걸렸다는 사실은 둘 다 참이어야 한다.)
     */
    if (gate.hardBlocked.length > 0) {
      await recordGateViolation({ gateKey: 'bloodbank.issueEnforce', recorder: this.gates, logger: this.logger, refType: 'BloodProduct', refId: bloodProductId }, 'BLOCK', `절대금지 — ${gate.hardBlocked.join(' / ')}`);
      throw new BadRequestException({ code: 'BLOOD_ISSUE_INCOMPATIBLE', message: `출고 불가(절대금지): ${gate.hardBlocked.join(' / ')}`, blocked: gate.hardBlocked });
    }
    if (gate.blocked.length > 0 && mode === 'BLOCK') {
      await recordGateViolation({ gateKey: 'bloodbank.issueEnforce', recorder: this.gates, logger: this.logger, refType: 'BloodProduct', refId: bloodProductId }, 'BLOCK', gate.blocked.join(' / '));
      throw new BadRequestException({ code: 'BLOOD_ISSUE_INCOMPATIBLE', message: `출고 불가: ${gate.blocked.join(' / ')}`, blocked: gate.blocked });
    }
    if (gate.blocked.length > 0 && mode === 'WARN') {
      // 막지 않았으나 남긴다 — 남기지 않으면 BLOCK 승격 근거가 생기지 않는다
      await recordGateViolation({ gateKey: 'bloodbank.issueEnforce', recorder: this.gates, logger: this.logger, refType: 'BloodProduct', refId: bloodProductId }, 'WARN', gate.blocked.join(' / '));
    }
    const warnings = mode === 'WARN' ? [...gate.blocked, ...gate.warnings] : gate.warnings;

    // TOCTOU 방지 — AVAILABLE인 경우에만 원자적 ISSUED 전환. 동시 출고 시 한 쪽만 성공.
    const transfusion = await this.prisma.$transaction(async (tx) => {
      // 🔴 과출고 가드 + 오더 전이 — 종전엔 transfusionOrder.status 를 갱신하는 코드가 API 전체에
      //    한 줄도 없어, 출고 버튼 조건(ORDERED/CROSSMATCHING/READY)이 영구 참 → 2U 오더에
      //    **무제한 재출고**가 가능했고 상태 배지는 영원히 시드값을 말했다(2026-08-13 W3).
      const issuedCount = await tx.bloodTransfusion.count({ where: { orderId } });
      if (issuedCount >= order.units) {
        throw new BadRequestException(`이미 오더 수량(${order.units}U)만큼 출고되었습니다 — 추가 수혈은 새 오더로`);
      }
      const upd = await tx.bloodProduct.updateMany({ where: { id: bloodProductId, status: 'AVAILABLE' }, data: { status: 'ISSUED' } });
      if (upd.count === 0) throw new ConflictException('혈액제제가 이미 출고/사용되었습니다(동시 출고 충돌)');
      const created = await tx.bloodTransfusion.create({ data: { orderId, bloodProductId, patientId: order.patientId } });
      if (issuedCount + 1 >= order.units) {
        await tx.transfusionOrder.update({ where: { id: orderId }, data: { status: 'ISSUED' } });
      }
      return created;
    });

    // MTP 팩 자동소진(A-7) — 활성 MTP 환자의 출고는 팩 카운트 자동 증가(수동 updateMtp 병행·best-effort)
    void this.consumeMtpPack(order.patientId);

    return warnings.length > 0 ? { ...transfusion, warnings } : transfusion;
  }

  /** 활성 MTP 팩 자동소진 — 출고 1유닛당 packsIssued +1. 실패해도 출고 무영향(best-effort). */
  private async consumeMtpPack(patientId: string): Promise<void> {
    // 🔴 (2026-09-17 L2) 출고를 되돌리지는 않는다(best-effort 가 맞다) — 다만 **조용히** 놓치지 않는다.
    //    이 카운트는 대량수혈 프로토콜의 소진 팩 수다: 실패가 삼켜지면 화면·집계가 **실제보다 적게** 말한다.
    try {
      await this.prisma.massiveTransfusionProtocol
        .updateMany({ where: { patientId, status: 'ACTIVE' }, data: { packsIssued: { increment: 1 } } });
    } catch (e) {
      this.logger.error(`MTP 팩 자동소진 실패 — 출고는 확정됐으나 소진 팩 수가 실제보다 적게 남는다(patient=${patientId}): ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /**
   * 2인 확인 + bedside 바코드 대조(2026-07 R2).
   * - 스캔 제공 시(모드 무관): 손목밴드(MRN)·혈액백(unitNumber) 불일치는 **항상 BLOCK**(ABO급 치명 — 완화 불가)
   * - config `bloodBank.bedsideScan.enforce`(기본 OFF) ON이면 스캔 2종 미제공 자체를 차단
   */
  /** 수혈 실행 목록 — 워크스테이션(R2-1 FE 배선) */
  async listTransfusions(status?: string) {
    return this.prisma.bloodTransfusion.findMany({
      where: status ? { status } : { status: { in: ['PENDING', 'VERIFIED', 'IN_PROGRESS'] } },
      orderBy: { id: 'desc' },
      take: 100,
      include: {
        patient: { select: { familyName: true, givenName: true, mrn: true } },
        bloodProduct: { select: { unitNumber: true, productType: true, bloodType: true, rhFactor: true } },
        order: { select: { urgency: true, indication: true } },
      },
    });
  }

  async verifyTransfusion(
    id: string,
    nurse1Id: string,
    nurse2Id: string,
    scans?: { patientBandScan?: string; bloodUnitScan?: string },
  ) {
    if (nurse1Id === nurse2Id) throw new BadRequestException('2인 확인은 서로 다른 간호사가 수행해야 합니다');

    const transfusion = await this.prisma.bloodTransfusion.findUnique({
      where: { id },
      include: {
        patient: { select: { mrn: true } },
        bloodProduct: { select: { unitNumber: true } },
      },
    });
    if (!transfusion) throw new NotFoundException('수혈 기록을 찾을 수 없습니다');
    if (transfusion.status !== 'PENDING') throw new BadRequestException(`확인 가능한 상태가 아닙니다(현재 ${transfusion.status})`);

    // 🔴 환자 식별 스캔 해석은 **투약(BCMA)과 같은 정본 파서**를 쓴다(`parsePatientQr`).
    //    한 곳만 고치면 갈라진다 — MRN 완전일치만 통과시키면 구 형식 팔찌(JSON·`HRPT:`)가
    //    수혈에서도 전건 `BEDSIDE_PATIENT_MISMATCH` 로 떨어진다.
    const band = parsePatientQr(scans?.patientBandScan) ?? scans?.patientBandScan?.trim();
    const unit = scans?.bloodUnitScan?.trim();
    const enforce = String((await this.config?.get('bloodBank.bedsideScan.enforce')) ?? 'false') === 'true';
    // 🔴 2026-08-26: 아래 세 차단은 전부 예외만 던지고 원장에 남지 않았다 —
    //    베드사이드 대조 실패는 수혈 사고 직전 사건이다. 관제가 '0건'의 뜻을 알 수 있어야 한다.
    if (enforce && (!band || !unit)) {
      await recordGateViolation({ gateKey: 'bloodBank.bedsideScan.enforce', recorder: this.gates, logger: this.logger, refType: 'BloodTransfusion', refId: id }, 'BLOCK', `베드사이드 스캔 누락(손목밴드=${band ? '있음' : '없음'}·혈액백=${unit ? '있음' : '없음'})`);
      throw new BadRequestException({
        code: 'BEDSIDE_SCAN_REQUIRED',
        message: '환자 손목밴드와 혈액백 바코드를 모두 스캔해야 합니다(bedside 대조 필수)',
      });
    }
    if (band && band.toUpperCase() !== String(transfusion.patient?.mrn ?? '').toUpperCase()) {
      await recordGateViolation({ gateKey: 'bloodBank.bedsideScan.enforce', recorder: this.gates, logger: this.logger, refType: 'BloodTransfusion', refId: id }, 'BLOCK', '환자 불일치 — 스캔한 손목밴드가 수혈 대상과 다르다(수혈 중단)');
      throw new BadRequestException({
        code: 'BEDSIDE_PATIENT_MISMATCH',
        message: `환자 불일치: 스캔(${band}) ≠ 수혈 대상(${transfusion.patient?.mrn}) — 수혈 중단·재확인`,
      });
    }
    if (unit && unit.toUpperCase() !== String(transfusion.bloodProduct?.unitNumber ?? '').toUpperCase()) {
      await recordGateViolation({ gateKey: 'bloodBank.bedsideScan.enforce', recorder: this.gates, logger: this.logger, refType: 'BloodTransfusion', refId: id }, 'BLOCK', '혈액백 불일치 — 스캔한 유닛이 출고 유닛과 다르다(수혈 중단)');
      throw new BadRequestException({
        code: 'BEDSIDE_UNIT_MISMATCH',
        message: `혈액백 불일치: 스캔(${unit}) ≠ 출고 유닛(${transfusion.bloodProduct?.unitNumber}) — 수혈 중단·혈액은행 확인`,
      });
    }

    return this.prisma.bloodTransfusion.update({
      where: { id },
      data: {
        verifiedByNurse1: nurse1Id,
        verifiedByNurse2: nurse2Id,
        verificationTime: new Date(),
        ...(band || unit ? { patientBandScan: band ?? null, bloodUnitScan: unit ?? null, bedsideScanAt: new Date() } : {}),
        status: 'VERIFIED',
      },
    });
  }

  async startTransfusion(id: string) {
    const transfusion = await this.prisma.bloodTransfusion.findUnique({ where: { id } });
    if (!transfusion) throw new NotFoundException('수혈 기록을 찾을 수 없습니다');
    if (transfusion.status !== 'VERIFIED') throw new BadRequestException(`2인 확인(VERIFIED) 후에만 시작할 수 있습니다(현재 ${transfusion.status})`);
    if (!transfusion.verifiedByNurse1 || !transfusion.verifiedByNurse2) throw new BadRequestException('2인 확인이 완료되지 않았습니다');

    // 🔴 오더 상태가 시행을 따라가지 않아, 수혈이 시작·종료돼도 오더 목록은 영원히 '출고됨'이었다.
    //    (오더 어휘에 IN_PROGRESS·COMPLETED 가 정의돼 있는데 아무도 그 상태로 만들지 않았다)
    // 🔴 (2026-09-16 F3) 시행과 오더 상태는 한 트랜잭션 — 따로 커밋하면 오더만 '출고됨'에 멈춰
    //    위 주석이 고쳤다고 적은 그 결함(오더가 시행을 따라가지 않는다)이 부분 실패로 되살아난다.
    return this.prisma.$transaction(async (tx) => {
      const started = await tx.bloodTransfusion.update({
        where: { id },
        data: { startTime: new Date(), status: 'IN_PROGRESS' },
      });
      await tx.transfusionOrder.updateMany({
        where: { id: transfusion.orderId, status: { in: ['ORDERED', 'CROSSMATCHING', 'READY', 'ISSUED'] } },
        data: { status: 'IN_PROGRESS' },
      });
      return started;
    });
  }

  async recordVitals(id: string, vitals: Record<string, unknown>) {
    const transfusion = await this.prisma.bloodTransfusion.findUnique({ where: { id } });
    if (!transfusion) throw new NotFoundException('수혈 기록을 찾을 수 없습니다');
    if (transfusion.status !== 'IN_PROGRESS') throw new BadRequestException('진행 중인 수혈에만 활력징후를 기록할 수 있습니다');

    // Append to vitalSigns array
    const existing = (transfusion.vitalSigns as Array<Record<string, unknown>>) ?? [];
    const updated = [...existing, { ...vitals, recordedAt: new Date().toISOString() }];

    return this.prisma.bloodTransfusion.update({
      where: { id },
      data: { vitalSigns: updated as unknown as Prisma.InputJsonValue },
    });
  }

  async completeTransfusion(id: string, volumeTransfused: number) {
    const transfusion = await this.prisma.bloodTransfusion.findUnique({ where: { id } });
    if (!transfusion) throw new NotFoundException('수혈 기록을 찾을 수 없습니다');
    if (transfusion.status !== 'IN_PROGRESS') throw new BadRequestException(`진행 중(IN_PROGRESS)인 수혈만 완료할 수 있습니다(현재 ${transfusion.status})`);

    // 🔴 (2026-09-16 F3) 완료 표시와 오더 상태는 한 트랜잭션 — 따로 커밋하면 **마지막 단위**에서
    //    오더가 IN_PROGRESS 에 멈춘 채 아무도 다시 계산해 주지 않는다(다음 완료가 없으므로).
    //    단위 수 집계도 같은 트랜잭션 안에서 읽어 경합 중에 두 번 세지 않게 한다.
    const updated = await this.prisma.$transaction(async (tx) => {
      const done = await tx.bloodTransfusion.update({
        where: { id },
        data: {
          endTime: new Date(),
          volumeTransfused,
          status: 'COMPLETED',
        },
      });

      // 오더는 **요청 단위 수를 다 수혈했을 때만** 완료다 — 2단위 중 1단위만 끝난 것을
      // 완료로 적으면 남은 수혈이 목록에서 사라진다. 아니면 진행 중으로 남긴다.
      const order = await tx.transfusionOrder.findUnique({
        where: { id: transfusion.orderId },
        select: { id: true, units: true, status: true },
      });
      if (order) {
        const doneCount = await tx.bloodTransfusion.count({
          where: { orderId: order.id, status: 'COMPLETED' },
        });
        const nextStatus = doneCount >= (order.units ?? 1) ? 'COMPLETED' : 'IN_PROGRESS';
        if (order.status !== nextStatus && order.status !== 'CANCELLED') {
          await tx.transfusionOrder.update({ where: { id: order.id }, data: { status: nextStatus } });
        }
      }
      return done;
    });

    // 환자 여정 — 수혈 완료(fire-and-forget)
    if (transfusion.patientId) {
      this.journey?.emit({
        patientId: transfusion.patientId,
        eventType: 'TRANSFUSION_COMPLETED',
        title: '수혈 완료',
        description: `${volumeTransfused}mL`,
        department: '진단검사의학과',
        refType: 'BloodTransfusion',
        refId: id,
      });
    }

    return updated;
  }

  async reportReaction(id: string, data: {
    reactionType: string; reactionSeverity: string; reactionAction?: string;
  }) {
    const transfusion = await this.prisma.bloodTransfusion.findUnique({ where: { id } });
    if (!transfusion) throw new NotFoundException('수혈 기록을 찾을 수 없습니다');

    return this.prisma.bloodTransfusion.update({
      where: { id },
      data: {
        reactionOccurred: true,
        reactionType: data.reactionType,
        reactionSeverity: data.reactionSeverity,
        reactionAction: data.reactionAction,
        status: 'REACTION',
      },
    });
  }

  // ── P1: 수혈전검사 기반 ──

  /** 환자 혈액형 확정(2차 재검 불일치 감지) + 항체선별 */
  async setBloodTyping(data: { patientId: string; abo: string; rh: string; aboConfirm?: string; antibodyScreen?: string; method?: string; notes?: string }, typedBy: string) {
    if (data.aboConfirm && data.aboConfirm !== data.abo) {
      throw new BadRequestException({ code: 'ABO_DISCREPANCY', message: `ABO 불일치: 1차 ${data.abo} vs 2차 ${data.aboConfirm}. 재검 필요.` });
    }
    return this.prisma.patientBloodTyping.upsert({
      where: { patientId: data.patientId },
      update: { abo: data.abo, rh: data.rh, aboConfirm: data.aboConfirm ?? null, antibodyScreen: data.antibodyScreen ?? null, method: data.method ?? null, notes: data.notes ?? null, typedBy, typedAt: new Date() },
      create: { patientId: data.patientId, abo: data.abo, rh: data.rh, aboConfirm: data.aboConfirm ?? null, antibodyScreen: data.antibodyScreen ?? null, method: data.method ?? null, notes: data.notes ?? null, typedBy },
    });
  }

  /** 환자 수혈전검사 프로필(혈액형 + 항체 이력) */
  async getBloodProfile(patientId: string) {
    const [typing, antibodies] = await Promise.all([
      this.prisma.patientBloodTyping.findUnique({ where: { patientId } }),
      this.prisma.patientAntibody.findMany({ where: { patientId }, orderBy: { identifiedAt: 'desc' } }),
    ]);
    return { typing, antibodies, hasSignificantAntibody: antibodies.some(a => a.significance === 'SIGNIFICANT') };
  }

  async addAntibody(data: { patientId: string; antibody: string; significance?: string; notes?: string }, identifiedBy: string) {
    return this.prisma.patientAntibody.create({
      data: { patientId: data.patientId, antibody: data.antibody, significance: data.significance ?? null, notes: data.notes ?? null, identifiedBy },
    });
  }

  /** 대량수혈 프로토콜 활성화(환자당 ACTIVE 1건) */
  async activateMtp(data: { patientId: string; indication: string; ratio?: string; notes?: string }, activatedBy: string) {
    const active = await this.prisma.massiveTransfusionProtocol.findFirst({ where: { patientId: data.patientId, status: 'ACTIVE' } });
    if (active) throw new BadRequestException('이미 활성 MTP가 있습니다');
    return this.prisma.massiveTransfusionProtocol.create({
      data: { patientId: data.patientId, indication: data.indication, ratio: data.ratio ?? '1:1:1', notes: data.notes ?? null, activatedBy },
    });
  }

  async updateMtp(id: string, data: { packsIssued?: number; deactivate?: boolean }, userId: string) {
    const mtp = await this.prisma.massiveTransfusionProtocol.findUnique({ where: { id } });
    if (!mtp) throw new NotFoundException('MTP를 찾을 수 없습니다');
    return this.prisma.massiveTransfusionProtocol.update({
      where: { id },
      data: {
        ...(data.packsIssued !== undefined ? { packsIssued: data.packsIssued } : {}),
        ...(data.deactivate ? { status: 'DEACTIVATED', deactivatedBy: userId, deactivatedAt: new Date() } : {}),
      },
    });
  }

  async getActiveMtps() {
    return this.prisma.massiveTransfusionProtocol.findMany({ where: { status: 'ACTIVE' }, orderBy: { activatedAt: 'desc' } });
  }

  /** 긴급 출고(비교차·uncrossmatched) — 사유·감사 기록 */
  async issueEmergency(orderId: string, bloodProductId: string, reason: string) {
    const order = await this.prisma.transfusionOrder.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('수혈 오더를 찾을 수 없습니다');
    const product = await this.prisma.bloodProduct.findUnique({ where: { id: bloodProductId } });
    if (!product) throw new NotFoundException('혈액제제를 찾을 수 없습니다');
    if (product.status !== 'AVAILABLE') throw new BadRequestException('사용 가능 상태가 아닙니다');
    // 긴급 출고는 교차시험·ABO 확정을 우회하나(비교차 O음성 등) 만료 제제는 금지·원자적 선점은 유지.
    if (product.expiresAt.getTime() <= Date.now()) throw new BadRequestException('혈액제제가 만료되어 긴급 출고할 수 없습니다');
    const transfusion = await this.prisma.$transaction(async (tx) => {
      const upd = await tx.bloodProduct.updateMany({ where: { id: bloodProductId, status: 'AVAILABLE' }, data: { status: 'ISSUED' } });
      if (upd.count === 0) throw new ConflictException('혈액제제가 이미 출고/사용되었습니다(동시 출고 충돌)');
      return tx.bloodTransfusion.create({ data: { orderId, bloodProductId, patientId: order.patientId, emergencyRelease: true, emergencyReason: reason } });
    });
    // MTP 팩 자동소진(A-7) — 긴급 출고도 동일 반영(MTP는 대량수혈 상황이라 긴급 출고가 주 경로)
    void this.consumeMtpPack(order.patientId);
    return transfusion;
  }

  // ── P2: 반응 신고·특수제제·반납/폐기 ──

  async reportReactionDetail(transfusionId: string, data: { reactionType: string; severity: string; signs?: string; workup?: Record<string, unknown>; managementNote?: string; outcome?: string; reportedToBloodCenter?: boolean }, reportedBy: string) {
    const t = await this.prisma.bloodTransfusion.findUnique({ where: { id: transfusionId } });
    if (!t) throw new NotFoundException('수혈 기록을 찾을 수 없습니다');
    /**
     * 🔴 (2026-09-16 F3) 수혈 부작용 표시와 **부작용 보고서**는 한 트랜잭션이다.
     *    종전엔 수혈 행을 먼저 REACTION 으로 커밋해서, 보고서 생성이 실패하면
     *    "부작용이 일어난 수혈"은 남고 **보고서 목록(`getReactionReports`)에는 없는** 상태가 됐다 —
     *    혈액원 보고의 근거가 되는 목록이라, 보고해야 할 건이 아무 화면에도 안 뜬다.
     */
    return this.prisma.$transaction(async (tx) => {
    await tx.bloodTransfusion.update({ where: { id: transfusionId }, data: { reactionOccurred: true, reactionType: data.reactionType, reactionSeverity: data.severity, status: 'REACTION' } });
    return tx.transfusionReactionReport.upsert({
      where: { transfusionId },
      update: { reactionType: data.reactionType, severity: data.severity, signs: data.signs ?? null, workup: (data.workup ?? Prisma.JsonNull) as Prisma.InputJsonValue, managementNote: data.managementNote ?? null, outcome: data.outcome ?? null, reportedToBloodCenter: data.reportedToBloodCenter ?? false, reportedAt: data.reportedToBloodCenter ? new Date() : null, reportedBy },
      create: { transfusionId, patientId: t.patientId, reactionType: data.reactionType, severity: data.severity, signs: data.signs ?? null, workup: (data.workup ?? Prisma.JsonNull) as Prisma.InputJsonValue, managementNote: data.managementNote ?? null, outcome: data.outcome ?? null, reportedToBloodCenter: data.reportedToBloodCenter ?? false, reportedAt: data.reportedToBloodCenter ? new Date() : null, reportedBy },
    });
    });
  }

  async getReactionReports(reportedOnly?: boolean) {
    return this.prisma.transfusionReactionReport.findMany({
      where: reportedOnly ? { reportedToBloodCenter: true } : {},
      orderBy: { createdAt: 'desc' }, take: 200,
    });
  }

  async setProductAttributes(id: string, attrs: { irradiated?: boolean; leukoreduced?: boolean; cmvNegative?: boolean; washed?: boolean }) {
    const p = await this.prisma.bloodProduct.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('혈액제제를 찾을 수 없습니다');
    return this.prisma.bloodProduct.update({ where: { id }, data: attrs });
  }

  /** 반납(→AVAILABLE) / 폐기(→DISCARDED) + 사유 */
  async disposeProduct(id: string, action: string, reason: string) {
    const p = await this.prisma.bloodProduct.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('혈액제제를 찾을 수 없습니다');
    const status = action === 'RETURN' ? 'AVAILABLE' : 'DISCARDED';
    return this.prisma.bloodProduct.update({ where: { id }, data: { status, discardReason: `[${action}] ${reason}` } });
  }

  // ── P3: 재고 임계 알림·발주 ──

  /** 혈액형×제제 재고가 임계 미만 알림 */
  /**
   * 재고 임계 알림(A-7 SystemConfig화) — 임계값을 config로 이관.
   * - `bloodbank.inventoryMin`(기본 2): 전 제제 공통 최소 재고
   * - `bloodbank.inventoryMinByType`(JSON, 예 {"PRBC":4,"FFP":2}): 제제유형별 차등 임계(공통값 오버라이드)
   * 완전 소진(0) 조합: 재고 이력이 있는 제제유형 × 표준 혈액형 중 AVAILABLE 0건도 경고(구 빈 스텁 실구현).
   */
  async getInventoryAlerts() {
    // 🔴 키 공간은 DB 정본(bloodType='A'…'AB' + rhFactor='POS'/'NEG')이다. 종전엔 표준표를
    //    'A+' 합성 문자열로 만들어 실재 키('A')와 영원히 어긋났고 — 실재 재고(PRBC A 3단위)가
    //    있어도 "PRBC A+ 0단위" 유령 알림 32건이 붉게 섰다(P1-ⓐ: 표본 부재를 재고 0으로).
    const stats = await this.prisma.bloodProduct.groupBy({ by: ['productType', 'bloodType', 'rhFactor'], _count: { id: true }, where: { status: 'AVAILABLE' } });

    const rawMin = await this.config?.get('bloodbank.inventoryMin').catch(() => null);
    const min = Number.isFinite(Number(rawMin)) && Number(rawMin) > 0 ? Number(rawMin) : 2;
    const byTypeRaw = await this.config?.get('bloodbank.inventoryMinByType').catch(() => null);
    const byType = (byTypeRaw && typeof byTypeRaw === 'object' ? byTypeRaw : {}) as Record<string, unknown>;
    const minFor = (productType: string) => {
      const v = Number(byType[productType]);
      return Number.isFinite(v) && v > 0 ? v : min;
    };

    const present = new Map(stats.map(s => [`${s.productType}|${s.bloodType}|${s.rhFactor}`, s._count.id]));
    const alerts: { productType: string; bloodType: string; rhFactor: string; count: number; min: number }[] = [];
    for (const s of stats) {
      const m = minFor(s.productType);
      if (s._count.id < m) alerts.push({ productType: s.productType, bloodType: s.bloodType, rhFactor: s.rhFactor, count: s._count.id, min: m });
    }
    // 완전 소진(0) 조합 — 재고 이력이 있는 제제유형(전 상태) × 표준 ABO×Rh 중 AVAILABLE 부재
    const knownTypes = await this.prisma.bloodProduct.groupBy({ by: ['productType'], _count: { id: true } });
    const STD_ABO = ['A', 'B', 'O', 'AB'];
    const STD_RH = ['POS', 'NEG'];
    for (const t of knownTypes) {
      for (const abo of STD_ABO) {
        for (const rh of STD_RH) {
          if (!present.has(`${t.productType}|${abo}|${rh}`)) {
            alerts.push({ productType: t.productType, bloodType: abo, rhFactor: rh, count: 0, min: minFor(t.productType) });
          }
        }
      }
    }
    alerts.sort((a, b) => a.count - b.count || a.productType.localeCompare(b.productType) || a.bloodType.localeCompare(b.bloodType));
    return { alerts, min };
  }

  async createReorder(data: { productType: string; bloodType: string; units: number; urgency?: string; supplierName?: string; notes?: string }, requestedBy: string) {
    return this.prisma.bloodReorderRequest.create({
      data: { productType: data.productType, bloodType: data.bloodType, units: data.units, urgency: data.urgency ?? 'ROUTINE', supplierName: data.supplierName ?? null, notes: data.notes ?? null, requestedBy },
    });
  }

  async getReorders(status?: string) {
    return this.prisma.bloodReorderRequest.findMany({ where: status ? { status } : {}, orderBy: { requestedAt: 'desc' }, take: 200 });
  }

  async updateReorderStatus(id: string, status: string) {
    const r = await this.prisma.bloodReorderRequest.findUnique({ where: { id } });
    if (!r) throw new NotFoundException('발주 요청을 찾을 수 없습니다');
    return this.prisma.bloodReorderRequest.update({ where: { id }, data: { status } });
  }

  // ── Dashboard ──

  async getDashboard() {
    // 🔴 FE 재고 매트릭스는 {제제유형: {'A+': n}} 객체를 그린다. 종전엔 groupBy **배열**을
    //    그대로 실어 유형 열에 '0'..'13', 셀 전 칸 0, 합계 열엔 문자열이 이어붙었다(P11).
    //    가용(AVAILABLE)만 재고로 센다 — 출고·예약분은 재고가 아니다.
    const invStats = await this.prisma.bloodProduct.groupBy({
      by: ['productType', 'bloodType', 'rhFactor'],
      _count: { id: true },
      where: { status: 'AVAILABLE' },
    });
    const inventoryMatrix: Record<string, Record<string, number>> = {};
    let totalInventory = 0;
    for (const s of invStats) {
      const bt = `${s.bloodType}${s.rhFactor === 'NEG' ? '-' : '+'}`; // rhFactor NOT NULL(POS/NEG)
      const row = (inventoryMatrix[s.productType] ??= {});
      row[bt] = (row[bt] ?? 0) + s._count.id;
      totalInventory += s._count.id;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const [ordersToday, transfusionsToday, pendingCrossmatch, expiringSoon] = await Promise.all([
      this.prisma.transfusionOrder.count({
        where: { orderedAt: { gte: today, lt: tomorrow } },
      }),
      this.prisma.bloodTransfusion.count({
        where: { startTime: { gte: today, lt: tomorrow } },
      }),
      this.prisma.bloodCrossmatch.count({ where: { testedAt: null } }), // 의뢰됐고 아직 미판정 = 대기
      this.prisma.bloodProduct.count({
        where: {
          status: 'AVAILABLE',
          expiresAt: {
            gte: new Date(),
            lte: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          },
        },
      }),
    ]);

    return {
      inventoryMatrix,
      // FE 계약 필드 — 종전엔 todayStats 아래에만 있어 상단 카드 3칸이 전부 '-' 였다(P11)
      totalInventory,
      todayOrders: ordersToday,
      pendingCrossmatch,
      todayStats: {
        ordersToday,
        transfusionsToday,
        expiringSoon,
      },
    };
  }
}
