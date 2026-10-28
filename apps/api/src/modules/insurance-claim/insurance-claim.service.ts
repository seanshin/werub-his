import { Injectable, NotFoundException, ConflictException, BadRequestException, Logger } from '@nestjs/common';
import { PATIENT_SENSITIVE_OMIT } from '../../common/patient-select';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { Optional } from '@nestjs/common';
import { IntegrationOutboxService } from '../integration/integration-outbox.service';
import { ClaimStatus, Prisma } from '@prisma/client';
// 🔴 심평원 전송 정본(C1) — claim.service 와 같은 함수를 쓴다(정본이 둘이면 갈라진다).
import { HIRA_CHANNEL, notTransmittedNote, transmitToHira } from '../hira-edi/hira-transmission';
import { withAdvisoryLock } from '../../common/util/advisory-lock';
import { claimBillingLockKey } from '../claim/claim-billing-lock';
import { buildClaimData, OTHER_PAYER_TYPES } from '../claim/claim-data';
import { resolveEdiCodes } from '../hira-edi/edi-code';
import { localDateKey } from '../../common/day-range';

@Injectable()
export class InsuranceClaimService {
  private readonly logger = new Logger(InsuranceClaimService.name);
  constructor(private readonly prisma: PrismaService, @Optional() private readonly outbox?: IntegrationOutboxService) {}

  async getQueue() {
    return this.prisma.claim.findMany({
      where: { status: { in: [ClaimStatus.DRAFT, ClaimStatus.SUBMITTED, ClaimStatus.UNDER_REVIEW] } },
      orderBy: { claimDate: 'asc' },
      include: {
        billing: { select: { id: true, totalAmount: true, insuranceCovered: true, patientCopay: true } },
        patient: { select: { id: true, mrn: true, familyName: true, givenName: true } },
      },
    });
  }

  async create(billingId: string, reason?: string) {
    const billing = await this.prisma.billing.findUnique({
      where: { id: billingId },
      include: { patient: { omit: PATIENT_SENSITIVE_OMIT }, items: true, encounter: { select: { createdAt: true } } },
    });
    if (!billing) throw new NotFoundException('Billing not found');
    // 🔴 (P2-4) 종전엔 수납 상태·보험유형을 보지 않아 미수납·취소·환불 수납과 자비·산재·자동차보험 수납도 청구가 됐다.
    //    정본 경로(generateClaims)와 같은 대상만: 수납 완료(PAID) · 건강보험·의료급여.
    if (billing.status !== 'PAID') {
      throw new ConflictException({ code: 'CLAIM_BILLING_NOT_PAID', message: '수납이 끝난 건만 청구합니다', details: { status: billing.status } });
    }
    const payerType = billing.patient.insuranceType;
    if (payerType === 'SELF_PAY' || OTHER_PAYER_TYPES.has(payerType)) {
      throw new ConflictException({ code: 'CLAIM_PAYER_NOT_NHI', message: '이 청구는 건강보험·의료급여용입니다', details: { payerType } });
    }
    const codeOf = await resolveEdiCodes(this.prisma, billing.items.map((i) => i.codeId));

    // 이중청구 방지(2차 스카우트 R2) — 활성(비REJECTED) claim이 이미 있으면 차단. 반려분만 재청구 허용.
    //  claim.service.generateClaims(경로A)와 동일 정책·금액정의(보험자부담금) 통일.
    // 🔴 (2026-09-28 재판정 a13360) 종전엔 이 선검사가 잠금 밖이라 동시 호출 둘이 모두 "없음"을 보고 둘 다 만들었다.
    //    `generateClaims` 와 **같은 키**로 수납 단위 직렬화하고, 잠근 안에서 선검사한다(형제 경로와도 경합하지 않게).
    return withAdvisoryLock(this.prisma, claimBillingLockKey(billingId), async (tx) => {
      const existingClaim = await tx.claim.findFirst({
        where: { billingId, status: { not: 'REJECTED' } },
      });
      if (existingClaim) throw new ConflictException('이미 청구가 존재하는 진료건입니다(활성 청구).');

      return tx.claim.create({
        data: {
          billingId,
          patientId: billing.patientId,
          claimDate: new Date(),
          // claimedAmount = 보험자부담금(insuranceCovered) — 종전 totalAmount(본인부담 포함)는 부당청구/이중정의였음
          claimedAmount: billing.insuranceCovered ?? billing.totalAmount,
          status: ClaimStatus.DRAFT,
          // 정본 청구 데이터(보험유형·진료일·마스터 코드·금액) + 이 경로의 근거 — 종전엔 금액·항목이 없어 XML 이 비었다
          claimData: {
            ...buildClaimData(billing, {
              payerType,
              serviceDate: billing.encounter?.createdAt ? localDateKey(billing.encounter.createdAt) : undefined,
              codeOf,
            }),
            reason: reason || '',
            itemCount: billing.items.length,
            createdFrom: 'billing',
          } as Prisma.InputJsonValue,
        },
        include: {
          billing: { select: { id: true, totalAmount: true } },
          patient: { select: { id: true, mrn: true, familyName: true, givenName: true } },
        },
      });
    });
  }

  /**
   * 🔴 2026-08-20 전송 정직성 — `claim.service.submit()` 과 **같은 테이블(Claim)** 을 쓰는 쌍둥이 경로다.
   * 종전엔 이쪽도 `status:'SUBMITTED'` · `submittedAt: new Date()` · `claimData.submitTime` 을
   * 전송 시도와 무관하게 적었다. 심평원 전송 코드는 존재한 적이 없다(정본 `hira-edi/hira-transmission.ts`).
   * 판정·기록 규약은 `ClaimService.submit()` 의 주석과 동일하다(정본 함수 `transmitToHira` 공유).
   * 부수 봉합: 종전 `claimData` 를 통째로 덮어써 생성 시 기록한 `reason`·`itemCount`·`createdFrom` 이
   * 제출 순간 사라졌다 → 병합한다.
   */
  async submit(claimId: string, ediData?: string, notes?: string) {
    const claim = await this.prisma.claim.findUnique({
      where: { id: claimId },
      include: { billing: true },
    });
    if (!claim) throw new NotFoundException('Claim not found');

    if (claim.status !== ClaimStatus.DRAFT) {
      throw new ConflictException(`Cannot submit claim with status ${claim.status}. Expected: DRAFT`);
    }

    // Generate claim number if not exists
    // (청구번호는 요양기관이 부여하는 번호 — 기관 부여 접수번호를 사칭하는 값이 아니라 그대로 둔다)
    const claimNumber = claim.claimNumber || `CLM-${Date.now()}`;

    const now = new Date();
    const result = await transmitToHira(ediData ?? claim.claimData ?? null);
    const sent = result.outcome === 'SENT';
    const transmission = sent
      ? { channel: HIRA_CHANNEL.key, outcome: result.outcome, receiptNo: result.externalRef ?? null, transmittedAt: (result.at ?? now).toISOString() }
      : {
          channel: HIRA_CHANNEL.key, outcome: result.outcome, receiptNo: null,
          recordedAt: now.toISOString(),
          note: notTransmittedNote(now, result.reason),
          manualFallback: HIRA_CHANNEL.manualFallback,
        };
    // 예상된 미구축은 warn — 거짓 경보가 진짜 경보를 죽인다.
    if (!sent) this.logger.warn(`청구 ${claimId} 미전송(${result.outcome}) — ${result.reason ?? HIRA_CHANNEL.name} · 조치: ${HIRA_CHANNEL.manualFallback}`);

    return this.prisma.claim.update({
      where: { id: claimId },
      data: {
        status: ClaimStatus.SUBMITTED,
        claimNumber,
        submittedAt: sent ? (result.at ?? now) : null, // 🔴 나가지 않았으므로 제출 시각을 적지 않는다
        claimData: {
          ...((claim.claimData as Prisma.JsonObject) ?? {}),
          ediData: ediData || '',
          notes: notes || '',
          transmission,
        } as Record<string, any>,
      },
      include: {
        billing: { select: { id: true, totalAmount: true } },
        patient: { select: { id: true, mrn: true, familyName: true, givenName: true } },
      },
    });
  }

  async getDetail(claimId: string) {
    const claim = await this.prisma.claim.findUnique({
      where: { id: claimId },
      include: {
        billing: { include: { items: true } },
        patient: { select: { id: true, mrn: true, familyName: true, givenName: true } },
      },
    });

    if (!claim) throw new NotFoundException('Claim not found');
    return claim;
  }

  async getPatientHistory(patientId: string) {
    return this.prisma.claim.findMany({
      where: { patientId },
      orderBy: { claimDate: 'desc' },
      include: {
        billing: { select: { id: true, totalAmount: true } },
      },
    });
  }

  async review(claimId: string, action: 'approve' | 'reject' | 'partial_approve', approvedAmount: number, reason?: string) {
    const claim = await this.prisma.claim.findUnique({
      where: { id: claimId },
    });
    if (!claim) throw new NotFoundException('Claim not found');

    if (claim.status !== ClaimStatus.SUBMITTED && claim.status !== ClaimStatus.UNDER_REVIEW) {
      throw new ConflictException(
        `Cannot review claim with status ${claim.status}. Expected: SUBMITTED or UNDER_REVIEW`
      );
    }

    if (!Number.isInteger(approvedAmount) || approvedAmount < 0) throw new BadRequestException('Approved amount must be a non-negative integer');
    if (approvedAmount > claim.claimedAmount) throw new BadRequestException('Approved amount cannot exceed claimed amount');

    // 🔴 (P2-4) 결과와 금액이 맞아야 한다 — 정본 경로(claim.service review)와 같은 규칙.
    //    종전엔 모르는 action 이 반려로 떨어지고, 반려에도 인정액 > 0 이 들어갔다.
    let newStatus: ClaimStatus;
    if (action === 'approve') {
      if (approvedAmount !== claim.claimedAmount) throw new BadRequestException('전액 인정은 인정액 = 청구액입니다 — 금액이 다르면 부분인정으로 기록하세요');
      newStatus = ClaimStatus.APPROVED;
    } else if (action === 'partial_approve') {
      if (approvedAmount >= claim.claimedAmount) throw new BadRequestException('부분인정 인정액은 청구액보다 작아야 합니다');
      newStatus = ClaimStatus.PARTIALLY_APPROVED;
    } else if (action === 'reject') {
      if (approvedAmount !== 0) throw new BadRequestException('반려는 인정액이 0 입니다');
      newStatus = ClaimStatus.REJECTED;
    } else {
      throw new BadRequestException({ code: 'CLAIM_REVIEW_ACTION', message: '알 수 없는 심사 결과입니다', details: { action } });
    }

    const reducedAmount = claim.claimedAmount - approvedAmount;
    const now = new Date();

    // 🔴 §5 봉합: 경로B도 경로A(claim.service.review)와 정합 — Claim+Billing 원장을 원자적으로 갱신.
    // 종전엔 Claim만 갱신·Billing 미반영·outbox 미발행이라 이 경로 심사 시 삭감이 원장·ERP에 안 갔음.
    const [c] = await this.prisma.$transaction([
      this.prisma.claim.update({
        where: { id: claimId },
        data: {
          status: newStatus,
          approvedAmount,
          reducedAmount: reducedAmount > 0 ? reducedAmount : null,
          rejectReason: reason || null,
          reviewedAt: now,
        },
        include: {
          billing: { select: { id: true, totalAmount: true } },
          patient: { select: { id: true, mrn: true, familyName: true, givenName: true } },
        },
      }),
      this.prisma.billing.update({
        where: { id: claim.billingId },
        data: { reviewedInsuranceAmount: approvedAmount, insuranceReducedAmount: reducedAmount > 0 ? reducedAmount : 0, insuranceAdjustedAt: now },
      }),
    ]);

    // 심사결과 → ERP 회계(경로A와 동일 이벤트·§3 ref 바인딩)
    const erpStatus = newStatus === ClaimStatus.REJECTED ? 'REJECTED' : newStatus === ClaimStatus.PARTIALLY_APPROVED ? 'PARTIALLY_APPROVED' : 'APPROVED';
    void this.outbox?.enqueue('claim', 'claim.reviewed', `claim:review:${claimId}:${erpStatus}:${approvedAmount}:${reducedAmount}`, {
      claimId, claimNumber: c.claimNumber, status: erpStatus, approvedAmount, reducedAmount, rejectReason: reason ?? null,
    });
    return c;
  }

  async recordPayment(claimId: string, paidAmount: number) {
    const claim = await this.prisma.claim.findUnique({
      where: { id: claimId },
    });
    if (!claim) throw new NotFoundException('Claim not found');

    if (claim.status !== ClaimStatus.APPROVED && claim.status !== ClaimStatus.PARTIALLY_APPROVED) {
      throw new ConflictException(
        `Cannot record payment for claim with status ${claim.status}. Expected: APPROVED or PARTIALLY_APPROVED`
      );
    }

    const maxPayable = claim.approvedAmount || 0;
    // 🔴 (P2-4) 종전엔 0·음수·소수도 지급(PAID)으로 기록됐다
    if (!Number.isInteger(paidAmount) || paidAmount <= 0) throw new BadRequestException('지급 금액은 1원 이상의 정수여야 합니다');
    if (paidAmount > maxPayable) throw new BadRequestException('Paid amount cannot exceed approved amount');

    return this.prisma.claim.update({
      where: { id: claimId },
      data: {
        status: ClaimStatus.PAID,
        paidAmount,
        paidAt: new Date(),
      },
      include: {
        billing: { select: { id: true, totalAmount: true } },
        patient: { select: { id: true, mrn: true, familyName: true, givenName: true } },
      },
    });
  }

  async updateClaimData(claimId: string, claimData?: Record<string, any>, reducedAmount?: number) {
    const claim = await this.prisma.claim.findUnique({
      where: { id: claimId },
    });
    if (!claim) throw new NotFoundException('Claim not found');

    if (claim.status !== ClaimStatus.DRAFT && claim.status !== ClaimStatus.SUBMITTED) {
      throw new ConflictException(
        `Cannot update claim with status ${claim.status}. Expected: DRAFT or SUBMITTED`
      );
    }

    const updateData: Prisma.ClaimUpdateInput = {
      updatedAt: new Date(),
    };

    // 🔴 (P2-4) 종전엔 claimData 를 **통째로 교체**해 전송 기록(transmission)·생성 근거가 사라졌다.
    //    보낸 키만 덮고, 전송 기록은 이 경로로 바꾸지 않는다(제출 경로만 쓴다).
    if (claimData) {
      const prev = (claim.claimData as Prisma.JsonObject | null) ?? {};
      const { transmission: _ignored, ...rest } = claimData;
      updateData.claimData = { ...prev, ...rest, ...(prev.transmission !== undefined ? { transmission: prev.transmission } : {}) } as Prisma.InputJsonValue;
    }

    if (reducedAmount !== undefined) {
      if (!Number.isInteger(reducedAmount) || reducedAmount < 0 || reducedAmount > claim.claimedAmount) {
        throw new BadRequestException('감액은 0 이상 청구액 이하의 정수여야 합니다');
      }
      updateData.reducedAmount = reducedAmount;
    }

    return this.prisma.claim.update({
      where: { id: claimId },
      data: updateData,
      include: {
        billing: { select: { id: true, totalAmount: true } },
        patient: { select: { id: true, mrn: true, familyName: true, givenName: true } },
      },
    });
  }
}
