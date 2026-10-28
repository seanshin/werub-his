import { Injectable, ForbiddenException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ConfigRuntimeService } from '../config/config-runtime.service';
import { publicBaseUrl } from '../../common/util/public-url';

export type EnforceLevel = 'OFF' | 'WARN' | 'BLOCK';

/**
 * 사전승인 발행 게이트 — 순수 서비스(Prisma·ConfigRuntime만 의존, 순환 차단용).
 * prescription 등 발행 경로가 이 서비스를 주입해 발행 직전 게이트를 확인한다.
 * 정책 preauth.enforce = { NARCOTIC_RX: 'OFF'|'WARN'|'BLOCK', ... } (미설정=OFF). formulary 게이트 패턴.
 */
@Injectable()
export class PreAuthGateService {
  private readonly logger = new Logger(PreAuthGateService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configRuntime: ConfigRuntimeService,
  ) {}

  private async getPolicy(): Promise<Record<string, EnforceLevel>> {
    // 🔴 조회 실패를 삼키지 않는다 — 삼키면 `{}` → 전 유형 'OFF' 가 되어 **BLOCK 으로 운영 중이어도
    //    설정 조회 1회 실패로 마약류·수혈·항암·고가검사 발행이 전부 통과**하고 위반 기록도 안 남는다.
    //    키 부재는 `get()` 이 null 을 돌려주므로 그대로 'OFF'(등록 기본)로 흐른다 — 그것과 실패는 다른 사실이다.
    //    이 저장소의 다른 집행 게이트 10곳(dur·cdss·bcma·surgery·blood-bank …)은 전부 전파한다(fail-closed).
    const p = await this.configRuntime.get('preauth.enforce');
    return (p && typeof p === 'object' ? p : {}) as Record<string, EnforceLevel>;
  }

  async enforceLevel(type: string): Promise<EnforceLevel> {
    return (await this.getPolicy())[type] ?? 'OFF';
  }

  /**
   * 소비 가능한 승인 사전승인 조회 — status=APPROVED만(FULFILLED는 이미 발행 소진분이라 제외, H1).
   * 유효창(preauth.approvalValidHours, 기본 72h) 내 decidedAt만. 미소비 1건.
   */
  async findApprovedPreAuth(patientId: string, type: string): Promise<{ id: string } | null> {
    const validHours = Number((await this.configRuntime.get('preauth.approvalValidHours').catch(() => null)) ?? 72);
    const since = validHours > 0 ? new Date(Date.now() - validHours * 3600_000) : undefined;
    return this.prisma.preAuthRequest.findFirst({
      where: { patientId, type, status: 'APPROVED', ...(since ? { decidedAt: { gte: since } } : {}) },
      orderBy: { decidedAt: 'desc' },
      select: { id: true },
    });
  }

  /** 승인 1건을 원자적으로 소비(CONSUMED) — 재사용·경합 이중발행 차단(H1). claim 성공 시 true. */
  private async consumeApproval(id: string): Promise<boolean> {
    const claimed = await this.prisma.preAuthRequest.updateMany({ where: { id, status: 'APPROVED' }, data: { status: 'CONSUMED' } });
    return claimed.count > 0;
  }

  /**
   * 마약류 처방 발행 게이트.
   * - OFF(기본): 즉시 통과(no-op) → 기존 동작 불변
   * - preAuthRef 동반(승인 훅 발행): 통과
   * - 응급/STAT: 우회 발행 + 사후승인 큐(POST_FACTO_PENDING) 등록 → 응급 지연 없음
   * - BLOCK + 승인 없음: 차단(ForbiddenException)
   * - WARN + 승인 없음: 통과하되 사후 큐 기록(감사)
   */
  async assertNarcoticGate(ctx: {
    patientId: string; encounterId?: string | null; medicationCodeId: string; controlSchedule: string;
    preAuthRef?: string; emergency?: boolean; bypassReason?: string; priority?: string;
    requestedByUserId?: string; draft?: unknown;
  }): Promise<{ ok: boolean; bypassed?: boolean }> {
    return this.assertGate('NARCOTIC_RX', ctx);
  }

  /** 유형별 라벨(차단 메시지) */
  private label(type: string): string {
    return ({ NARCOTIC_RX: '마약류 처방', HIGH_COST_IMAGING: '고가·특수 검사', TRANSFUSION: '수혈(혈액제제)', CHEMO_REGIMEN: '항암 레지멘' } as Record<string, string>)[type] ?? '오더';
  }

  /**
   * 범용 발행 게이트(유형 공통).
   * - OFF(기본): 즉시 통과(no-op) → 기존 동작 불변
   * - preAuthRef 동반(승인 훅 발행): 통과
   * - 응급/STAT: 우회 발행 + 사후승인 큐(POST_FACTO_PENDING) → 응급 지연 없음
   * - BLOCK + 승인 없음: 차단(ForbiddenException) / WARN + 승인 없음: 통과 + 감사 큐
   */
  async assertGate(type: string, ctx: {
    patientId: string; encounterId?: string | null;
    preAuthRef?: string; emergency?: boolean; bypassReason?: string; priority?: string;
    requestedByUserId?: string; draft?: unknown;
  }): Promise<{ ok: boolean; bypassed?: boolean; postFactoId?: string }> {
    const level = await this.enforceLevel(type);
    if (level === 'OFF') return { ok: true };
    if (ctx.preAuthRef) return { ok: true }; // 승인된 사전승인으로 발행(훅)

    // 응급 우회 — 자가선언 priority='STAT'로는 우회 불가(H2). 명시 emergency=true + 사유(bypassReason) 필수.
    if (ctx.emergency === true) {
      if (!ctx.bypassReason || !ctx.bypassReason.trim())
        throw new BadRequestException({ code: 'BYPASS_REASON_REQUIRED', message: '응급 우회 발행은 사유(bypassReason)가 필요합니다.' });
      const postFactoId = await this.recordPostFacto(type, { ...ctx });
      return { ok: true, bypassed: true, postFactoId: postFactoId ?? undefined };
    }

    // 승인된 사전승인 — 1회성 원자 소비(H1). claim 성공 시에만 통과.
    const approved = await this.findApprovedPreAuth(ctx.patientId, type);
    if (approved && (await this.consumeApproval(approved.id))) return { ok: true };

    if (level === 'BLOCK') {
      throw new ForbiddenException({
        code: 'PREAUTH_REQUIRED',
        message: `${this.label(type)}은(는) 사전승인이 필요합니다. 사전승인 상신 후 승인되면 발행됩니다(응급 시 emergency=true+사유로 우회 발행·사후승인).`,
      });
    }
    // WARN — 통과 + 감사 큐
    const postFactoId = await this.recordPostFacto(type, { ...ctx, bypassReason: ctx.bypassReason ?? 'WARN 게이트 통과(사전승인 없음)' });
    return { ok: true, bypassed: true, postFactoId: postFactoId ?? undefined };
  }

  /**
   * 오더 발행 공용 게이트(choke point) — 마약류(control_schedule)·고가검사(config 판정)를 판별해 assertGate 위임.
   * prescription(create·copy·repeat)·pre-order·remote-consultation 등 모든 처방 발행 경로가 이 메서드를 호출한다(F1~F3 우회 차단).
   */
  async assertOrderGate(
    item: { type: string; medicationCodeId?: string | null; procedureCodeId?: string | null; priority?: string | null },
    ctx: { patientId: string; encounterId?: string | null; requestedByUserId?: string; preAuthRef?: string; emergency?: boolean; bypassReason?: string; draft?: unknown },
  ): Promise<{ postFactoId?: string }> {
    let postFactoId: string | undefined;
    if (item.type === 'MEDICATION' && item.medicationCodeId) {
      const mc = await this.prisma.medicationCode.findUnique({ where: { id: item.medicationCodeId }, select: { controlSchedule: true } });
      if (mc?.controlSchedule) {
        const r = await this.assertGate('NARCOTIC_RX', { ...ctx, priority: item.priority ?? undefined });
        postFactoId = r.postFactoId ?? postFactoId;
      }
    }
    if (item.type === 'IMAGING' && item.procedureCodeId) {
      if (await this.isHighCostImaging(item.procedureCodeId)) {
        const r = await this.assertGate('HIGH_COST_IMAGING', { ...ctx, priority: item.priority ?? undefined });
        postFactoId = r.postFactoId ?? postFactoId;
      } else if ((await this.enforceLevel('HIGH_COST_IMAGING')) !== 'OFF') {
        // F5 — enforce ON이나 판정기준(preauth.imaging) 미설정 시 게이트가 무력(모든 영상 통과). 관리자 인지용 경고.
        // 🔴 조회 실패를 '미설정'으로 번역하지 않는다(2026-09-15) — 실패는 전파한다
        const cfg = (await this.configRuntime.get('preauth.imaging')) as object | null;
        if (!cfg || Object.keys(cfg).length === 0) {
          this.logger.warn('HIGH_COST_IMAGING 게이트 ON이나 preauth.imaging 판정기준 미설정 — 영상검사가 게이트를 통과합니다(판정기준 설정 필요)');
        }
      }
    }
    return { postFactoId };
  }

  /**
   * 사후승인 발행분 링크 — 우회 발행된 처방 id를 사후승인 건(fulfilledRef)에 연결.
   * 소급 결재 반려 시 이 링크로 발행분을 자동취소한다. best-effort(링크 실패해도 발행 무영향).
   */
  async linkPostFacto(postFactoId: string | undefined, fulfilledRef: string, fulfilledType = 'prescription'): Promise<void> {
    if (!postFactoId) return;
    await this.prisma.preAuthRequest.updateMany({
      where: { id: postFactoId, status: 'POST_FACTO_PENDING', fulfilledRef: null },
      data: { fulfilledRef, fulfilledType },
    }).catch((e) => this.logger.warn(`사후승인 발행분 링크 실패 pa=${postFactoId}: ${e?.message ?? e}`));
  }

  /**
   * 고가·특수 검사 판정 — ProcedureCode에 전용 플래그가 없어 config 기반.
   * preauth.imaging = { minUnitPrice?: number, codePrefixes?: string[], categories?: string[] }. 하나라도 매칭이면 고가.
   */
  async isHighCostImaging(procedureCodeId: string): Promise<boolean> {
    // 🔴 (2026-09-15) 종전 `.catch(() => null)` — 판정기준 **조회 실패**가 "고가 아님"으로 번역돼 고가 영상이
    //    사전승인 게이트를 조용히 통과했다(모르면 안전측). 실패는 전파한다 — 처방 저장이 실패로 끝난다.
    const cfg = (await this.configRuntime.get('preauth.imaging')) as
      { minUnitPrice?: number; codePrefixes?: string[]; categories?: string[] } | null;
    if (!cfg || typeof cfg !== 'object') return false;
    const pc = await this.prisma.procedureCode.findUnique({ where: { id: procedureCodeId }, select: { unitPrice: true, code: true, category: true } });
    if (!pc) return false;
    if (typeof cfg.minUnitPrice === 'number' && (pc.unitPrice ?? 0) >= cfg.minUnitPrice) return true;
    if (Array.isArray(cfg.codePrefixes) && pc.code && cfg.codePrefixes.some((p) => pc.code.startsWith(p))) return true;
    if (Array.isArray(cfg.categories) && pc.category && cfg.categories.includes(pc.category)) return true;
    return false;
  }

  /**
   * 사후승인 큐 생성 — 응급/WARN 우회 발행의 소급 결재 대상.
   * 반려 자동취소 정책(2026-07-22): 생성과 동시에 EApprovalRelay(docType=PRE_AUTH)를 만들어 결재 수신함에
   * 노출한다(종전엔 큐만 쌓이고 결재 경로가 없어 소급 반려·발행분 취소가 불가능했음).
   * 승인권자=발행 의료진(requestedByUserId)의 관리자(과장). 미해소/본인이면 relay 없이 큐만(경고 로그).
   */
  private async recordPostFacto(type: string, ctx: {
    patientId: string; encounterId?: string | null;
    requestedByUserId?: string; bypassReason?: string; draft?: unknown;
  }): Promise<string | null> {
    try {
      const pa = await this.prisma.preAuthRequest.create({
        data: {
          category: 'ORDER', type, status: 'POST_FACTO_PENDING',
          patientId: ctx.patientId, encounterId: ctx.encounterId ?? null,
          requestedByUserId: ctx.requestedByUserId ?? null,
          payload: (ctx.draft ?? {}) as object,
          // 🔴 (2026-09-15 D3) 사유 없이 우회했는데 원장에는 '우회 발행'이 **사유처럼** 적혔다 —
          //    소급 결재자는 그것을 근거로 읽는다. 없는 사유는 없다고 적는다(cdss 와 같은 어휘).
          bypassReason: (ctx.bypassReason ?? '(사유 미입력)').slice(0, 300),
        },
      });
      try {
        const requester = ctx.requestedByUserId;
        const mgr = requester
          ? (await this.prisma.staff.findUnique({ where: { userId: requester }, select: { manager: { select: { id: true, userId: true } } } }))?.manager
          : null;
        if (mgr?.userId && mgr.id && mgr.userId !== requester) {
          // 결재 상신과 참조 연결은 함께 성립해야 한다 — relay 만 생기고 eApprovalRef 연결이
          // 실패하면 상신은 떠 있는데 원본에서 추적할 수 없다. (2026-07 트랜잭션 경계 전수)
          // 알림은 의도적으로 트랜잭션 밖 — 알림 실패가 결재 상신을 되돌리면 안 된다.
          await this.prisma.$transaction(async (tx) => {
            const relay = await tx.eApprovalRelay.create({
              data: {
                docType: 'PRE_AUTH', title: `${this.label(type)} 사후승인(우회 발행 소급 결재)`,
                refModule: 'preauth.pre_auth_requests', refId: pa.id,
                callbackUrl: `${publicBaseUrl()}/api/v1/ess/leave/eapproval-callback`,
                approvalLine: [{ order: 1, staffId: mgr.id, userId: mgr.userId, role: 'APPROVE' }] as object,
              },
            });
            await tx.preAuthRequest.update({ where: { id: pa.id }, data: { eApprovalRef: relay.refId } });
          });
          await this.prisma.notification.create({
            data: {
              userId: mgr.userId, type: 'PRE_AUTH', title: `${this.label(type)} 사후승인 요청`,
              message: `우회 발행 소급 결재가 도착했습니다 (사유: ${(ctx.bypassReason ?? '(사유 미입력)').slice(0, 80)})`,
              severity: 'WARNING', refType: 'PRE_AUTH', refId: pa.id,
            },
          }).catch((e) => this.logger.warn(`사후승인 알림 발신 실패: ${(e as Error).message}`));
        } else {
          this.logger.warn(`사후승인 결재선 미해소(관리자 없음/본인) — 큐만 기록 pa=${pa.id} requester=${requester ?? '-'}`);
        }
      } catch (e) {
        this.logger.warn(`사후승인 결재 편입 실패(비차단) pa=${pa.id}: ${e instanceof Error ? e.message : e}`);
      }
      return pa.id;
    } catch (e) {
      this.logger.error(`사후승인 큐(POST_FACTO_PENDING) 기록 실패 — 환자 ${ctx.patientId}·${type}: ${(e as Error)?.message ?? e}`);
      return null;
    }
  }
}
