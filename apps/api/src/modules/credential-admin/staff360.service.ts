import { Injectable, Logger, NotFoundException, ForbiddenException } from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { RedisService } from '../../infrastructure/redis/redis.service';

// FR-20/21/22: 직원 360° 인증현황 + 세션/로그인
@Injectable()
export class Staff360Service {
  private readonly logger = new Logger(Staff360Service.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /** FR-28: 인증 현황 대시보드 요약 */
  async dashboard() {
    const now = new Date();
    const gp = await this.prisma.authPolicy.findFirst({ where: { scope: 'GLOBAL' }, select: { expiryWarnDays: true } });
    const warnAt = new Date(now.getTime() + (gp?.expiryWarnDays ?? 14) * 86400000);

    const [totalStaff, withDevice, reEnrollDue, expiredDevices, lostDevices, certActive, certExpiringSoon, certRevoked, pendingApprovals, recovery] =
      await Promise.all([
        this.prisma.user.count({ where: { isActive: true } }),
        this.prisma.staffDevice.findMany({ where: { status: 'ACTIVE' }, select: { userId: true }, distinct: ['userId'] }),
        this.prisma.staffDevice.count({ where: { status: 'REENROLL_DUE' } }),
        this.prisma.staffDevice.count({ where: { status: 'EXPIRED' } }),
        this.prisma.staffDevice.count({ where: { lostReportedAt: { not: null } } }),
        this.prisma.blockchainCertificate.count({ where: { ownerType: 'STAFF', status: 'ACTIVE' } }),
        this.prisma.blockchainCertificate.count({ where: { ownerType: 'STAFF', status: 'ACTIVE', expiresAt: { lte: warnAt, gt: now } } }),
        this.prisma.blockchainCertificate.count({ where: { ownerType: 'STAFF', status: 'REVOKED' } }),
        this.prisma.adminApproval.count({ where: { status: 'PENDING' } }),
        this.prisma.accountRecovery.count({ where: { status: { in: ['PENDING', 'REQUESTED', 'APPROVED'] } } }),
      ]);

    return {
      staff: { total: totalStaff, withActiveDevice: withDevice.length, unregistered: Math.max(0, totalStaff - withDevice.length) },
      devices: { reEnrollDue, expired: expiredDevices, lost: lostDevices },
      certs: { active: certActive, expiringSoon: certExpiringSoon, revoked: certRevoked },
      pending: { approvals: pendingApprovals, recovery },
    };
  }

  /** 직원 1명의 디바이스·패스키·인증서·세션·복구·감사 통합 */
  async get(userId: string, viewerId?: string) {
    if (viewerId) await this.auditRead(viewerId, userId, 'STAFF360'); // FR-48 열람 감사
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, familyName: true, givenName: true, role: true, department: true, isActive: true },
    });
    if (!user) throw new NotFoundException('직원 없음');

    const [devices, passkeys, certs, recovery, sessions, audit] = await Promise.all([
      this.prisma.staffDevice.findMany({ where: { userId }, orderBy: { verifiedAt: 'desc' } }),
      this.prisma.webAuthnCredential.findMany({
        where: { userId },
        select: { id: true, deviceName: true, status: true, backedUp: true, lastUsedAt: true, createdAt: true, deviceId: true },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.blockchainCertificate.findMany({
        where: { ownerType: 'STAFF', userId },
        select: { id: true, serialNumber: true, status: true, issuedAt: true, expiresAt: true, revokedAt: true },
        orderBy: { issuedAt: 'desc' },
      }),
      this.prisma.accountRecovery.findMany({ where: { userId }, orderBy: { requestedAt: 'desc' }, take: 10 }),
      this.getSessions(userId),
      this.prisma.auditLog.findMany({
        where: { OR: [{ resourceId: userId }, { userId }] },
        orderBy: { timestamp: 'desc' },
        take: 30,
        select: { id: true, action: true, resourceType: true, resourceId: true, changes: true, timestamp: true, userId: true },
      }),
    ]);

    return { user, devices, passkeys, certs, recovery, sessions, audit };
  }

  /** 활성 세션 목록 (session:* 스캔 + refresh 토큰 존재) */
  async getSessions(userId: string, viewerId?: string) {
    if (viewerId) await this.auditRead(viewerId, userId, 'SESSION');
    const keys = await this.redis.keys('session:*');
    const sessions: Array<{ sessionId: string; createdAt?: string; lastActiveAt?: string }> = [];
    for (const k of keys) {
      const raw = await this.redis.get(k);
      if (!raw) continue;
      try {
        const s = JSON.parse(raw);
        if (s.userId === userId) {
          sessions.push({ sessionId: k.replace('session:', ''), createdAt: s.createdAt, lastActiveAt: s.lastActiveAt });
        }
      } catch {
        /* skip */
      }
    }
    sessions.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
    // 세션별 refresh 모델 — 활성 여부는 실제 세션 존재로 판정
    return { active: sessions.length > 0, count: sessions.length, sessions };
  }

  /** 로그인 이력(베스트에포트: 세션 createdAt 기준) */
  async getLogins(userId: string, viewerId?: string) {
    if (viewerId) await this.auditRead(viewerId, userId, 'LOGIN_HISTORY');
    const { sessions } = await this.getSessions(userId);
    return sessions.map((s) => ({ at: s.createdAt, lastActiveAt: s.lastActiveAt, method: 'session', sessionId: s.sessionId }));
  }

  /** 강제 로그아웃 (SLO) — refresh·세션·SSO 자식토큰 무효화 */
  async forceLogout(actorId: string, userId: string) {
    if (actorId === userId) throw new ForbiddenException('본인 세션은 콘솔에서 강제 로그아웃할 수 없습니다(일반 로그아웃 사용).'); // FR-42
    // 레거시 + 세션별 refresh 키 모두 제거(세션별 모델)
    await this.redis.del(`refresh:${userId}`, `refresh:hash:${userId}`, `refresh:used:${userId}`, `sessions:${userId}`);
    const keys = await this.redis.keys('session:*');
    let removed = 0;
    for (const k of keys) {
      const raw = await this.redis.get(k);
      if (!raw) continue;
      try {
        if (JSON.parse(raw).userId === userId) {
          const sid = k.replace('session:', '');
          await this.redis.del(k, `refresh:sess:${sid}`, `refresh:used:sess:${sid}`);
          removed++;
        }
      } catch {
        /* skip */
      }
    }
    // SSO 자식 토큰(SLO)
    const jtis = await this.redis.smembers(`sso:children:${userId}`);
    if (jtis.length) await this.redis.del(...jtis.map((j) => `sso:jti:${j}`));
    await this.redis.del(`sso:children:${userId}`);

    await this.prisma.auditLog
      .create({
        data: {
          userId: actorId,
          action: AuditAction.UPDATE,
          resourceType: 'SESSION',
          resourceId: userId,
          changes: { op: 'FORCE_LOGOUT', sessions: removed, ssoTokens: jtis.length } as Prisma.InputJsonObject,
        },
      })
      .catch((e) => {
        // 세션은 이미 끊었다 — 강제 로그아웃 감사 기록 실패를 조용히 삼키지 않는다
        this.logger.warn(`force-logout audit write failed target=${userId}: ${e instanceof Error ? e.message : String(e)}`);
      });
    return { ok: true, sessionsRemoved: removed, ssoRevoked: jtis.length };
  }

  /** FR-48: 인증 정보 열람 감사 (관리자 열람도 추적) */
  private async auditRead(viewerId: string, targetUserId: string, scope: string) {
    await this.prisma.auditLog
      .create({
        data: {
          userId: viewerId,
          action: AuditAction.READ,
          resourceType: 'CREDENTIAL_VIEW',
          resourceId: targetUserId,
          changes: { scope } as Prisma.InputJsonObject,
        },
      })
      .catch(() => undefined);
  }
}
