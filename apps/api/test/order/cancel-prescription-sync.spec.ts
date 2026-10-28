import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { OrderService } from '../../src/modules/order/order.service';

/**
 * 오더 취소 ↔ 처방 취소 연동 — 2026-08-03 정책 확정(**같은 행위로 간주**).
 *
 * 🔴 종전엔 오더만 CANCELLED 가 되고 처방은 ACTIVE 로 남았다(운영 실측 61건·계속 누적).
 *    취소한 검사·약이 처방 목록·청구·MAR 에서는 살아 있었다.
 *
 * 역방향(처방 취소 → 오더 취소)은 `prescription.service.cancel` 이 이미 처리한다.
 * **두 방향의 부수효과가 같아야** 하므로(상태 + SCHEDULED MAR 제거) 아래에서 대칭을 고정한다 —
 * 한쪽만 고치면 다시 어긋난다.
 */
function build() {
  const prisma: any = {
    // 발효 판정(2026-09-30) — 기본은 미발효(투약 기록·시작된 다른 오더 0)
    order: { findUnique: vi.fn(), update: vi.fn(), count: vi.fn().mockResolvedValue(0) },
    prescription: { findUnique: vi.fn(), update: vi.fn() },
    medicationAdministration: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }), count: vi.fn().mockResolvedValue(0) },
    $transaction: vi.fn(async (cb: (tx: unknown) => unknown) => cb(prisma)),
  };
  const audit = { safeLog: vi.fn() };
  const signLog = { recordTransition: vi.fn() };
  const events = { emit: vi.fn() };
  const service = new OrderService(prisma, { createWorklistItem: vi.fn() } as never, signLog as never, events as never, audit as never);
  return { service, prisma, audit, signLog, events };
}

const ORDER = { id: 'ord-1', status: 'ORDERED', department: 'LAB', prescriptionId: 'rx-1' };

describe('오더 취소 → 처방 연동 취소', () => {
  let ctx: ReturnType<typeof build>;
  beforeEach(() => {
    ctx = build();
    ctx.prisma.order.findUnique.mockResolvedValue(ORDER);
    ctx.prisma.order.update.mockResolvedValue({ ...ORDER, status: 'CANCELLED', cancelledAt: new Date() });
  });

  it('연결된 ACTIVE 처방을 함께 취소한다', async () => {
    ctx.prisma.prescription.findUnique.mockResolvedValue({ id: 'rx-1', status: 'ACTIVE' });
    await ctx.service.changeStatus('ord-1', 'CANCELLED', undefined, 'user-1');

    expect(ctx.prisma.prescription.update).toHaveBeenCalledWith({
      where: { id: 'rx-1' }, data: { status: 'CANCELLED' },
    });
  });

  it('예정 투약(SCHEDULED)을 제거한다 — 취소약이 MAR 에 남으면 투약 사고', async () => {
    ctx.prisma.prescription.findUnique.mockResolvedValue({ id: 'rx-1', status: 'ACTIVE' });
    await ctx.service.changeStatus('ord-1', 'CANCELLED', undefined, 'user-1');

    expect(ctx.prisma.medicationAdministration.deleteMany).toHaveBeenCalledWith({
      where: { prescriptionId: 'rx-1', status: 'SCHEDULED' },
    });
  });

  it('오더 전이와 처방 취소는 같은 트랜잭션이다', async () => {
    ctx.prisma.prescription.findUnique.mockResolvedValue({ id: 'rx-1', status: 'ACTIVE' });
    await ctx.service.changeStatus('ord-1', 'CANCELLED', undefined, 'user-1');
    expect(ctx.prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('이미 취소된 처방은 건드리지 않는다 (역방향 진입 시 멱등)', async () => {
    ctx.prisma.prescription.findUnique.mockResolvedValue({ id: 'rx-1', status: 'CANCELLED' });
    await ctx.service.changeStatus('ord-1', 'CANCELLED', undefined, 'user-1');

    expect(ctx.prisma.prescription.update).not.toHaveBeenCalled();
    expect(ctx.prisma.medicationAdministration.deleteMany).not.toHaveBeenCalled();
  });

  it('취소가 아닌 전이는 처방을 건드리지 않는다', async () => {
    ctx.prisma.order.update.mockResolvedValue({ ...ORDER, status: 'RECEIVED' });
    await ctx.service.changeStatus('ord-1', 'RECEIVED', undefined, 'user-1');

    expect(ctx.prisma.prescription.update).not.toHaveBeenCalled();
  });

  it('처방 상태 변경을 PRESCRIPTION 감사에 남긴다', async () => {
    ctx.prisma.prescription.findUnique.mockResolvedValue({ id: 'rx-1', status: 'ACTIVE' });
    await ctx.service.changeStatus('ord-1', 'CANCELLED', undefined, 'user-1');

    expect(ctx.audit.safeLog).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1', resourceType: 'PRESCRIPTION', resourceId: 'rx-1',
    }));
  });

  it('처방이 없는 오더도 정상 취소된다', async () => {
    ctx.prisma.order.findUnique.mockResolvedValue({ ...ORDER, prescriptionId: null });
    ctx.prisma.order.update.mockResolvedValue({ ...ORDER, prescriptionId: null, status: 'CANCELLED', cancelledAt: new Date() });
    const r = await ctx.service.changeStatus('ord-1', 'CANCELLED', undefined, 'user-1');

    expect(r.status).toBe('CANCELLED');
    expect(ctx.prisma.prescription.findUnique).not.toHaveBeenCalled();
  });
});

describe('양방향 대칭(소스 계약)', () => {
  const rxSrc = readFileSync(join(process.cwd(), 'src/modules/prescription/prescription.service.ts'), 'utf-8');
  const orderSrc = readFileSync(join(process.cwd(), 'src/modules/order/order.service.ts'), 'utf-8');

  it('두 방향 모두 SCHEDULED MAR 만 제거한다(시행분은 감사 위해 보존)', () => {
    const rule = /status:\s*'SCHEDULED'/;
    expect(rxSrc).toMatch(rule);
    expect(orderSrc).toMatch(rule);
    // 시행/보류/거부분까지 지우면 투약 기록이 사라진다 — deleteMany 조건에 status 가 반드시 있어야 한다
    for (const src of [rxSrc, orderSrc]) {
      const m = /medicationAdministration\.deleteMany\(\{[\s\S]{0,160}?\}\)/.exec(src);
      expect(m?.[0]).toContain("status: 'SCHEDULED'");
    }
  });

  it('오더 취소는 모듈 순환을 만들지 않는다(PrescriptionService 미주입)', () => {
    // 순환 import 로 운영이 내려간 이력이 있다 — 연동은 같은 tx 직접 쓰기로 한다
    expect(orderSrc).not.toMatch(/PrescriptionService/);
  });
});
