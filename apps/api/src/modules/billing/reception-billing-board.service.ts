import { Injectable } from '@nestjs/common';
import { billingOutstanding, waitMinutesSince } from '@hospital-run/shared';
import { UNPAID_STATUS } from '../journey-console/flow-canon';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

/**
 * 원무·수납 보드(D4) — 접수 대기·자격 미확인·금일 수납·미수금·증명서 발급 대기.
 * raw SQL 미사용(Prisma ORM).
 */
@Injectable()
export class ReceptionBillingBoardService {
  constructor(private readonly prisma: PrismaService) {}

  async getBoard() {
    const now = new Date();
    const dayStart = new Date(now); dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart); dayEnd.setDate(dayEnd.getDate() + 1);

    const [waiting, eligUnchecked, paidAgg, outstanding, docPending] = await Promise.all([
      // 접수 대기
      this.prisma.waitingQueue.count({ where: { status: 'WAITING' } }),
      // 자격 미확인(대기 중 + 미확인/미체크)
      this.prisma.waitingQueue.count({ where: { status: 'WAITING', OR: [{ eligibilityStatus: null }, { eligibilityStatus: 'NOT_CHECKED' }] } }),
      // 🔴 (2026-10-14 수납·청구 결함 발굴 P4-1) 금일 수납 = 오늘 들어온 돈 — 일마감(getDailySummary)과 같은 정의.
      //    종전엔 오늘 완납(PAID)된 청구의 누적 납부액이라 부분 납부·분납 회차가 빠지고 어제 낸 돈이 딸려왔다.
      //    원장 줄(환불 제외 · 완납/부분 수납 청구) + 원장 줄 없는 옛 수납(오늘 paidAt).
      Promise.all([
        this.prisma.billingPayment.aggregate({ where: { createdAt: { gte: dayStart, lt: dayEnd }, method: { not: 'REFUND' }, billing: { status: { in: ['PAID', 'PARTIAL'] } } }, _sum: { amount: true } }),
        this.prisma.billingPayment.findMany({ where: { createdAt: { gte: dayStart, lt: dayEnd }, method: { not: 'REFUND' }, billing: { status: { in: ['PAID', 'PARTIAL'] } } }, select: { billingId: true }, distinct: ['billingId'] }),
        this.prisma.billing.aggregate({ where: { paidAt: { gte: dayStart, lt: dayEnd }, status: { in: ['PAID', 'PARTIAL'] }, payments: { none: {} } }, _sum: { paidAmount: true }, _count: true }),
      ]),
      // 🔴 (P4-1) 미수 = 정본 집합(UNPAID_STATUS)의 남은 본인부담(shared billingOutstanding) — 종전 Σ(총액 − 납부)는 보험자(공단) 부담까지 미수로 셌다
      this.prisma.billing.findMany({
        where: { status: { in: UNPAID_STATUS } },
        select: { patientCopay: true, discountAmount: true, paidAmount: true },
      }),
      // 증명서 발급 대기
      this.prisma.documentRequest.count({ where: { status: { in: ['REQUESTED', 'PROCESSING'] } } }),
    ]);

    const outstandingAmount = outstanding.reduce((s, b) => s + (billingOutstanding(b) ?? 0), 0);
    const [ledgerToday, ledgerBillings, unledgeredToday] = paidAgg;

    /**
     * 접수 대기 목록(대기시간 순).
     *
     * 🔴 대기시간 기준이 `createdAt` 이었다 — 대기열 196건 중 **99건의 createdAt 이 미래**라
     *    평균 대기가 **-36분**으로 나왔다(실측). 실제 도착 기준(`checkedInAt`)으로는 10분이다.
     *    나머지 세 화면(외래 대기열·접수 큐·내 대기 위젯)은 이미 `checkedInAt` 기준이라
     *    같은 '대기시간'에 정본이 둘이었다(P12).
     */
    const LIST_LIMIT = 50;
    const waitList = await this.prisma.waitingQueue.findMany({
      where: { status: 'WAITING' },
      orderBy: [{ checkedInAt: 'asc' }, { createdAt: 'asc' }],
      take: LIST_LIMIT,
      select: { id: true, departmentName: true, createdAt: true, checkedInAt: true, eligibilityStatus: true, patientId: true,
        patient: { select: { familyName: true, givenName: true, mrn: true } } },
    });

    const waitingList = waitList.map((w) => ({
      id: w.id, patientId: w.patientId,
      name: `${w.patient.familyName}${w.patient.givenName}`, mrn: w.patient.mrn,
      department: w.departmentName ?? '-',
      // 아직 도착 전이면 대기시간은 0 도 '방금'도 아니다 — 없다.
      waitMins: waitMinutesSince(w.checkedInAt ?? w.createdAt, now),
      eligibility: w.eligibilityStatus ?? 'NOT_CHECKED',
    }));

    return {
      summary: {
        waiting,
        eligUnchecked,
        todayPaidAmount: (ledgerToday._sum.amount ?? 0) + (unledgeredToday._sum.paidAmount ?? 0),
        todayPaidCount: ledgerBillings.length + (unledgeredToday._count ?? 0),
        outstandingAmount,
        outstandingCount: outstanding.length,
        docPending,
      },
      waitingList,
      // 🔴 헤더는 196 인데 표는 50행에서 끝났다 — 잘렸다는 사실을 화면이 말할 수 있게.
      listLimit: LIST_LIMIT,
      listTruncated: waiting > waitingList.length,
    };
  }
}
