import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { GoLiveService } from './go-live.service';

/**
 * 운영 전환 지연 알림 — 목표일(targetDate) 경과했는데 아직 미준비인 blocking 항목을
 * 매일 ADMIN에게 통보(전환 지연 가시화). owner는 역할 문자열이라 개인 매핑 불가 → ADMIN 일괄.
 */
@Injectable()
export class GoLiveCronService {
  private readonly logger = new Logger(GoLiveCronService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly goLive: GoLiveService,
    @Optional() private readonly notify?: NotificationService,
  ) {}

  /**
   * 발송 — **도달한 것만 도달했다고 로그에 적는다**.
   * 🔴 예전 코드는 `this.notify?.notify(...)` 를 await 없이 던지고(floating promise) 곧바로
   *    "ADMIN N명 통보" 를 남겼다. 실패해도 로그는 성공이라, 운영에서 0건 도달을 아무도 몰랐다.
   *    (같은 계열 사고: refId 계약 위반으로 알림이 통째 유실됐는데 로그에는 "N명 통보"였던 건)
   */
  private async notifyAll(
    admins: { id: string }[],
    input: { type: string; title: string; message: string; severity: string; refType?: string; refId?: string },
  ): Promise<{ sent: number; failed: number }> {
    if (!this.notify) {
      this.logger.warn(`알림 서비스 미주입 — ${input.type} 미발송(대상 ${admins.length}명)`);
      return { sent: 0, failed: admins.length };
    }
    let sent = 0, failed = 0;
    for (const a of admins) {
      try { await this.notify.notify(a.id, input); sent++; } catch (e) {
        failed++;
        this.logger.error(`${input.type} 발송 실패 (user=${a.id}): ${(e as Error).message}`);
      }
    }
    return { sent, failed };
  }

  /** Notification.refId 는 `@db.Uuid` — UUID 가 아닌 값은 아예 넘기지 않는다(정본 규약) */
  private static readonly UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
  private ref(refId?: string | null): { refType: string; refId: string } | Record<string, never> {
    return refId && GoLiveCronService.UUID_RE.test(refId) ? { refType: 'GoLiveItem', refId } : {};
  }

  @Cron(CronExpression.EVERY_DAY_AT_9AM)
  async run() {
    try {
      // 1) 일일 준비도 스냅샷(추이) + 전환 준비 완료 전환 감지
      const snap = await this.goLive.snapshot();
      const admins = await this.prisma.user.findMany({ where: { role: 'ADMIN', isActive: true }, select: { id: true } });

      // 2) 전환 준비 완료(직전 <100 → 100) 통지
      //    🔴 refId:'ready' 를 넘기던 자리 — 가리킬 엔티티가 없으므로 참조를 붙이지 않는다(UUID 아닌 값 금지).
      if (snap.justReachedReady) {
        const r = await this.notifyAll(admins, {
          type: 'GOLIVE_READY', title: '✅ 실운영 전환 준비 완료',
          message: '전 필수 전환 항목이 준비되었습니다. 각 항목 상세에서 개별 실행하세요.', severity: 'INFO',
        });
        this.logger.log(`운영 전환 준비 100% 도달 → ADMIN ${r.sent}/${admins.length}명 도달${r.failed ? ` (실패 ${r.failed})` : ''}`);
      }

      // 3) 지연 blocking 항목 통보
      const overdue = (await this.goLive.overdueItems()).filter((i) => i.isBlocking);
      if (overdue.length) {
        const summary = overdue.slice(0, 5).map((i) => `${i.title}(${i.owner ?? '미지정'})`).join(', ');
        const message = `실운영 전환 지연 ${overdue.length}건 — ${summary}${overdue.length > 5 ? ' 외' : ''}`;
        const r = await this.notifyAll(admins, {
          type: 'GOLIVE_OVERDUE', title: '운영 전환 목표일 지연',
          message, severity: 'WARNING', ...this.ref(overdue[0].id),
        });
        this.logger.warn(`운영 전환 지연 ${overdue.length}건 → ADMIN ${r.sent}/${admins.length}명 도달${r.failed ? ` (실패 ${r.failed})` : ''}`);
      }
    } catch (e) {
      this.logger.warn(`go-live 크론 오류: ${(e as Error).message}`);
    }
  }
}
