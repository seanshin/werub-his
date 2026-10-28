import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BillingService } from '../../src/modules/billing/billing.service';

/** 청구 심층검토 §3 — 취소 발행 ref 구분(skipDuplicates 폐기 방지) */
describe('BillingService.emitBillingLines — 취소 ref 구분', () => {
  let svc: BillingService;
  let outbox: any;

  beforeEach(() => {
    outbox = { enqueue: vi.fn() };
    svc = new BillingService(
      {} as any, {} as any, outbox as any, {} as any, {} as any, {} as any, {} as any,
    );
    // buildLines를 라인 1건으로 고정(prisma include 회피)
    vi.spyOn(svc as any, 'buildLines').mockResolvedValue([
      { encounterId: 'e1', sourcePrescriptionId: 'rx1', lineId: 'l1', amount: 100, cancelled: false },
    ]);
  });

  it('정상 발행 ref = bline:e1:rx:rx1', async () => {
    await svc.emitBillingLines('b1', false);
    expect(outbox.enqueue).toHaveBeenCalledWith('billing', 'billing.line_recorded', 'bline:e1:rx:rx1', expect.anything());
  });

  it('취소 발행 ref = bline:e1:rx:rx1:cancel (원 발행과 분리 → ERP 전달)', async () => {
    await svc.emitBillingLines('b1', true);
    expect(outbox.enqueue).toHaveBeenCalledWith('billing', 'billing.line_recorded', 'bline:e1:rx:rx1:cancel', expect.anything());
  });

  it('정상·취소 ref가 서로 달라 skipDuplicates에 폐기되지 않음', async () => {
    await svc.emitBillingLines('b1', false);
    await svc.emitBillingLines('b1', true);
    const refs = outbox.enqueue.mock.calls.map((c: any[]) => c[2]);
    expect(new Set(refs).size).toBe(2); // 서로 다른 ref
  });
});
