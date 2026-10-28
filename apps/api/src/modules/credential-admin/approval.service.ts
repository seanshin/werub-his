import { Injectable, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma, AuditAction } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

export type ApprovalAction =
  | 'CERT_REVOKE'
  | 'ACCOUNT_DEPROVISION'
  | 'RECOVERY_APPROVE'
  | 'BULK_REENROLL'
  | 'RETENTION_PURGE' // security-governance G6 — 대량 PHI 파기 4-eyes
  | 'LEGAL_HOLD_RELEASE'; // 상용 릴리즈 T10-7 — 법적 보존명령 해제 4-eyes(요청자≠승인자 · 설정자≠승인자는 LegalHoldService 가 추가 강제)
const APPROVAL_TTL_MS = 24 * 60 * 60 * 1000; // 24h

// FR-41: 4-eyes 2인 승인 엔진. 고위험 액션은 request→approve(요청자≠승인자)→consume(실행) 흐름.
@Injectable()
export class ApprovalService {
  constructor(private readonly prisma: PrismaService) {}

  /** 고위험 액션 요청 — PENDING 생성(실행 안 함). 동일 대상 PENDING 있으면 재사용. */
  async request(
    action: ApprovalAction,
    targetType: string,
    targetId: string,
    requestedBy: string,
    reason?: string,
    payload?: Prisma.InputJsonValue,
  ) {
    const existing = await this.prisma.adminApproval.findFirst({
      where: { action, targetId, status: 'PENDING', expiresAt: { gt: new Date() } },
    });
    if (existing) return existing;
    const row = await this.prisma.adminApproval.create({
      data: {
        action,
        targetType,
        targetId,
        requestedBy,
        reason,
        payload: payload ?? undefined,
        status: 'PENDING',
        expiresAt: new Date(Date.now() + APPROVAL_TTL_MS),
      },
    });
    await this.audit(requestedBy, AuditAction.CREATE, row.id, { op: 'REQUEST', action, targetId });
    return row;
  }

  list(status?: string) {
    return this.prisma.adminApproval.findMany({
      where: status ? { status } : undefined,
      orderBy: { requestedAt: 'desc' },
      take: 200,
    });
  }

  /** 승인 — 요청자≠승인자 강제(FR-41). APPROVED로 전이(실행은 consume에서). */
  async approve(id: string, approverId: string) {
    const a = await this.getActionable(id);
    if (a.requestedBy === approverId) {
      throw new ForbiddenException('요청자와 승인자는 동일할 수 없습니다(4-eyes).');
    }
    const row = await this.prisma.adminApproval.update({
      where: { id },
      data: { status: 'APPROVED', approvedBy: approverId, decidedAt: new Date() },
    });
    await this.audit(approverId, AuditAction.UPDATE, id, { op: 'APPROVE', action: a.action, targetId: a.targetId });
    return row;
  }

  async reject(id: string, approverId: string, reason?: string) {
    const a = await this.getActionable(id);
    const row = await this.prisma.adminApproval.update({
      where: { id },
      data: { status: 'REJECTED', approvedBy: approverId, decidedAt: new Date(), reason: reason ?? a.reason },
    });
    await this.audit(approverId, AuditAction.UPDATE, id, { op: 'REJECT', action: a.action, targetId: a.targetId });
    return row;
  }

  /**
   * 실행 단계 — 고위험 액션 서비스가 호출. APPROVED & 미소비 승인을 EXECUTED로 전이.
   * 승인 없으면 차단(승인 선행 강제). 반환된 approval로 실제 처리 진행.
   */
  async consume(action: ApprovalAction, targetId: string, executorId: string) {
    const a = await this.prisma.adminApproval.findFirst({
      where: { action, targetId, status: 'APPROVED', expiresAt: { gt: new Date() } },
      orderBy: { decidedAt: 'desc' },
    });
    if (!a) {
      throw new ForbiddenException('2인 승인(4-eyes)이 필요합니다. 먼저 승인 요청을 받으세요.');
    }
    // 원자적 소비 — 동시 2건이 같은 APPROVED를 읽어 중복 실행하는 race 방지(updateMany + count===1)
    const claimed = await this.prisma.adminApproval.updateMany({
      where: { id: a.id, status: 'APPROVED' },
      data: { status: 'EXECUTED' },
    });
    if (claimed.count !== 1) {
      throw new ForbiddenException('승인이 이미 소비되었거나 만료되었습니다.');
    }
    const row = await this.prisma.adminApproval.findUnique({ where: { id: a.id } });
    await this.audit(executorId, AuditAction.UPDATE, a.id, { op: 'EXECUTE', action, targetId });
    return row;
  }

  private async getActionable(id: string) {
    const a = await this.prisma.adminApproval.findUnique({ where: { id } });
    if (!a) throw new NotFoundException('승인 요청 없음');
    if (a.status !== 'PENDING') throw new BadRequestException(`처리 불가 상태: ${a.status}`);
    if (a.expiresAt <= new Date()) {
      await this.prisma.adminApproval.update({ where: { id }, data: { status: 'EXPIRED' } });
      throw new BadRequestException('승인 요청이 만료되었습니다.');
    }
    return a;
  }

  private async audit(actorId: string, action: AuditAction, approvalId: string, changes: Prisma.InputJsonObject) {
    await this.prisma.auditLog
      .create({
        data: { userId: actorId, action, resourceType: 'ADMIN_APPROVAL', resourceId: approvalId, changes },
      })
      .catch(() => undefined);
  }
}
