import { describe, it, expect, vi } from 'vitest';
import { BlockchainCertService } from '../../src/modules/blockchain-cert/blockchain-cert.service';

/**
 * 🔴 (2026-09-03 P16 봉합) 관리 화면 '안내 발송' 버튼이 발송 코드 없이 toast.success 만 띄웠다 —
 *    실제 원내 알림으로 배선. 이 스펙이 지키는 것:
 *    ① 미발급자에게만 간다(ACTIVE 인증서 보유자는 제외) ② 결과 {attempted,sent,failed}가 정직하다
 *    ③ 알림 정본(NotificationService.notify)을 지난다(직접 create 는 SSE 푸시가 빠진다)
 */

const mkPrisma = (users: { id: string }[], certUserIds: string[]) => ({
  user: { findMany: vi.fn(async () => users) },
  blockchainCertificate: {
    findMany: vi.fn(async () => certUserIds.map((userId) => ({ userId }))),
  },
});

describe('인증서 설정 안내 발송 — 보낸 척하지 않는다', () => {
  it('🔴 ACTIVE 인증서 보유자는 제외하고 미발급자에게만 정본 notify 로 보낸다', async () => {
    const prisma = mkPrisma([{ id: 'u1' }, { id: 'u2' }, { id: 'u3' }], ['u2']);
    const notifications = { notify: vi.fn(async () => ({ id: 'n1' })) };
    const svc = new BlockchainCertService(prisma as never, {} as never, notifications as never);
    const r = await svc.notifySetup('ALL');
    expect(r).toEqual({ attempted: 2, sent: 2, failed: 0 });
    const sentTo = notifications.notify.mock.calls.map((c) => c[0]).sort();
    expect(sentTo).toEqual(['u1', 'u3']);
    expect((notifications.notify.mock.calls[0][1] as { type: string }).type).toBe('CERT_SETUP_NOTICE');
  });

  it('🔴 발송 실패를 성공으로 세지 않는다', async () => {
    const prisma = mkPrisma([{ id: 'u1' }, { id: 'u2' }], []);
    const notifications = {
      notify: vi.fn(async (uid: string) => { if (uid === 'u2') throw new Error('down'); return { id: 'n' }; }),
    };
    const svc = new BlockchainCertService(prisma as never, {} as never, notifications as never);
    const r = await svc.notifySetup('ALL');
    expect(r).toEqual({ attempted: 2, sent: 1, failed: 1 });
  });

  it('🔴 알림 서비스 미주입이면 보낸 척하지 않고 400 으로 말한다', async () => {
    const prisma = mkPrisma([{ id: 'u1' }], []);
    const svc = new BlockchainCertService(prisma as never, {} as never);
    await expect(svc.notifySetup('ALL')).rejects.toThrow(/배선되지 않아/);
  });

  it('역할 지정이 조회 조건에 반영된다(대조군 — DOCTOR 지정이 전 직군으로 새지 않는다)', async () => {
    const prisma = mkPrisma([], []);
    const notifications = { notify: vi.fn() };
    const svc = new BlockchainCertService(prisma as never, {} as never, notifications as never);
    await svc.notifySetup('DOCTOR');
    const where = prisma.user.findMany.mock.calls[0][0] as unknown as { where: { role: { in: string[] } } };
    expect(where.where.role.in).toEqual(['DOCTOR']);
  });
});
