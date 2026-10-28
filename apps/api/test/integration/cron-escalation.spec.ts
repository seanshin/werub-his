import { describe, it, expect, beforeEach, vi } from 'vitest';

import { VoucherCronService } from '../../src/modules/voucher/voucher-cron.service';
import { AnomalyDetectionService } from '../../src/modules/audit-enhanced/anomaly-detection.service';

/**
 * 크론 전수검토 회귀 — 보안·무결성 탐지 크론이 "로그만" 남기고 끝나던 것 봉합.
 * 탐지(detection)와 상신(escalation)은 분리될 수 없다: 아무도 안 보는 알람은 통제가 아니다.
 */
describe('보안·무결성 크론 상신(escalation)', () => {
  const admins = [{ id: 'admin-1' }, { id: 'admin-2' }];

  describe('VoucherCron.verifyChainSample', () => {
    let prisma: any;
    let ledger: any;
    let notifications: any;

    beforeEach(() => {
      vi.clearAllMocks();
      prisma = {
        checkupVoucher: {
          /**
           * 🔴 `verifyChainSample` 은 `findMany` 를 **두 번** 부른다 —
           *    ① 검증 표본 ② 이미 `chainValid=false` 로 표시된 건(반복 경보 억제용).
           *    한 값만 주면 표본이 그대로 "이미 상신분"이 되어 **새 위반이 없는 것처럼** 보인다.
           *    목은 정본의 **실제 호출 순서**를 따른다(§규약 3).
           */
          findMany: vi.fn()
            .mockResolvedValueOnce([{ id: 'v1', serial: 'WGC-0001' }, { id: 'v2', serial: 'WGC-0002' }])
            .mockResolvedValueOnce([]),
          update: vi.fn().mockResolvedValue({}),
        },
        user: { findMany: vi.fn().mockResolvedValue(admins) },
      };
      ledger = { verifyChain: vi.fn() };
      notifications = { notify: vi.fn().mockResolvedValue({}) };
    });

    const make = () => new VoucherCronService(prisma, {} as never, ledger, notifications);

    it('무결성 위반 시 전 ADMIN에게 CRITICAL 통보한다', async () => {
      ledger.verifyChain
        .mockResolvedValueOnce({ valid: false, events: 1, brokenAt: 'e1' })
        .mockResolvedValueOnce({ valid: true, events: 2 });

      await make().verifyChainSample();

      expect(notifications.notify).toHaveBeenCalledTimes(admins.length);
      const [, payload] = notifications.notify.mock.calls[0];
      expect(payload.type).toBe('VOUCHER_CHAIN_BROKEN');
      expect(payload.severity).toBe('CRITICAL');
      expect(payload.message).toContain('WGC-0001');
    });

    it('위반이 없으면 통보하지 않는다 (알람 피로 방지)', async () => {
      ledger.verifyChain.mockResolvedValue({ valid: true, events: 1 });
      await make().verifyChainSample();
      expect(notifications.notify).not.toHaveBeenCalled();
    });

    it('검증 결과를 기록해 미검증분 우선 순회를 가능케 한다', async () => {
      ledger.verifyChain.mockResolvedValue({ valid: true, events: 1 });
      await make().verifyChainSample();

      expect(prisma.checkupVoucher.update).toHaveBeenCalledTimes(2);
      expect(prisma.checkupVoucher.update.mock.calls[0][0].data).toMatchObject({ chainValid: true });
      // 최신순 고정이면 오래된 검진권이 영구 미검증 → 정렬에 chainVerifiedAt이 포함되어야 한다
      expect(JSON.stringify(prisma.checkupVoucher.findMany.mock.calls[0][0].orderBy)).toContain('chainVerifiedAt');
    });
  });

  describe('AnomalyDetectionService.runPeriodicCheck', () => {
    let prisma: any;
    let notifications: any;

    beforeEach(() => {
      vi.clearAllMocks();
      prisma = {
        auditLog: { findMany: vi.fn().mockResolvedValue([{ userId: 'u1' }]), groupBy: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0) },
        user: { findMany: vi.fn().mockResolvedValue(admins) },
      };
      notifications = { notify: vi.fn().mockResolvedValue({}) };
    });

    it('PHI 접근 이상 탐지 시 ADMIN에게 통보한다', async () => {
      const svc = new AnomalyDetectionService(prisma, notifications);
      vi.spyOn(svc, 'checkBulkAccess').mockResolvedValue({ type: 'BULK_ACCESS', userId: 'u1', message: '대량 조회', detectedAt: new Date() });
      vi.spyOn(svc, 'checkAfterHoursAccess').mockResolvedValue(null);

      await svc.runPeriodicCheck();

      expect(notifications.notify).toHaveBeenCalledTimes(admins.length);
      const [, payload] = notifications.notify.mock.calls[0];
      expect(payload.type).toBe('AUDIT_ANOMALY');
      expect(payload.message).toContain('BULK_ACCESS');
    });

    it('이상이 없으면 통보하지 않는다', async () => {
      const svc = new AnomalyDetectionService(prisma, notifications);
      vi.spyOn(svc, 'checkBulkAccess').mockResolvedValue(null);
      vi.spyOn(svc, 'checkAfterHoursAccess').mockResolvedValue(null);

      await svc.runPeriodicCheck();

      expect(notifications.notify).not.toHaveBeenCalled();
    });

    /**
     * 🔴 탐지기 격리 — 화면 실사용 점검 W8(2026-08-14).
     *
     * VIP 열람 감지를 `runPeriodicCheck` 에 배선하면서 그 호출을 바깥 try 에 그대로 두었더니,
     * VIP 조회가 던지는 순간 **이미 탐지해 둔 대량조회 경보까지 통째로 사라졌다.**
     * 로그에는 "Periodic check failed" 한 줄만 남아 아무도 알 수 없었다(위 케이스가 통보 0건으로 실패).
     *
     * 이상탐지는 하나가 죽어도 나머지는 나가야 한다. 그리고 실패한 탐지기의 커서는
     * **전진시키지 않아야** 다음 회차가 그 구간을 다시 본다 — 놓친 열람이 영구 유실되지 않게.
     */
    it('🔴 탐지기 하나가 실패해도 나머지 경보는 나간다 (하나가 전부를 죽이지 않는다)', async () => {
      // prisma 에 VIP 조회 대상 모델이 없어 detectVipAccess 가 던지는 상황 (mock 그대로)
      const svc = new AnomalyDetectionService(prisma, notifications);
      vi.spyOn(svc, 'checkBulkAccess').mockResolvedValue({ type: 'BULK_ACCESS', userId: 'u1', message: '대량 조회', detectedAt: new Date() });
      vi.spyOn(svc, 'checkAfterHoursAccess').mockResolvedValue(null);

      await svc.runPeriodicCheck();

      expect(notifications.notify).toHaveBeenCalledTimes(admins.length);
      expect(notifications.notify.mock.calls[0][1].message).toContain('BULK_ACCESS');
    });

    it('🔴 VIP 탐지가 실패하면 커서를 전진시키지 않는다 (놓친 구간을 다음 회차가 다시 본다)', async () => {
      const svc = new AnomalyDetectionService(prisma, notifications);
      vi.spyOn(svc, 'checkBulkAccess').mockResolvedValue(null);
      vi.spyOn(svc, 'checkAfterHoursAccess').mockResolvedValue(null);
      const cursorBefore = (svc as unknown as { lastVipScanAt?: Date | null }).lastVipScanAt ?? null;

      await svc.runPeriodicCheck();

      expect((svc as unknown as { lastVipScanAt?: Date | null }).lastVipScanAt ?? null).toBe(cursorBefore);
    });
  });
});
