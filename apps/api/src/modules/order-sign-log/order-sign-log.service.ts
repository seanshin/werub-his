import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { SignIntegrationService } from '../sign-integration/sign-integration.service';
import {
  ACTION_BY_STATUS,
  ORDER_STREAM,
  SYSTEM_ACTOR,
  buildSignEventBody,
  buildSummary,
  deriveEntries,
  hasUnrecoverableCancel,
  missingEntries,
  SEAL_RETRY_WHERE,
  shouldRetrySeal,
  type OrderSignAction,
} from './order-sign-entry';

/**
 * 오더 서명 로그 — CPOE 행위를 sign 해시체인 원장에 봉인하고 영수증을 원내에 보관한다.
 *
 * 두 겹으로 남긴다:
 *  1. **실시간 배선** — 발행(order.created 단일 구독점)·상태변경 정본·취소. 행위자가 정확하다.
 *  2. **소급 복원(리콘사일러)** — orders 의 전이 스탬프에서 누락분을 찾아 봉인.
 *     오더 상태를 바꾸는 코드가 13개 모듈 34곳에 흩어져 있어 호출부 등재만으로는 반드시 샌다.
 *     스탬프는 어느 경로가 바꿨든 남으므로, 커버리지를 **등재가 아니라 데이터로** 보장한다.
 *
 * 기록 순서는 **로컬 먼저, 봉인은 그 다음**이다. sign 이 내려가 있어도 로그는 남고, 재시도가 봉인한다.
 * 반대로 했다면 sign 장애 = 로그 유실이 된다.
 */
@Injectable()
export class OrderSignLogService {
  private readonly logger = new Logger(OrderSignLogService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly sign?: SignIntegrationService,
  ) {}

  /**
   * 로그 1건 기록(+봉인 시도). 임상 흐름을 막지 않는다 — 실패해도 예외를 던지지 않는다.
   * 오더 처리 자체가 로그 때문에 실패하면 그게 더 큰 사고다.
   */
  async record(input: {
    orderId: string;
    action: OrderSignAction;
    toStatus: string;
    fromStatus?: string | null;
    actorId?: string | null;
    occurredAt: Date;
    origin?: 'EVENT' | 'RECONCILED';
    /** 대량 봉인 중 — TSA 앵커를 건건이 걸지 않는다(앵커는 스트림 head 기준이라 마지막 1회면 충분) */
    suppressAnchor?: boolean;
    /** 대량 봉인의 마지막 항목 — 행위와 무관하게 앵커를 걸어 이번 회차 전량을 덮는다 */
    forceAnchor?: boolean;
  }): Promise<string | null> {
    try {
      const ctx = await this.orderContext(input.orderId);
      if (!ctx) return null;

      const row = await this.prisma.orderSignLog.upsert({
        where: { orderId_action_occurredAt: { orderId: input.orderId, action: input.action, occurredAt: input.occurredAt } },
        create: {
          orderId: input.orderId,
          prescriptionId: ctx.prescriptionId,
          patientId: ctx.patientId,
          encounterId: ctx.encounterId,
          action: input.action,
          fromStatus: input.fromStatus ?? null,
          toStatus: input.toStatus,
          actorId: input.actorId ?? null,
          actorRole: input.actorId ? await this.roleOf(input.actorId) : null,
          orderType: ctx.orderType,
          department: ctx.department,
          priority: ctx.priority,
          summary: ctx.summary,
          origin: input.origin ?? 'EVENT',
          occurredAt: input.occurredAt,
        },
        update: {}, // 이미 있으면 그대로 — 같은 전이를 덮어쓰지 않는다(원장 성격)
      });

      if (row.sealStatus === 'PENDING') await this.seal(row.id, { suppressAnchor: input.suppressAnchor, forceAnchor: input.forceAnchor });
      return row.id;
    } catch (e) {
      this.logger.warn(`오더 서명 로그 기록 실패(비차단) order=${input.orderId} action=${input.action}: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
  }

  /** 로컬 1건을 sign 원장에 봉인하고 영수증을 저장 */
  private async seal(id: string, opt?: { suppressAnchor?: boolean; forceAnchor?: boolean }): Promise<void> {
    const row = await this.prisma.orderSignLog.findUnique({ where: { id } });
    if (!row || row.sealStatus === 'SEALED') return;
    if (!this.sign) {
      await this.prisma.orderSignLog.update({ where: { id }, data: { sealStatus: 'SKIPPED', sealError: 'sign 연동 모듈 미주입' } });
      return;
    }

    const body = buildSignEventBody({
      action: row.action as OrderSignAction,
      orderId: row.orderId,
      actorId: row.actorId,
      actorRole: row.actorRole,
      patientId: row.patientId,
      encounterId: row.encounterId,
      prescriptionId: row.prescriptionId,
      orderType: row.orderType,
      department: row.department,
      fromStatus: row.fromStatus,
      toStatus: row.toStatus,
      summary: row.summary,
      occurredAt: row.occurredAt,
      origin: row.origin,
      // 취소·완료는 다툼이 생기는 지점이라 TSA 시점봉인까지 즉시 건다.
      // 단 대량 봉인 중에는 억제 — 앵커는 **스트림 head** 를 봉인하므로 마지막 1회가 앞의 전량을 덮는다.
      anchor: opt?.forceAnchor === true
        ? true
        : !opt?.suppressAnchor && (row.action === 'ORDER_CANCELLED' || row.action === 'ORDER_COMPLETED'),
    });

    const receipt = await this.sign.recordSignAuditEvent({
      userId: body.actor,
      action: body.action,
      actorRole: body.actorRole,
      targetType: body.targetType,
      targetRef: body.targetRef,
      stream: body.stream,
      data: body.data,
      occurredAt: body.occurredAt,
      anchor: body.anchor,
    });

    await this.prisma.orderSignLog.update({
      where: { id },
      data: {
        sealAttempts: { increment: 1 },
        ...(receipt.ok
          ? {
              sealStatus: 'SEALED',
              entryHash: receipt.entryHash ?? null,
              prevHash: receipt.prevHash ?? null,
              authMethod: receipt.authMethod ?? null,
              anchorHead: receipt.anchorHead ?? null,
              anchoredAt: receipt.anchoredAt ? new Date(receipt.anchoredAt) : null,
              sealedAt: new Date(),
              sealError: null,
            }
          : receipt.skipped
            ? { sealStatus: 'SKIPPED', sealError: receipt.reason ?? null }
            : { sealStatus: 'FAILED', sealError: receipt.reason ?? null }),
      },
    });
  }

  /** 오더 1건의 맥락 — 요약은 코드·명칭까지만(PHI 금지) */
  private async orderContext(orderId: string) {
    const o = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        department: true, priority: true, prescriptionId: true,
        prescription: {
          select: {
            type: true, dosage: true, instructions: true, encounterId: true,
            encounter: { select: { patientId: true } },
            medicationCode: { select: { code: true, nameKo: true } },
            procedureCode: { select: { code: true, nameKo: true } },
          },
        },
      },
    });
    if (!o) return null;
    const rx = o.prescription;
    const code = rx.medicationCode ?? rx.procedureCode ?? null;
    return {
      prescriptionId: o.prescriptionId,
      patientId: rx.encounter?.patientId ?? null,
      encounterId: rx.encounterId,
      orderType: rx.type,
      department: o.department,
      priority: o.priority,
      summary: buildSummary({
        code: code?.code, codeName: code?.nameKo,
        dosage: rx.dosage, instructions: rx.instructions, priority: o.priority,
      }),
    };
  }

  private async roleOf(userId: string): Promise<string | null> {
    if (userId.startsWith('system:')) return 'SYSTEM';
    const u = await this.prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    return u?.role ?? null;
  }

  // ── 실시간 배선 ──────────────────────────────────────────────

  /** 오더 발행 — order.created 는 8개 생성 경로의 단일 구독점이라 여기 하나로 전량 덮인다 */
  @OnEvent('order.created')
  async onOrderCreated(p: { orderId?: string; patientId?: string }): Promise<void> {
    if (!p?.orderId) return;
    const o = await this.prisma.order.findUnique({
      where: { id: p.orderId },
      select: { createdAt: true, prescription: { select: { createdBy: true, prescriberId: true } } },
    });
    if (!o) return;
    await this.record({
      orderId: p.orderId,
      action: 'ORDER_CREATED',
      toStatus: 'ORDERED',
      actorId: o.prescription.prescriberId ?? o.prescription.createdBy,
      occurredAt: o.createdAt,
    });
  }

  /** 상태 전이 — 정본 경로(OrderService.changeStatus)와 취소 경로가 직접 부른다 */
  async recordTransition(p: { orderId: string; from: string; to: string; actorId?: string | null; occurredAt: Date }): Promise<void> {
    const action = ACTION_BY_STATUS[p.to];
    if (!action) return;
    await this.record({ orderId: p.orderId, action, fromStatus: p.from, toStatus: p.to, actorId: p.actorId, occurredAt: p.occurredAt });
  }

  // ── 소급 복원·재시도 크론 ────────────────────────────────────

  /**
   * 누락분 소급 복원 — 최근 변경된 오더의 스탬프와 로그를 대조해 빠진 전이를 봉인한다.
   * 실시간 배선이 닿지 않는 경로(약국·검사·영상·워크스테이션·PACS 웹훅)를 여기서 흡수한다.
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async reconcile(sinceHours = 48): Promise<{ scanned: number; created: number; unrecoverableCancel: number }> {
    const since = new Date(Date.now() - sinceHours * 3600_000);
    const orders = await this.prisma.order.findMany({
      where: { updatedAt: { gte: since } },
      select: {
        id: true, status: true, createdAt: true,
        receivedAt: true, receivedById: true,
        startedAt: true, startedById: true,
        completedAt: true, completedById: true,
        cancelledAt: true, cancelledById: true,
        prescription: { select: { createdBy: true, prescriberId: true } },
        signLogs: { select: { action: true, occurredAt: true } },
      },
      take: 2000,
    });

    let unrecoverable = 0;
    // 먼저 **무엇을 봉인할지 전부 모은 뒤** 마지막 1건만 앵커를 건다.
    // sign 에는 독립 앵커 EP 가 없고 항목 기록에 플래그를 얹는 방식이라, 합성 항목을 끼워 넣지 않고
    // 실제 마지막 항목이 앵커를 지게 한다(앵커는 스트림 head 봉인이라 앞의 전량을 덮는다).
    const pending: { orderId: string; action: OrderSignAction; toStatus: string; actorId: string | null; occurredAt: Date }[] = [];
    for (const o of orders) {
      const snap = {
        id: o.id, status: o.status, createdAt: o.createdAt,
        receivedAt: o.receivedAt, receivedById: o.receivedById,
        startedAt: o.startedAt, startedById: o.startedById,
        completedAt: o.completedAt, completedById: o.completedById,
        cancelledAt: o.cancelledAt, cancelledById: o.cancelledById,
        prescribedById: o.prescription.prescriberId ?? o.prescription.createdBy,
      };
      if (hasUnrecoverableCancel(snap)) unrecoverable += 1;
      for (const m of missingEntries(deriveEntries(snap), o.signLogs)) {
        pending.push({ orderId: o.id, action: m.action, toStatus: m.toStatus, actorId: m.actorId, occurredAt: m.occurredAt });
      }
    }

    let created = 0;
    for (const [i, m] of pending.entries()) {
      await this.record({
        orderId: m.orderId, action: m.action, toStatus: m.toStatus,
        actorId: m.actorId, occurredAt: m.occurredAt, origin: 'RECONCILED',
        suppressAnchor: i < pending.length - 1,
        forceAnchor: i === pending.length - 1,
      });
      created += 1;
    }
    if (created > 0 || unrecoverable > 0) {
      this.logger.log(`오더 서명 로그 소급 복원: 대상 ${orders.length} · 신규 ${created} · 취소시각 미상 ${unrecoverable}`);
    }
    return { scanned: orders.length, created, unrecoverableCancel: unrecoverable };
  }

  /** 봉인 실패분 재시도 — sign 일시 장애가 영구 미봉인으로 굳지 않게 */
  @Cron(CronExpression.EVERY_10_MINUTES)
  async retryFailedSeals(): Promise<{ retried: number }> {
    const rows = await this.prisma.orderSignLog.findMany({
      // 🔴 판정 정본과 같은 조건으로 **쿼리 단계에서** 거른다 — 거를 행으로 창을 채우면 재시도 대상이 굶는다
      where: SEAL_RETRY_WHERE,
      select: { id: true, sealStatus: true, sealAttempts: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
      take: 200,
    });
    const now = new Date();
    let retried = 0;
    let failed = 0;
    for (const r of rows) {
      if (!shouldRetrySeal(r, now)) continue;
      // 🔴 (2026-09-16 E4) 종전엔 per-item 보호가 없어, 한 행에서 `seal()` 이 던지면 **나머지 행이 통째로 건너뛰어졌다**
      //    (createdAt 오름차순이라 같은 행이 매번 먼저 와 영구 차단 — audit 버퍼가 이미 겪은 poison message 다).
      //    개별 실패는 여기서 끊고 다음 행으로 간다. 재시도 상한(MAX_SEAL_ATTEMPTS)은 seal() 쪽 정책 그대로다.
      try {
        await this.seal(r.id);
        retried += 1;
      } catch (e) {
        failed += 1;
        this.logger.warn(`오더 서명 로그 재봉인 실패 id=${r.id}: ${(e as Error).message}`);
      }
    }
    if (retried || failed) this.logger.log(`오더 서명 로그 재봉인 시도 ${retried}건${failed ? ` · 실패 ${failed}건` : ''}`);
    return { retried };
  }

  // ── 조회 ────────────────────────────────────────────────────

  /** 오더 1건의 서명 로그(시간순) */
  async byOrder(orderId: string) {
    const rows = await this.prisma.orderSignLog.findMany({
      where: { orderId },
      orderBy: { occurredAt: 'asc' },
    });
    const actorIds = [...new Set(rows.map((r) => r.actorId).filter(Boolean) as string[])];
    const users = actorIds.length
      ? await this.prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, familyName: true, givenName: true, role: true } })
      : [];
    const nameOf = new Map(users.map((u) => [u.id, `${u.familyName ?? ''}${u.givenName ?? ''}`.trim()]));
    return rows.map((r) => ({
      ...r,
      actorName: r.actorId ? (nameOf.get(r.actorId) ?? null) : null,
      /** 원장 대조에 쓰는 값 — 화면은 앞 12자만 보여준다 */
      entryHashShort: r.entryHash ? r.entryHash.slice(0, 12) : null,
    }));
  }

  /** 로그 목록 — 기간·행위·행위자·봉인상태 필터 */
  async list(q: {
    from?: string; to?: string; action?: string; actorId?: string; orderId?: string;
    patientId?: string; sealStatus?: string; page?: number; limit?: number;
  }) {
    const page = Math.max(1, q.page ?? 1);
    const limit = Math.min(200, Math.max(1, q.limit ?? 50));
    const where = {
      ...(q.orderId ? { orderId: q.orderId } : {}),
      ...(q.patientId ? { patientId: q.patientId } : {}),
      ...(q.action ? { action: q.action } : {}),
      ...(q.actorId ? { actorId: q.actorId } : {}),
      ...(q.sealStatus ? { sealStatus: q.sealStatus } : {}),
      ...(q.from || q.to
        ? { occurredAt: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}) } }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.orderSignLog.findMany({ where, orderBy: { occurredAt: 'desc' }, skip: (page - 1) * limit, take: limit }),
      this.prisma.orderSignLog.count({ where }),
    ]);
    const actorIds = [...new Set(rows.map((r) => r.actorId).filter(Boolean) as string[])];
    const users = actorIds.length
      ? await this.prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, familyName: true, givenName: true } })
      : [];
    const nameOf = new Map(users.map((u) => [u.id, `${u.familyName ?? ''}${u.givenName ?? ''}`.trim()]));
    return {
      data: rows.map((r) => ({ ...r, actorName: r.actorId ? (nameOf.get(r.actorId) ?? null) : null })),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  /**
   * 봉인 현황 — "얼마나 남았고 얼마나 봉인됐는가"와 **복원 불가한 구멍**을 함께 보여준다.
   * 봉인률만 보이면 애초에 기록되지 않은 것은 영원히 안 보인다.
   */
  async stats() {
    const [byStatus, byAction, unrecoverable, oldestPending, lastSealed, missingCancelLog] =
      await Promise.all([
        this.prisma.orderSignLog.groupBy({ by: ['sealStatus'], _count: true }),
        this.prisma.orderSignLog.groupBy({ by: ['action'], _count: true }),
        this.prisma.order.count({ where: { status: 'CANCELLED', cancelledAt: null } }),
        this.prisma.orderSignLog.findFirst({ where: { sealStatus: { not: 'SEALED' } }, orderBy: { createdAt: 'asc' }, select: { createdAt: true } }),
        // 🔴 마지막으로 실제 봉인이 일어난 시각 — "봉인률 100%"가 정체를 가린다
        this.prisma.orderSignLog.findFirst({ where: { sealedAt: { not: null } }, orderBy: { sealedAt: 'desc' }, select: { sealedAt: true } }),
        // 취소 스탬프는 있는데 원장에 취소 항목이 없는 오더
        this.prisma.order.count({
          where: {
            cancelledAt: { not: null },
            NOT: { signLogs: { some: { action: 'ORDER_CANCELLED' } } },
          },
        // 🔴 (2026-09-15) 종전 `.catch(() => 0)` — 집계 실패가 "기록 누락 0건"(정상)으로 보였다. 실패=null(확인 불가)
        }).catch((e) => { this.logger.warn(`취소 기록 누락 집계 실패 — 확인 불가: ${e instanceof Error ? e.message : String(e)}`); return null; }),
      ]);
    const total = byStatus.reduce((a, b) => a + b._count, 0);
    const sealed = byStatus.find((b) => b.sealStatus === 'SEALED')?._count ?? 0;
    return {
      total,
      sealed,
      /**
       * 🔴 이 비율의 분모는 **이미 원장에 기록된 항목**이다 — "봉인해야 할 CPOE 행위 전체"가 아니다.
       * 애초에 기록되지 않은 행위는 분모에도 없으므로 **100% 가 나와도 커버리지는 그보다 낮다**
       * (2026-08-14 실측: 원장 645 / 봉인 대상 추정 718 → 실 커버리지 약 89.8%).
       * 이름을 바꿔 오독을 막고, 아래 `recordingGaps` 로 기록 자체의 구멍을 함께 보고한다.
       */
      /**
       * 🔴 분모 0 = **산출 불가(null)**, 0% 가 아니다(W8 이연 회수·2026-08-14).
       *    0% 는 "봉인 대상이 있었는데 하나도 못 봉인했다"는 **다른 사실**이고, 그건 즉시
       *    조치해야 할 위급 신호다. 원장에 항목이 아예 없는 것(=아직 아무 일도 없었다)과
       *    구분되지 않으면 진짜 0% 가 왔을 때 아무도 놀라지 않는다.
       *    W7/W8 다른 EP 전부(`/executive` bedOccupancyPct·clinical-pathway completionRate·
       *    education completionRate) 가 null 규약이라 여기만 갈라져 있었다(P12).
       */
      sealRateOfRecorded: total > 0 ? Math.round((sealed / total) * 1000) / 10 : null,
      /** 🔴 null 일 때 화면이 말할 말 — 폴백 0 을 쓰지 말라는 신호 */
      sealRateUnavailableReason: total > 0 ? null : '봉인 원장에 항목이 없습니다(표본 0) — 비율을 산출할 수 없습니다',
      byStatus: Object.fromEntries(byStatus.map((b) => [b.sealStatus, b._count])),
      byAction: Object.fromEntries(byAction.map((b) => [b.action, b._count])),
      /** 취소 시각이 없어 소급 복원조차 못 하는 오더 — 이 숫자는 0 으로 수렴해야 한다 */
      unrecoverableCancel: unrecoverable,
      /**
       * 🔴 취소 스탬프는 있는데 원장에 취소 항목이 없는 오더.
       * 실측 10건은 `cancelled_at` 이 **마이크로초까지 동일**하고 `cancelled_by_id` 가 전부 NULL 이며
       * `updated_at` 은 5~7월이다 — 즉 **실제 취소 시각이 아니라 일괄 백필**로 보인다.
       * 이 시각으로 봉인하면 **틀린 시각을 위변조 방지 원장에 영구히 박게 된다.**
       * 이 저장소 원칙: **모르는 시각은 추정하지 않는다.** 봉인하지 말고 드러내기만 한다.
       */
      recordingGaps: { cancelledWithoutLog: missingCancelLog },
      oldestUnsealedAt: oldestPending?.createdAt ?? null,
      /** 🔴 마지막 봉인 시각 — 정체되면 "100%"가 안심 신호로 오독된다 */
      lastSealedAt: lastSealed?.sealedAt ?? null,
      stream: ORDER_STREAM,
      systemActor: SYSTEM_ACTOR,
    };
  }

  /** sign 원장 체인 검증 — 위변조 탐지는 원장이 정본이므로 그대로 전달한다 */
  async verifyChain() {
    if (!this.sign) return { available: false, reason: 'sign 연동 모듈 미주입' };
    try {
      const result = await this.sign.verifySignAuditChain(ORDER_STREAM);
      if (result === null) return { available: false, reason: 'sign.mode 가 EXTERNAL 이 아니거나 미설정' };
      return { available: true, result };
    } catch (e) {
      return { available: false, reason: e instanceof Error ? e.message : String(e) };
    }
  }
}
