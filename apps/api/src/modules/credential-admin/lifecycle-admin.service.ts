import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { DeviceEnrollService } from '../auth/device-enroll/device-enroll.service';
import { ApprovalService } from './approval.service';
import { Staff360Service } from './staff360.service';

// FR-50/51: 온보딩 / 오프보딩(수명주기)
@Injectable()
export class LifecycleAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly enroll: DeviceEnrollService,
    private readonly approvals: ApprovalService,
    private readonly staff360: Staff360Service,
  ) {}

  /** FR-50: 온보딩 — 디바이스 등록 QR 발급 + 현황 체크리스트 */
  async onboard(actorId: string, userId: string, deviceName?: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, isActive: true } });
    if (!user) throw new NotFoundException('직원 없음');
    const session = await this.enroll.start(actorId, userId, undefined, deviceName ?? '신규 기기');
    const [device, cert] = await Promise.all([
      this.prisma.staffDevice.count({ where: { userId, status: 'ACTIVE' } }),
      this.prisma.blockchainCertificate.count({ where: { ownerType: 'STAFF', userId, status: 'ACTIVE' } }),
    ]);
    await this.audit(actorId, AuditAction.CREATE, userId, { op: 'ONBOARD_START' });
    return { enroll: session, checklist: { hasActiveDevice: device > 0, hasActiveCert: cert > 0 } };
  }

  /**
   * FR-51: 오프보딩(deprovision) — 4-eyes. 디바이스·패스키·인증서·세션 일괄 폐기 + 계정 비활성화.
   * 승인 없으면 요청(pending), 승인 후 재호출 시 실행.
   */
  async deprovision(actorId: string, userId: string, reason: string) {
    if (actorId === userId) throw new ForbiddenException('본인 계정은 직접 폐기할 수 없습니다.'); // FR-42
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) throw new NotFoundException('직원 없음');

    try {
      await this.approvals.consume('ACCOUNT_DEPROVISION', userId, actorId);
    } catch (e) {
      if (e instanceof ForbiddenException) {
        const ap = await this.approvals.request('ACCOUNT_DEPROVISION', 'USER', userId, actorId, reason);
        return { pending: true, approvalId: ap.id, message: '2인 승인(4-eyes)이 필요합니다. 승인 후 폐기됩니다.' };
      }
      throw e;
    }

    const [dev, pk, cert] = await this.prisma.$transaction([
      this.prisma.staffDevice.updateMany({
        where: { userId, status: { in: ['ACTIVE', 'REENROLL_DUE', 'EXPIRED'] } },
        data: { status: 'REVOKED', revokedAt: new Date(), revokeReason: reason, fcmToken: null },
      }),
      this.prisma.webAuthnCredential.updateMany({ where: { userId, status: 'ACTIVE' }, data: { status: 'REVOKED' } }),
      this.prisma.blockchainCertificate.updateMany({
        where: { ownerType: 'STAFF', userId, status: { in: ['ACTIVE', 'SUSPENDED'] } },
        data: { status: 'REVOKED', revokedAt: new Date(), revokeReason: reason },
      }),
    ]);
    const logout = await this.staff360.forceLogout(actorId, userId);
    await this.prisma.user.update({ where: { id: userId }, data: { isActive: false } });
    await this.audit(actorId, AuditAction.DELETE, userId, {
      op: 'DEPROVISION', reason, devices: dev.count, passkeys: pk.count, certs: cert.count, sessions: logout.sessionsRemoved,
    });
    return { pending: false, devices: dev.count, passkeys: pk.count, certs: cert.count, sessions: logout.sessionsRemoved };
  }

  private async audit(actorId: string, action: AuditAction, userId: string, changes: Prisma.InputJsonObject) {
    await this.prisma.auditLog
      .create({ data: { userId: actorId, action, resourceType: 'STAFF_LIFECYCLE', resourceId: userId, changes } })
      .catch(() => undefined);
  }
}
