import { Injectable, Logger, NotFoundException, BadRequestException, UnauthorizedException } from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';
import type { AuthenticationResponseJSON } from '@simplewebauthn/server';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { FcmPushService } from '../../notification/fcm-push.service';
import { PasskeyService } from '../passkey/passkey.service';
import { StepUpService } from './step-up.service';
import { TerminalPinService } from '../../terminal/terminal-pin.service';
import { AuditService } from '../../audit/audit.service';

// 스마트폰 푸시 생체 승인 — Tier 2 재인증 (단말 제로트러스트 ②).
// 흐름: PC request → 스태프 폰 FCM 푸시(미설치 시 폰 polling) → 폰 생체승인(approve) →
//       step-up 토큰 발급 → PC가 status polling 으로 1회 수령 → x-step-up-token 재시도.
const APPROVAL_TTL_SEC = 180; // 3분

export interface ApprovalContext {
  patient: string; // 환자명(familyName+givenName)
  mrn: string;
  note: string | null; // 주소(C.C.) 또는 진단 요약(≤40자)
}

@Injectable()
export class PushApprovalService {
  private readonly logger = new Logger(PushApprovalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stepUp: StepUpService,
    private readonly fcm: FcmPushService,
    private readonly passkey: PasskeyService,
    private readonly terminalPin: TerminalPinService,
    private readonly audit: AuditService,
  ) {}

  /**
   * 승인/거부 이벤트를 중앙 감사(AuditLog)에 기록 — 해시체인 + 시간당 blockchain 앵커(Merkle)로 위변조 방지.
   * 의료 컴플라이언스: 처방·차트 서명의 2차 인증(부인방지)은 필수 보존·변조탐지 대상.
   */
  private async recordAudit(appr: { id: string; userId: string; action: string; resourceId: string | null }, method: 'BIO' | 'PIN' | 'DENY', result: 'APPROVED' | 'DENIED') {
    let target: string | null = appr.resourceId;
    try {
      const ctx = (await this.withContext([{ resourceId: appr.resourceId }]))[0]?.context;
      if (ctx) target = `${ctx.patient}(${ctx.mrn})`;
    } catch { /* 컨텍스트 실패 무시 */ }
    await this.audit.safeLog({
      userId: appr.userId,
      action: AuditAction.UPDATE,
      resourceType: 'STEPUP_APPROVAL',
      resourceId: appr.id,
      changes: {
        result: { old: 'PENDING', new: result },
        method: { old: null, new: method },
        action: { old: null, new: appr.action },
        target: { old: null, new: target },
      },
    });
  }

  /** PC: 승인 요청 생성 + 스태프 폰 푸시. */
  async request(userId: string, action: string, resourceId?: string, bodyHash?: string) {
    if (!action) throw new BadRequestException('action is required');
    const appr = await this.prisma.stepUpApproval.create({
      data: {
        userId,
        action,
        resourceId: resourceId ?? null,
        bodyHash: bodyHash ?? null,
        status: 'PENDING',
        expiresAt: new Date(Date.now() + APPROVAL_TTL_SEC * 1000),
      },
    });
    // 스태프 등록 단말로 푸시(미설치/미등록 시 no-op — 폰은 polling 으로도 발견 가능)
    const devices = await this.prisma.staffDevice.findMany({
      where: { userId, status: 'ACTIVE', fcmToken: { not: null } },
      select: { fcmToken: true },
    });
    const tokens = devices.map((d) => d.fcmToken!).filter(Boolean);
    if (tokens.length) {
      this.fcm
        .sendToTokens(tokens, {
          title: '승인 요청',
          body: `고위험 작업(${action}) 승인이 필요합니다.`,
          data: { type: 'STEPUP_APPROVAL', requestId: appr.id, action },
        })
        .catch((e) => this.logger.warn(`승인 푸시 실패(무시): ${(e as Error).message}`));
    }
    return { requestId: appr.id, expiresAt: appr.expiresAt.toISOString() };
  }

  /** PC: 승인 상태 polling. APPROVED 면 토큰 1회 수령(CONSUMED). */
  async status(userId: string, requestId: string) {
    const appr = await this.owned(userId, requestId);
    if (appr.status === 'PENDING' && appr.expiresAt < new Date()) {
      await this.prisma.stepUpApproval.update({ where: { id: requestId }, data: { status: 'EXPIRED' } });
      return { status: 'EXPIRED' as const };
    }
    if (appr.status === 'APPROVED' && appr.stepUpToken) {
      await this.prisma.stepUpApproval.update({ where: { id: requestId }, data: { status: 'CONSUMED' } });
      return { status: 'APPROVED' as const, stepUpToken: appr.stepUpToken };
    }
    return { status: appr.status as 'PENDING' | 'DENIED' | 'EXPIRED' | 'CONSUMED' };
  }

  /**
   * 위임/대리처방: 입력자(requesterId)가 지정 처방의(prescriberId)에게 승인 요청.
   * 푸시는 지정 처방의 폰으로 가고, 토큰은 입력자가 delegateStatus 로 1회 수령.
   */
  async requestDelegate(requesterId: string, prescriberId: string, action: string, resourceId?: string, bodyHash?: string, summary?: string) {
    if (!action) throw new BadRequestException('action is required');
    if (!prescriberId) throw new BadRequestException('prescriberId is required');
    if (prescriberId === requesterId) throw new BadRequestException('본인에게는 위임 승인을 요청할 수 없습니다.');
    const appr = await this.prisma.stepUpApproval.create({
      data: {
        userId: prescriberId,
        requesterId,
        action,
        resourceId: resourceId ?? null,
        bodyHash: bodyHash ?? null,
        summary: summary ? summary.slice(0, 120) : null,
        status: 'PENDING',
        expiresAt: new Date(Date.now() + APPROVAL_TTL_SEC * 1000),
      },
    });
    const devices = await this.prisma.staffDevice.findMany({
      where: { userId: prescriberId, status: 'ACTIVE', fcmToken: { not: null } },
      select: { fcmToken: true },
    });
    const tokens = devices.map((d) => d.fcmToken!).filter(Boolean);
    if (tokens.length) {
      this.fcm
        .sendToTokens(tokens, {
          title: '처방 승인 요청',
          body: `대리 입력된 처방(${action}) 승인이 필요합니다.`,
          data: { type: 'STEPUP_APPROVAL', requestId: appr.id, action },
        })
        .catch((e) => this.logger.warn(`위임 승인 푸시 실패(무시): ${(e as Error).message}`));
    }
    return { requestId: appr.id, expiresAt: appr.expiresAt.toISOString() };
  }

  /** 위임: 입력자(requesterId)가 승인 토큰 polling — 본인이 요청한 건만 수령(CONSUMED). */
  async delegateStatus(requesterId: string, requestId: string) {
    const appr = await this.prisma.stepUpApproval.findUnique({ where: { id: requestId } });
    if (!appr || appr.requesterId !== requesterId) throw new NotFoundException('승인 요청을 찾을 수 없습니다');
    if (appr.status === 'PENDING' && appr.expiresAt < new Date()) {
      await this.prisma.stepUpApproval.update({ where: { id: requestId }, data: { status: 'EXPIRED' } });
      return { status: 'EXPIRED' as const };
    }
    if (appr.status === 'APPROVED' && appr.stepUpToken) {
      await this.prisma.stepUpApproval.update({ where: { id: requestId }, data: { status: 'CONSUMED' } });
      return { status: 'APPROVED' as const, stepUpToken: appr.stepUpToken, prescriberId: appr.userId };
    }
    return { status: appr.status as 'PENDING' | 'DENIED' | 'EXPIRED' | 'CONSUMED' };
  }

  /** 폰: 대기 중 승인 요청 목록(푸시 미수신 대비 polling). */
  async pending(userId: string) {
    const rows = await this.prisma.stepUpApproval.findMany({
      where: { userId, status: 'PENDING', expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, action: true, resourceId: true, summary: true, createdAt: true, expiresAt: true },
    });
    return this.withContext(rows);
  }

  /**
   * 승인 대상의 구체적 컨텍스트(환자·차트 요약)를 부착 — "무엇을 승인하는지" 명확화.
   * resourceId(차트서명=encounterId, 처방=encounterId)로 Encounter→환자 조회.
   */
  private async withContext<T extends { resourceId: string | null }>(rows: T[]): Promise<(T & { context: ApprovalContext | null })[]> {
    const ids = [...new Set(rows.map((r) => r.resourceId).filter((x): x is string => !!x))];
    if (!ids.length) return rows.map((r) => ({ ...r, context: null }));
    const encs = await this.prisma.encounter
      .findMany({
        where: { id: { in: ids } },
        select: {
          id: true, chiefComplaint: true, assessment: true, subjective: true,
          patient: { select: { familyName: true, givenName: true, mrn: true } },
        },
      })
      .catch(() => []);
    const byId = new Map(encs.map((e) => [e.id, e]));
    return rows.map((r) => {
      const e = r.resourceId ? byId.get(r.resourceId) : undefined;
      const context: ApprovalContext | null = e
        ? {
            patient: `${e.patient.familyName}${e.patient.givenName}`,
            mrn: e.patient.mrn,
            note: ((e.assessment || e.chiefComplaint || e.subjective || '').trim().slice(0, 40)) || null,
          }
        : null;
      return { ...r, context };
    });
  }

  /** 폰: 승인 요청 처리 이력(로그) — 기간 필터·페이지. 확인/감사용(승인·거부·만료 포함). */
  async history(userId: string, opts: { from?: Date; to?: Date; limit?: number; offset?: number } = {}) {
    const where: Prisma.StepUpApprovalWhereInput = { userId };
    if (opts.from || opts.to) where.createdAt = { ...(opts.from ? { gte: opts.from } : {}), ...(opts.to ? { lte: opts.to } : {}) };
    const limit = Math.min(Math.max(opts.limit ?? 30, 1), 100);
    const offset = Math.max(opts.offset ?? 0, 0);
    const rows = await this.prisma.stepUpApproval.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
      select: {
        id: true, action: true, resourceId: true, status: true, method: true,
        createdAt: true, approvedAt: true, expiresAt: true,
      },
    });
    // PENDING 인데 만료된 건은 표시상 EXPIRED 로 정규화(상태 전환은 status polling 시점에 영속화).
    const now = new Date();
    const normalized = rows.map((r) => ({
      ...r,
      status: r.status === 'PENDING' && r.expiresAt < now ? 'EXPIRED' : r.status,
    }));
    return this.withContext(normalized);
  }

  /**
   * 폰: 생체(passkey) 승인 → step-up 토큰 발급. assertion 을 서버에서 검증(생체 바인딩) 후에만 발급.
   * 흐름: 폰이 /auth/step-up/options 로 챌린지 수령 → navigator.credentials.get(생체) → 본 메서드에 response 전달.
   */
  async approve(userId: string, requestId: string, response: AuthenticationResponseJSON) {
    const appr = await this.owned(userId, requestId);
    if (appr.status !== 'PENDING') throw new BadRequestException('이미 처리된 요청입니다.');
    if (appr.expiresAt < new Date()) {
      await this.prisma.stepUpApproval.update({ where: { id: requestId }, data: { status: 'EXPIRED' } });
      throw new BadRequestException('만료된 요청입니다.');
    }
    // 생체 assertion 서버 검증 — 본인 credential 아니거나 실패 시 throw(세션만으론 승인 불가).
    await this.passkey.verifyStepUpAssertion(userId, response);
    const { stepUpToken } = await this.stepUp.issueDirect(
      userId,
      appr.action,
      appr.resourceId ?? undefined,
      appr.bodyHash ?? undefined,
    );
    await this.prisma.stepUpApproval.update({
      where: { id: requestId },
      data: { status: 'APPROVED', method: 'BIO', stepUpToken, approvedAt: new Date() },
    });
    await this.recordAudit(appr, 'BIO', 'APPROVED');
    return { ok: true };
  }

  /**
   * 폰: 데일리 PIN 승인 → step-up 토큰 발급(생체 대안). 본인 당일 PIN(HMAC) 검증 후에만 발급.
   * 승인 시 생체/PIN 둘 중 선택 가능. PIN 은 화면잠금/승인용 당일 비밀(생체 로그인 후 발급).
   */
  async approveWithPin(userId: string, requestId: string, pin: string) {
    const appr = await this.owned(userId, requestId);
    if (appr.status !== 'PENDING') throw new BadRequestException('이미 처리된 요청입니다.');
    if (appr.expiresAt < new Date()) {
      await this.prisma.stepUpApproval.update({ where: { id: requestId }, data: { status: 'EXPIRED' } });
      throw new BadRequestException('만료된 요청입니다.');
    }
    // 당일 PIN 검증(실패 시 false·잠금은 throw) — 본인 PIN 아니면 승인 불가
    const ok = await this.terminalPin.verifyByUserId(userId, pin);
    if (!ok) throw new UnauthorizedException({ code: 'PIN_INVALID', message: 'PIN이 올바르지 않습니다.' });
    const { stepUpToken } = await this.stepUp.issueDirect(
      userId,
      appr.action,
      appr.resourceId ?? undefined,
      appr.bodyHash ?? undefined,
    );
    await this.prisma.stepUpApproval.update({
      where: { id: requestId },
      data: { status: 'APPROVED', method: 'PIN', stepUpToken, approvedAt: new Date() },
    });
    await this.recordAudit(appr, 'PIN', 'APPROVED');
    return { ok: true };
  }

  /** 폰: 승인 거부. */
  async deny(userId: string, requestId: string) {
    const appr = await this.owned(userId, requestId);
    if (appr.status !== 'PENDING') throw new BadRequestException('이미 처리된 요청입니다.');
    await this.prisma.stepUpApproval.update({ where: { id: requestId }, data: { status: 'DENIED', method: 'DENY' } });
    await this.recordAudit(appr, 'DENY', 'DENIED');
    return { ok: true };
  }

  /** ADMIN 오버사이트 — 전체 의료진 승인 내역(필터·페이지). 위변조 방지 사실은 AuditLog가 보유. */
  async adminList(filter: { userId?: string; from?: Date; to?: Date; status?: string; method?: string; limit?: number; offset?: number }) {
    const where: Prisma.StepUpApprovalWhereInput = {};
    if (filter.userId) where.userId = filter.userId;
    // 🔴 응답은 `PENDING + 기한경과` 를 'EXPIRED' 로 다시 쓰는데 필터는 **DB 값**을 그대로 비교해,
    //    화면이 정반대 사실을 말했다(2026-08-13 W6 실측: `?status=EXPIRED` → 0건 "내역 없음",
    //    `?status=PENDING` → 9건인데 배지는 전부 '만료'). 필터도 **표시 기준**으로 맞춘다.
    const nowForFilter = new Date();
    if (filter.status === 'EXPIRED') {
      where.OR = [{ status: 'EXPIRED' }, { status: 'PENDING', expiresAt: { lt: nowForFilter } }];
    } else if (filter.status === 'PENDING') {
      where.status = 'PENDING';
      where.expiresAt = { gte: nowForFilter }; // 아직 살아 있는 대기만
    } else if (filter.status) {
      where.status = filter.status;
    }
    if (filter.method) where.method = filter.method;
    if (filter.from || filter.to) where.createdAt = { ...(filter.from ? { gte: filter.from } : {}), ...(filter.to ? { lte: filter.to } : {}) };
    const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);
    const offset = Math.max(filter.offset ?? 0, 0);
    const [rows, total] = await Promise.all([
      this.prisma.stepUpApproval.findMany({
        where, orderBy: { createdAt: 'desc' }, take: limit, skip: offset,
        select: { id: true, userId: true, action: true, resourceId: true, status: true, method: true, createdAt: true, approvedAt: true, expiresAt: true },
      }),
      this.prisma.stepUpApproval.count({ where }),
    ]);
    // 승인자(의사) 이름 일괄 조회 + 환자 컨텍스트
    const userIds = [...new Set(rows.map((r) => r.userId))];
    const users = await this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, familyName: true, givenName: true, department: true } });
    const byUser = new Map(users.map((u) => [u.id, u]));
    const withCtx = await this.withContext(rows);
    const now = new Date();
    return {
      total, limit, offset,
      rows: withCtx.map((r) => {
        const u = byUser.get(r.userId);
        return {
          ...r,
          status: r.status === 'PENDING' && r.expiresAt < now ? 'EXPIRED' : r.status,
          staff: u ? `${u.familyName ?? ''}${u.givenName ?? ''}` : '(알 수 없음)',
          department: u?.department ?? null,
        };
      }),
    };
  }

  private async owned(userId: string, requestId: string) {
    const appr = await this.prisma.stepUpApproval.findUnique({ where: { id: requestId } });
    if (!appr || appr.userId !== userId) throw new NotFoundException('승인 요청을 찾을 수 없습니다.');
    return appr;
  }
}
