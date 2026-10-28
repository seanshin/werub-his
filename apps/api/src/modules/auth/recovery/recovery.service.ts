import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { randomBytes, createHash } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { NotificationService } from '../../notification/notification.service';
import { AuthService } from '../auth.service';

// 계정 복구 (FR-16/24) — 패스키 전부 분실 시 관리자 다중통제 승인 → 재등록
@Injectable()
export class RecoveryService {
  private readonly logger = new Logger(RecoveryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notify: NotificationService,
    private readonly auth: AuthService,
  ) {}

  private hash(t: string) {
    return createHash('sha256').update(t).digest('hex');
  }

  // 1) 잠긴 직원이 복구 요청 (공개). FR-25: 사용자 존재여부와 무관 동일 응답
  async request(identifier: string, reason?: string) {
    const user = await this.prisma.user.findUnique({ where: { email: identifier } });
    if (user) {
      const rec = await this.prisma.accountRecovery.create({
        data: { userId: user.id, reason, status: 'PENDING' },
      });
      // 보안팀(ADMIN) 알림
      const admins = await this.prisma.user.findMany({ where: { role: 'ADMIN', isActive: true }, select: { id: true } });
      await Promise.all(admins.map((a) => this.notifyOne(a.id, '계정 복구 요청', `${user.familyName}${user.givenName} 복구 요청(사유: ${reason ?? '-'})`, rec.id)));
    }
    // 항상 동일 응답(계정 열거 방어)
    return { requested: true, message: '복구 요청이 접수되었습니다. 관리자 승인 후 안내됩니다.' };
  }

  async listPending() {
    const rows = await this.prisma.accountRecovery.findMany({
      where: { status: { in: ['PENDING', 'APPROVED'] } },
      orderBy: { requestedAt: 'desc' },
      include: { user: { select: { familyName: true, givenName: true, role: true, department: true } } },
    });
    return rows.map((r) => ({
      id: r.id,
      staff: `${r.user.familyName}${r.user.givenName}`,
      role: r.user.role,
      department: r.user.department,
      reason: r.reason,
      status: r.status,
      requestedAt: r.requestedAt,
    }));
  }

  // 2) 관리자 승인 — 복구 토큰 발급(대면 전달). 2인 승인 옵션
  async approve(approverId: string, id: string, secondApproverId?: string, minutes = 15) {
    const rec = await this.prisma.accountRecovery.findUnique({ where: { id } });
    if (!rec) throw new NotFoundException('복구 요청을 찾을 수 없습니다.');
    if (rec.status !== 'PENDING') throw new BadRequestException('대기 상태가 아닙니다.');

    const token = randomBytes(16).toString('hex'); // 대면 전달용
    await this.prisma.accountRecovery.update({
      where: { id },
      data: {
        status: 'APPROVED',
        approvers: [approverId, ...(secondApproverId ? [secondApproverId] : [])],
        tokenHash: this.hash(token),
        approvedAt: new Date(),
        expiresAt: new Date(Date.now() + minutes * 60_000),
      },
    });
    await this.audit(approverId, 'UPDATE', id, { action: 'APPROVE', secondApproverId: secondApproverId ?? null });
    this.logger.warn(`복구 승인 rec=${id} by=${approverId}`);
    // 토큰은 본인 대면 전달(화면 표시) — 알림 채널엔 싣지 않음
    return { recoveryToken: token, expiresInMinutes: minutes };
  }

  // 3) 복구 완료 — 토큰 검증 → 기존 패스키 전량 폐기 → 임시 세션(재등록 강제)
  async complete(requestId: string, recoveryToken: string) {
    const rec = await this.prisma.accountRecovery.findUnique({ where: { id: requestId } });
    if (!rec || rec.status !== 'APPROVED' || !rec.tokenHash) {
      throw new BadRequestException('유효하지 않은 복구 요청입니다.');
    }
    if (rec.expiresAt && rec.expiresAt < new Date()) throw new BadRequestException('복구 토큰이 만료되었습니다.');
    if (this.hash(recoveryToken) !== rec.tokenHash) throw new BadRequestException('복구 토큰이 일치하지 않습니다.');

    const user = await this.prisma.user.findUnique({ where: { id: rec.userId } });
    if (!user || !user.isActive) throw new BadRequestException('비활성 계정입니다.');

    // 기존 패스키 전량 폐기 (분실 자격증명 무효화)
    await this.prisma.webAuthnCredential.updateMany({
      where: { userId: rec.userId, status: 'ACTIVE' },
      data: { status: 'REVOKED' },
    });
    await this.prisma.accountRecovery.update({
      where: { id: requestId },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });
    await this.audit(rec.userId, 'UPDATE', requestId, { action: 'COMPLETE' });
    await this.notifyOne(rec.userId, '계정 복구 완료', '기존 패스키가 무효화되었습니다. 새 패스키를 등록하세요.', requestId);

    // 임시 세션 발급 → 패스키 재등록 가능. 재등록 강제 플래그.
    const session = await this.auth.issueSession({ id: user.id, email: user.email, role: user.role }, { method: 'RECOVERY' });
    return { ...session, mustRegisterPasskey: true };
  }

  private async notifyOne(userId: string, title: string, message: string, refId: string) {
    const n = await this.notify
      .create(userId, { type: 'SECURITY', title, message, severity: 'WARNING', refType: 'AccountRecovery', refId })
      .catch(() => null);
    if (n) this.notify.pushNotification(userId, { id: n.id, type: 'SECURITY', title, message, severity: 'WARNING', refType: 'AccountRecovery', refId });
  }

  private async audit(userId: string, action: 'CREATE' | 'UPDATE', id: string, changes: Prisma.InputJsonObject) {
    await this.prisma.auditLog
      .create({ data: { userId, action, resourceType: 'ACCOUNT_RECOVERY', resourceId: id, changes } })
      .catch(() => undefined);
  }
}
