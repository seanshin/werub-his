import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../infrastructure/prisma/prisma.service';
import { NotificationService } from '../modules/notification/notification.service';
import { ConfigRuntimeService } from '../modules/config/config-runtime.service';
import { SentinelReadService } from './sentinel-read.service';

const AXIS_LABEL: Record<string, string> = {
  DATA: '데이터 정합성', FLOW: '흐름 완결성', CONTRACT: '계약 드리프트', PIPE: '파이프 생존',
};

/**
 * 상시 감시 알림 — **API 가 보낸다**(감시자는 판정만 한다).
 *
 * 🔴 왜 감시자가 직접 안 보내는가: 정본은 `NotificationService.notify()` 이고
 *    직접 `prisma.notification.create` 를 하면 **SSE 푸시가 빠진다**(정본 주석이 그렇게 경고한다).
 *    감시자는 별도 프로세스라 그 정본을 들 수 없다 — 그래서 판정은 감시자가, 발신은 API 가 한다.
 *
 * 🔴 **신규 발생과 재발만 보낸다.** 기존 항목을 매 스윕 다시 알리면 소음이 되고,
 *    소음은 진짜 경보를 죽인다(P4 완료 판정: 기존 항목 재알림 0).
 * 🔴 **관측 불가는 어떤 설정에서도 알리지 않는다** — "확인 못 함"으로 사람을 깨우지 않는다.
 *    화면에는 남는다.
 * 🔴 **임상 통로와 분리** — severity 는 INFO 고정, 대상은 ADMIN. 감시 소음이 임상 경보와
 *    같은 색으로 뜨면 진짜 경보가 묻힌다.
 */
@Injectable()
export class SentinelNotifyService {
  private readonly logger = new Logger(SentinelNotifyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notification: NotificationService,
    private readonly config: ConfigRuntimeService,
    private readonly read: SentinelReadService,
  ) {}

  private async admins(): Promise<string[]> {
    const rows = await this.prisma.user.findMany({
      where: { role: UserRole.ADMIN, isActive: true },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  /**
   * 미발신 신규 발견을 보낸다. 10분마다 — 스윕(60분)보다 촘촘히 돌아 지연을 줄인다.
   */
  @Cron('*/10 * * * *', { name: 'sentinel.notifyNew' })
  async sendNew(): Promise<{ attempted: number; sent: number; skipped: number; reason?: string }> {
    const enabled = (await this.config.get('sentinel.notify.enabled').catch(() => true)) !== false;
    // 🔴 조회 실패를 '꺼짐'으로 읽지 않는다 — 기본값(ON)으로 두고 사유를 남긴다
    const sevRaw: unknown = await this.config.get('sentinel.notify.severities').catch(() => ['RED']);
    const severities = Array.isArray(sevRaw) ? sevRaw.map(String) : ['RED'];

    const pending = await this.prisma.sentinelFinding.findMany({
      where: { notifyPending: true },
      orderBy: { value: 'desc' },
    });
    if (pending.length === 0) return { attempted: 0, sent: 0, skipped: 0 };

    if (!enabled) {
      // 🔴 꺼져 있어도 **표시는 지운다** — 켰을 때 밀린 것이 한꺼번에 쏟아지면 그게 소음이다.
      //    화면에는 그대로 남아 있으므로 사실을 잃지 않는다.
      await this.prisma.sentinelFinding.updateMany({
        where: { id: { in: pending.map((p) => p.id) } },
        data: { notifyPending: false },
      });
      return { attempted: pending.length, sent: 0, skipped: pending.length, reason: 'sentinel.notify.enabled=false' };
    }

    const targets = pending.filter((f) => !f.unobservable && severities.includes(f.severity));
    const userIds = await this.admins();
    let sent = 0;

    for (const f of targets) {
      if (userIds.length === 0) break;
      try {
        for (const uid of userIds) {
          await this.notification.notify(uid, {
            type: 'SENTINEL_FINDING',
            title: `[상시 감시] ${AXIS_LABEL[f.axis] ?? f.axis} 신규 — ${f.label}`,
            message: `${f.value.toLocaleString('ko-KR')}건${f.detail ? ` · ${f.detail}` : ''}`,
            // 🔴 임상 경보와 같은 색으로 뜨지 않게 INFO 고정
            severity: 'INFO',
            refType: 'sentinel',
            // 🔴 refId 는 UUID 만 — 코드를 넘기면 정본이 링크를 생략한다(이 저장소의 기록된 사고)
            refId: f.id,
          });
        }
        sent += 1;
      } catch (e) {
        // 🔴 실패를 삼키지 않는다. 다만 notifyPending 을 그대로 두어 다음 주기에 다시 시도한다
        this.logger.warn(`감시 알림 발신 실패 ${f.checkKey}: ${e instanceof Error ? e.message : e}`);
        continue;
      }
      await this.prisma.sentinelFinding.update({
        where: { id: f.id },
        data: { notifyPending: false, notifiedAt: new Date() },
      });
    }

    // 범위 밖(관측 불가·심각도 제외)은 다시 검토하지 않도록 표시만 내린다
    const outOfScope = pending.filter((f) => !targets.includes(f));
    if (outOfScope.length) {
      await this.prisma.sentinelFinding.updateMany({
        where: { id: { in: outOfScope.map((f) => f.id) } },
        data: { notifyPending: false },
      });
    }

    if (sent) this.logger.log(`감시 신규 알림 ${sent}건 발신(대상 관리자 ${userIds.length}명)`);
    return { attempted: pending.length, sent, skipped: pending.length - sent };
  }

  /**
   * 주간 요약 — 월요일 09:30 KST. 신규 여부와 무관하게 **지금 이렇다**를 한 번 정리한다.
   *
   * 🔴 미판정·관측 불가를 0 으로 합치지 않는다. 합치면 이 요약이 화면보다 낙관적이 된다.
   */
  @Cron('30 9 * * 1', { name: 'sentinel.weeklyDigest', timeZone: 'Asia/Seoul' })
  async weeklyDigest(): Promise<{ sent: number; reason?: string }> {
    const on = (await this.config.get('sentinel.notify.weeklyDigest').catch(() => true)) !== false;
    if (!on) return { sent: 0, reason: 'sentinel.notify.weeklyDigest=false' };

    const { axes } = await this.read.overview();
    const lines = axes.map((a) => {
      if (a.open === null) return `· ${a.label}: 미판정${a.unavailableReason ? ` (${a.unavailableReason})` : ''}`;
      const unobs = (a.unobservable ?? 0) > 0 ? ` · 관측 불가 ${a.unobservable}` : '';
      const sev = a.bySeverity ? ` (적색 ${a.bySeverity.RED})` : '';
      return `· ${a.label}: 미해결 ${a.open}${sev}${unobs}`;
    });

    const userIds = await this.admins();
    if (userIds.length === 0) return { sent: 0, reason: '대상 관리자가 없습니다' };

    for (const uid of userIds) {
      await this.notification.notify(uid, {
        type: 'SENTINEL_DIGEST',
        title: '[상시 감시] 주간 요약',
        message: lines.join('\n'),
        severity: 'INFO',
        refType: 'sentinel',
      });
    }
    this.logger.log(`감시 주간 요약 발신(관리자 ${userIds.length}명)`);
    return { sent: userIds.length };
  }
}
