import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';

// FR-04/05/24/46: 디바이스 보안 운영(강제 재등록·분실·해제)
@Injectable()
export class DevicePolicyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notify: NotificationService,
  ) {}

  /** 전체 디바이스(등록일·최근사용·만료·재등록예정·상태) */
  list(opts?: { userId?: string; status?: string }) {
    return this.prisma.staffDevice.findMany({
      where: { ...(opts?.userId ? { userId: opts.userId } : {}), ...(opts?.status ? { status: opts.status } : {}) },
      orderBy: { verifiedAt: 'desc' },
      include: { user: { select: { familyName: true, givenName: true, role: true, department: true } } },
      take: 500,
    });
  }

  /** FR-05: 강제 재등록 — 재등록 필요 상태 전이 + 알림 */
  async forceReEnroll(actorId: string, deviceId: string) {
    const d = await this.get(deviceId);
    if (d.userId === actorId) throw new ForbiddenException('본인 기기는 직접 강제재등록할 수 없습니다(타 관리자 경유).'); // FR-42
    await this.prisma.staffDevice.update({
      where: { id: deviceId },
      data: { status: 'REENROLL_DUE', reEnrollDueAt: new Date() },
    });
    await this.audit(actorId, AuditAction.UPDATE, deviceId, { op: 'FORCE_REENROLL' });
    await this.notifyUser(d.userId, '기기 재등록 필요', '보안 정책에 따라 기기를 재등록해 주세요.', 'WARNING');
    return { ok: true };
  }

  /** FR-04/46: 분실 신고 — 디바이스+연결 패스키+FCM+세션 즉시 폐기 */
  async reportLost(actorId: string, deviceId: string, byOwner: boolean, reason?: string) {
    if (!byOwner && (!reason || !reason.trim())) {
      throw new ForbiddenException('관리자 분실 신고는 사유가 필수입니다(FR-46).'); // 허위신고 추적
    }
    const d = await this.get(deviceId);
    await this.prisma.$transaction([
      this.prisma.staffDevice.update({
        where: { id: deviceId },
        data: { status: 'REVOKED', lostReportedAt: new Date(), revokedAt: new Date(), revokeReason: reason ?? '분실 신고', fcmToken: null },
      }),
      this.prisma.webAuthnCredential.updateMany({
        where: { deviceId, status: 'ACTIVE' },
        data: { status: 'REVOKED' },
      }),
    ]);
    await this.audit(actorId, AuditAction.UPDATE, deviceId, { op: 'REPORT_LOST', byOwner, reason: reason ?? null });
    await this.notifyUser(d.userId, '기기 분실 처리됨', '신고된 기기의 인증 수단이 폐기되었습니다. 재등록이 필요합니다.', 'CRITICAL');
    return { ok: true, message: '분실 처리 완료 — 재등록이 필요합니다.' };
  }

  /** FR-24: 정상 해제(unenroll) — 디바이스+연결 패스키 폐기 */
  async unenroll(actorId: string, deviceId: string, reason?: string) {
    const d = await this.get(deviceId);
    if (d.userId === actorId) throw new ForbiddenException('본인 기기는 직접 해제할 수 없습니다(타 관리자 경유).'); // FR-42
    await this.prisma.$transaction([
      this.prisma.staffDevice.update({
        where: { id: deviceId },
        data: { status: 'REVOKED', revokedAt: new Date(), revokeReason: reason ?? '관리자 해제', fcmToken: null },
      }),
      this.prisma.webAuthnCredential.updateMany({ where: { deviceId, status: 'ACTIVE' }, data: { status: 'REVOKED' } }),
    ]);
    await this.audit(actorId, AuditAction.DELETE, deviceId, { op: 'UNENROLL', reason: reason ?? null });
    await this.notifyUser(d.userId, '기기 등록 해제', '등록된 기기가 해제되었습니다.', 'INFO');
    return { ok: true };
  }

  private async get(deviceId: string) {
    const d = await this.prisma.staffDevice.findUnique({ where: { id: deviceId } });
    if (!d) throw new NotFoundException('디바이스 없음');
    return d;
  }

  private async notifyUser(userId: string, title: string, message: string, severity: string) {
    await this.notify
      .create(userId, { type: 'CREDENTIAL', title, message, severity, refType: 'STAFF_DEVICE' })
      .catch(() => undefined);
  }

  private async audit(actorId: string, action: AuditAction, deviceId: string, changes: Prisma.InputJsonObject) {
    await this.prisma.auditLog
      .create({ data: { userId: actorId, action, resourceType: 'STAFF_DEVICE', resourceId: deviceId, changes } })
      .catch(() => undefined);
  }
}
