import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { PolicyService } from './policy.service';

const DAY = 86400000;

// FR-30/43: 만료·재등록 일배치 + 락아웃 방지
@Injectable()
export class CredentialCronService {
  private readonly logger = new Logger('CredentialCron');

  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
    private readonly notify: NotificationService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM, { name: 'credential-lifecycle' })
  async run() {
    try {
      await this.runOnce();
    } catch (e) {
      this.logger.error(`credential cron 실패: ${(e as Error).message}`);
    }
  }

  /** 수동 트리거(테스트/관리) */
  async runOnce() {
    const now = Date.now();
    const devices = await this.prisma.staffDevice.findMany({
      where: { status: { in: ['ACTIVE', 'REENROLL_DUE'] } },
      include: { user: { select: { role: true, department: true } } },
    });
    // 사용자별 활성 디바이스 수(락아웃 방지)
    const activeCountByUser = new Map<string, number>();
    for (const d of devices) if (d.status === 'ACTIVE') activeCountByUser.set(d.userId, (activeCountByUser.get(d.userId) ?? 0) + 1);

    let dueCount = 0, expiredCount = 0, skippedLockout = 0;
    for (const d of devices) {
      const pol = await this.policy.resolve(d.user?.role, d.user?.department);
      const lastUsed = (d.lastUsedAt ?? d.verifiedAt).getTime();
      const reDueAt = d.reEnrollDueAt?.getTime() ?? d.verifiedAt.getTime() + pol.reEnrollDays * DAY;

      // 재등록 도래(FR-01) — 알림 + 상태
      if (d.status === 'ACTIVE' && now > reDueAt) {
        await this.prisma.staffDevice.update({ where: { id: d.id }, data: { status: 'REENROLL_DUE', reEnrollDueAt: new Date(reDueAt) } });
        await this.warn(d.userId, '기기 재등록 필요', '보안 정책에 따라 기기 재등록 기한이 도래했습니다.', 'WARNING');
        dueCount++;
        continue;
      }

      // 미사용 만료(FR-02) — 단, 락아웃 방지(FR-43): 사용자 마지막 활성 디바이스는 만료 보류
      if (now - lastUsed > pol.idleExpireDays * DAY) {
        const activeCount = activeCountByUser.get(d.userId) ?? 0;
        if (d.status === 'ACTIVE' && activeCount <= 1) {
          await this.warn(d.userId, '미사용 기기 — 재등록 권장', '장기 미사용 기기입니다. 보안을 위해 재등록을 권장합니다(자동 만료 보류).', 'WARNING');
          skippedLockout++;
          continue;
        }
        await this.prisma.staffDevice.update({ where: { id: d.id }, data: { status: 'EXPIRED', expiresAt: new Date() } });
        await this.prisma.webAuthnCredential.updateMany({ where: { deviceId: d.id, status: 'ACTIVE' }, data: { status: 'REVOKED' } });
        if (d.status === 'ACTIVE') activeCountByUser.set(d.userId, activeCount - 1);
        await this.warn(d.userId, '미사용 기기 만료', '장기 미사용으로 기기가 만료되었습니다. 재등록이 필요합니다.', 'WARNING');
        expiredCount++;
      }
    }

    // 인증서 만료 임박(FR-03/12)
    let certWarn = 0;
    const globalPol = await this.policy.resolve(null, null);
    const soon = new Date(now + globalPol.expiryWarnDays * DAY);
    const certs = await this.prisma.blockchainCertificate.findMany({
      where: { ownerType: 'STAFF', status: 'ACTIVE', expiresAt: { lte: soon, gt: new Date() }, userId: { not: null } },
      select: { userId: true, expiresAt: true },
    });
    for (const c of certs) {
      if (!c.userId) continue;
      await this.warn(c.userId, '인증서 만료 임박', `전자서명 인증서가 ${c.expiresAt.toISOString().slice(0, 10)}에 만료됩니다. 갱신하세요.`, 'WARNING');
      certWarn++;
    }

    const summary = { devices: devices.length, reEnrollDue: dueCount, expired: expiredCount, skippedLockout, certWarn };
    this.logger.log(`credential lifecycle: ${JSON.stringify(summary)}`);
    return summary;
  }

  private async warn(userId: string, title: string, message: string, severity: string) {
    await this.notify.create(userId, { type: 'CREDENTIAL', title, message, severity, refType: 'CREDENTIAL_LIFECYCLE' }).catch(() => undefined);
  }
}
