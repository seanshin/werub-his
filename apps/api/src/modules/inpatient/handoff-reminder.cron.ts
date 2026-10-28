import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { ConfigRuntimeService } from '../config/config-runtime.service';

/**
 * 미확인 인수인계 재알림 — 기획 v2 P1-2 (nurse-workstation-notes-handoff.plan.md).
 *
 * acknowledge 를 안 하면 아무 일도 일어나지 않았다 — 최초 알림 한 번을 놓치면 인계가
 * 영영 묻힌다. 등록 후 N시간 미확인이면 인수자에게 재알림한다(매시 정각·같은 건은
 * N시간 간격으로 억제 — 매시간 쏘면 알림 무시가 학습된다).
 *
 * config `nursing.handoff.remindAfterHours`(0=OFF 기본). 간호(NURSING_SHIFT)만이 아니라
 * **모든 유형** — 의사 인계도 묻히면 안 되는 건 같다.
 */
@Injectable()
export class HandoffReminderCron {
  private readonly logger = new Logger(HandoffReminderCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
    @Optional() private readonly config?: ConfigRuntimeService, // 미주입=OFF(무중단)
  ) {}

  @Cron(CronExpression.EVERY_HOUR, { name: 'handoff-reminder' })
  async remindUnacknowledged(): Promise<{ notified: number; targets: number }> {
    const hours = Number((await this.config?.get('nursing.handoff.remindAfterHours').catch(() => 0)) ?? 0);
    if (!hours || hours <= 0) return { notified: 0, targets: 0 };

    const cutoff = new Date(Date.now() - hours * 3600_000);
    const stale = await this.prisma.clinicalHandoff.findMany({
      where: { acknowledgedAt: null, createdAt: { lt: cutoff } },
      select: {
        id: true, toDoctorId: true, createdAt: true,
        patient: { select: { familyName: true, givenName: true, mrn: true } },
      },
      orderBy: { createdAt: 'asc' },
      take: 100, // 폭주 방지 — 남은 건 다음 시각에
    });
    if (!stale.length) return { notified: 0, targets: 0 };

    const dedupeSince = new Date(Date.now() - hours * 3600_000);
    let notified = 0;
    for (const h of stale) {
      try {
        // 같은 인계 재알림은 N시간 간격 — 최초 알림(CLINICAL_HANDOFF)과 별개 유형이라 따로 센다
        const recent = await this.prisma.notification.findFirst({
          where: { type: 'CLINICAL_HANDOFF_REMINDER', refId: h.id, createdAt: { gte: dedupeSince } },
          select: { id: true },
        });
        if (recent) continue;

        const hoursAgo = Math.floor((Date.now() - h.createdAt.getTime()) / 3600_000);
        // refId=handoff.id(UUID) — 알림 refId 계약
        await this.notifications.notify(h.toDoctorId, {
          type: 'CLINICAL_HANDOFF_REMINDER',
          title: '⏰ 미확인 인수인계',
          message: `${h.patient.familyName}${h.patient.givenName}(${h.patient.mrn}) — 인계가 ${hoursAgo}시간째 미확인입니다. 확인 후 인수 처리하세요.`,
          severity: 'WARNING',
          refType: 'CLINICAL_HANDOFF',
          refId: h.id,
        });
        notified += 1;
      } catch (e) {
        this.logger.warn(`인계 재알림 실패 handoff=${h.id}: ${(e as Error).message}`);
      }
    }
    if (notified) this.logger.log(`미확인 인계 재알림 ${notified}건 (대상 ${stale.length})`);
    return { notified, targets: stale.length };
  }
}
