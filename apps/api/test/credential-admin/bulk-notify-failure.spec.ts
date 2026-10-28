import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BulkService } from '../../src/modules/credential-admin/bulk.service';

/**
 * 가드 — `Promise.all` 안에서 실패가 조용히 사라지던 자리 (2026-08-21)
 *
 * 🔴 원 결함: 그룹 강제 재등록(`bulkReEnroll`)은 대상 직원 전원에게 알림을 만들면서
 *    `this.notify.create(...).catch(() => undefined)` 로 실패를 지웠다. 기기는
 *    `REENROLL_DUE` 로 바뀌었는데 **당사자만 그 사실을 모르는 상태**가 흔적 없이
 *    남았고, 감사기록에는 `users: N` 만 있어 전원 통보된 것처럼 읽혔다.
 *    (같은 계열의 실측 선례 — 알림 refId 계약: "N명 통보" 로그인데 실제 발행 0건)
 *
 * 재주입 검증: `.catch(() => undefined)` + `Promise.all` 로 되돌리면
 * notifyFailed 가 사라져 아래 두 케이스가 실패한다.
 */
describe('bulkReEnroll — 통보 실패를 지우지 않는다', () => {
  let service: BulkService;
  let notifyCreate: ReturnType<typeof vi.fn>;
  let auditCreate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    notifyCreate = vi.fn();
    auditCreate = vi.fn().mockResolvedValue({});
    const prisma: any = {
      user: { findMany: vi.fn().mockResolvedValue([{ id: 'u1' }, { id: 'u2' }, { id: 'u3' }]) },
      staffDevice: { updateMany: vi.fn().mockResolvedValue({ count: 5 }) },
      auditLog: { create: auditCreate },
    };
    const approvals: any = { consume: vi.fn().mockResolvedValue(undefined), request: vi.fn() };
    service = new BulkService(prisma, { create: notifyCreate } as any, approvals, {} as any);
  });

  it('🔴 일부 통보가 실패하면 notifyFailed 로 응답에 드러낸다', async () => {
    notifyCreate.mockImplementation(async (id: string) => {
      if (id === 'u2') throw new Error('알림 발행 실패(refId 계약 위반)');
      return { id: `n-${id}` };
    });

    const r: any = await service.bulkReEnroll('actor', 'ROLE', 'NURSE');

    expect(r.users).toBe(3);
    expect(r.notified).toBe(2);
    expect(r.notifyFailed).toBe(1);
  });

  it('🔴 감사기록에도 통보 성공/실패 수가 남는다 — users 만으로 전원 통보로 읽히지 않게', async () => {
    notifyCreate.mockRejectedValue(new Error('알림 서비스 다운'));

    await service.bulkReEnroll('actor', 'ROLE', 'NURSE');

    const changes = auditCreate.mock.calls[0][0].data.changes;
    expect(changes.notifyFailed).toBe(3);
    expect(changes.notified).toBe(0);
  });

  it('전원 통보되면 notifyFailed 는 0', async () => {
    notifyCreate.mockResolvedValue({ id: 'n' });

    const r: any = await service.bulkReEnroll('actor', 'DEPARTMENT', '간호부');

    expect(r.notified).toBe(3);
    expect(r.notifyFailed).toBe(0);
  });
});
