import { Injectable, BadRequestException, ForbiddenException, Logger } from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { ApprovalService } from './approval.service';
import { CredentialCronService } from './credential-cron.service';

// FR-27: 일괄 작업(부서/역할 단위 강제재등록·만료점검)
@Injectable()
export class BulkService {
  private readonly logger = new Logger(BulkService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notify: NotificationService,
    private readonly approvals: ApprovalService,
    private readonly cron: CredentialCronService,
  ) {}

  private whereOf(scope: string, scopeRef: string): Prisma.UserWhereInput {
    if (scope === 'ROLE') return { role: scopeRef as never, isActive: true };
    if (scope === 'DEPARTMENT') return { department: scopeRef, isActive: true };
    throw new BadRequestException('scope는 ROLE/DEPARTMENT');
  }

  /** 그룹 강제 재등록 — 4-eyes. 승인 없으면 요청(pending). */
  async bulkReEnroll(actorId: string, scope: string, scopeRef: string) {
    const target = `${scope}:${scopeRef}`;
    try {
      await this.approvals.consume('BULK_REENROLL', target, actorId);
    } catch (e) {
      if (e instanceof ForbiddenException) {
        const ap = await this.approvals.request('BULK_REENROLL', 'GROUP', target, actorId, `일괄 재등록 ${target}`);
        return { pending: true, approvalId: ap.id, message: '2인 승인(4-eyes)이 필요합니다.' };
      }
      throw e;
    }
    const users = await this.prisma.user.findMany({ where: this.whereOf(scope, scopeRef), select: { id: true } });
    const ids = users.map((u) => u.id);
    const res = await this.prisma.staffDevice.updateMany({
      where: { userId: { in: ids }, status: 'ACTIVE' },
      data: { status: 'REENROLL_DUE', reEnrollDueAt: new Date() },
    });
    // 🔴 통보 실패를 `.catch(() => undefined)` 로 지우면, 기기가 REENROLL_DUE 로 바뀐 사실을
    //    당사자만 모르는 상태가 흔적 없이 남는다(원장에도 `users: N` 만 남아 전원 통보된 것처럼
    //    읽혔다). 부분 성공은 살리되 **몇 명에게 못 알렸는지를 응답과 감사기록에 남긴다.**
    const notifyResults = await Promise.allSettled(
      ids.map((id) =>
        this.notify.create(id, { type: 'CREDENTIAL', title: '기기 재등록 필요', message: '보안 정책에 따라 기기를 재등록해 주세요.', severity: 'WARNING', refType: 'STAFF_DEVICE' }),
      ),
    );
    const notifyFailed = notifyResults.filter((r) => r.status === 'rejected').length;
    const notified = ids.length - notifyFailed;
    if (notifyFailed > 0) {
      this.logger.error(
        `BULK_REENROLL ${target}: 통보 실패 ${notifyFailed}/${ids.length} — 해당 직원은 재등록 요구를 통보받지 못했다`,
        (notifyResults.find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined)?.reason,
      );
    }
    await this.audit(actorId, { op: 'BULK_REENROLL', target, users: ids.length, devices: res.count, notified, notifyFailed });
    return { pending: false, users: ids.length, devices: res.count, notified, notifyFailed };
  }

  /** 미리보기 — 대상 직원/기기 수 */
  async preview(scope: string, scopeRef: string) {
    const users = await this.prisma.user.findMany({ where: this.whereOf(scope, scopeRef), select: { id: true } });
    const ids = users.map((u) => u.id);
    const devices = await this.prisma.staffDevice.count({ where: { userId: { in: ids }, status: 'ACTIVE' } });
    return { scope, scopeRef, users: ids.length, activeDevices: devices };
  }

  /** 만료/재등록 일괄 점검(cron 수동 실행) */
  async expiryCheck(actorId: string) {
    const r = await this.cron.runOnce();
    await this.audit(actorId, { op: 'BULK_EXPIRY_CHECK', ...r });
    return r;
  }

  private async audit(actorId: string, changes: Prisma.InputJsonObject) {
    await this.prisma.auditLog
      .create({ data: { userId: actorId, action: AuditAction.UPDATE, resourceType: 'CREDENTIAL_BULK', resourceId: actorId, changes } })
      .catch(() => undefined);
  }
}
