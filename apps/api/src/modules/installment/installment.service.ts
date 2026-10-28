import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { BillingService } from '../billing/billing.service';
import { addMonths } from '../../common/day-range';

@Injectable()
export class InstallmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly billingService: BillingService,
  ) {}

  /**
   * 분할 납부 계획 생성
   */
  async createPlan(billingId: string, installments: number) {
    // 🔴 (2026-10-14 결함 발굴 수납 P1-2) 수납 화면 분납과 같은 규칙(상태·남은 금액·진행 중 계획) — 정본 BillingService.prepareInstallment
    const { billing, amount: totalAmount } = await this.billingService.prepareInstallment(billingId);
    const baseAmount = Math.floor(totalAmount / installments);
    const remainder = totalAmount - baseAmount * installments;

    const now = new Date();
    const payments: { seqNo: number; amount: number; dueDate: Date }[] = [];

    for (let i = 0; i < installments; i++) {
      // 🔴 종전엔 기준일이 31일이면 **2월을 건너뛰고 3월에 두 번** 청구됐다
      //    (1회차 3/03 · 2회차 3/31). 말일은 말일로 클램프한다.
      const dueDate = addMonths(now, i + 1);

      payments.push({
        seqNo: i + 1,
        amount: i === 0 ? baseAmount + remainder : baseAmount,
        dueDate,
      });
    }

    /**
     * 🔴 (2026-09-16 G3) 분납 계획 생성과 수납 상태 전이는 **한 트랜잭션**이다.
     *    종전엔 계획을 먼저 커밋해, 상태 전이가 실패하면 청구는 PENDING 인데 계획만 존재했다 —
     *    같은 청구에 **계획이 한 벌 더** 만들어질 수 있고(중복 회차), 미수금 화면은 분납을 모른다.
     */
    return this.prisma.$transaction(async (tx) => {
    const plan = await tx.installmentPlan.create({
      data: {
        billingId,
        totalAmount,
        installments,
        nextDueDate: payments[0].dueDate,
        payments: {
          create: payments.map((p) => ({
            seqNo: p.seqNo,
            amount: p.amount,
            dueDate: p.dueDate,
            status: 'PENDING',
          })),
        },
      },
      include: { payments: { orderBy: { seqNo: 'asc' } } },
    });

      // 🔴 (P1-2) 종전엔 'INSTALLMENT' 로 바꿨는데 그 값은 미수 집합 정본(UNPAID_STATUS)에 없어 미수 집계에서 빠졌다 —
      //    수납 화면 분납과 같이 PARTIAL · 읽은 상태 그대로일 때만
      const r = await tx.billing.updateMany({ where: { id: billingId, status: billing.status }, data: { status: 'PARTIAL' } });
      if (r.count !== 1) throw new BadRequestException('수납 정보가 변경되었습니다. 다시 시도해주세요.');

      return plan;
    });
  }

  /**
   * 분할 납부 결제 — 🔴 **정본은 `BillingService.payInstallment`** 이고 여기서는 위임만 한다.
   *
   * 종전에는 같은 행위가 두 곳에 각각 구현돼 있었고 **동작이 서로 달랐다**(P12):
   *   · 이쪽: 트랜잭션 없이 3쓰기(회차·계획·수납) → 중간 실패 시 "회차는 냈는데 미납"으로 남는다
   *   · 이쪽: 회차 납부액을 `Billing.paidAmount` 에 **반영하지 않다가** 완납 시
   *     `paidAmount = plan.totalAmount` 로 **덮어썼다** → 납부 중에는 미수금 화면이 전액 미납으로 보인다
   *   · 저쪽(정본): 회차마다 `increment`·원자적 선점·수납 원장 라인 기록
   * 두 경로를 섞어 쓰면 `paidAmount` 가 실제 납부액과 어긋난다. 그래서 구현을 하나로 모은다.
   *
   * EP 는 그대로 둔다 — 막으면 방치된다(부르는 화면이 아직 없다는 사실은 따로 드러낸다).
   * 이 경로는 결제수단을 받지 않으므로 원장에는 `UNKNOWN` 으로 남는다(지어내지 않는다).
   */
  async payInstallment(planId: string, seqNo: number, method?: string) {
    const plan = await this.prisma.installmentPlan.findUnique({
      where: { id: planId },
      include: { payments: { orderBy: { seqNo: 'asc' } } },
    });
    if (!plan) throw new NotFoundException('Installment plan not found');
    if (plan.status === 'COMPLETED') throw new BadRequestException('Plan already completed');

    const payment = plan.payments.find((p) => p.seqNo === seqNo);
    if (!payment) throw new NotFoundException('Payment not found');
    if (payment.status === 'PAID') throw new BadRequestException('Payment already paid');

    await this.billingService.payInstallment(payment.id, method);

    // 다음 납부일 — 정본은 회차·계획·수납만 갱신하므로 예정일 유지는 여기서(계획 소유 정보)
    const remaining = plan.payments.filter((p) => p.seqNo !== seqNo && p.status === 'PENDING');
    const nextPayment = remaining.find((p) => p.seqNo > seqNo) ?? remaining[0];
    const isCompleted = plan.paidCount + 1 >= plan.installments;
    return this.prisma.installmentPlan.update({
      where: { id: planId },
      data: { nextDueDate: isCompleted ? null : nextPayment?.dueDate ?? null },
      include: { payments: { orderBy: { seqNo: 'asc' } } },
    });
  }

  /**
   * 분할 납부 계획 목록
   */
  async getPlans(billingId?: string) {
    const where = billingId ? { billingId } : {};
    return this.prisma.installmentPlan.findMany({
      where,
      include: { payments: { orderBy: { seqNo: 'asc' } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * 분할 납부 계획 상세
   */
  async getPlanDetail(planId: string) {
    const plan = await this.prisma.installmentPlan.findUnique({
      where: { id: planId },
      include: { payments: { orderBy: { seqNo: 'asc' } } },
    });
    if (!plan) throw new NotFoundException('Installment plan not found');
    return plan;
  }
}
