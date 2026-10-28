import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ConfigRuntimeService } from '../config/config-runtime.service';

/**
 * HR 결재 미결 리마인더·에스컬레이션 (P1-5) — 매일 09:10
 * - remindAfterDays(2) 초과 PENDING → 현재 결재자 재알림 (relay.remindedAt 멱등)
 * - escalateAfterDays(4) 초과 → 결재자의 상급자에게 에스컬레이션
 * config: ess.approval.reminder.enabled (기본 OFF)
 */
@Injectable()
export class EssApprovalReminderCron {
  private readonly logger = new Logger(EssApprovalReminderCron.name);

  constructor(private readonly prisma: PrismaService, @Optional() private readonly configRuntime?: ConfigRuntimeService) {}

  @Cron('10 9 * * *')
  async run() {
    const enabled = String((await this.configRuntime?.get('ess.approval.reminder.enabled').catch(() => null)) ?? 'false') === 'true';
    if (!enabled) return;
    const remindDays = Number((await this.configRuntime?.get('ess.approval.remindAfterDays').catch(() => null)) ?? 2);
    const escalateDays = Number((await this.configRuntime?.get('ess.approval.escalateAfterDays').catch(() => null)) ?? 4);
    const now = Date.now();

    const pendings = await this.prisma.eApprovalRelay.findMany({
      where: { docType: { in: ['HR_LEAVE', 'HR_ATTENDANCE_CORRECTION', 'HR_OVERTIME'] }, status: 'PENDING' },
      take: 200,
    });
    let reminded = 0;
    let escalated = 0;
    for (const r of pendings) {
      const ageDays = (now - r.createdAt.getTime()) / 86400_000;
      if (ageDays < remindDays) continue;
      // 리마인더 멱등 — 마지막 알림 후 remindDays 경과 시에만 재발송
      if (r.remindedAt && (now - r.remindedAt.getTime()) / 86400_000 < remindDays) continue;
      const line = (r.approvalLine as { staffId?: string; userId?: string; result?: string }[] | null) ?? [];
      const current = line.find((a) => !a.result);
      if (!current?.userId) continue;
      await this.notify(current.userId, 'HR_APPROVAL_REMIND', '미결 결재 알림', `${r.title} — ${Math.floor(ageDays)}일째 대기 중입니다`, r.refId);
      reminded++;
      if (ageDays >= escalateDays && current.staffId) {
        const mgr = await this.prisma.staff.findUnique({ where: { id: current.staffId }, select: { manager: { select: { userId: true } } } });
        if (mgr?.manager?.userId) {
          await this.notify(mgr.manager.userId, 'HR_APPROVAL_ESCALATION', '결재 지연 에스컬레이션', `${r.title} — ${Math.floor(ageDays)}일째 미결(담당 결재자 지연)`, r.refId);
          escalated++;
        }
      }
      // 🔴 (2026-09-16 E4) 이 표시가 **리마인더 멱등의 유일한 근거**다(위 `r.remindedAt` 비교).
      //    종전 `.catch(() => undefined)` 는 알림은 이미 보낸 뒤 표시만 실패한 상태를 삼켰다 —
      //    그러면 같은 결재 건으로 **매일 같은 알림이 다시 나가고** 아무 기록도 남지 않는다.
      await this.prisma.eApprovalRelay.update({ where: { id: r.id }, data: { remindedAt: new Date() } })
        .catch((e) => this.logger.error(`결재 리마인더 발송 표시 실패 relay=${r.id}: ${(e as Error).message} — 같은 알림이 다시 나갈 수 있습니다`));
    }
    if (reminded || escalated) this.logger.log(`HR 결재 리마인더 ${reminded}건·에스컬레이션 ${escalated}건`);
  }

  private async notify(userId: string, type: string, title: string, message: string, refId: string) {
    await this.prisma.notification.create({ data: { userId, type, title, message, severity: 'WARNING', refType: 'LEAVE', refId } }).catch((e) => this.logger.warn(`결재 리마인드 알림 실패: ${(e as Error).message}`));
  }
}
