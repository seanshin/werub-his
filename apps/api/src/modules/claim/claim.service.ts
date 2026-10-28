import { JourneyService } from '../journey/journey.service';
import { Injectable, NotFoundException, BadRequestException, ConflictException, Logger, Optional, UnprocessableEntityException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ClaimStatus, Prisma } from '@prisma/client';
import { IntegrationOutboxService } from '../integration/integration-outbox.service';
import { NotificationService } from '../notification/notification.service';
// 🔴 심평원 전송 정본(C1) — 청구 층에서도 같은 함수를 쓴다(정본이 둘이면 갈라진다).
import { HIRA_CHANNEL, notTransmittedNote, transmitToHira } from '../hira-edi/hira-transmission';
import { withAdvisoryLock } from '../../common/util/advisory-lock';
import { claimBillingLockKey } from './claim-billing-lock';
import { decryptLegacyPid } from '../../common/crypto/legacy-pid-crypto';
import { assertEnumParam } from '../../common/enum-param';
import { requireHospitalIdentityForSubmission } from '../config/hospital-facts';
import { isInternalCodeId, resolveEdiCodes } from '../hira-edi/edi-code';
import { localDateKey } from '../../common/day-range';
import { buildClaimData, OTHER_PAYER_TYPES, REVIEWABLE_CLAIM_STATUSES } from './claim-data';

/**
 * 🔴 청구 파일(EDI·XML)의 기관 식별 키 — 대외 제출물이라 DB 행만 읽고, 비었으면 파일을 만들지 않는다(422).
 *    종전엔 `12345678`·`Hospital RUN` 이 코드에 박혀 설정조차 읽지 않았다(2026-09-11 회수).
 * 🔴 **그 파일이 실제로 싣는 키만** 요구한다 — 싣지도 않는 키를 필수로 걸면 담당자가 아무 값이나 넣어 통과한다
 *    (EDI 파이프 레코드에는 기관명 칸이 없다 · XML 헤더에는 코드·명이 둘 다 있다).
 */
const CLAIM_XML_IDENTITY_KEYS = ['hospital.code', 'hospital.name'] as const;
const CLAIM_EDI_IDENTITY_KEYS = ['hospital.code'] as const;

interface ClaimDataJson {
  claimYearMonth?: string;
  /** 청구 생성 때 환자 보험유형(NHI·MEDICAID) — P2-2 이전 청구엔 없다 */
  payerType?: string;
  /** 진료일(병원 시간대 달력 날짜) — P2-2 이전 청구엔 없다 */
  serviceDate?: string;
  totalAmount?: number;
  insuranceClaimed?: number;
  patientCopay?: number;
  items?: Array<{ code?: string; codeId?: string; name?: string; codeName?: string; amount: number; quantity: number; unitPrice?: number; insuranceCategory?: string | null }>;
}



@Injectable()
export class ClaimService {
  private readonly logger = new Logger(ClaimService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: IntegrationOutboxService,
    private readonly notification: NotificationService,
    /** 여정 정본 발행기(2026-10-01 P0-6 — 직접 쓰기 이관) */
    @Optional() private readonly journey?: JourneyService,
  ) {}

  /**
   * 심사 결과 콜백(심사 P3) → 의료진 알림 릴레이. (ERP/심사 → HIS, 샘플 인터페이스 — 실 스펙 확정 시 조정)
   * 의사 해소: doctorId 직접 > claimId→billing→encounter.doctorId > encounterId→encounter.doctorId.
   */
  async reviewCallback(dto: {
    claimId?: string; encounterId?: string; doctorId?: string;
    result: string; reducedAmount?: number; reason?: string; reviewedAt?: string;
  }): Promise<{ ok: boolean; doctorId?: string; notified?: boolean }> {
    let doctorId = dto.doctorId ?? null;
    let claimRef = dto.claimId ?? dto.encounterId ?? null;
    // 🔴 (2026-09-16 K4) 종전엔 두 조회가 `.catch(() => null)` 이라 **DB 실패가 "담당의 없음"과 같은 값**이 됐다.
    //    그러면 삭감·반려 알림이 조용히 사라지고, 심사기관에는 `{ok:false}`(=의사 미상)로 답해 **재시도도 오지 않는다**.
    //    조회 실패는 전파한다 — 외부 콜백은 5xx 를 보고 재시도하는 것이 옳다(N4 의 ERP 멱등 조회와 같은 선택).
    if (!doctorId && dto.claimId) {
      const claim = await this.prisma.claim.findUnique({ where: { id: dto.claimId }, select: { billing: { select: { encounter: { select: { doctorId: true, id: true } } } } } });
      doctorId = claim?.billing?.encounter?.doctorId ?? null;
      claimRef = dto.claimId;
    }
    if (!doctorId && dto.encounterId) {
      const enc = await this.prisma.encounter.findUnique({ where: { id: dto.encounterId }, select: { doctorId: true } });
      doctorId = enc?.doctorId ?? null;
    }
    if (!doctorId) return { ok: false };
    const sev = dto.result === 'REJECTED' || dto.result === 'REDUCED' ? 'WARNING' : 'INFO';
    const msg = dto.result === 'APPROVED' ? '청구가 심사 승인되었습니다.'
      : dto.result === 'REDUCED' ? `청구가 일부 삭감되었습니다${dto.reducedAmount ? ` (-${dto.reducedAmount.toLocaleString()}원)` : ''}.${dto.reason ? ' 사유: ' + dto.reason : ''}`
      : dto.result === 'REJECTED' ? `청구가 반려되었습니다.${dto.reason ? ' 사유: ' + dto.reason : ''}`
      : `심사 결과: ${dto.result}`;
    // 🔴 알림이 실패해도 `notified: true` 라 답하던 자리 — 보낸 것과 실패한 것을 뒤바꿔 말하지 않는다
    const notified = await this.notification.notify(doctorId, {
      type: 'CLAIM_REVIEW', title: '심사 결과 알림', message: msg, severity: sev,
      refType: 'CLAIM', refId: claimRef ?? undefined,
    }).then(() => true).catch((e) => {
      this.logger.warn(`심사결과 알림 실패: ${(e as Error).message}`);
      return false;
    });
    return { ok: true, doctorId, notified };
  }

  async findAll(filters: { status?: string; page?: number; limit?: number }) {
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 20;
    const where: Prisma.ClaimWhereInput = {};
    if (filters.status) { assertEnumParam(filters.status, ClaimStatus, '상태'); where.status = filters.status as ClaimStatus; }

    const [data, total] = await Promise.all([
      this.prisma.claim.findMany({
        where, skip: (page - 1) * limit, take: limit,
        orderBy: { createdAt: 'desc' },
        include: { patient: { select: { id: true, mrn: true, familyName: true, givenName: true } } },
      }),
      this.prisma.claim.count({ where }),
    ]);
    return { data, pagination: { total, page, limit, hasMore: page * limit < total } };
  }

  /**
   * 미청구(PAID·청구 0건) 수납을 훑어 청구를 만든다 — 화면 `/claims` 의 '청구 생성' 버튼이 부른다.
   *
   * 🔴 (2026-09-28 재판정 a13360) 종전엔 `claims: { none: {} }` 를 **한 번 읽고** 바로 만들었다(check-then-act).
   *    순차 재클릭은 두 번째가 걸러지지만 **동시 호출**(탭 둘·느린 응답 뒤 재시도·두 사람)은 같은 목록을
   *    둘 다 읽고 둘 다 만든다 → 같은 수납에 청구 두 벌 = **보험 이중청구**. `billingId` 에는 유니크가 없고
   *    `claimNumber @unique` 는 `String?` 이며 여기서 적지 않는다 — DB 는 심판이 아니다.
   *    → 정본 `withAdvisoryLock` 으로 **수납 단위 직렬화**, 잠근 뒤 **다시 센다**(재확인이 없으면 잠금은 아무것도 막지 않는다).
   *    키는 `InsuranceClaimService.create` 와 공유한다(`claimBillingLockKey`).
   * 🔴 `skipped` 를 함께 돌려준다 — "0건 생성"이 경합으로 건너뛴 것인지 대상이 없던 것인지 갈린다.
   */
  async generateClaims() {
    // 미청구 수납 중 PAID 상태인 것들 조회(후보 — 확정은 잠근 뒤 다시 센다)
    const unpaidBillings = await this.prisma.billing.findMany({
      where: { status: 'PAID', claims: { none: {} } },
      include: {
        patient: { select: { id: true, insuranceType: true } },
        encounter: { select: { createdAt: true } },
        items: true,
      },
    });

    const created = [];
    let skipped = 0;
    // 🔴 (2026-09-30) 자비 제외를 세지 않아 화면이 "대상이 없다"와 "자비라 뺐다"를 가를 수 없었다
    let excludedSelfPay = 0;
    // 🔴 (P2-2) 산재·자동차보험도 건강보험 청구 파일로 만들어졌다(보험유형 칸이 늘 'NHI') — 청구처가 다르다
    let excludedOtherPayer = 0;
    const codeOf = await resolveEdiCodes(this.prisma, unpaidBillings.flatMap((b) => b.items.map((i) => i.codeId)));
    for (const billing of unpaidBillings) {
      if (billing.patient.insuranceType === 'SELF_PAY') { excludedSelfPay += 1; continue; } // 자비는 청구 불필요
      if (OTHER_PAYER_TYPES.has(billing.patient.insuranceType)) { excludedOtherPayer += 1; continue; }

      const claim = await withAdvisoryLock(this.prisma, claimBillingLockKey(billing.id), async (tx) => {
        // 🔴 후보 조회와 같은 기준(`claims: { none: {} }` = 어떤 청구든 있으면 제외)으로 잠근 뒤 다시 센다.
        const already = await tx.claim.count({ where: { billingId: billing.id } });
        if (already > 0) return null;
        return tx.claim.create({
          data: {
            billingId: billing.id,
            patientId: billing.patientId,
            claimDate: new Date(),
            claimedAmount: billing.insuranceCovered,
            claimData: buildClaimData(billing, {
              payerType: billing.patient.insuranceType,
              serviceDate: billing.encounter?.createdAt ? localDateKey(billing.encounter.createdAt) : undefined,
              codeOf,
            }) as unknown as Prisma.InputJsonValue,
          },
        });
      });
      if (claim) created.push(claim);
      else skipped += 1;
    }
    return { generated: created.length, skipped, excludedSelfPay, excludedOtherPayer, claims: created };
  }

  async findById(id: string) {
    const claim = await this.prisma.claim.findUnique({
      where: { id },
      include: {
        patient: { select: { id: true, mrn: true, familyName: true, givenName: true, insuranceNumber: true, insuranceType: true } },
        billing: { include: { items: true, encounter: { select: { createdAt: true } } } },
      },
    });
    if (!claim) throw new NotFoundException('Claim not found');
    return claim;
  }

  /**
   * 🔴 2026-08-20 전송 정직성 — 종전 이 메서드는 `status:'SUBMITTED'` · `submittedAt: new Date()` 를
   * **적기만** 했다. 심평원(요양기관업무포털)으로 나가는 전송 코드는 이 저장소에 존재한 적이 없고
   * (같은 결함을 EDI 명세서 층에서 이미 봉합했다 — 정본 `hira-edi/hira-transmission.ts` C1),
   * `outbox.enqueue('claim.submitted')` 는 **ERP 통보**이지 보험자 제출이 아니다.
   * 그런데 화면(`/claims`)은 '제출' 배지와 제출 시각을 보여줬다.
   *
   * 이제 정본 `transmitToHira()` 로 전송을 시도하고, **나가지 않았으면 시각을 남기지 않는다**.
   * 실제 연동이 붙는 날 고칠 자리는 여전히 `HIRA_CHANNEL.implemented` / `transmitToHira()` 두 곳뿐이다.
   *
   * ⚠️ 상태를 `LOCAL_RECORDED` 로 적지 못하는 이유: `ClaimStatus` 는 Prisma **enum** 이라 값 추가가
   *    스키마 변경(사람 승인)이다. 그동안 미전송 근거는 `claimData.transmission` 에 남는다.
   * ⚠️ `claimNumber`(CLM-…)는 그대로 둔다 — 청구번호는 **요양기관이 부여**하는 번호라 날조가 아니다
   *    (KCDC-…/HIRA 접수번호처럼 기관 부여를 사칭하는 값이 아니다). EDI/XML 청구번호로도 쓰인다.
   * ⚠️ 전송 채널 자체는 **대외 발신이라 사람 결정** — 코드가 할 수 있는 것은 여기까지다.
   */
  async submit(id: string) {
    const prev = await this.prisma.claim.findUnique({ where: { id }, select: { claimData: true, claimNumber: true, status: true } });
    if (!prev) throw new NotFoundException('청구를 찾을 수 없습니다');
    // 🔴 (P2-3) 종전엔 상태를 보지 않아 심사·지급이 끝난 청구(APPROVED·PAID…)도 SUBMITTED 로 덮였다.
    //    제출은 작성 중(DRAFT)과, 이미 제출했지만 **나가지 않은** 청구의 재시도만. 재청구는 이의신청 경로가 정본.
    const prevOutcome = ((prev.claimData as Prisma.JsonObject | null)?.transmission as Prisma.JsonObject | undefined)?.outcome;
    if (!(prev.status === 'DRAFT' || (prev.status === 'SUBMITTED' && prevOutcome !== 'SENT'))) {
      throw new ConflictException({ code: 'CLAIM_NOT_SUBMITTABLE', message: '작성 중인 청구(또는 전송되지 않은 제출 건)만 제출할 수 있습니다', details: { status: prev.status } });
    }
    const now = new Date();
    const result = await transmitToHira(prev?.claimData ?? null);
    const sent = result.outcome === 'SENT';
    const transmission = sent
      ? { channel: HIRA_CHANNEL.key, outcome: result.outcome, receiptNo: result.externalRef ?? null, transmittedAt: (result.at ?? now).toISOString() }
      : {
          channel: HIRA_CHANNEL.key, outcome: result.outcome, receiptNo: null,
          recordedAt: now.toISOString(),
          note: notTransmittedNote(now, result.reason),
          manualFallback: HIRA_CHANNEL.manualFallback,
        };
    // 예상된 미구축은 warn(실패는 아니다) — 예상된 상태까지 error 로 울리면 진짜 경보가 묻힌다.
    if (!sent) this.logger.warn(`청구 ${id} 미전송(${result.outcome}) — ${result.reason ?? HIRA_CHANNEL.name} · 조치: ${HIRA_CHANNEL.manualFallback}`);

    const upd = await this.prisma.claim.updateMany({
      where: { id, status: prev.status },
      data: {
        status: 'SUBMITTED',
        submittedAt: sent ? (result.at ?? now) : null, // 🔴 나가지 않았으므로 제출 시각을 적지 않는다
        claimNumber: prev?.claimNumber ?? `CLM-${Date.now()}`,
        claimData: { ...((prev?.claimData as Prisma.JsonObject) ?? {}), transmission } as Prisma.InputJsonValue,
      },
    });
    if (upd.count === 0) throw new ConflictException({ code: 'CLAIM_CHANGED', message: '다른 처리로 청구 상태가 바뀌었습니다 — 새로 고친 뒤 다시 시도하세요' });
    const c = await this.prisma.claim.findUniqueOrThrow({ where: { id } });
    // §3 봉합: 재제출(appeal 후) 반영 — 종전엔 ref 를 submittedAt 에 바인딩했으나 미전송이면 null 이라
    //  모든 재제출이 같은 ref 로 skipDuplicates 폐기된다 → 제출 시도 시각(now)에 바인딩한다.
    //  payload 에 전송 결과를 함께 실어 수신측(ERP)이 '제출됨'으로 오독하지 않게 한다.
    void this.outbox.enqueue('claim', 'claim.submitted', `claim:submit:${id}:${now.getTime()}`, {
      claimId: id, claimNumber: c.claimNumber, claimedAmount: c.claimedAmount, status: c.status,
      transmitted: sent, transmissionOutcome: result.outcome,
    });
    return { ...c, transmission };
  }

  // ── 심사조정(삭감) 라인 (R3-3) — 총액 삭감을 항목·사유코드 단위로 ──

  /** 조정 라인 일괄 기록 — Σ금액이 claim.reducedAmount와 불일치하면 경고 동봉(정합 점검) */
  async addAdjustments(
    claimId: string,
    lines: { lineRef?: string; itemName?: string; adjustCode: string; adjustReason?: string; amount: number; status?: string }[],
    recordedBy?: string,
  ) {
    const claim = await this.prisma.claim.findUnique({ where: { id: claimId }, select: { id: true, reducedAmount: true } });
    if (!claim) throw new NotFoundException('청구를 찾을 수 없습니다');
    if (!lines?.length) throw new BadRequestException('조정 라인이 없습니다');
    for (const l of lines) {
      if (!l.adjustCode?.trim()) throw new BadRequestException('사유코드(adjustCode)는 필수입니다');
      if (!Number.isFinite(l.amount) || l.amount <= 0) throw new BadRequestException('삭감액(amount)은 양수여야 합니다');
    }
    const created = await this.prisma.$transaction(
      lines.map((l) => this.prisma.claimAdjustment.create({
        data: {
          claimId,
          lineRef: l.lineRef?.slice(0, 120), itemName: l.itemName?.slice(0, 200),
          adjustCode: l.adjustCode.trim().slice(0, 20), adjustReason: l.adjustReason?.slice(0, 300),
          amount: Math.round(l.amount),
          status: ['ACCEPTED', 'APPEALING', 'REWORK', 'RESOLVED'].includes(l.status ?? '') ? l.status! : 'ACCEPTED',
          recordedBy: recordedBy ?? null,
        },
      })),
    );
    const totalLines = await this.prisma.claimAdjustment.aggregate({ where: { claimId }, _sum: { amount: true } });
    const lineSum = totalLines._sum.amount ?? 0;
    const mismatch = claim.reducedAmount != null && lineSum !== claim.reducedAmount;
    return {
      created: created.length,
      lineSum,
      claimReducedAmount: claim.reducedAmount,
      ...(mismatch ? { warning: `조정 라인 합계(${lineSum.toLocaleString()}원)가 청구 삭감 총액(${(claim.reducedAmount ?? 0).toLocaleString()}원)과 다릅니다 — 라인 누락/중복 확인` } : {}),
    };
  }

  async getAdjustments(claimId: string) {
    return this.prisma.claimAdjustment.findMany({ where: { claimId }, orderBy: { createdAt: 'asc' } });
  }

  /** 조정 라인 상태 전이 — 이의(APPEALING)·재작업(REWORK)·해소(RESOLVED) 재작업 큐 */
  async setAdjustmentStatus(adjustmentId: string, status: string, recordedBy?: string) {
    if (!['ACCEPTED', 'APPEALING', 'REWORK', 'RESOLVED'].includes(status)) {
      throw new BadRequestException('status는 ACCEPTED|APPEALING|REWORK|RESOLVED');
    }
    return this.prisma.claimAdjustment.update({ where: { id: adjustmentId }, data: { status, recordedBy: recordedBy ?? undefined } });
  }

  /** 삭감 패턴 통계 — 사유코드별 건수·금액(재발 방지 분석), 상태 분포 */
  async getAdjustmentStats(from?: string, to?: string) {
    const where = {
      ...(from || to ? { createdAt: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(`${to}T23:59:59.999Z`) } : {}) } } : {}),
    };
    const [byCode, byStatus, total] = await Promise.all([
      this.prisma.claimAdjustment.groupBy({ by: ['adjustCode'], where, _count: { _all: true }, _sum: { amount: true }, orderBy: { _sum: { amount: 'desc' } }, take: 20 }),
      this.prisma.claimAdjustment.groupBy({ by: ['status'], where, _count: { _all: true }, _sum: { amount: true } }),
      this.prisma.claimAdjustment.aggregate({ where, _count: { _all: true }, _sum: { amount: true } }),
    ]);
    return {
      total: { count: total._count._all, amount: total._sum.amount ?? 0 },
      byCode: byCode.map((r) => ({ adjustCode: r.adjustCode, count: r._count._all, amount: r._sum.amount ?? 0 })),
      byStatus: byStatus.map((r) => ({ status: r.status, count: r._count._all, amount: r._sum.amount ?? 0 })),
    };
  }

  async review(
    id: string,
    body: {
      reviewResult?: 'APPROVED' | 'PARTIALLY_APPROVED' | 'REJECTED';
      approvedAmount: number; reducedAmount?: number; rejectReason?: string; reducedReason?: string;
    },
  ) {
    const claim = await this.prisma.claim.findUnique({ where: { id }, select: { billingId: true, claimedAmount: true, patientId: true, status: true } });
    if (!claim) throw new NotFoundException('청구를 찾을 수 없습니다');

    // 🔴 (P2-3) 종전엔 상태 가드도 금액 검증도 없었다 — 제출 전(DRAFT)·지급 끝(PAID) 청구도 심사되고,
    //    인정액 > 청구액·음수·소수(Int 컬럼 500)·'인정'인데 삭감액이 남는 조합이 그대로 저장됐다.
    //    화면은 인정액 칸을 비우면 0 을 보내 **'인정 0 · 삭감 0'** 이 원장·수납·ERP 로 나갔다.
    //    쌍둥이 경로(insurance-claim review)와 같은 규칙으로 맞춘다. 이미 심사된 청구의 재심사(금액 정정)는 그대로 열어 둔다.
    if (!(REVIEWABLE_CLAIM_STATUSES as readonly string[]).includes(claim.status)) {
      throw new ConflictException({ code: 'CLAIM_NOT_REVIEWABLE', message: '제출된 청구만 심사 결과를 기록할 수 있습니다', details: { status: claim.status } });
    }
    // 🔴 심사자가 고른 결과가 정본이다. 종전엔 이 값이 DTO 에 없어 버려지고 사유·삭감액 유무로만
    //    추론해, **반려·부분인정을 골라도 전부 APPROVED** 로 저장됐다(2026-08-13 W6).
    const reason = body.rejectReason ?? body.reducedReason;
    const status = body.reviewResult
      ?? (reason ? 'REJECTED' : body.reducedAmount ? 'PARTIALLY_APPROVED' : 'APPROVED');
    const claimed = claim.claimedAmount;
    const bad = (message: string) => { throw new BadRequestException({ code: 'CLAIM_REVIEW_AMOUNT', message, details: { status, claimedAmount: claimed, approvedAmount: body.approvedAmount ?? null, reducedAmount: body.reducedAmount ?? null } }); };
    const isWon = (v: unknown) => typeof v === 'number' && Number.isInteger(v) && v >= 0;
    if (body.approvedAmount != null && !isWon(body.approvedAmount)) bad('인정액은 0 이상의 원 단위 정수여야 합니다');
    if (body.reducedAmount != null && !isWon(body.reducedAmount)) bad('삭감액은 0 이상의 원 단위 정수여야 합니다');
    let approved: number;
    if (status === 'REJECTED') {
      if ((body.approvedAmount ?? 0) > 0) bad('반려는 인정액이 0 입니다');
      approved = 0;
    } else if (status === 'APPROVED') {
      if (body.approvedAmount != null && body.approvedAmount !== claimed) bad('전액 인정은 인정액 = 청구액입니다 — 금액이 다르면 부분인정으로 기록하세요');
      approved = claimed;
    } else {
      if (body.approvedAmount == null) bad('부분인정은 인정액을 입력해야 합니다');
      approved = body.approvedAmount as number;
      if (approved >= claimed) bad('부분인정 인정액은 청구액보다 작아야 합니다');
    }
    const reduced = claimed - approved;
    if (body.reducedAmount != null && body.reducedAmount !== reduced) bad('삭감액 = 청구액 − 인정액이어야 합니다');
    const now = new Date();

    // 청구 + Billing 정산을 원자적으로: 원본 insuranceCovered 보존, 심사 승인액/삭감액을 별도 기록(삭감=병원 부담·환자 미청구)
    // 상태는 읽은 값 그대로일 때만 바꾼다(동시 심사·지급 처리와 겹치면 409)
    const c = await this.prisma.$transaction(async (tx) => {
      const r = await tx.claim.updateMany({
        where: { id, status: claim.status },
        data: { status, approvedAmount: approved, reducedAmount: reduced, rejectReason: reason, reviewedAt: now },
      });
      if (r.count === 0) throw new ConflictException({ code: 'CLAIM_CHANGED', message: '다른 처리로 청구 상태가 바뀌었습니다 — 새로 고친 뒤 다시 시도하세요' });
      await tx.billing.update({
        where: { id: claim.billingId },
        data: { reviewedInsuranceAmount: approved, insuranceReducedAmount: reduced, insuranceAdjustedAt: now },
      });
      return tx.claim.findUniqueOrThrow({ where: { id } });
    });

    // 삭감/반려는 환자 여정에 재무 이벤트로 기록(가시화)
    if (status !== 'APPROVED' && reduced > 0) {
      this.journey?.emit({
          patientId: claim.patientId,
          eventType: 'CLAIM_REVIEW',
          title: status === 'REJECTED' ? '청구 반려(심사)' : '청구 일부 삭감(심사)',
          description: [`삭감액 ${reduced.toLocaleString()}원`, reason].filter(Boolean).join(' · '),
          department: '원무/보험',
          refType: 'CLAIM',
          refId: id,
          navUrl: '/claims',
          severity: 'WARNING',
        });
    }

    // 심사결과(승인/삭감) → ERP 회계(AR·삭감 반영)
    // §3 봉합: 재심사 금액정정 반영 — ref에 결과·금액 바인딩(동일 ref면 정정 재심사가 폐기돼 ERP AR 구금액 고정)
    void this.outbox.enqueue('claim', 'claim.reviewed', `claim:review:${id}:${status}:${approved}:${reduced}`, {
      claimId: id, claimNumber: c.claimNumber, status, approvedAmount: approved, reducedAmount: reduced, rejectReason: body.rejectReason ?? null,
    });
    return c;
  }

  async getSummary() {
    const claims = await this.prisma.claim.groupBy({
      by: ['status'],
      _sum: { claimedAmount: true, approvedAmount: true, reducedAmount: true, paidAmount: true },
      _count: true,
    });
    return claims;
  }

  async generateEdi(claimId: string): Promise<string> {
    const claim = await this.findById(claimId);
    const claimData = claim.claimData as ClaimDataJson | null;
    const patientName = (claim.patient?.familyName || '') + (claim.patient?.givenName || '');
    const mrn = claim.patient?.mrn || '';
    // 🔴 (P2-2) 종전 `billing.insuranceType || 'NHI'` — Billing 에 그 칸이 없어 **늘 'NHI'** 였다(의료급여 분기 도달 0)
    const facts = await this.claimFileFacts(claim);
    const insuranceType = facts.payerType;
    const claimYearMonth = claimData?.claimYearMonth || new Date().toISOString().slice(0, 7).replace('-', '');
    const claimNumber = claim.claimNumber || claim.id;
    // 청구구분: 1=건강보험, 2=의료급여, 3=자비
    const claimTypeCode = insuranceType === 'MEDICAID' ? '2' : insuranceType === 'SELF_PAY' ? '3' : '1';
    const institutionCode = (await requireHospitalIdentityForSubmission(this.prisma, CLAIM_EDI_IDENTITY_KEYS))['hospital.code'];

    const lines: string[] = [];

    // 헤더 레코드 (H)
    lines.push(['H', institutionCode, claimYearMonth, claimTypeCode, patientName, mrn, insuranceType, claimNumber].join('|'));

    // 항목 레코드 (I)
    for (const item of facts.items) {
      const code = item.code as string;
      const name = item.name;
      const unitPrice = item.unitPrice ?? item.amount ?? 0;
      const quantity = item.quantity ?? 1;
      const amount = item.amount ?? 0;
      // 급여구분: A=급여, B=비급여 — 라인 insuranceCategory 기반(미기록 구라인은 A 폴백=기존 동작)
      const benefitType = item.insuranceCategory === 'NON_COVERED' ? 'B' : 'A';
      lines.push(['I', code, name, unitPrice, quantity, amount, benefitType].join('|'));
    }

    // 푸터 레코드 (F)
    const totalAmount = claimData?.totalAmount ?? claim.claimedAmount ?? 0;
    const insuranceClaimed = claimData?.insuranceClaimed ?? claim.claimedAmount ?? 0;
    const patientCopay = claimData?.patientCopay ?? 0;
    lines.push(['F', totalAmount, insuranceClaimed, patientCopay].join('|'));

    return lines.join('\n');
  }

  async generateHiraXml(id: string): Promise<string> {
    const claim = await this.findById(id);
    const inst = await requireHospitalIdentityForSubmission(this.prisma, CLAIM_XML_IDENTITY_KEYS);
    return this.buildHiraXmlForClaim(claim, inst, await this.claimFileFacts(claim));
  }

  async generateBatchHiraXml(claimIds: string[]): Promise<string> {
    const claims = await Promise.all(claimIds.map((id) => this.findById(id)));
    const factsList = await Promise.all(claims.map((c) => this.claimFileFacts(c)));
    const inst = await requireHospitalIdentityForSubmission(this.prisma, CLAIM_XML_IDENTITY_KEYS);
    const now = new Date().toISOString();
    let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
    xml += `<일괄청구서 xmlns="urn:hira:claim:2026">\n`;
    xml += `  <헤더>\n`;
    xml += this.institutionXml(inst, '    ');
    xml += `    <생성일시>${this.escapeXml(now)}</생성일시>\n`;
    xml += `    <총건수>${claims.length}</총건수>\n`;
    xml += `  </헤더>\n`;
    xml += `  <청구목록>\n`;
    claims.forEach((claim, n) => {
      xml += this.buildClaimXmlBody(claim, '    ', factsList[n]);
    });
    xml += `  </청구목록>\n`;
    xml += `</일괄청구서>`;
    return xml;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- complex Prisma query result with nested relations
  private buildHiraXmlForClaim(
    claim: Awaited<ReturnType<ClaimService['findById']>>,
    inst: Record<(typeof CLAIM_XML_IDENTITY_KEYS)[number], string>,
    facts: Awaited<ReturnType<ClaimService['claimFileFacts']>>,
  ): string {
    const now = new Date().toISOString();
    const claimData = claim.claimData as ClaimDataJson | null;
    let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
    xml += `<청구서 xmlns="urn:hira:claim:2026">\n`;
    xml += `  <헤더>\n`;
    xml += this.institutionXml(inst, '    ');
    xml += `    <청구년월>${this.escapeXml(claimData?.claimYearMonth || new Date().toISOString().slice(0, 7).replace('-', ''))}</청구년월>\n`;
    xml += `    <청구번호>${this.escapeXml(claim.claimNumber || claim.id)}</청구번호>\n`;
    xml += `    <생성일시>${this.escapeXml(now)}</생성일시>\n`;
    xml += `  </헤더>\n`;
    xml += `  <환자정보>\n`;
    xml += `    <등록번호>${this.escapeXml(claim.patient?.mrn || '')}</등록번호>\n`;
    xml += `    <성명>${this.escapeXml((claim.patient?.familyName || '') + (claim.patient?.givenName || ''))}</성명>\n`;
    xml += `    <보험유형>${this.escapeXml(facts.payerType)}</보험유형>\n`;
    xml += `    <보험증번호>${this.escapeXml(decryptLegacyPid(claim.patient?.insuranceNumber))}</보험증번호>\n`;
    xml += `  </환자정보>\n`;
    xml += `  <진료내역>\n`;
    xml += `    <진료일>${this.escapeXml(facts.serviceDate)}</진료일>\n`;
    xml += `    <총진료비>${claimData?.totalAmount ?? claim.claimedAmount ?? 0}</총진료비>\n`;
    xml += `    <보험자부담금>${claimData?.insuranceClaimed ?? claim.claimedAmount ?? 0}</보험자부담금>\n`;
    xml += `    <본인부담금>${claimData?.patientCopay ?? 0}</본인부담금>\n`;
    xml += `    <항목목록>\n`;
    for (const item of facts.items) {
      xml += `      <항목>\n`;
      xml += `        <코드>${this.escapeXml(item.code as string)}</코드>\n`;
      xml += `        <명칭>${this.escapeXml(item.name)}</명칭>\n`;
      xml += `        <수량>${item.quantity ?? 1}</수량>\n`;
      xml += `        <단가>${item.unitPrice ?? item.amount ?? 0}</단가>\n`;
      xml += `        <금액>${item.amount ?? 0}</금액>\n`;
      xml += `      </항목>\n`;
    }
    xml += `    </항목목록>\n`;
    xml += `  </진료내역>\n`;
    xml += `</청구서>`;
    return xml;
  }

  private buildClaimXmlBody(claim: Awaited<ReturnType<ClaimService['findById']>>, indent: string, facts: Awaited<ReturnType<ClaimService['claimFileFacts']>>): string {
    let xml = `${indent}<청구>\n`;
    xml += `${indent}  <청구번호>${this.escapeXml(claim.claimNumber || claim.id)}</청구번호>\n`;
    xml += `${indent}  <환자등록번호>${this.escapeXml(claim.patient?.mrn || '')}</환자등록번호>\n`;
    xml += `${indent}  <환자성명>${this.escapeXml((claim.patient?.familyName || '') + (claim.patient?.givenName || ''))}</환자성명>\n`;
    xml += `${indent}  <청구금액>${claim.claimedAmount ?? 0}</청구금액>\n`;
    xml += `${indent}  <보험유형>${this.escapeXml(facts.payerType)}</보험유형>\n`;
    xml += `${indent}  <진료일>${this.escapeXml(facts.serviceDate)}</진료일>\n`;
    xml += `${indent}  <항목목록>\n`;
    for (const item of facts.items) {
      xml += `${indent}    <항목>\n`;
      xml += `${indent}      <코드>${this.escapeXml(item.code as string)}</코드>\n`;
      xml += `${indent}      <명칭>${this.escapeXml(item.name)}</명칭>\n`;
      xml += `${indent}      <수량>${item.quantity ?? 1}</수량>\n`;
      xml += `${indent}      <금액>${item.amount ?? 0}</금액>\n`;
      xml += `${indent}    </항목>\n`;
    }
    xml += `${indent}  </항목목록>\n`;
    xml += `${indent}</청구>\n`;
    return xml;
  }

  /**
   * 청구기관 식별 요소 두 줄(`<청구기관코드>`·`<청구기관명>`) — 값은 `requireHospitalIdentityForSubmission` 을 지난 DB 행.
   * 태그명은 심평원 XML 스키마의 식별자라 인자로 둔다(표시 문장이 아니다 — 두 헤더가 같은 조립을 쓰도록 한 곳에).
   */
  private institutionXml(inst: Record<(typeof CLAIM_XML_IDENTITY_KEYS)[number], string>, indent: string): string {
    const el = (tag: string, v: string) => `${indent}<${tag}>${this.escapeXml(v)}</${tag}>\n`;
    return el('청구기관코드', inst['hospital.code']) + el('청구기관명', inst['hospital.name']);
  }

  private escapeXml(str: string): string {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  async appeal(id: string, body: { reason: string; attachments?: string[] }) {
    const claim = await this.prisma.claim.findUnique({ where: { id } });
    if (!claim) throw new NotFoundException('Claim not found');
    if (claim.status !== 'PARTIALLY_APPROVED' && claim.status !== 'REJECTED') {
      throw new NotFoundException('Only partially approved or rejected claims can be appealed');
    }
    // 🔴 (2026-10-13 결함 발굴 C1) 종전엔 전송 없이 상태만 SUBMITTED 로 돌렸고, 화면은 원 청구의 전송 기록(transmission)을
    //    그대로 읽었다 — 원 청구가 전송됐다면 이의신청도 "전송됨"으로 보였다. 이의신청 전송 경로는 없다(submit 과 같은 정직성):
    //    이번 시도의 미전송 기록으로 바꾸고, 제출 시각을 비운다(나가지 않았다). 원 청구 전송 기록은 previousTransmission 으로 보존.
    const now = new Date();
    const prevData = (claim.claimData as Record<string, unknown> | null) ?? {};
    const transmission = {
      channel: HIRA_CHANNEL.key, outcome: 'NOT_TRANSMITTED', kind: 'APPEAL', receiptNo: null,
      recordedAt: now.toISOString(),
      note: notTransmittedNote(now, '이의신청 전송 경로 미구축'),
      manualFallback: HIRA_CHANNEL.manualFallback,
    };
    this.logger.warn(`청구 ${id} 이의신청 미전송 — 조치: ${HIRA_CHANNEL.manualFallback}`);
    return this.prisma.claim.update({
      where: { id },
      data: {
        status: 'SUBMITTED',
        submittedAt: null,
        claimData: {
          ...prevData,
          transmission,
          previousTransmission: prevData.transmission ?? null,
          appealReason: body.reason,
          appealDate: new Date().toISOString(),
          appealAttachments: body.attachments,
          previousStatus: claim.status,
          previousRejectReason: claim.rejectReason,
        },
      },
    });
  }

  async getStatsByMonth() {
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    const claims = await this.prisma.claim.findMany({
      where: { createdAt: { gte: sixMonthsAgo } },
      select: { status: true, claimedAmount: true, approvedAmount: true, createdAt: true },
    });

    const monthly: Record<string, { total: number; approved: number; rejected: number; amount: number; approvedAmount: number }> = {};
    for (const c of claims) {
      const key = c.createdAt.toISOString().slice(0, 7);
      if (!monthly[key]) monthly[key] = { total: 0, approved: 0, rejected: 0, amount: 0, approvedAmount: 0 };
      monthly[key].total++;
      monthly[key].amount += Number(c.claimedAmount ?? 0);
      monthly[key].approvedAmount += Number(c.approvedAmount ?? 0);
      if (c.status === 'APPROVED' || c.status === 'PAID') monthly[key].approved++;
      if (c.status === 'REJECTED') monthly[key].rejected++;
    }
    return Object.entries(monthly).sort(([a], [b]) => a.localeCompare(b)).map(([month, data]) => ({ month, ...data }));
  }

  /**
   * 청구 파일에 싣는 사실 — 보험유형·진료일·항목 마스터 코드.
   * 옛 청구(P2-2 이전)는 칸이 없으므로 원장에서 다시 읽는다: 보험유형 = 환자 보험유형(현재 값 — 청구 당시 스냅샷은 없다) ·
   * 진료일 = 진료 생성 시각(명세서 경로와 같은 기준) · 코드 = codeId 로 마스터 재해석.
   * 🔴 모르는 것은 지어내지 않는다 — 보험유형·진료일·코드 중 하나라도 없으면 파일을 만들지 않고 422.
   */
  private async claimFileFacts(claim: Awaited<ReturnType<ClaimService['findById']>>) {
    const claimData = claim.claimData as ClaimDataJson | null;
    const payerType = claimData?.payerType ?? claim.patient?.insuranceType ?? null;
    const encCreated = (claim.billing as { encounter?: { createdAt?: Date } | null } | null)?.encounter?.createdAt;
    const serviceDate = claimData?.serviceDate ?? (encCreated ? localDateKey(new Date(encCreated)) : null);
    const raw = (claimData?.items ?? claim.billing?.items ?? []) as NonNullable<ClaimDataJson['items']>;
    const idOf = (it: (typeof raw)[number]) => it.codeId ?? (isInternalCodeId(it.code) ? it.code : undefined);
    const needResolve = raw.filter((it) => !it.code || isInternalCodeId(it.code)).map(idOf).filter((v): v is string => !!v);
    const codeOf = await resolveEdiCodes(this.prisma, needResolve);
    const items = raw.map((it) => {
      const id = idOf(it);
      const code = it.code && !isInternalCodeId(it.code) ? it.code : id ? codeOf.get(id) ?? null : null;
      return { ...it, code, name: it.name || it.codeName || '' };
    });
    const missing: string[] = [];
    if (!payerType) missing.push('보험유형');
    if (!serviceDate) missing.push('진료일');
    const unresolved = items.filter((i) => !i.code).map((i) => i.name);
    if (unresolved.length) missing.push('항목 코드');
    if (missing.length) {
      throw new UnprocessableEntityException({ code: 'CLAIM_FILE_FACT_MISSING', message: '청구 파일에 실을 사실(보험유형·진료일·항목 코드)을 확인할 수 없어 만들지 않습니다', details: { missing, unresolved } });
    }
    if (OTHER_PAYER_TYPES.has(payerType as string)) {
      throw new UnprocessableEntityException({ code: 'CLAIM_OTHER_PAYER', message: '이 청구 파일은 건강보험·의료급여용입니다 — 이 보험유형은 청구처가 다릅니다', details: { payerType } });
    }
    return { payerType: payerType as string, serviceDate: serviceDate as string, items };
  }
}