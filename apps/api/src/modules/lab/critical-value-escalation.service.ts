import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ConfigRuntimeService } from '../config/config-runtime.service';
import { CRITICAL_ALERT_ESCALATE_CONFIG_KEY, parseEscalateAfterMinutes } from './critical-value-alert-states';

export type EscalationPolicy = {
  /** 허용시간(분) — 미설정·해석 불가면 null */
  afterMinutes: number | null;
  /** 설정 행이 있는데 해석하지 못했는가(예: "30분", -5) — 미설정과 다른 사실이다 */
  invalid: boolean;
};

export type EscalationRun =
  | { status: 'NOT_CONFIGURED'; escalated: 0; afterMinutes: null; invalid: boolean }
  | {
      status: 'DONE';
      escalated: number;
      afterMinutes: number;
      /** 원내 알림을 보냈는가 — 수신자 라우팅이 승인되지 않아 보내지 않는다(아래 사유) */
      notificationSent: false;
      notificationReason: 'ALERT_ROUTING_UNAPPROVED';
    };

/**
 * 위급값 경보 상향 보고(ESCALATED) — agent-emr-alignment 2-1 "ESCALATED 크론 + 허용시간 파라미터".
 *
 * 🔴 허용시간이 설정되지 않으면 **아무것도 하지 않는다.** 30분 같은 값을 코드가 정하면 위원회가 정할
 *    정책을 코드가 정한 것이 된다(판정 규칙: 기준값이 원내 정책이면 config 로 두고 미설정임을 밝힌다).
 * 🔴 PENDING 만 전이한다 — 이미 ESCALATED·ACKNOWLEDGED 인 행은 where 에서 빠지므로 재실행해도 한 번만 전이된다(멱등).
 * 🔴 기존 행을 소급하지 않는다 — 설정 이후 크론이 도는 시점에 허용시간을 넘긴 미확인 경보만 표시한다.
 *    (설정 직후 첫 실행에서 오래된 미확인 경보가 한꺼번에 ESCALATED 가 되는 것은 소급이 아니라 현재 사실이다 —
 *     그 경보는 지금도 확인되지 않았다. 다만 escalatedAt 은 전이한 **실제 시각**이지 기한 도래 시각이 아니다.)
 * 🔴 원내 알림(상향 수신자)을 보내지 않는다. 경보 라우팅(`alert-registry.plan.md` §3.5 역할 라우팅)은 승인 게이트이고
 *    수신자를 임의로 정하면 "누구에게 갔다"가 지어낸 사실이 된다. 대신 미확인 목록·보드에 ESCALATED 로 **보이게** 한다.
 */
@Injectable()
export class CriticalValueEscalationService {
  private readonly logger = new Logger(CriticalValueEscalationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigRuntimeService,
  ) {}

  async policy(): Promise<EscalationPolicy> {
    const raw = await this.config.get(CRITICAL_ALERT_ESCALATE_CONFIG_KEY);
    const afterMinutes = parseEscalateAfterMinutes(raw);
    return { afterMinutes, invalid: afterMinutes == null && raw != null && raw !== '' };
  }

  @Cron(CronExpression.EVERY_5_MINUTES, { name: 'critical-value-escalation' })
  async cron(): Promise<void> {
    const run = await this.escalateOverdue();
    if (run.status === 'DONE' && run.escalated > 0) {
      this.logger.warn(`critical value alerts escalated: ${run.escalated} (after ${run.afterMinutes} min) - in-app routing unapproved, visible in worklist only`);
    }
  }

  async escalateOverdue(now: Date = new Date()): Promise<EscalationRun> {
    const { afterMinutes, invalid } = await this.policy();
    if (afterMinutes == null) {
      if (invalid) this.logger.warn(`${CRITICAL_ALERT_ESCALATE_CONFIG_KEY} is set but not a positive integer - escalation skipped`);
      return { status: 'NOT_CONFIGURED', escalated: 0, afterMinutes: null, invalid };
    }
    const cutoff = new Date(now.getTime() - afterMinutes * 60_000);
    const res = await this.prisma.criticalValueAlert.updateMany({
      where: { status: 'PENDING', notifiedAt: { lt: cutoff } },
      data: { status: 'ESCALATED', escalatedAt: now },
    });
    return { status: 'DONE', escalated: res.count, afterMinutes, notificationSent: false, notificationReason: 'ALERT_ROUTING_UNAPPROVED' };
  }
}
