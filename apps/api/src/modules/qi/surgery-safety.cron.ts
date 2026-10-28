import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { ConfigRuntimeService } from '../config/config-runtime.service';
import { SurgerySafetyService } from './surgery-safety.service';
import { localDateKey } from '../../common/day-range';

/**
 * 수술 안전(IPSG.4) 미이행 **일일 요약 상신**.
 *
 * 🔴 탐지와 상신은 분리 불가(이 저장소 규약) — 탐지만 하고 아무에게도 말하지 않는 크론이
 *    이 저장소에 이미 2건 있었다. 그래서 워크리스트만 만들고 끝내지 않는다.
 *
 * 🔴 그러나 **건당 알림은 만들지 않는다.** 운영 알림 읽음률 8.6%(348건 중 30건)에서
 *    건당 알림은 목록을 옮겨 적는 소음이고, 진짜 위급 알림까지 같이 죽인다.
 *    → 하루 1회 · 수신자당 **1건** · 본문에 **분모 포함** · 목록으로 데려가는 링크.
 *    미이행이 0건이면 아무것도 보내지 않는다(안심시키는 알림은 알림 피로만 만든다).
 *
 * config `surgery.safetyDigest.enabled`(기본 true) · `surgery.safetyDigest.lookbackDays`(기본 7).
 */
@Injectable()
export class SurgerySafetyCron {
  private readonly logger = new Logger(SurgerySafetyCron.name);
  static readonly NOTIFICATION_TYPE = 'SURGERY_SAFETY_DIGEST';

  constructor(
    private readonly prisma: PrismaService,
    private readonly safety: SurgerySafetyService,
    private readonly notifications: NotificationService,
    @Optional() private readonly config?: ConfigRuntimeService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_8AM, { name: 'surgery-safety-digest' })
  async digest(): Promise<{ sent: number; flagged: number; scanned: number; skipped?: string }> {
    const enabled = String((await this.config?.get('surgery.safetyDigest.enabled').catch(() => true)) ?? true) !== 'false';
    if (!enabled) return { sent: 0, flagged: 0, scanned: 0, skipped: 'disabled' };

    const lookback = Number((await this.config?.get('surgery.safetyDigest.lookbackDays').catch(() => 7)) ?? 7) || 7;
    const now = new Date();
    const from = localDateKey(new Date(now.getTime() - lookback * 86400_000));
    const to = localDateKey(now);

    const wl = await this.safety.getWorklist({ from, to, kind: 'ALL' });
    if (wl.flagged === 0) {
      // 🔴 "이상 없음" 알림은 보내지 않는다 — 매일 오는 초록은 진짜 경보를 읽지 않게 만든다.
      this.logger.log(`수술 안전 미이행 0건 (대상 ${wl.scanned}건, ${from}~${to}) — 상신 없음`);
      return { sent: 0, flagged: 0, scanned: wl.scanned };
    }

    // 수신자: 관리자(질관리·수술실 관제). 🔴 역할 확대는 운영 판단이라 코드에서 넓히지 않는다.
    const recipients = await this.prisma.user.findMany({ where: { role: 'ADMIN', isActive: true }, select: { id: true } });
    if (!recipients.length) {
      this.logger.warn(`수술 안전 미이행 ${wl.flagged}건인데 수신 가능한 관리자 계정이 없습니다 — 상신 실패(탐지만 남음)`);
      return { sent: 0, flagged: wl.flagged, scanned: wl.scanned, skipped: 'no-recipient' };
    }

    const high = wl.items.filter((i) => i.issues.some((x) => x.severity === 'HIGH')).length;
    const site = wl.items.filter((i) => i.issues.some((x) => x.code === 'LATERALITY_MISSING')).length;
    const absent = wl.items.filter((i) => i.issues.some((x) => x.code === 'CHECKLIST_ABSENT')).length;
    // 🔴 분모를 본문에 넣는다 — "미이행 8건"만 보면 전체가 8건인지 46건인지 알 수 없다.
    const message =
      `${from}~${to} 대상 수술 ${wl.scanned}건 중 미이행 ${wl.flagged}건` +
      `(중대 ${high}건 · 좌우 미지정 ${site}건 · 체크리스트 기록 없음 ${absent}건). ` +
      `상세는 질 관리 → 수술 안전(IPSG.4) 워크리스트에서 확인하세요.`;

    // 같은 날 이미 보냈으면 다시 보내지 않는다(재기동·수동 실행 중복 방지)
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    let sent = 0;
    for (const r of recipients) {
      try {
        const dup = await this.prisma.notification.findFirst({
          where: { userId: r.id, type: SurgerySafetyCron.NOTIFICATION_TYPE, createdAt: { gte: todayStart } },
          select: { id: true },
        });
        if (dup) continue;
        // refId 없음 — 이 알림은 특정 수술이 아니라 **목록**을 가리킨다(UUID 아닌 값을 넣지 않는다).
        await this.notifications.notify(r.id, {
          type: SurgerySafetyCron.NOTIFICATION_TYPE,
          title: `🔪 수술 안전 미이행 ${wl.flagged}건 / 대상 ${wl.scanned}건`,
          message,
          severity: high > 0 ? 'WARNING' : 'INFO',
        });
        sent += 1;
      } catch (e) {
        this.logger.warn(`수술 안전 요약 상신 실패 user=${r.id}: ${(e as Error).message}`);
      }
    }
    this.logger.log(`수술 안전 미이행 ${wl.flagged}/${wl.scanned}건 — 관리자 ${sent}명 상신`);
    return { sent, flagged: wl.flagged, scanned: wl.scanned };
  }
}
