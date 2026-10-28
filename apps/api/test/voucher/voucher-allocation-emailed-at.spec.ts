/**
 * 🔴 배분 원장 시각 정직성 가드 — 2026-08-20.
 *
 * 종전 `voucher-trade.service.ts` 는 발송 결과와 **무관하게** `emailedAt: new Date()` 를 찍었다.
 * 그래서 차단(BLOCKED)·상류 실패(FAILED)·설정상 모의(SIMULATION) 어느 쪽이든
 * `voucher_allocations` 에 "이 시각에 메일을 보냈다"는 **모르는 시각**이 박혔다.
 * (규약: 전송을 흉내내지 않는다 · 모르는 시각은 원장에 박지 않는다)
 *
 * 재주입: `emailedAt: delivered ? new Date() : null` → `emailedAt: new Date()` 로 되돌리면
 * 아래 3개 케이스가 실패한다.
 */
import { describe, it, expect, vi } from 'vitest';
import { VoucherTradeService } from '../../src/modules/voucher/voucher-trade.service';

vi.mock('../../src/common/crypto/field-encryption', () => ({ decryptField: () => 'AAAA-BBBB' }));

function mk(channel: string) {
  const updateSpy = vi.fn().mockResolvedValue({});
  const tx = {
    voucherAllocation: { create: vi.fn().mockResolvedValue({ id: 'alloc-1' }) },
    checkupVoucher: { update: vi.fn().mockResolvedValue({}) },
  };
  const prisma: any = {
    voucherAllocation: { findUnique: vi.fn().mockResolvedValue(null), update: updateSpy },
    distributor: { findUnique: vi.fn().mockResolvedValue({ id: 'd1', name: '딜러', status: 'ACTIVE', dealerType: 'DOMESTIC', currency: 'KRW' }) },
    distributorAccount: { findFirst: vi.fn().mockResolvedValue({ email: 'd@x.example' }) },
    checkupVoucher: { findMany: vi.fn().mockResolvedValue([{ id: 'v1', serial: 'V-1', headHash: 'h0', activationCodeEnc: 'enc' }]) },
    $transaction: vi.fn(async (cb: (t: unknown) => unknown) => cb(tx)),
  };
  const svc = new VoucherTradeService(
    prisma,
    {} as never,
    { append: vi.fn().mockResolvedValue('h1') } as never,
    { emit: vi.fn() } as never,
    { log: vi.fn() } as never,
    { sendActivationCodes: vi.fn().mockResolvedValue({ channel, messageId: 'm' }) } as never,
    {} as never,
  );
  return { svc, updateSpy };
}

const run = async (channel: string) => {
  const { svc, updateSpy } = mk(channel);
  const res = await svc.sendBatchToDealer('b1', { distributorId: 'd1', idempotencyKey: 'idem-1' }, { actorId: 'u1', actorType: 'STAFF' });
  return { data: updateSpy.mock.calls[0]?.[0]?.data, res: res as { channel: string; delivered: boolean } };
};

describe('배분 원장 — 나가지 않은 메일에 시각을 박지 않는다', () => {
  it('🔴 차단(BLOCKED) 이면 emailedAt 은 null · 채널은 그대로 남긴다', async () => {
    const { data, res } = await run('BLOCKED');
    expect(data.emailedAt).toBeNull();
    expect(data.deliveryChannel).toBe('BLOCKED');
    expect(res.delivered).toBe(false);
  });

  it('🔴 상류 실패(FAILED) 도 emailedAt 은 null', async () => {
    const { data } = await run('FAILED');
    expect(data.emailedAt).toBeNull();
  });

  it('🔴 설정상 모의(SIMULATION) 도 발송이 아니다 — emailedAt 은 null', async () => {
    const { data, res } = await run('SIMULATION');
    expect(data.emailedAt).toBeNull();
    expect(res.delivered).toBe(false);
  });

  it('실제 발송(RESEND) 일 때만 시각을 남긴다', async () => {
    const { data, res } = await run('RESEND');
    expect(data.emailedAt).toBeInstanceOf(Date);
    expect(res.delivered).toBe(true);
  });
});
