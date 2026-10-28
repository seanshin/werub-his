import { Injectable, Logger, Optional, NotFoundException, ForbiddenException, BadRequestException, MessageEvent, HttpStatus } from '@nestjs/common';
import { DomainException } from '../../common/errors/domain.exception';
import * as E from '../../common/errors/domain-error-codes';
import { ConfigService } from '@nestjs/config';
import { ConfigRuntimeService } from '../config/config-runtime.service';
import { Interval } from '@nestjs/schedule';
import { AuditAction } from '@prisma/client';
import { Subject, Observable } from 'rxjs';
import { finalize } from 'rxjs/operators';
import { readJitsiEnv, signJitsiToken } from '../../common/jitsi/jitsi-token';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { TranslationService } from '../i18n/translation.service';
import { AuditService } from '../audit/audit.service';
import { NotificationService } from '../notification/notification.service';
import { FcmPushService } from '../notification/fcm-push.service';
import { RedisService } from '../../infrastructure/redis/redis.service';
import { ConsultTeamService } from './consult-team.service';
import { clampAiMode, isConsultAutoReplyAllowed, type ConsultAiMode } from './consult-ai-gate';

type EmitScope = 'both' | 'staff';

@Injectable()
export class ConsultService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly t: TranslationService,
    private readonly config: ConfigService,
    private readonly teamSvc: ConsultTeamService,
    @Optional() private readonly audit?: AuditService,
    @Optional() private readonly notify?: NotificationService,
    @Optional() private readonly redis?: RedisService,
    @Optional() private readonly fcm?: FcmPushService,
    @Optional() private readonly cfg?: ConfigRuntimeService,
  ) {}

  /**
   * 상담 운영 정책 — 🔴 **설정 > 환경변수 > 상수** 순으로 읽는다.
   *
   * 종전엔 환경변수뿐이었고 **운영 .env 에 하나도 없어** 영업시간·SLA 임계가
   * 화면 어디에도 없는 코드 상수였다(형제인 `voc.sla.*` 는 설정 화면에 있다).
   * 🔴 환경변수 폴백을 남긴 이유: 이미 env 로 운영 중인 배포가 있으면 조용히 값이
   *    바뀌면 안 된다. **설정이 비어 있을 때만** env 를 본다.
   * 🔴 기본값은 전부 종전 동작과 같다.
   */
  private async policyNum(key: string, envKey: string, fallback: number, min: number, max: number): Promise<number> {
    const raw = await this.cfg?.get(key).catch(() => null);
    const fromCfg = typeof raw === 'number' ? raw : Number(raw);
    if (Number.isFinite(fromCfg) && fromCfg >= min && fromCfg <= max) return Math.floor(fromCfg);
    const fromEnv = Number(this.config.get(envKey));
    if (Number.isFinite(fromEnv) && fromEnv >= min && fromEnv <= max) return Math.floor(fromEnv);
    // 🔴 범위를 벗어난 값은 **조용히 쓰지 않는다** — 영업시간 25시는 상담을 영영 닫는다
    return fallback;
  }

  // ── 실시간 신호(SSE) — 세션별 Subject. 환자/직원 채널 분리(설계 D-1) ──
  private streams = new Map<string, Subject<MessageEvent>>();       // 환자(+직원 공통 신호)
  private staffStreams = new Map<string, Subject<MessageEvent>>();  // 직원 전용 신호
  private subscribe(map: Map<string, Subject<MessageEvent>>, id: string): Observable<MessageEvent> {
    let s = map.get(id);
    if (!s) { s = new Subject<MessageEvent>(); map.set(id, s); }
    const subj = s;
    return subj.asObservable().pipe(finalize(() => {
      if (!subj.observed) { subj.complete(); map.delete(id); }
    }));
  }
  /** 환자 SSE */
  getStream(id: string): Observable<MessageEvent> { return this.subscribe(this.streams, id); }
  /** 직원 SSE(전용 신호 포함) */
  getStaffStream(id: string): Observable<MessageEvent> { return this.subscribe(this.staffStreams, id); }
  /** 신호 emit — scope='both'(환자+직원) | 'staff'(직원만). 내용 미전송(type 힌트만). */
  private emit(id: string, scope: EmitScope = 'both', type = 'message') {
    const payload = { data: { t: Date.now(), type } } as MessageEvent;
    this.staffStreams.get(id)?.next(payload);
    if (scope === 'both') this.streams.get(id)?.next(payload);
  }

  // ── 🔴 AI 자동응답 게이트(consult-ai-gate.ts 가 규약 정본) ──
  /** 유효 AI 모드 — 저장값이 AUTO 여도 게이트가 꺼져 있으면 SUGGEST 로 내려간다. */
  private async effectiveAiMode(stored: string | null | undefined): Promise<ConsultAiMode> {
    return clampAiMode(stored, await isConsultAutoReplyAllowed(this.prisma));
  }

  // ── 1:1 화상(Jitsi 재사용) ──
  // 🔴 서명 정본은 `common/jitsi/jitsi-token.ts` 하나다(2026-09-21 · P12 — 종전엔 telehealth·consult·remote-consultation
  //    세 곳이 각자 payload 와 기본값을 적고 있었고 consult 만 context.user.email·avatar 가 빠져 있었다).
  private buildJitsiToken(opts: { roomName: string; userName: string; userId: string; isModerator: boolean }) {
    const env = readJitsiEnv({ get: (k) => this.config.get<string>(k) });
    if (!env) throw new BadRequestException('JITSI_JWT_SECRET 미설정');
    return signJitsiToken(env, opts);
  }

  /** 화상 시작/참가 — 세션 룸 부여 후 참가자별 토큰 발급 */
  async startVideo(id: string, party: 'PATIENT' | 'STAFF', userName: string, userId: string) {
    const s = await this.prisma.consultSession.findUnique({ where: { id } });
    if (!s) throw new NotFoundException('상담 세션 없음');
    let room = s.jitsiRoom;
    if (!room) {
      room = `consult-${id.replace(/-/g, '').slice(0, 20)}`;
      await this.prisma.consultSession.update({ where: { id }, data: { jitsiRoom: room, videoStartedAt: new Date(), status: 'ACTIVE' } });
    }
    const token = this.buildJitsiToken({ roomName: room, userName, userId, isModerator: party === 'STAFF' });
    return { room, token };
  }

  /** 환자의 열린 세션 조회/생성 — category 라우팅 + 팀 기본 AI모드 상속 */
  async openSession(patientId: string, locale = 'ko', category?: string) {
    const existing = await this.prisma.consultSession.findFirst({
      where: { patientId, status: { not: 'CLOSED' } },
      orderBy: { createdAt: 'desc' },
    });
    if (existing) {
      if (locale && existing.locale !== locale) {
        return this.prisma.consultSession.update({ where: { id: existing.id }, data: { locale } });
      }
      return existing;
    }
    const cat = category || 'GENERAL';
    const teamId = await this.teamSvc.routeTeam(cat, locale);
    // 🔴 종전엔 팀 미지정 시 'AUTO' 로 태어났다(= 사람 검토 없이 환자에게 AI 답변 전송).
    //    스키마 기본값(AUTO)에 기대지 않고 **항상 명시 지정**하며, AUTO 는 게이트가 켜졌을 때만 AUTO 다.
    let storedMode: string | null = null;
    if (teamId) {
      const team = await this.prisma.consultTeam.findUnique({ where: { id: teamId }, select: { defaultAiMode: true } });
      storedMode = team?.defaultAiMode ?? null;
    }
    const aiMode = await this.effectiveAiMode(storedMode);
    const session = await this.prisma.consultSession.create({ data: { patientId, locale, status: 'OPEN', category: cat, teamId, aiMode } });
    // D3: 신규 세션 인입 시 담당 팀 ONLINE 상담원에게 알림(종전 인입 알림 부재 봉합)
    void this.notifyNewSession(session.id, teamId).catch(() => undefined);
    return session;
  }

  /** D3: 신규 상담 세션 인입 알림 — 팀 ONLINE 상담원(팀 미지정 시 전체 ONLINE). notifyLead 패턴 준용 */
  private async notifyNewSession(sessionId: string, teamId: string | null) {
    const agents = await this.prisma.consultAgent.findMany({
      where: { status: 'ONLINE', ...(teamId ? { teamId } : {}) },
      select: { userId: true },
    });
    for (const a of agents) {
      const n = await this.notify?.create(a.userId, { type: 'CONSULT_NEW', title: '새 상담 요청', message: '상담실에 새 문의가 접수되었습니다.', severity: 'INFO', refType: 'ConsultSession', refId: sessionId });
      if (n) this.notify?.pushNotification(a.userId, { id: n.id, type: 'CONSULT_NEW', title: '새 상담 요청', message: '상담실에 새 문의가 접수되었습니다.', severity: 'INFO', refType: 'ConsultSession', refId: sessionId });
    }
  }

  /** 세션 팀의 ONLINE 상담원 수(D1: 대기표시 vs 비동기 폴백 판단용) */
  private async onlineAgentCount(teamId: string | null): Promise<number> {
    return this.prisma.consultAgent.count({ where: { status: 'ONLINE', ...(teamId ? { teamId } : {}) } });
  }

  private async ensure(id: string, patientId: string) {
    const s = await this.prisma.consultSession.findUnique({ where: { id } });
    if (!s) throw new NotFoundException('상담 세션 없음');
    if (s.patientId !== patientId) throw new ForbiddenException('본인 상담만 접근 가능');
    return s;
  }

  /** 환자 화상 시작 — 본인 확인 + 이름 조회 */
  async patientVideo(id: string, patientId: string) {
    await this.ensure(id, patientId);
    const p = await this.prisma.patient.findUnique({ where: { id: patientId }, select: { familyName: true, givenName: true } });
    return this.startVideo(id, 'PATIENT', p ? `${p.familyName}${p.givenName}` : '환자', patientId);
  }

  async listMessages(id: string, patientId: string) {
    await this.ensure(id, patientId);
    // 환자 격리: INTERNAL(내부노트) 제외, 직원 발신은 'STAFF'로 정규화(LEAD 토큰 비노출·개인정보 미반환)
    const msgs = await this.prisma.consultMessage.findMany({ where: { sessionId: id, visibility: 'PATIENT' }, orderBy: { createdAt: 'asc' } });
    return msgs.map((m) => ({
      id: m.id,
      sender: m.sender === 'PATIENT' || m.sender === 'AI' ? m.sender : 'STAFF',
      content: m.content, attachmentUrl: m.attachmentUrl, createdAt: m.createdAt,
    }));
  }

  /**
   * 상담 영업시간 여부 (기본 평일 09~18시, 서버시각).
   * 설정 `voc.consult.hourStart`/`hourEnd` → env `CONSULT_HOUR_START/END` → 상수 순.
   */
  async serviceOnline(): Promise<boolean> {
    const now = new Date();
    const day = now.getDay(); // 0=일 ~ 6=토
    const hour = now.getHours();
    const start = await this.policyNum('voc.consult.hourStart', 'CONSULT_HOUR_START', 9, 0, 23);
    const end = await this.policyNum('voc.consult.hourEnd', 'CONSULT_HOUR_END', 18, 1, 24);
    // 🔴 시작 ≥ 종료면 설정이 모순이다 — 상담을 영영 닫지 않고 종전 동작으로 돌아간다
    if (start >= end) return day >= 1 && day <= 5 && hour >= 9 && hour < 18;
    return day >= 1 && day <= 5 && hour >= start && hour < end;
  }

  /** 세션 상태/평가/대기위치/영업여부 조회(환자) */
  async getSessionInfo(id: string, patientId: string) {
    const s = await this.ensure(id, patientId);
    let waitingPosition = 0;
    if (s.status === 'OPEN' && !s.assigneeId) {
      waitingPosition = await this.prisma.consultSession.count({
        where: { status: 'OPEN', assigneeId: null, createdAt: { lte: s.createdAt } },
      });
    }
    const onlineAgents = await this.onlineAgentCount(s.teamId);
    // D1/D2: 상담원 실시간 연결 가능 여부 — 온라인 상담원 0명이거나 영업시간 외면 비동기(문의) 폴백 안내
    const online = await this.serviceOnline();
    const liveAvailable = onlineAgents > 0 && online;
    return { id: s.id, status: s.status, locale: s.locale, rating: s.rating, assigned: !!s.assigneeId, waitingPosition, serviceOnline: online, onlineAgents, liveAvailable };
  }

  /**
   * 동시성 안전 배정(W-9) — 상담원 단위 advisory xact lock으로 capacity 검증과 배정을 한 트랜잭션에 원자화.
   * 같은 상담원에 대한 동시 claim/assign을 직렬화 → maxConcurrent 엄격 보장(TOCTOU 제거).
   * requireUnassigned=true(claim): 미배정/본인 행만. false(assign/transfer): 강제.
   * @returns 'OK' | 'TAKEN'(이미 타인 담당) | 'FULL'(상한 초과)
   */
  private async assignWithCapacity(sessionId: string, agentUserId: string, requireUnassigned: boolean): Promise<'OK' | 'TAKEN' | 'FULL'> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${agentUserId}))`;
      const agent = await tx.consultAgent.findUnique({ where: { userId: agentUserId } });
      // 본인 세션 제외 활성 담당 수 — 이 세션을 더했을 때 상한 초과면 거부
      const active = await tx.consultSession.count({ where: { assigneeId: agentUserId, status: 'ACTIVE', id: { not: sessionId } } });
      if (agent && active >= agent.maxConcurrent) return 'FULL';
      const where = requireUnassigned
        ? { id: sessionId, OR: [{ assigneeId: null }, { assigneeId: agentUserId }] }
        : { id: sessionId };
      const res = await tx.consultSession.updateMany({ where, data: { assigneeId: agentUserId, status: 'ACTIVE' } });
      return res.count === 0 ? 'TAKEN' : 'OK';
    });
  }

  /** 직원 담당 배정(claim) — 미배정 세션만, maxConcurrent 원자 검증(W-9) */
  async claim(id: string, staffId: string) {
    const s = await this.prisma.consultSession.findUnique({ where: { id } });
    if (!s) throw new NotFoundException('상담 세션 없음');
    if (s.assigneeId && s.assigneeId !== staffId) throw new BadRequestException({ code: 'CONSULT_ALREADY_CLAIMED', message: '이미 다른 상담원이 담당 중' });
    const r = await this.assignWithCapacity(id, staffId, true);
    if (r === 'FULL') throw new BadRequestException({ code: 'CONSULT_AGENT_FULL', message: '동시 상담 상한 도달' });
    if (r === 'TAKEN') throw new BadRequestException({ code: 'CONSULT_ALREADY_CLAIMED', message: '이미 다른 상담원이 담당 중' });
    this.emit(id, 'both', 'assigned');
    return { ok: true };
  }

  /** 팀장 배정/재배정 — 지정 상담원에게(capacity 원자 검증·W-9, 대상 팀 일치 검증) */
  async assign(id: string, agentUserId: string, byUserId: string, ctx?: { teamId?: string | null; isAdmin?: boolean }) {
    const s = await this.prisma.consultSession.findUnique({ where: { id } });
    if (!s) throw new NotFoundException('상담 세션 없음');
    const agent = await this.prisma.consultAgent.findUnique({ where: { userId: agentUserId } });
    if (!agent) throw new BadRequestException('대상이 상담원이 아닙니다');
    // 팀장은 자기 팀 세션·자기 팀 상담원에게만 배정(ADMIN 예외)
    if (ctx && !ctx.isAdmin && agent.teamId !== s.teamId) throw new BadRequestException('대상 상담원이 해당 팀이 아닙니다');
    const r = await this.assignWithCapacity(id, agentUserId, false);
    if (r === 'FULL') throw new BadRequestException({ code: 'CONSULT_AGENT_FULL', message: '대상 상담원 동시 상한 도달' });
    void this.recordAudit(byUserId, id, 'CONSULT_ASSIGN', { assigneeId: { old: s.assigneeId, new: agentUserId } });
    this.emit(id, 'both', 'assigned');
    return { ok: true };
  }

  /**
   * 부서(팀) 큐 이관 — 기획 portal-chat-consultation FR-05 "라우팅(부서)" 중 **사람이 옮기는 경로**.
   * 🔴 (2026-09-14) 종전엔 환자가 고른 분류로 **개설 시 한 번만** 팀이 정해졌고, 잘못 들어온 문의(예: 수납 문의가 검진 팀)를
   *    다른 부서 큐로 옮길 수단이 없었다(담당 이관 `transfer` 는 팀장 본인 인수일 뿐 큐는 그대로).
   * - 자동 분류는 하지 않는다: 기획서의 라운드로빈·분류 규칙은 운영 정책이 정해지지 않았다 — 팀장/ADMIN 이 대상 팀을 **고른다**.
   * - 옮기면 이전 팀 담당·팀장 에스컬레이션 대상은 해제한다(이전 팀 사람이 계속 쥐고 있으면 새 큐에서 아무도 못 집는다).
   * - 이관 사실은 직원 전용 노트(INTERNAL)와 감사에 남긴다 — 환자 화면에는 나가지 않는다.
   */
  async routeToTeam(id: string, targetTeamId: string, byUserId: string, opts: { category?: string; reason?: string } = {}) {
    const s = await this.prisma.consultSession.findUnique({ where: { id } });
    if (!s) throw new NotFoundException('상담 세션 없음');
    const team = await this.prisma.consultTeam.findUnique({ where: { id: targetTeamId }, select: { id: true, active: true } });
    if (!team || !team.active) {
      throw new DomainException(E.CONSULT_ROUTE_TEAM_INVALID, '이관할 팀이 없거나 비활성입니다', HttpStatus.BAD_REQUEST, { teamId: targetTeamId });
    }
    const nextCategory = opts.category ?? s.category;
    if (s.teamId === targetTeamId && nextCategory === s.category) return { ok: true, changed: false };
    await this.prisma.consultSession.update({
      where: { id },
      data: {
        teamId: targetTeamId,
        category: nextCategory,
        assigneeId: null,
        escalatedToId: null,
        leadEscalatedAt: null,
        escalationReason: null,
      },
    });
    const note = opts.reason?.trim() ? opts.reason.trim().slice(0, 300) : '부서 큐 이관(사유 미입력)';
    await this.prisma.consultMessage.create({ data: { sessionId: id, sender: 'LEAD', senderId: byUserId, content: note, contentKo: note, visibility: 'INTERNAL', lang: 'ko' } });
    void this.recordAudit(byUserId, id, 'CONSULT_ROUTE', {
      teamId: { old: s.teamId, new: targetTeamId },
      category: { old: s.category, new: nextCategory },
      assigneeId: { old: s.assigneeId, new: null },
    });
    void this.notifyNewSession(id, targetTeamId).catch((err: Error) => this.logger.warn(`consult route notify failed session=${id}: ${err.message}`));
    this.emit(id, 'staff', 'routed');
    return { ok: true, changed: true };
  }

  /** 세션 AI 모드 변경(AUTO/SUGGEST/OFF) */
  async setAiMode(id: string, mode: string, byUserId: string) {
    if (!['AUTO', 'SUGGEST', 'OFF'].includes(mode)) throw new BadRequestException('AI 모드는 AUTO/SUGGEST/OFF');
    // 🔴 조용히 강등하지 않는다 — AUTO 로 바꾸려는데 게이트가 꺼져 있으면 **무엇이 막는지 말하고 거절**한다.
    //    (강등하면 화면은 AUTO 라 믿고, 실제로는 초안만 쌓인다 = 화면이 사실과 다르게 말한다)
    if (mode === 'AUTO' && !(await isConsultAutoReplyAllowed(this.prisma))) {
      throw new BadRequestException({
        code: 'CONSULT_AUTO_REPLY_DISABLED',
        message: `AI 자동응답(AUTO)은 사람 검토 없이 환자에게 전송되므로 기본 차단입니다. 시스템 설정 '${'consult.ai.autoReply'}' 를 켠 뒤 다시 시도하세요.`,
      });
    }
    const s = await this.prisma.consultSession.findUnique({ where: { id } });
    if (!s) throw new NotFoundException('상담 세션 없음');
    await this.prisma.consultSession.update({ where: { id }, data: { aiMode: mode } });
    void this.recordAudit(byUserId, id, 'CONSULT_AIMODE', { aiMode: { old: s.aiMode, new: mode } });
    this.emit(id, 'staff', 'ai_mode');
    return { ok: true, aiMode: mode };
  }

  /** AI 초안 조회(SUGGEST) — 직원이 검토 후 전송. */
  async getAiDraft(id: string) {
    let draft: string | null = null;
    try { draft = (await this.redis?.get(`consult:draft:${id}`)) ?? null; } catch { /* Redis 실패 */ }
    // 🔴 감사 귀속(§ai-phi-audit-coverage) — 이 조회는 이 환자의 상담 초안을 본 것이다.
    //    응답이 patientId 를 들지 않으면 열람이 환자별 접근이력에서 빠진다. 못 찾으면 null(찾은 척하지 않는다).
    const session = await this.prisma.consultSession.findUnique({ where: { id }, select: { patientId: true } });
    return { draft, patientId: session?.patientId ?? null };
  }

  private async recordAudit(userId: string, sessionId: string, op: string, changes: Record<string, { old: unknown; new: unknown }>) {
    try {
      await this.audit?.log({ userId, action: 'UPDATE' as AuditAction, resourceType: 'ConsultSession', resourceId: sessionId, changes: { op: { old: null, new: op }, ...changes } });
    } catch (err) {
      // 감사 실패가 업무 흐름을 막지 않음 — 다만 조용히 사라지게 두지 않는다
      this.logger.warn(`consult audit write failed session=${sessionId} op=${op}: ${(err as Error).message}`);
    }
  }

  /** 만족도 평가(환자, 종료 세션) */
  async rate(id: string, patientId: string, rating: number, comment?: string) {
    await this.ensure(id, patientId);
    await this.prisma.consultSession.update({ where: { id }, data: { rating, ratingComment: comment ?? null } });
    return { ok: true };
  }

  /** 첨부 메시지(환자) — 업로드된 URL을 메시지로 */
  async addAttachment(id: string, patientId: string, url: string) {
    await this.ensure(id, patientId);
    const m = await this.prisma.consultMessage.create({ data: { sessionId: id, sender: 'PATIENT', content: '[첨부]', attachmentUrl: url, lang: 'ko' } });
    await this.prisma.consultSession.update({ where: { id }, data: { updatedAt: new Date() } }).catch(() => {});
    this.emit(id);
    return { id: m.id, attachmentUrl: url };
  }

  /** 환자 메시지 수신 → 즉시 저장 후 반환. 번역·AI 1차 응답은 백그라운드(LLM 느림 → 폴링으로 수신). */
  async patientMessage(id: string, patientId: string, content: string) {
    const s = await this.ensure(id, patientId);
    const locale = s.locale || 'ko';
    const text = (content ?? '').trim();
    if (!text) throw new NotFoundException('빈 메시지');

    const pmsg = await this.prisma.consultMessage.create({ data: { sessionId: id, sender: 'PATIENT', content: text, lang: locale } });
    await this.prisma.consultSession.update({ where: { id }, data: { updatedAt: new Date() } }).catch(() => {});
    this.emit(id);
    void this.processAsync(id, locale, text, pmsg.id); // 응답 대기 안 함
    return { ok: true, patientMessageId: pmsg.id };
  }

  // ── 직원 상담 데스크 ──
  /**
   * 직원 세션 접근 스코프 검증(IDOR 방지) — 자기 팀 세션만(ADMIN 예외).
   * 모든 직원 세션 EP 진입부에서 호출. teamId 미일치/세션없음/팀없음 → 거부.
   */
  async assertScope(sessionId: string, ctx: { teamId?: string | null; isAdmin?: boolean }): Promise<void> {
    if (ctx.isAdmin) return;
    const s = await this.prisma.consultSession.findUnique({ where: { id: sessionId }, select: { teamId: true } });
    if (!s) throw new NotFoundException('상담 세션 없음');
    if (s.teamId && ctx.teamId && s.teamId === ctx.teamId) return;
    throw new ForbiddenException({ code: 'CONSULT_SCOPE', message: '담당 팀의 상담만 접근할 수 있습니다' });
  }

  /** 세션 인박스 — scope(mine/team/unassigned/all) + 팀 필터 */
  async listSessions(opts: { status?: string; scope?: string; userId?: string; teamId?: string | null; isAdmin?: boolean } = {}) {
    const { status, scope = 'all', userId, teamId, isAdmin } = opts;
    const where: Record<string, unknown> = {};
    if (status && status !== 'ALL') where.status = status;
    else where.status = { not: 'CLOSED' };
    if (scope === 'mine' && userId) where.assigneeId = userId;
    else if (scope === 'unassigned') where.assigneeId = null;
    // 팀 스코프: ADMIN 아니면 본인 팀으로 제한(team/unassigned/all 공통)
    if (!isAdmin && teamId) where.teamId = teamId;
    const sessions = await this.prisma.consultSession.findMany({
      where, orderBy: { updatedAt: 'desc' }, take: 100,
      include: { messages: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    const patientIds = [...new Set(sessions.map((s) => s.patientId))];
    const patients = await this.prisma.patient.findMany({ where: { id: { in: patientIds } }, select: { id: true, mrn: true, familyName: true, givenName: true } });
    const pmap = new Map(patients.map((p) => [p.id, p]));
    const now = Date.now();
    // 유효 AI 모드를 돌려준다 — 저장값이 AUTO 여도 게이트가 꺼졌으면 실제 동작은 SUGGEST 다(화면이 사실을 말한다).
    const autoAllowed = await isConsultAutoReplyAllowed(this.prisma);
    return sessions.map((s) => {
      const last = s.messages[0];
      const p = pmap.get(s.patientId);
      const waitingForHuman = last && last.sender === 'PATIENT';
      const aiMode = clampAiMode(s.aiMode, autoAllowed);
      return {
        id: s.id, status: s.status, locale: s.locale, category: s.category, teamId: s.teamId, aiMode,
        aiModeStored: s.aiMode, aiModeGateOff: aiMode !== s.aiMode,
        assigneeId: s.assigneeId, updatedAt: s.updatedAt,
        priority: s.priority, escalationLevel: s.escalationLevel, escalatedAt: s.escalatedAt,
        leadEscalatedAt: s.leadEscalatedAt, escalatedToId: s.escalatedToId,
        waitingSec: waitingForHuman ? Math.round((now - new Date(last.createdAt).getTime()) / 1000) : 0,
        patient: p ? { mrn: p.mrn, name: `${p.familyName}${p.givenName}` } : null,
        lastMessage: last ? { sender: last.sender, content: last.contentKo ?? last.content, createdAt: last.createdAt } : null,
      };
    });
  }

  /** 직원용 메시지(한국어 우선 표시) — INTERNAL 노트 포함, 발신 직원명 조인 */
  async staffMessages(id: string) {
    const msgs = await this.prisma.consultMessage.findMany({ where: { sessionId: id }, orderBy: { createdAt: 'asc' } });
    const sids = [...new Set(msgs.map((m) => m.senderId).filter(Boolean) as string[])];
    const users = sids.length ? await this.prisma.user.findMany({ where: { id: { in: sids } }, select: { id: true, familyName: true, givenName: true } }) : [];
    const umap = new Map(users.map((u) => [u.id, `${u.familyName ?? ''}${u.givenName ?? ''}`.trim()]));
    return msgs.map((m) => ({
      id: m.id, sender: m.sender, visibility: m.visibility,
      senderName: m.senderId ? (umap.get(m.senderId) ?? null) : null,
      ko: m.contentKo ?? m.content, original: m.content, attachmentUrl: m.attachmentUrl, lang: m.lang, createdAt: m.createdAt,
    }));
  }

  /** 직원 답변(한국어 입력 → 환자 언어 번역 저장) — 자기 담당 갱신 */
  async staffReply(id: string, staffId: string, contentKo: string) {
    return this.replyCore(id, staffId, 'STAFF', contentKo, true);
  }

  /** 팀장 공동응답 — 담당(assignee) 보존(D-2). 환자엔 sender=LEAD(listMessages가 '상담팀'으로 정규화) */
  async leadCoReply(id: string, leadId: string, contentKo: string) {
    return this.replyCore(id, leadId, 'LEAD', contentKo, false);
  }

  /**
   * 환자 응답 코어. role=STAFF|LEAD, reassign=true면 assigneeId를 발신자로 갱신.
   * SLA 에스컬레이션만 리셋(lead 필드 불간섭·R2), firstResponseAt는 첫 직원응답 시 set(AI 제외).
   */
  private async replyCore(id: string, staffId: string, role: 'STAFF' | 'LEAD', contentKo: string, reassign: boolean) {
    const s = await this.prisma.consultSession.findUnique({ where: { id } });
    if (!s) throw new NotFoundException('상담 세션 없음');
    const text = (contentKo ?? '').trim();
    if (!text) throw new NotFoundException('빈 메시지');
    const locale = s.locale || 'ko';
    // 🔴 **번역 실패는 "번역됨"이 아니다.** 폴백이면 `content` 는 한국어 원문인데
    //    종전에는 `lang: locale`(예: 'ru')로 적었다 — **컬럼이 거짓말했다.**
    //    환자는 한국어를 받고, 원장은 러시아어를 보냈다고 기록했다.
    const tr = locale === 'ko' ? null : await this.t.translate(text, locale, 'ko');
    const content = tr ? tr.translated : text;
    const lang = tr && !tr.fallback ? locale : 'ko';
    await this.prisma.consultMessage.create({ data: { sessionId: id, sender: role, senderId: staffId, content, contentKo: text, lang, visibility: 'PATIENT' } });
    try { await this.redis?.del(`consult:draft:${id}`); } catch { /* 초안 정리 실패 무시 */ }
    await this.prisma.consultSession.update({
      where: { id },
      data: {
        status: 'ACTIVE', updatedAt: new Date(),
        ...(reassign ? { assigneeId: staffId } : {}),
        priority: 'NORMAL', escalationLevel: 0, escalatedAt: null,
        firstResponseAt: s.firstResponseAt ?? new Date(),
      },
    });
    this.emit(id);
    return { ok: true };
  }

  // ── 팀장 에스컬레이션 & 협업(P2) ──

  /** 상담원 → 팀장 에스컬레이션(사유). SLA(escalationLevel)와 분리된 leadEscalatedAt 사용(R2). */
  async escalate(id: string, agentId: string, reason: string) {
    const s = await this.prisma.consultSession.findUnique({ where: { id } });
    if (!s) throw new NotFoundException('상담 세션 없음');
    if (s.assigneeId && s.assigneeId !== agentId) throw new BadRequestException('본인 담당 상담만 에스컬레이션 가능');
    // 팀 LEAD 선정: 같은 팀 LEAD 중 ONLINE 우선, 없으면 단일 대상 없이 팀 전체 큐에 노출(escalatedToId=null·D-5)
    let escalatedToId: string | null = null;
    if (s.teamId) {
      const leads = await this.prisma.consultAgent.findMany({ where: { teamId: s.teamId, role: 'LEAD' } });
      escalatedToId = (leads.find((l) => l.status === 'ONLINE') ?? leads[0])?.userId ?? null;
    }
    await this.prisma.consultSession.update({
      where: { id },
      data: { leadEscalatedAt: new Date(), escalatedToId, escalationReason: (reason ?? '').slice(0, 300), priority: s.priority === 'NORMAL' ? 'HIGH' : s.priority },
    });
    void this.recordAudit(agentId, id, 'CONSULT_ESCALATE', { escalatedToId: { old: null, new: escalatedToId }, reason: { old: null, new: reason } });
    this.emit(id, 'staff', 'escalated');
    void this.notifyLead(escalatedToId, s.teamId, id, reason);
    return { ok: true, escalatedToId };
  }

  /** 팀장 에스컬레이션 해제 — lead 필드만 클리어(SLA 불간섭). */
  async resolveEscalation(id: string, byUserId: string) {
    const s = await this.prisma.consultSession.findUnique({ where: { id } });
    if (!s) throw new NotFoundException('상담 세션 없음');
    await this.prisma.consultSession.update({ where: { id }, data: { leadEscalatedAt: null, escalatedToId: null, escalationReason: null } });
    void this.recordAudit(byUserId, id, 'CONSULT_RESOLVE_ESCALATION', { leadEscalatedAt: { old: s.leadEscalatedAt, new: null } });
    this.emit(id, 'staff', 'escalation_resolved');
    return { ok: true };
  }

  /** 내부 노트(직원 전용·환자 비노출). visibility=INTERNAL, staff SSE만. */
  async addNote(id: string, userId: string, role: string, content: string) {
    const s = await this.prisma.consultSession.findUnique({ where: { id } });
    if (!s) throw new NotFoundException('상담 세션 없음');
    const text = (content ?? '').trim();
    if (!text) throw new BadRequestException('빈 노트');
    const sender = role === 'LEAD' || role === 'ADMIN' ? 'LEAD' : 'STAFF';
    await this.prisma.consultMessage.create({ data: { sessionId: id, sender, senderId: userId, content: text, contentKo: text, visibility: 'INTERNAL', lang: 'ko' } });
    this.emit(id, 'staff', 'note');
    return { ok: true };
  }

  /** 이관 — 담당을 팀장(본인)으로 전환(capacity 원자 검증) + 에스컬레이션 해제. */
  async transfer(id: string, leadUserId: string) {
    const s = await this.prisma.consultSession.findUnique({ where: { id } });
    if (!s) throw new NotFoundException('상담 세션 없음');
    const r = await this.assignWithCapacity(id, leadUserId, false);
    if (r === 'FULL') throw new BadRequestException({ code: 'CONSULT_AGENT_FULL', message: '동시 상담 상한 도달' });
    await this.prisma.consultSession.update({ where: { id }, data: { leadEscalatedAt: null, escalatedToId: null, escalationReason: null } });
    void this.recordAudit(leadUserId, id, 'CONSULT_TRANSFER', { assigneeId: { old: s.assigneeId, new: leadUserId } });
    this.emit(id, 'both', 'transferred');
    return { ok: true };
  }

  /** 에스컬레이션 알림 — 대상 팀장(없으면 팀 전체 LEAD)에게 인앱 알림. */
  private async notifyLead(escalatedToId: string | null, teamId: string | null, sessionId: string, reason: string) {
    try {
      let targets: string[] = [];
      if (escalatedToId) targets = [escalatedToId];
      else if (teamId) targets = (await this.prisma.consultAgent.findMany({ where: { teamId, role: 'LEAD' }, select: { userId: true } })).map((a) => a.userId);
      for (const uid of targets) {
        const n = await this.notify?.create(uid, { type: 'CONSULT_ESCALATION', title: '상담 에스컬레이션', message: reason || '상담원이 팀장 지원을 요청했습니다.', severity: 'WARNING', refType: 'ConsultSession', refId: sessionId });
        if (n) this.notify?.pushNotification(uid, { id: n.id, type: 'CONSULT_ESCALATION', title: '상담 에스컬레이션', message: reason || '팀장 지원 요청', severity: 'WARNING', refType: 'ConsultSession', refId: sessionId });
        // FCM: 팀장 등록 단말로 푸시(미설정/미등록 시 no-op)
        const devices = await this.prisma.staffDevice.findMany({ where: { userId: uid, status: 'ACTIVE', fcmToken: { not: null } }, select: { fcmToken: true } });
        const tokens = devices.map((d) => d.fcmToken!).filter(Boolean);
        if (tokens.length) {
          void this.fcm?.sendToTokens(tokens, { title: '상담 에스컬레이션', body: reason || '상담원이 팀장 지원을 요청했습니다.', data: { type: 'CONSULT_ESCALATION', sessionId } })
            .catch(() => { /* 푸시 실패 무시 */ });
        }
      }
    } catch { /* 알림 실패가 업무를 막지 않음 */ }
  }

  // ── 미응답 SLA 에스컬레이션 ──
  private readonly logger = new Logger(ConsultService.name);

  /** 마지막 메시지가 환자(직원/AI 미응답)이고 SLA 초과 시 단계 상향. AI 자동응답이 있으면 last=AI라 제외됨. */
  @Interval(60000)
  async checkEscalations() {
    const warnSec = await this.policyNum('voc.consult.slaWarnSec', 'CONSULT_SLA_WARN_SEC', 300, 30, 86400);
    let escSec = await this.policyNum('voc.consult.slaEscalateSec', 'CONSULT_SLA_ESCALATE_SEC', 900, 30, 86400);
    // 🔴 상신 임계가 경고보다 작으면 경고 없이 바로 상신된다 — 모순이면 종전 동작으로 돌아간다
    if (escSec <= warnSec) escSec = Math.max(900, warnSec * 3);
    const now = Date.now();
    // 최근 활동 세션만(부하 최적화) — 오래 방치된 미응답은 이미 L2 도달 상태, 응답 시 updatedAt 갱신됨
    const since = new Date(now - 24 * 3600 * 1000);
    const sessions = await this.prisma.consultSession.findMany({
      where: { status: { not: 'CLOSED' }, updatedAt: { gte: since } },
      include: { messages: { orderBy: { createdAt: 'desc' }, take: 1 } },
      orderBy: { updatedAt: 'desc' },
      take: 500,
    }).catch(() => []);

    for (const s of sessions) {
      const last = s.messages[0];
      const waitingForHuman = last && last.sender === 'PATIENT';
      if (!waitingForHuman) {
        // 답변됨(AI/STAFF가 마지막) → 에스컬레이션 해제
        if (s.escalationLevel > 0) {
          await this.prisma.consultSession.update({ where: { id: s.id }, data: { priority: 'NORMAL', escalationLevel: 0, escalatedAt: null } }).catch(() => {});
          this.emit(s.id);
        }
        continue;
      }
      const waitSec = (now - new Date(last.createdAt).getTime()) / 1000;
      let level = 0, priority = 'NORMAL';
      if (waitSec >= escSec) { level = 2; priority = 'URGENT'; }
      else if (waitSec >= warnSec) { level = 1; priority = 'HIGH'; }
      if (level > s.escalationLevel) {
        // level 2: 담당 해제(미들로 회수해 재배정 유도)
        const data: Record<string, unknown> = { priority, escalationLevel: level, escalatedAt: new Date() };
        if (level === 2 && s.assigneeId) data.assigneeId = null;
        await this.prisma.consultSession.update({ where: { id: s.id }, data }).catch(() => {});
        this.emit(s.id);
        this.logger.warn(`상담 에스컬레이션 L${level}(${priority}) session=${s.id} 대기 ${Math.round(waitSec)}s`);
      }
    }
  }

  /** 에스컬레이션된 세션 목록(직원 데스크 알림) */
  async listEscalations() {
    const sessions = await this.prisma.consultSession.findMany({
      where: { status: { not: 'CLOSED' }, escalationLevel: { gt: 0 } },
      include: { messages: { orderBy: { createdAt: 'desc' }, take: 1 } },
      orderBy: [{ escalationLevel: 'desc' }, { escalatedAt: 'asc' }],
    });
    const pids = [...new Set(sessions.map((s) => s.patientId))];
    const patients = await this.prisma.patient.findMany({ where: { id: { in: pids } }, select: { id: true, mrn: true, familyName: true, givenName: true } });
    const pmap = new Map(patients.map((p) => [p.id, p]));
    const now = Date.now();
    return sessions.map((s) => {
      const last = s.messages[0];
      const p = pmap.get(s.patientId);
      return {
        id: s.id, status: s.status, priority: s.priority, escalationLevel: s.escalationLevel, escalatedAt: s.escalatedAt,
        assigneeId: s.assigneeId, locale: s.locale,
        waitingSec: last ? Math.round((now - new Date(last.createdAt).getTime()) / 1000) : null,
        patient: p ? { mrn: p.mrn, name: `${p.familyName}${p.givenName}` } : null,
        lastMessage: last ? { sender: last.sender, content: last.contentKo ?? last.content } : null,
      };
    });
  }

  async closeSession(id: string) {
    // 🔴 (2026-09-14) 종전 `.catch(() => {})` 뒤 스트림을 닫고 `{ ok: true }` — 종료 기록이 실패해도(없는 id 포함)
    //    "종료했다"고 말하고 세션은 열린 채 남았다. 없는 세션은 404, 그 밖의 실패는 전파한다(스트림은 건드리지 않는다).
    try {
      await this.prisma.consultSession.update({ where: { id }, data: { status: 'CLOSED' } });
    } catch (err) {
      if ((err as { code?: string })?.code === 'P2025') throw new NotFoundException('상담 세션을 찾을 수 없습니다');
      this.logger.error(`consult closeSession failed session=${id}: ${(err as Error).message}`);
      throw err;
    }
    // SSE 스트림 정리(환자·직원 채널)
    for (const map of [this.streams, this.staffStreams]) {
      const s = map.get(id);
      if (s) { s.complete(); map.delete(id); }
    }
    return { ok: true };
  }

  /** 팀장 콘솔 큐 — 팀 세션(에스컬 우선 정렬) + 상담원 보드(부하) */
  async leadQueue(opts: { teamId?: string | null; isAdmin?: boolean }) {
    const { teamId, isAdmin } = opts;
    const where: Record<string, unknown> = { status: { not: 'CLOSED' } };
    if (!isAdmin && teamId) where.teamId = teamId;
    const sessions = await this.prisma.consultSession.findMany({
      where, include: { messages: { orderBy: { createdAt: 'desc' }, take: 1 } }, take: 200,
    });
    const pids = [...new Set(sessions.map((s) => s.patientId))];
    const patients = await this.prisma.patient.findMany({ where: { id: { in: pids } }, select: { id: true, mrn: true, familyName: true, givenName: true } });
    const pmap = new Map(patients.map((p) => [p.id, p]));
    const now = Date.now();
    const rank = (s: typeof sessions[number]) =>
      (s.leadEscalatedAt ? 3_000_000 : 0) + s.escalationLevel * 1_000_000 +
      (s.messages[0]?.sender === 'PATIENT' ? Math.round((now - new Date(s.messages[0].createdAt).getTime()) / 1000) : 0);
    const autoAllowed = await isConsultAutoReplyAllowed(this.prisma);
    const queue = sessions
      .map((s) => {
        const last = s.messages[0];
        const p = pmap.get(s.patientId);
        const waiting = last && last.sender === 'PATIENT';
        const aiMode = clampAiMode(s.aiMode, autoAllowed);
        return {
          id: s.id, status: s.status, locale: s.locale, category: s.category, aiMode,
          aiModeStored: s.aiMode, aiModeGateOff: aiMode !== s.aiMode,
          assigneeId: s.assigneeId, priority: s.priority, escalationLevel: s.escalationLevel,
          leadEscalatedAt: s.leadEscalatedAt, escalationReason: s.escalationReason,
          waitingSec: waiting ? Math.round((now - new Date(last.createdAt).getTime()) / 1000) : 0,
          patient: p ? { mrn: p.mrn, name: `${p.familyName}${p.givenName}` } : null,
          lastMessage: last ? { sender: last.sender, content: last.contentKo ?? last.content } : null,
          _rank: rank(s),
        };
      })
      .sort((a, b) => b._rank - a._rank)
      .map(({ _rank, ...rest }) => rest);

    // 상담원 보드
    const agentWhere = !isAdmin && teamId ? { teamId } : {};
    const agents = await this.prisma.consultAgent.findMany({ where: agentWhere });
    const auids = agents.map((a) => a.userId);
    const users = await this.prisma.user.findMany({ where: { id: { in: auids } }, select: { id: true, familyName: true, givenName: true } });
    const umap = new Map(users.map((u) => [u.id, u]));
    const actives = await this.prisma.consultSession.groupBy({ by: ['assigneeId'], where: { assigneeId: { in: auids }, status: 'ACTIVE' }, _count: { _all: true } });
    const amap = new Map(actives.map((a) => [a.assigneeId, a._count._all]));
    const board = agents.map((a) => {
      const u = umap.get(a.userId);
      return {
        userId: a.userId, name: u ? `${u.familyName ?? ''}${u.givenName ?? ''}`.trim() : a.userId,
        role: a.role, status: a.status, maxConcurrent: a.maxConcurrent, activeCount: amap.get(a.userId) ?? 0,
      };
    });
    return { queue, board };
  }

  /** 상담 분석(P3) — 기간·팀별 지표: 세션수·종료율·평균 첫응답·만족도·AI비중·상담원별 처리. */
  async analytics(opts: { teamId?: string | null; isAdmin?: boolean; days?: number }) {
    const days = Math.min(Math.max(opts.days ?? 7, 1), 90);
    const since = new Date(Date.now() - days * 24 * 3600 * 1000);
    const teamFilter = !opts.isAdmin && opts.teamId ? { teamId: opts.teamId } : {};
    const where = { createdAt: { gte: since }, ...teamFilter };

    const sessions = await this.prisma.consultSession.findMany({
      where, select: { id: true, status: true, createdAt: true, firstResponseAt: true, rating: true, assigneeId: true },
    });
    const total = sessions.length;
    const closed = sessions.filter((s) => s.status === 'CLOSED').length;
    const responded = sessions.filter((s) => s.firstResponseAt);
    const avgFirstRespSec = responded.length
      ? Math.round(responded.reduce((a, s) => a + (new Date(s.firstResponseAt!).getTime() - new Date(s.createdAt).getTime()) / 1000, 0) / responded.length)
      : null;
    const rated = sessions.filter((s) => s.rating != null);
    const avgRating = rated.length ? Math.round((rated.reduce((a, s) => a + (s.rating ?? 0), 0) / rated.length) * 10) / 10 : null;

    // AI 비중: 기간 세션의 메시지 중 sender=AI 비율
    const ids = sessions.map((s) => s.id);
    let aiRatio: number | null = null;
    let aiMessages = 0;
    let totalMessages = 0;
    if (ids.length) {
      const msgGroups = await this.prisma.consultMessage.groupBy({ by: ['sender'], where: { sessionId: { in: ids } }, _count: { _all: true } });
      totalMessages = msgGroups.reduce((a, g) => a + g._count._all, 0);
      aiMessages = msgGroups.find((g) => g.sender === 'AI')?._count._all ?? 0;
      // 🔴 메시지 0건이면 비중은 0% 가 아니라 산출 불가(null) — 분모와 함께 내보낸다
      aiRatio = totalMessages ? Math.round((aiMessages / totalMessages) * 1000) / 10 : null; // %
    }

    // 상담원별 처리 세션수(담당 기준)
    const byAgent = await this.prisma.consultSession.groupBy({ by: ['assigneeId'], where: { ...where, assigneeId: { not: null } }, _count: { _all: true } });
    const auids = byAgent.map((a) => a.assigneeId!).filter(Boolean);
    const users = auids.length ? await this.prisma.user.findMany({ where: { id: { in: auids } }, select: { id: true, familyName: true, givenName: true } }) : [];
    const umap = new Map(users.map((u) => [u.id, `${u.familyName ?? ''}${u.givenName ?? ''}`.trim()]));
    const agents = byAgent.map((a) => ({ userId: a.assigneeId, name: umap.get(a.assigneeId!) ?? a.assigneeId, handled: a._count._all })).sort((x, y) => y.handled - x.handled);

    return {
      days, total, closed, open: sessions.filter((s) => s.status === 'OPEN').length, active: sessions.filter((s) => s.status === 'ACTIVE').length,
      // 🔴 (2026-09-17 L4) 세션 0 건이면 '종결률 0%'(=하나도 못 닫았다)가 아니라 산출 불가. total 이 분모다.
      closeRate: total ? Math.round((closed / total) * 1000) / 10 : null,
      avgFirstRespSec, avgRating, ratedCount: rated.length, aiRatio, aiMessages, totalMessages, agents,
    };
  }

  /** 자동 배분(P3·least-busy) — 미배정 팀 세션을 ONLINE·여유 상담원에 분배. */
  async autoAssign(opts: { teamId?: string | null; isAdmin?: boolean; byUserId: string }) {
    const teamFilter = !opts.isAdmin && opts.teamId ? { teamId: opts.teamId } : {};
    const pending = await this.prisma.consultSession.findMany({
      where: { status: { in: ['OPEN', 'ACTIVE'] }, assigneeId: null, ...teamFilter },
      orderBy: { createdAt: 'asc' }, take: 100,
    });
    if (!pending.length) return { assigned: 0 };
    const agents = await this.prisma.consultAgent.findMany({ where: { status: 'ONLINE', ...(!opts.isAdmin && opts.teamId ? { teamId: opts.teamId } : {}) } });
    if (!agents.length) return { assigned: 0, reason: 'NO_ONLINE_AGENT' };
    // 현재 부하
    const auids = agents.map((a) => a.userId);
    const actives = await this.prisma.consultSession.groupBy({ by: ['assigneeId'], where: { assigneeId: { in: auids }, status: 'ACTIVE' }, _count: { _all: true } });
    const load = new Map(actives.map((a) => [a.assigneeId, a._count._all]));
    let assigned = 0;
    for (const sess of pending) {
      // 여유 있는 상담원 중 least-busy 선택
      const cand = agents
        .map((a) => ({ a, used: load.get(a.userId) ?? 0 }))
        .filter((x) => x.used < x.a.maxConcurrent)
        .sort((x, y) => x.used - y.used)[0];
      if (!cand) break; // 모두 만석
      const r = await this.assignWithCapacity(sess.id, cand.a.userId, true);
      if (r === 'OK') { assigned++; load.set(cand.a.userId, (load.get(cand.a.userId) ?? 0) + 1); this.emit(sess.id, 'both', 'assigned'); }
    }
    if (assigned) void this.recordAudit(opts.byUserId, 'team', 'CONSULT_AUTO_ASSIGN', { assigned: { old: null, new: assigned } });
    return { assigned };
  }

  /** 문의 내용을 카테고리 코드로 분류(AI). 실패/불명확 시 null. */
  private async classifyCategory(textKo: string): Promise<string | null> {
    const prompt = `다음 병원 상담 문의를 아래 카테고리 중 하나로 분류해 코드만 한 단어로 답하세요.\n- INTERNATIONAL: 외국인/국제진료/통역/비자/해외\n- CHECKUP: 건강검진/검진예약/검진결과\n- BILLING: 수납/청구/영수증/보험/환불\n- GENERAL: 그 외 일반 안내\n\n문의: ${textKo}\n\n카테고리 코드:`;
    let out = '';
    try { out = (await this.t.complete(prompt, 20000, 8)).toUpperCase(); } catch { return null; }
    for (const c of ['INTERNATIONAL', 'CHECKUP', 'BILLING', 'GENERAL']) if (out.includes(c)) return c;
    return null;
  }

  /** 백그라운드: 직원용 한국어 번역(항상) + AI 1차 응답(aiMode=AUTO일 때만·설계 D-6) */
  private async processAsync(id: string, locale: string, text: string, pmsgId: string) {
    let contentKo = text;
    try {
      if (locale !== 'ko') {
        contentKo = (await this.t.translate(text, 'ko', locale)).translated;
        await this.prisma.consultMessage.update({ where: { id: pmsgId }, data: { contentKo } }).catch(() => {});
      }
    } catch { /* 번역 실패 시 원문 */ }

    // category AI 자동분류(opt-in CONSULT_AUTO_CLASSIFY=true) — 첫 환자 메시지 & 미분류(GENERAL)면 분류 후 재라우팅
    const autoClassifyCfg = await this.cfg?.get('voc.consult.autoClassify').catch(() => null);
    const autoClassify = autoClassifyCfg === true || autoClassifyCfg === 'true'
      || (autoClassifyCfg == null && String(this.config.get('CONSULT_AUTO_CLASSIFY') ?? '') === 'true');
    if (autoClassify) {
      try {
        const cur = await this.prisma.consultSession.findUnique({ where: { id }, select: { category: true } });
        const pcount = await this.prisma.consultMessage.count({ where: { sessionId: id, sender: 'PATIENT' } });
        if (pcount === 1 && (cur?.category ?? 'GENERAL') === 'GENERAL') {
          const cat = await this.classifyCategory(contentKo);
          if (cat && cat !== 'GENERAL') {
            const teamId = await this.teamSvc.routeTeam(cat, locale);
            await this.prisma.consultSession.update({ where: { id }, data: { category: cat, teamId } });
            this.emit(id, 'staff', 'category');
          }
        }
      } catch { /* 분류 실패 시 기본 유지 */ }
    }

    const prompt = `당신은 병원 "환자 상담실"의 안내 상담원입니다. 환자 문의에 한국어로 친절하고 간결하게(2~3문장) 답하세요. 예약·수납·검진·증명·길안내 등 행정 안내 위주이며, 진단·처방·치료 판단은 하지 말고 필요하면 "담당 부서/의료진 확인" 또는 "상담원 연결"을 권하세요.\n\n환자 문의: ${contentKo}\n\n상담원 답변:`;
    const FALLBACK = '문의 주셔서 감사합니다. 상담원이 확인 후 안내드리겠습니다. 빠른 처리는 진료시간 내 상담원 연결을 이용해 주세요.';

    // AI 게이트(설계 D-6): OFF=AI 생략, SUGGEST=초안만(Redis·미전송), AUTO=자동응답
    const sess = await this.prisma.consultSession.findUnique({ where: { id }, select: { aiMode: true } });
    // 🔴 실행 지점의 clamp — **이미 AUTO 로 저장된 기존 세션**도 게이트가 꺼져 있으면 자동 전송되지 않는다
    //    (DB 를 고치지 않고 위험이 멈춘다). 미상/조회실패는 SUGGEST(안전한 쪽).
    const aiMode = await this.effectiveAiMode(sess?.aiMode);
    if (aiMode === 'OFF') { this.emit(id); return; }
    if (aiMode === 'SUGGEST') {
      let draft = '';
      try { draft = await this.t.complete(prompt, 60000, 220); } catch { draft = FALLBACK; }
      try { await this.redis?.setex(`consult:draft:${id}`, 3600, draft); } catch { /* Redis 실패 무시 */ }
      this.emit(id, 'staff', 'ai_draft');
      return;
    }

    if (locale === 'ko') {
      // 한국어: 토큰 스트리밍 — AI 메시지를 만들고 누적하며 갱신(throttle) + SSE
      const aiMsg = await this.prisma.consultMessage.create({ data: { sessionId: id, sender: 'AI', content: '', contentKo: '', lang: locale } });
      this.emit(id);
      let last = 0;
      let replyKo = '';
      try {
        replyKo = await this.t.complete(prompt, 60000, 220, (full) => {
          const now = Date.now();
          if (now - last > 500) { last = now; void this.prisma.consultMessage.update({ where: { id: aiMsg.id }, data: { content: full, contentKo: full } }).then(() => this.emit(id)).catch(() => {}); }
        });
      } catch { replyKo = FALLBACK; }
      // 🔴 (2026-09-17 L2) 이 쓰기가 실패하면 **환자에게는 빈 AI 말풍선만 남는다**(위에서 `content: ''` 로
      //    먼저 만든 행이다). 종전 `.catch(() => {})` 는 그 사실을 아무 데도 남기지 않아 **환자도 직원도
      //    답이 오지 않은 것을 모른다.** 되돌릴 수 없는 비동기 경로라 던지지는 않되, 유실을 원장(로그)에 남기고
      //    빈 말풍선은 지워 "답이 온 것처럼" 보이지 않게 한다(§부분실패 · P16).
      try {
        await this.prisma.consultMessage.update({ where: { id: aiMsg.id }, data: { content: replyKo, contentKo: replyKo } });
      } catch (e) {
        this.logger.error(`상담 AI 답변 저장 실패 — 환자에게 답이 가지 않았다(session=${id} msg=${aiMsg.id}): ${e instanceof Error ? e.message : String(e)}`);
        await this.prisma.consultMessage.delete({ where: { id: aiMsg.id } }).catch((e2) =>
          this.logger.error(`빈 AI 말풍선 정리도 실패(session=${id} msg=${aiMsg.id}): ${e2 instanceof Error ? e2.message : String(e2)}`));
        this.emit(id, 'staff', 'ai_failed');
      }
    } else {
      // 외국어: 한국어 생성 후 환자 언어로 번역(스트리밍은 원문언어라 최종 번역본만 표시)
      let replyKo = '';
      try { replyKo = await this.t.complete(prompt, 60000, 220); } catch { replyKo = FALLBACK; }
      // 🔴 여기도 같다 — 번역이 안 됐으면 `lang` 은 원문 언어(`ko`)다
      let replyLocale = replyKo;
      let replyLang = 'ko';
      try {
        const r = await this.t.translate(replyKo, locale, 'ko');
        replyLocale = r.translated;
        if (!r.fallback) replyLang = locale;
      } catch { /* 폴백 — 원문이 나가고 lang 은 ko 로 남는다 */ }
      // 🔴 (2026-09-17 L2) 외국어 경로도 같다 — 저장이 실패하면 환자는 **아무 답도 받지 못하는데**
      //    세션 `updatedAt` 만 올라가 목록에서는 방금 응답한 것처럼 보인다. 실패를 남기고 직원에게 신호한다.
      try {
        await this.prisma.consultMessage.create({ data: { sessionId: id, sender: 'AI', content: replyLocale, contentKo: replyKo, lang: replyLang } });
      } catch (e) {
        this.logger.error(`상담 AI 답변 저장 실패 — 환자에게 답이 가지 않았다(session=${id} locale=${locale}): ${e instanceof Error ? e.message : String(e)}`);
        this.emit(id, 'staff', 'ai_failed');
      }
    }
    await this.prisma.consultSession.update({ where: { id }, data: { updatedAt: new Date() } }).catch(() => {});
    this.emit(id);
  }
}
