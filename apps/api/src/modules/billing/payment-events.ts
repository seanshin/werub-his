import type { PrismaService } from '../../infrastructure/prisma/prisma.service';

/**
 * 기간 안에 **실제로 오간 돈** — 수납 원장 줄(납부 +, 환불 −)을 그 줄의 날짜에 센다(2026-10-14 수납·청구 P2-5 · P4-5 에서 공용으로 추출).
 * 원장 줄이 없는 옛 수납(원장 도입 전·시드)은 완납일에 납부액, 환불일에 환불액(−)으로 센다.
 * 🔴 검진권(VOUCHER) 충당은 환자가 낸 돈이 아니라 세지 않는다. 날짜를 모르는 옛 부분 납부는 지어내지 않고 뺀다.
 * 소비처: 포털 연말정산(본인) · 원무 의료비 납입확인서(직원).
 */
export async function paymentEventsInRange(prisma: Pick<PrismaService, 'billingPayment' | 'billing'>, patientId: string, start: Date, end: Date) {
  const lines = await prisma.billingPayment.findMany({
    where: { billing: { patientId }, createdAt: { gte: start, lt: end }, method: { not: 'VOUCHER' } },
    select: { billingId: true, amount: true, createdAt: true },
  });
  const withLines = new Set((await prisma.billingPayment.findMany({
    where: { billing: { patientId } }, select: { billingId: true }, distinct: ['billingId'],
  })).map((r) => r.billingId));
  const legacy = await prisma.billing.findMany({
    where: {
      patientId, id: { notIn: [...withLines] },
      OR: [{ paidAt: { gte: start, lt: end } }, { refundedAt: { gte: start, lt: end } }],
    },
    select: { id: true, paidAmount: true, paidAt: true, refundAmount: true, refundedAt: true },
  });
  const events: { billingId: string; at: Date; amount: number }[] = lines.map((l) => ({ billingId: l.billingId, at: l.createdAt, amount: l.amount }));
  for (const b of legacy) {
    if (b.paidAt && b.paidAt >= start && b.paidAt < end && (b.paidAmount ?? 0) > 0) events.push({ billingId: b.id, at: b.paidAt, amount: b.paidAmount as number });
    if (b.refundedAt && b.refundedAt >= start && b.refundedAt < end && (b.refundAmount ?? 0) > 0) events.push({ billingId: b.id, at: b.refundedAt, amount: -(b.refundAmount as number) });
  }
  const billingIds = [...new Set(events.map((e) => e.billingId))];
  const billings = billingIds.length
    ? await prisma.billing.findMany({
      where: { id: { in: billingIds } },
      select: { id: true, totalAmount: true, insuranceCovered: true, patientCopay: true, encounter: { select: { visitType: true } } },
    })
    : [];
  return { events, billings };
}
