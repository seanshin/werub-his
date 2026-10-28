import { Injectable, Logger, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { UserRole, Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { RedisService } from '../../infrastructure/redis/redis.service';
import { NotificationService } from '../notification/notification.service';
import { FcmPushService } from '../notification/fcm-push.service';
import { CreateStaffCallDto, BroadcastDto, CodeCallDto } from './dto/staff-call.dto';

@Injectable()
export class StaffCallService {
  private readonly logger = new Logger(StaffCallService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly notify: NotificationService,
    private readonly fcm: FcmPushService,
  ) {}

  // FR-42/48/49: 대상 사용자들의 스태프 디바이스 FCM 토큰
  private async fcmTokensFor(userIds: string[]): Promise<string[]> {
    if (!userIds.length) return [];
    const devices = await this.prisma.staffDevice.findMany({
      where: { userId: { in: userIds }, status: 'ACTIVE', fcmToken: { not: null } },
      select: { fcmToken: true },
    });
    return devices.map((d) => d.fcmToken!).filter(Boolean);
  }

  // FR-29/50: 호출 이벤트 감사
  private async audit(
    userId: string,
    action: 'CREATE' | 'UPDATE',
    callId: string,
    changes: Prisma.InputJsonObject,
  ) {
    await this.prisma.auditLog
      .create({ data: { userId, action, resourceType: 'STAFF_CALL', resourceId: callId, changes } })
      .catch(() => undefined);
  }

  // FR-45: 발신자별 rate-limit (남용·alarm fatigue 방어)
  private readonly RATE: Record<string, { limit: number; windowSec: number }> = {
    STAFF_CALL: { limit: 30, windowSec: 60 },
    BROADCAST: { limit: 10, windowSec: 3600 },
    CODE: { limit: 20, windowSec: 600 },
  };
  private async enforceRateLimit(senderId: string, type: string) {
    const r = this.RATE[type];
    if (!r) return;
    const key = `call:rate:${type}:${senderId}`;
    const n = await this.redis.incr(key);
    if (n === 1) await this.redis.expire(key, r.windowSec);
    if (n > r.limit) {
      throw new BadRequestException({ code: 'RATE_LIMITED', message: '발신 한도를 초과했습니다. 잠시 후 다시 시도하세요.' });
    }
  }
  // FR-45: 동일 대상 중복 호출 억제(de-dup)
  private async enforceDedup(senderId: string, type: string, kind: string, ref?: string) {
    const key = `call:dedup:${senderId}:${type}:${kind}:${ref ?? 'ALL'}`;
    const set = await this.redis.set(key, '1', 'EX', 30, 'NX');
    if (set === null) {
      throw new BadRequestException({ code: 'DUPLICATE_CALL', message: '동일 대상에 방금 호출했습니다(30초 내 중복).' });
    }
  }

  // 대상 사용자 해소 (FR-41)
  private async resolveTargets(kind: string, ref?: string, excludeUserId?: string): Promise<string[]> {
    let where: Record<string, unknown> = { isActive: true };
    if (kind === 'USER') where = { ...where, id: ref };
    else if (kind === 'ROLE') where = { ...where, role: ref as UserRole };
    else if (kind === 'DEPARTMENT') where = { ...where, department: ref };
    // ALL → isActive 전체
    const users = await this.prisma.user.findMany({ where, select: { id: true } });
    return users.map((u) => u.id).filter((id) => id !== excludeUserId);
  }

  // 활성 세션(근무중 근사) 필터 (FR-47). CODE/긴급은 미적용(전원 도달)
  private async filterActive(userIds: string[]): Promise<string[]> {
    const checks = await Promise.all(
      userIds.map(async (id) => ((await this.redis.scard(`sessions:${id}`)) > 0 ? id : null)),
    );
    return checks.filter((x): x is string => !!x);
  }

  private deliver(
    userIds: string[],
    call: { id: string; type: string; severity: string },
    title: string,
    message: string,
  ) {
    return Promise.all(
      userIds.map(async (uid) => {
        const n = await this.notify.create(uid, {
          type: call.type,
          title,
          message,
          severity: call.severity,
          refType: 'StaffCall',
          refId: call.id,
        });
        this.notify.pushNotification(uid, {
          id: n.id,
          type: call.type,
          title,
          message,
          severity: call.severity,
          refType: 'StaffCall',
          refId: call.id,
        });
      }),
    );
  }

  // ── 직원 호출 (FR-38) ──
  async createCall(senderId: string, dto: CreateStaffCallDto) {
    await this.enforceRateLimit(senderId, 'STAFF_CALL');
    await this.enforceDedup(senderId, 'STAFF_CALL', dto.targetKind, dto.targetRef);
    const sender = await this.prisma.user.findUnique({ where: { id: senderId } });
    const call = await this.prisma.staffCall.create({
      data: {
        type: 'STAFF_CALL',
        severity: dto.severity ?? 'NORMAL',
        senderId,
        targetKind: dto.targetKind,
        targetRef: dto.targetRef,
        message: dto.message,
        patientRef: dto.patientRef,
      },
    });
    let targets = await this.resolveTargets(dto.targetKind, dto.targetRef, senderId);
    targets = await this.filterActive(targets);
    const title = `호출 — ${sender?.familyName ?? ''}${sender?.givenName ?? ''}`;
    await this.deliver(targets, call, title, dto.message ?? '호출이 도착했습니다.');
    await this.audit(senderId, 'CREATE', call.id, {
      type: 'STAFF_CALL', targetKind: dto.targetKind, severity: call.severity, delivered: targets.length,
    });
    return { id: call.id, delivered: targets.length };
  }

  // ── 긴급 브로드캐스트 (FR-39) ──
  async broadcast(senderId: string, dto: BroadcastDto) {
    await this.enforceRateLimit(senderId, 'BROADCAST');
    await this.enforceDedup(senderId, 'BROADCAST', dto.targetKind, dto.targetRef);
    const call = await this.prisma.staffCall.create({
      data: {
        type: 'BROADCAST',
        severity: dto.severity ?? 'URGENT',
        senderId,
        targetKind: dto.targetKind,
        targetRef: dto.targetRef,
        message: dto.message,
      },
    });
    let targets = await this.resolveTargets(dto.targetKind, dto.targetRef, senderId);
    if ((dto.severity ?? 'URGENT') !== 'CRITICAL') targets = await this.filterActive(targets);
    await this.deliver(targets, call, '긴급 알림', dto.message);
    await this.audit(senderId, 'CREATE', call.id, {
      type: 'BROADCAST', targetKind: dto.targetKind, severity: call.severity, delivered: targets.length,
    });
    return { id: call.id, delivered: targets.length };
  }

  // ── Code 호출 (코드블루 등, FR-40) — 전원 도달, 활성필터 미적용 ──
  async code(senderId: string, dto: CodeCallDto) {
    await this.enforceRateLimit(senderId, 'CODE');
    const call = await this.prisma.staffCall.create({
      data: {
        type: 'CODE',
        severity: 'CRITICAL',
        senderId,
        targetKind: dto.targetKind,
        targetRef: dto.targetRef,
        location: dto.location,
        message: `${dto.codeType} @ ${dto.location}`,
      },
    });
    const targets = await this.resolveTargets(dto.targetKind, dto.targetRef, senderId);
    // SSE(in-app) + FCM(백그라운드/오프라인) 동시 발송 — 전달보장(FR-48)
    await this.deliver(targets, call, `🚨 ${dto.codeType}`, `${dto.location} — 즉시 대응`);
    const tokens = await this.fcmTokensFor(targets);
    const fcmRes = await this.fcm.sendToTokens(tokens, {
      title: `🚨 ${dto.codeType}`, // 운영정보만(환자 PII 없음, FR-49)
      body: `${dto.location} — 즉시 대응`,
      data: { kind: 'CODE', callId: call.id, codeType: dto.codeType },
    });
    this.logger.warn(`CODE ${dto.codeType} @ ${dto.location} by ${senderId} → SSE ${targets.length}, FCM ${fcmRes.sent}`);
    await this.audit(senderId, 'CREATE', call.id, {
      type: 'CODE', codeType: dto.codeType, location: dto.location, delivered: targets.length, fcmSent: fcmRes.sent,
    });
    return { id: call.id, delivered: targets.length, fcmSent: fcmRes.sent };
  }

  // ── 응답/수신확인 (FR-38/39/48) ──
  async respond(callId: string, userId: string, response: string) {
    const call = await this.prisma.staffCall.findUnique({ where: { id: callId } });
    if (!call) throw new NotFoundException('호출을 찾을 수 없습니다.');
    await this.prisma.staffCallAck.upsert({
      where: { callId_userId: { callId, userId } },
      create: { callId, userId, response },
      update: { response, ackedAt: new Date() },
    });
    if (call.status === 'OPEN') {
      await this.prisma.staffCall.update({ where: { id: callId }, data: { status: 'ACKED' } });
    }
    // 발신자에게 응답 상태 실시간 반영
    const responder = await this.prisma.user.findUnique({ where: { id: userId } });
    this.notify.pushNotification(call.senderId, {
      id: callId,
      type: 'STAFF_CALL_ACK',
      title: '호출 응답',
      message: `${responder?.familyName ?? ''}${responder?.givenName ?? ''} — ${response}`,
      severity: 'INFO',
      refType: 'StaffCall',
      refId: callId,
    });
    return { callId, response };
  }

  // ── 취소/철회 (FR-46) — 발신자/책임자만 ──
  async cancel(callId: string, userId: string, isManager: boolean, falseAlarm = false) {
    const call = await this.prisma.staffCall.findUnique({ where: { id: callId } });
    if (!call) throw new NotFoundException('호출을 찾을 수 없습니다.');
    if (call.senderId !== userId && !isManager) {
      throw new ForbiddenException('취소 권한이 없습니다.');
    }
    await this.prisma.staffCall.update({
      where: { id: callId },
      data: { status: 'CANCELLED', cancelledBy: userId },
    });
    // FR-45: 허위 호출 플래그(특히 Code) — 감사 추적
    await this.audit(userId, 'UPDATE', callId, {
      action: 'CANCEL', byManager: isManager, falseAlarm, type: call.type,
    });
    if (falseAlarm && call.type === 'CODE') {
      this.logger.warn(`⚠️ 허위 CODE 발신 플래그 call=${callId} by=${userId}`);
    }
    return { callId, status: 'CANCELLED', falseAlarm };
  }

  // ── 발신자 화면: 호출 상태+응답 집계 ──
  async getCall(callId: string) {
    const call = await this.prisma.staffCall.findUnique({
      where: { id: callId },
      include: {
        acks: { include: { user: { select: { familyName: true, givenName: true } } } },
      },
    });
    if (!call) throw new NotFoundException('호출을 찾을 수 없습니다.');
    return {
      id: call.id,
      type: call.type,
      severity: call.severity,
      status: call.status,
      message: call.message,
      location: call.location,
      createdAt: call.createdAt,
      acks: call.acks.map((a) => ({
        staff: `${a.user.familyName}${a.user.givenName}`,
        response: a.response,
        ackedAt: a.ackedAt,
      })),
    };
  }

  // ── 미응답 에스컬레이션 (FR-48) — 대상 확대 재전송 ──
  async escalate(callId: string) {
    const call = await this.prisma.staffCall.findUnique({ where: { id: callId } });
    if (!call) throw new NotFoundException('호출을 찾을 수 없습니다.');
    if (call.status === 'CANCELLED' || call.status === 'CLOSED') {
      throw new BadRequestException('종료된 호출입니다.');
    }
    // 대상 확대: 전체 활성 직원 (책임자 포함)
    const all = await this.resolveTargets('ALL', undefined, call.senderId);
    await this.deliver(all, { id: call.id, type: call.type, severity: 'CRITICAL' },
      `⏫ 에스컬레이션: ${call.message ?? '응급 호출'}`, '미응답으로 대상이 확대되었습니다.');
    const tokens = await this.fcmTokensFor(all);
    const fcmRes = await this.fcm.sendToTokens(tokens, {
      title: '⏫ 에스컬레이션', body: call.message ?? '응급 호출 미응답', data: { kind: 'ESCALATION', callId },
    });
    await this.prisma.staffCall.update({ where: { id: callId }, data: { status: 'ESCALATED', escalatedAt: new Date() } });
    await this.audit(call.senderId, 'UPDATE', callId, { action: 'ESCALATE', expanded: all.length, fcmSent: fcmRes.sent });
    this.logger.warn(`호출 에스컬레이션 call=${callId} → ${all.length}명`);
    return { callId, status: 'ESCALATED', expanded: all.length };
  }

  async myRecent(senderId: string) {
    const calls = await this.prisma.staffCall.findMany({
      where: { senderId },
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: { _count: { select: { acks: true } } },
    });
    return calls.map((c) => ({
      id: c.id,
      type: c.type,
      severity: c.severity,
      status: c.status,
      message: c.message,
      ackCount: c._count.acks,
      createdAt: c.createdAt,
    }));
  }
}
