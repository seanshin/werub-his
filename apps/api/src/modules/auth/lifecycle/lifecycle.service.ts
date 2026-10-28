import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { RedisService } from '../../../infrastructure/redis/redis.service';
import { NotificationService } from '../../notification/notification.service';
import { AuthService } from '../auth.service';

// FR-13: 관리자 정책·패스키 강제재설정 / FR-23: 수명주기 폐기훅
const POLICY_KEY = 'auth:policy';
const DEFAULT_POLICY = {
  maxDevices: 3, // D-5
  idleClinicalMin: 30, // D-6
  idleAdminMin: 60,
  attestation: 'HIGH_ASSURANCE_ONLY', // D-7
  syncedPasskey: 'ROLE_BASED', // D-4
};
export type AuthPolicy = typeof DEFAULT_POLICY;

@Injectable()
export class LifecycleService {
  private readonly logger = new Logger(LifecycleService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly notify: NotificationService,
    private readonly auth: AuthService,
  ) {}

  // ── 정책 (FR-13) ──
  async getPolicy(): Promise<AuthPolicy> {
    try {
      const raw = await this.redis.get(POLICY_KEY);
      return raw ? { ...DEFAULT_POLICY, ...JSON.parse(raw) } : DEFAULT_POLICY;
    } catch {
      return DEFAULT_POLICY;
    }
  }

  async setPolicy(adminId: string, patch: Partial<AuthPolicy>): Promise<AuthPolicy> {
    const next = { ...(await this.getPolicy()), ...patch };
    await this.redis.set(POLICY_KEY, JSON.stringify(next));
    await this.audit(adminId, 'UPDATE', adminId, { action: 'SET_POLICY', policy: next });
    return next;
  }

  // ── 패스키 강제 재설정 (FR-13) ──
  async forceResetPasskeys(adminId: string, userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('직원을 찾을 수 없습니다.');
    const res = await this.prisma.webAuthnCredential.updateMany({
      where: { userId, status: 'ACTIVE' },
      data: { status: 'REVOKED' },
    });
    await this.auth.logout(userId); // 세션·SSO 자식 무효화
    await this.audit(adminId, 'UPDATE', userId, { action: 'PASSKEY_RESET', revoked: res.count });
    await this.notifyOne(userId, '패스키가 재설정되었습니다', '관리자가 패스키를 재설정했습니다. 새 패스키를 등록하세요.', userId);
    this.logger.warn(`패스키 강제재설정 user=${userId} by=${adminId} (${res.count})`);
    return { revoked: res.count };
  }

  // ── 수명주기 폐기훅 (FR-23) — 퇴사/역할변경 시 일괄 폐기 ──
  async deprovision(adminId: string, userId: string, reason?: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('직원을 찾을 수 없습니다.');

    await this.prisma.$transaction([
      this.prisma.webAuthnCredential.updateMany({
        where: { userId, status: 'ACTIVE' },
        data: { status: 'REVOKED' },
      }),
      this.prisma.staffDevice.updateMany({
        where: { userId, status: 'ACTIVE' },
        data: { status: 'REVOKED', revokedAt: new Date(), revokeReason: reason ?? 'deprovision', fcmToken: null },
      }),
    ]);
    await this.auth.logout(userId); // 세션 + refresh + SSO 자식(SLO)
    await this.audit(adminId, 'UPDATE', userId, { action: 'DEPROVISION', reason: reason ?? null });
    this.logger.warn(`수명주기 폐기 user=${userId} by=${adminId} reason=${reason ?? '-'}`);
    return { deprovisioned: true };
  }

  private async notifyOne(userId: string, title: string, message: string, refId: string) {
    const n = await this.notify
      .create(userId, { type: 'SECURITY', title, message, severity: 'WARNING', refType: 'AuthLifecycle', refId })
      .catch(() => null);
    if (n) this.notify.pushNotification(userId, { id: n.id, type: 'SECURITY', title, message, severity: 'WARNING', refType: 'AuthLifecycle', refId });
  }

  private async audit(userId: string, action: 'CREATE' | 'UPDATE', resourceId: string, changes: Prisma.InputJsonObject) {
    await this.prisma.auditLog
      .create({ data: { userId, action, resourceType: 'AUTH_LIFECYCLE', resourceId, changes } })
      .catch(() => undefined);
  }
}
