import { describe, it, expect, vi } from 'vitest';
import { ClaimService } from '../../src/modules/claim/claim.service';

/**
 * 🔴 심사 결과 콜백 — 조회 실패를 "담당의 없음"으로, 알림 실패를 "보냈다"로 말하지 않는다(2026-09-16 K4).
 *
 * 종전: 두 조회가 `.catch(() => null)` 이라 **DB 실패와 "그런 건이 없다"가 같은 값**이었다.
 *   → 삭감·반려 알림이 조용히 사라지고, 심사기관에는 `{ok:false}`(의사 미상)로 답해 **재시도도 오지 않는다**.
 *   게다가 알림이 실패해도 `notified: true` 를 돌려줬다(보낸 것과 실패한 것을 뒤바꿔 말함).
 */
const svcWith = (prisma: unknown, notify: unknown) =>
  new ClaimService(prisma as never, { enqueue: vi.fn() } as never, { notify } as never);

describe('🔴 심사 결과 콜백 정직성', () => {
  it('🔴 claim 조회가 실패하면 전파한다(ok:false 로 접지 않는다 — 외부가 재시도해야 한다)', async () => {
    const svc = svcWith(
      { claim: { findUnique: vi.fn().mockRejectedValue(new Error('DB down')) } },
      vi.fn(),
    );
    await expect(svc.reviewCallback({ claimId: 'c1', result: 'REDUCED' })).rejects.toThrow('DB down');
  });

  it('🔴 encounter 조회가 실패해도 전파한다', async () => {
    const svc = svcWith(
      { encounter: { findUnique: vi.fn().mockRejectedValue(new Error('DB down')) } },
      vi.fn(),
    );
    await expect(svc.reviewCallback({ encounterId: 'e1', result: 'REJECTED' })).rejects.toThrow('DB down');
  });

  it('대조군 — 조회가 성공했는데 담당의가 없으면 ok:false(진짜 "없음"은 그대로)', async () => {
    const svc = svcWith(
      { encounter: { findUnique: vi.fn().mockResolvedValue({ doctorId: null }) } },
      vi.fn(),
    );
    await expect(svc.reviewCallback({ encounterId: 'e1', result: 'APPROVED' })).resolves.toEqual({ ok: false });
  });

  it('🔴 알림이 실패하면 notified:false — 보냈다고 말하지 않는다', async () => {
    const notify = vi.fn().mockRejectedValue(new Error('push down'));
    const svc = svcWith({}, notify);
    const r = await svc.reviewCallback({ doctorId: 'd1', result: 'REJECTED', reason: 'x' });
    expect(r).toEqual({ ok: true, doctorId: 'd1', notified: false });
  });

  it('대조군 — 알림이 성공하면 notified:true', async () => {
    const notify = vi.fn().mockResolvedValue({});
    const svc = svcWith({}, notify);
    const r = await svc.reviewCallback({ doctorId: 'd1', result: 'APPROVED' });
    expect(r).toEqual({ ok: true, doctorId: 'd1', notified: true });
  });
});
