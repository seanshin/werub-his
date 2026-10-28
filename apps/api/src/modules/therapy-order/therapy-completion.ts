import { ConflictException, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { assertOrderTransition, orderTransitionData } from '../order/order.service';

/**
 * 치료 세션 완료 정본 — `PATCH therapy-orders/:id/complete` 와 `PATCH workstation/therapy/:id/complete` 가 함께 쓴다.
 *
 * 🔴 (2026-09-15 P3) 두 경로 모두 **오더 상태를 보지 않았다**.
 *  · 취소(CANCELLED)된 오더도 COMPLETED 로 뒤집혔고, 매번 청구 발생 이벤트(`therapy.session.completed`)가 나갔다.
 *    outbox 는 (domain, ref) 로 멱등이라 같은 청구 줄이 두 번 쌓이지는 않지만, **취소가 먼저 나간 뒤** 완료가 오면
 *    ERP 는 취소 → 청구 순으로 받는다(= 취소한 치료가 청구된다).
 *  · 이미 완료된 오더를 다시 완료하면 완료 시각·완료자·결과가 **덮어써졌다**(일어난 사실을 고쳐 쓴다).
 *  · 워크스테이션 경로만 여정 `order.completed` 를 빠뜨렸다(같은 사실에 경로마다 다른 이벤트).
 * 규칙: 전이는 오더 상태기계 정본(`assertOrderTransition`)을 따른다 · 이미 완료면 **아무것도 바꾸지 않고** 이벤트도 다시 내지 않는다
 *       · 읽은 뒤 상태가 바뀌었으면(동시 처리) 조건부 갱신이 0건 → 409.
 */
export type TherapyCompletionResult = { completed: true; alreadyCompleted: boolean };

export async function completeTherapyOrder(
  prisma: PrismaService,
  eventEmitter: EventEmitter2 | undefined,
  therapyOrderId: string,
  resultData: Record<string, unknown> | undefined,
  userId?: string,
): Promise<TherapyCompletionResult> {
  const to = await prisma.therapyOrder.findUnique({
    where: { id: therapyOrderId },
    include: { order: { select: { id: true, status: true } } },
  });
  if (!to) throw new NotFoundException('치료 오더를 찾을 수 없습니다');

  const current = to.order.status;
  if (current === 'COMPLETED') return { completed: true, alreadyCompleted: true };
  assertOrderTransition(current, 'COMPLETED');

  const now = new Date();
  const order = await prisma.$transaction(async (tx) => {
    const upd = await tx.order.updateMany({
      where: { id: to.orderId, status: current },
      data: orderTransitionData('COMPLETED', userId) as Prisma.OrderUncheckedUpdateManyInput,
    });
    if (upd.count === 0) return null;
    await tx.therapyOrder.update({
      where: { id: therapyOrderId },
      data: { completedAt: now, resultData: (resultData ?? {}) as Prisma.InputJsonValue },
    });
    return tx.order.findUnique({
      where: { id: to.orderId },
      select: { id: true, prescriptionId: true, department: true },
    });
  });
  if (!order) {
    throw new ConflictException({
      code: 'THERAPY_ORDER_STATE_CHANGED',
      message: '다른 처리로 오더 상태가 바뀌었습니다 — 새로 고친 뒤 다시 시도하세요',
      details: { from: current },
    });
  }

  // 치료 완료 발생주의 청구 — lab/imaging/조제와 정합 · 새로 완료된 때만
  if (order.prescriptionId) {
    eventEmitter?.emit('therapy.session.completed', { orderId: order.id, prescriptionId: order.prescriptionId });
  }
  // 여정 ORDER_COMPLETED — 치료 완료는 order.service.updateStatus 를 거치지 않는 완료 경로다(같은 이벤트로 합류)
  eventEmitter?.emit('order.completed', { orderId: order.id, department: order.department, prescriptionId: order.prescriptionId });
  return { completed: true, alreadyCompleted: false };
}
