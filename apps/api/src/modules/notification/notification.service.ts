import { BadRequestException, ConflictException, Injectable, Logger, MessageEvent, NotFoundException, Optional } from '@nestjs/common';
import { localDateKey } from '../../common/day-range';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Observable, Subject } from 'rxjs';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ConfigRuntimeService } from '../config/config-runtime.service';
import { mergeTargetMap } from '../../common/qi-targets';
import { normalizeNotificationSeverity } from '@hospital-run/shared';
import { ALERT_REGISTRY, SEED_ONLY_CODES, lookupAlert, tierToSeverity, type AlertDef } from './alert-registry';
import { alertApprovalStatus, alertSnapshot } from './alert-approval';

/** 미등재 코드 관찰(프로세스 메모리 — 재기동 시 초기화 · 관제가 그 한계를 함께 표시한다) */
export interface UnregisteredSeen { code: string; count: number; firstSeenAt: string; lastSeenAt: string; sampleTitle: string }

/** Notification.refId 는 @db.Uuid — 그 형식이 아니면 링크를 붙일 수 없다 */
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);
  private readonly subjects = new Map<string, Subject<unknown>>();
  /** 등록부에 없는 코드로 발화된 것 — 막지 않고 센다(기획서 alert-registry §3.1) */
  private readonly unregistered = new Map<string, UnregisteredSeen>();
  private readonly bootAt = new Date().toISOString();

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly config?: ConfigRuntimeService,
  ) {}

  async create(
    userId: string,
    input: {
      type: string;
      title: string;
      message: string;
      severity?: string;
      refType?: string;
      refId?: string;
    },
  ) {
    // 🔴 경보 등록부 조회 — 등재돼 있으면 tier 가 severity 기본값(호출자가 준 값이 우선). 미등재는 **막지 않고** 센다.
    const def = lookupAlert(input.type);
    if (!def) this.noteUnregistered(input.type, input.title);
    const severity = input.severity ?? (def ? tierToSeverity(def.tier) : undefined);
    return this.prisma.notification.create({
      data: {
        userId,
        type: input.type,
        title: input.title,
        message: input.message,
        severity: normalizeNotificationSeverity(severity), // 정본 3단계로 수렴(ERROR/WARN/URGENT 등 흡수)
        refType: input.refType,
        refId: this.safeRefId(input.refId, input.type),
      },
    });
  }

  private noteUnregistered(code: string, title: string) {
    const now = new Date().toISOString();
    const cur = this.unregistered.get(code);
    if (cur) { cur.count += 1; cur.lastSeenAt = now; return; }
    this.unregistered.set(code, { code, count: 1, firstSeenAt: now, lastSeenAt: now, sampleTitle: title.slice(0, 80) });
    this.logger.warn(`미등재 경보 코드 발화: type=${code} — alert-registry.ts 에 등재하라(발화는 그대로 나갔다)`);
  }

  /**
   * 경보 등록부 관제 보고 — 코드별 30일 발화 N·읽음 n·읽음 중앙값(분) + 미등재 관찰 + 보존 창.
   * 🔴 분모와 함께 낸다(발화 0이면 읽음률은 산출 불가 — 화면이 `<Ratio>` 로 그린다).
   */
  async registryReport(days = 30) {
    const since = new Date(Date.now() - days * 86400_000);
    const rows = await this.prisma.$queryRaw<Array<{ type: string; fired: bigint; read: bigint; median_min: number | null; unread_over_24h: bigint }>>`
      SELECT type,
             COUNT(*)::bigint AS fired,
             COUNT(*) FILTER (WHERE is_read)::bigint AS read,
             PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (read_at - created_at)) / 60.0) FILTER (WHERE read_at IS NOT NULL) AS median_min,
             COUNT(*) FILTER (WHERE NOT is_read AND created_at < NOW() - INTERVAL '24 hours')::bigint AS unread_over_24h
      FROM notifications WHERE created_at >= ${since}
      GROUP BY type`;
    const byType = new Map(rows.map((r) => [r.type, r]));
    // 경보 승인 원장 — 코드별 최신 승인(철회 포함) · 승인 당시 값과 지금 코드를 대조한다
    const approvals = await this.prisma.alertApproval.findMany({ orderBy: { approvedAt: 'desc' }, select: { code: true, snapshot: true, basis: true, approvedBy: true, approvedAt: true, revokedAt: true } });
    const latestApproval = new Map<string, (typeof approvals)[number]>();
    for (const a of approvals) if (!latestApproval.has(a.code)) latestApproval.set(a.code, a);
    const retention = await this.config?.get('notification.retentionDays').catch(() => null);
    const item = (d: AlertDef) => {
      const r = byType.get(d.code);
      return {
        ...d,
        registered: true as const,
        fired: r ? Number(r.fired) : 0,
        read: r ? Number(r.read) : 0,
        medianReadMin: r?.median_min != null ? Math.round(Number(r.median_min)) : null,
        unreadOver24h: r ? Number(r.unread_over_24h) : 0,
        reviewOverdue: d.reviewDue < localDateKey(new Date()), // 🔴 KST 날짜 문자열(UTC slice 는 오전에 전날)
        // 🔴 승인은 원장에서 — 코드 상수 approvedBy 가 아니라 사람이 남긴 기록(승인 후 값이 바뀌면 CHANGED)
        approval: (() => {
          const a = latestApproval.get(d.code);
          return { status: alertApprovalStatus(d, a), approvedAt: a && !a.revokedAt ? a.approvedAt.toISOString() : null, basis: a && !a.revokedAt ? a.basis : null, approvedBy: a && !a.revokedAt ? a.approvedBy : null };
        })(),
      };
    };
    // DB 에는 있는데 등록부에 없는 코드(재기동 전 발화분까지 포함 — 메모리 관찰보다 넓다)
    const registeredCodes = new Set(ALERT_REGISTRY.map((d) => d.code));
    const unregisteredInDb = rows.filter((r) => !registeredCodes.has(r.type)).map((r) => ({ code: r.type, fired: Number(r.fired), read: Number(r.read), seedOnly: SEED_ONLY_CODES.includes(r.type) }));
    return {
      windowDays: days,
      generatedAt: new Date().toISOString(),
      items: ALERT_REGISTRY.map(item),
      unregistered: { sinceBoot: this.bootAt, seen: [...this.unregistered.values()], inDb: unregisteredInDb },
      /** 🔴 baseline 창의 한계 — 미읽음은 이 일수 뒤 삭제된다(원장이 사라진다) */
      retentionDays: { read: 90, unread: 180, override: retention ?? null },
      summary: {
        registered: ALERT_REGISTRY.length,
        // 승인 원장 기준 — 승인 후 값이 바뀐 것(CHANGED)도 미승인으로 센다
        unapproved: ALERT_REGISTRY.filter((d) => alertApprovalStatus(d, latestApproval.get(d.code)) !== 'APPROVED').length,
        changedSinceApproval: ALERT_REGISTRY.filter((d) => alertApprovalStatus(d, latestApproval.get(d.code)) === 'CHANGED').length,
        withoutDedup: ALERT_REGISTRY.filter((d) => d.dedupHours == null).length,
        attendingRouted: ALERT_REGISTRY.filter((d) => d.targetKind === 'ATTENDING').length,
        unregisteredCodesInDb: unregisteredInDb.length,
      },
    };
  }

  /**
   * 경보 승인 기록(2026-10-09) — 지금 등록부의 tier·대상·억제 창을 그대로 snapshot 으로 남긴다.
   * 🔴 승인자의 직책을 검증하지 못한다 — 근거(위원회 의결 번호·문서)를 반드시 받는다.
   */
  async approveAlert(code: string, basis: string, actorId: string) {
    const def = ALERT_REGISTRY.find((d) => d.code === code);
    if (!def) throw new NotFoundException({ code: 'ALERT_NOT_REGISTERED', message: '경보 등록부에 없는 코드입니다' });
    if (!basis || basis.trim().length < 5) throw new BadRequestException({ code: 'ALERT_APPROVAL_BASIS', message: '승인 근거(위원회 의결 번호·문서)를 5자 이상 적어주세요' });
    const latest = await this.prisma.alertApproval.findFirst({ where: { code }, orderBy: { approvedAt: 'desc' }, select: { snapshot: true, revokedAt: true } });
    if (alertApprovalStatus(def, latest) === 'APPROVED') throw new ConflictException({ code: 'ALERT_ALREADY_APPROVED', message: '이미 지금 값으로 승인돼 있습니다' });
    return this.prisma.alertApproval.create({ data: { code, snapshot: alertSnapshot(def) as never, basis: basis.trim(), approvedBy: actorId } });
  }

  /** 승인 철회 — 최신 승인 하나를 사유와 함께(지우지 않는다 · 동시 두 번이면 한쪽 409) */
  async revokeAlertApproval(code: string, reason: string, actorId: string) {
    if (!reason || reason.trim().length < 5) throw new BadRequestException({ code: 'ALERT_REVOKE_REASON', message: '철회 사유를 5자 이상 적어주세요' });
    const latest = await this.prisma.alertApproval.findFirst({ where: { code }, orderBy: { approvedAt: 'desc' }, select: { id: true, revokedAt: true } });
    if (!latest || latest.revokedAt) throw new ConflictException({ code: 'ALERT_NOT_APPROVED', message: '철회할 승인이 없습니다' });
    const r = await this.prisma.alertApproval.updateMany({ where: { id: latest.id, revokedAt: null }, data: { revokedAt: new Date(), revokedBy: actorId, revokeReason: reason.trim() } });
    if (!r.count) throw new ConflictException({ code: 'ALERT_NOT_APPROVED', message: '다른 사람이 먼저 철회했습니다' });
    return { code, revoked: true };
  }

  /**
   * refId 는 `@db.Uuid` 다. 코드·일련번호처럼 UUID 가 아닌 값이 들어오면 Prisma 가 P2023 으로
   * 죽어 **알림 자체가 생성되지 않는다**.
   *
   * 🔴 실제로 그렇게 유실됐다: 응급 코드 방송(refId=`CODE BLUE`)과 검진권 체인 위반
   *    상신(refId=일련번호 `WGC-…`)이 운영에서 **각각 0건**이었다. 둘 다 호출부가 예외를
   *    삼켜서(`.catch(() => …)`) 로그에는 "N명 통보"로 남았다.
   *
   * 참조 하나 때문에 통보가 통째로 사라지는 것이 가장 나쁘다 — 링크를 버리고 알림은 살린다.
   * 버린 사실은 경고로 남겨 호출부를 고칠 수 있게 한다(조용한 폐기 금지).
   */
  private safeRefId(refId: string | undefined, type: string): string | undefined {
    if (!refId) return undefined;
    if (UUID_RE.test(refId)) return refId;
    this.logger.warn(`알림 refId 가 UUID 가 아니라 링크를 생략합니다 (type=${type}, refId=${refId}) — 호출부가 엔티티 id 를 넘겨야 합니다.`);
    return undefined;
  }

  /** 정규 발신 경로 — 생성+SSE 실시간 푸시를 한 번에(직접 prisma.create 시 SSE 누락 방지) */
  async notify(userId: string, input: { type: string; title: string; message: string; severity?: string; refType?: string; refId?: string }) {
    const n = await this.create(userId, input);
    this.pushNotification(userId, {
      id: n.id, type: n.type, title: n.title, message: n.message, severity: n.severity,
      refType: n.refType ?? undefined, refId: n.refId ?? undefined,
    });
    return n;
  }

  async findByUser(userId: string, unreadOnly = false) {
    return this.prisma.notification.findMany({
      where: {
        userId,
        ...(unreadOnly ? { isRead: false } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  /** 읽음 처리 — 소유자 검증(스카우트: 타인 알림 읽음+내용 노출 IDOR 봉합) */
  async markRead(id: string, userId: string) {
    const r = await this.prisma.notification.updateMany({
      where: { id, userId },
      data: { isRead: true, readAt: new Date() },
    });
    return { ok: r.count > 0 };
  }

  async markAllRead(userId: string) {
    await this.prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true, readAt: new Date() },
    });
    return { ok: true };
  }

  async getUnreadCount(userId: string) {
    return this.prisma.notification.count({
      where: { userId, isRead: false },
    });
  }

  /** 보존 정리 — 기본 읽음 90일·미읽음 180일 경과 삭제(무한 적재 방지). 환자 알림 동일 기준.
   *  보존일 개정 표면 = config notification.retentionDays(부분 병합·§7 P1) */
  @Cron(CronExpression.EVERY_DAY_AT_5AM)
  async purgeOld() {
    const days = mergeTargetMap({ read: 90, unread: 180 }, await this.config?.get('notification.retentionDays').catch(() => null));
    const readCut = new Date(Date.now() - days.read * 86400_000);
    const unreadCut = new Date(Date.now() - days.unread * 86400_000);
    const [r1, r2, p1, p2] = await Promise.all([
      this.prisma.notification.deleteMany({ where: { isRead: true, createdAt: { lt: readCut } } }),
      this.prisma.notification.deleteMany({ where: { isRead: false, createdAt: { lt: unreadCut } } }),
      this.prisma.patientNotification.deleteMany({ where: { isRead: true, createdAt: { lt: readCut } } }),
      this.prisma.patientNotification.deleteMany({ where: { isRead: false, createdAt: { lt: unreadCut } } }),
    ]);
    const total = r1.count + r2.count + p1.count + p2.count;
    if (total) this.logger.log(`알림 보존 정리: 직원 ${r1.count + r2.count}·환자 ${p1.count + p2.count}건 삭제`);
    return { purged: total };
  }

  /** SSE: 사용자별 실시간 스트림 생성 */
  getStream(userId: string): Observable<MessageEvent> {
    if (!this.subjects.has(userId)) {
      this.subjects.set(userId, new Subject<unknown>());
    }
    const subject = this.subjects.get(userId)!;

    return new Observable<MessageEvent>((subscriber) => {
      // 초기 읽지 않은 알림 수 전송
      this.getUnreadCount(userId)
        .then((count) => {
          subscriber.next({
            data: JSON.stringify({ type: 'init', unreadCount: count }),
          } as MessageEvent);
        })
        .catch(() => {});

      // 알림 이벤트 구독
      const sub = subject.subscribe((data) => {
        subscriber.next({
          data: JSON.stringify(data),
        } as MessageEvent);
      });

      // 30초 간격 하트비트
      const heartbeatTimer = setInterval(() => {
        subscriber.next({
          data: JSON.stringify({ type: 'heartbeat', timestamp: new Date().toISOString() }),
        } as MessageEvent);
      }, 30000);

      this.logger.log(`SSE stream opened for user ${userId}`);

      return () => {
        sub.unsubscribe();
        clearInterval(heartbeatTimer);
        this.logger.log(`SSE stream closed for user ${userId}`);
      };
    });
  }

  /** SSE: 특정 사용자에게 실시간 알림 푸시 */
  pushNotification(
    userId: string,
    notification: {
      id: string;
      type: string;
      title: string;
      message: string;
      severity?: string;
      refType?: string;
      refId?: string;
    },
  ) {
    const subject = this.subjects.get(userId);
    if (subject) {
      const { type: notificationType, ...rest } = notification;
      subject.next({ type: 'notification', notificationType, ...rest });
      this.logger.debug(`Pushed SSE notification to user ${userId}: ${notification.title}`);
    }
  }
}
