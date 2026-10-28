import { Injectable, Logger, BadRequestException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomInt, timingSafeEqual } from 'crypto';
import { AuditAction } from '@prisma/client';
import type { AuthenticationResponseJSON } from '@simplewebauthn/server';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { RedisService } from '../../infrastructure/redis/redis.service';
import { AuditService } from '../audit/audit.service';
import { EssService } from '../ess/ess.service';
import { ConfigRuntimeService } from '../config/config-runtime.service';
import { PasskeyService } from '../auth/passkey/passkey.service';

// 데일리 PIN (terminal-zero-trust 설계 §6.5 / D2)
// 신뢰원칙: 포털 발급(본인 생체 후)·HMAC만 저장(평문 금지 §6.0-2)·출근(ess.clock) 통합.
// blockchain.pin*(인증서 서명PIN)과 무관 — terminal.pin.* 네임스페이스.

@Injectable()
export class TerminalPinService {
  private readonly logger = new Logger(TerminalPinService.name);
  private readonly hmacSecret: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly audit: AuditService,
    private readonly ess: EssService,
    private readonly config: ConfigService,
    private readonly configRuntime: ConfigRuntimeService,
    private readonly passkey: PasskeyService,
  ) {
    this.hmacSecret =
      this.config.get<string>('TERMINAL_PIN_SECRET') ||
      this.config.getOrThrow<string>('AUTH_SECRET') + ':terminal-pin';
  }

  // 서버 TZ=Asia/Seoul → 로컬 날짜키
  private dateKey(): string {
    return new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD
  }
  private secondsToMidnight(): number {
    const now = new Date();
    const mid = new Date(now);
    mid.setHours(24, 0, 0, 0);
    return Math.max(60, Math.floor((mid.getTime() - now.getTime()) / 1000));
  }
  private hmac(pin: string): string {
    return createHmac('sha256', this.hmacSecret).update(pin).digest('hex');
  }

  // ── 발급 (생체 인증된 포털 세션에서 본인이 생성, §6.5) ──
  // 출근 clock-in 통합(method=PIN) — 별도 출근 흐름 신설 금지(§2.4)
  async issue(userId: string): Promise<{ pin: string; expiresAt: string }> {
    const date = this.dateKey();
    const setKey = `daily_active_pins:${date}`;
    const ttl = this.secondsToMidnight();

    // 유일성 검증하며 PIN 생성(최대 시도) — 자릿수는 config terminal.pin.length(정의만 되고 미소비이던 것 실배선·4~8 클램프)
    const rawLen = Number((await this.configRuntime.get('terminal.pin.length').catch(() => null)) ?? 6);
    const pinLen = Number.isFinite(rawLen) ? Math.min(8, Math.max(4, Math.floor(rawLen))) : 6;
    let pin = '';
    let hashed = '';
    for (let i = 0; i < 12; i++) {
      pin = String(randomInt(0, 10 ** pinLen)).padStart(pinLen, '0');
      hashed = this.hmac(pin);
      const added = await this.redis.sadd(setKey, hashed);
      if (added === 1) break; // 신규(유일)
      pin = '';
    }
    if (!pin) throw new BadRequestException('PIN 생성 충돌 — 다시 시도하세요.');
    await this.redis.expire(setKey, ttl);
    await this.redis.set(`daily_pin:${date}:${userId}`, hashed, 'EX', ttl);
    await this.redis.del(`daily_pin_fail:${date}:${userId}`);

    // 출근 통합(ess — AttendanceRecord + ERP webhook). 멱등: 오늘 이미 출근이면 재기록 안 함.
    try {
      await this.ess.clockInOnceDaily(userId, 'PIN');
    } catch (e) {
      this.logger.warn(`clock-in 통합 실패(무시) user=${userId}: ${(e as Error).message}`);
    }

    // 발급 사실만 감사(평문/HMAC 비적재, §6.5). resourceId=UUID 컬럼이라 userId 사용, 날짜는 changes로.
    await this.audit.safeLog({
      userId,
      action: AuditAction.CREATE,
      resourceType: 'TERMINAL_DAILY_PIN',
      resourceId: userId,
      changes: { issued: { old: null, new: date } },
    });

    const expiresAt = new Date(Date.now() + ttl * 1000).toISOString();
    return { pin, expiresAt }; // 평문 PIN은 발급 응답으로 1회만 본인에게 노출
  }

  // ── PIN 보기 (생체 재인증 후 재발급·표시, §6.5/§6.0-2) ──
  // 평문 미보관 원칙상 "발급된 PIN 재조회"는 불가 → 본인 생체(passkey) 재인증 후 당일 PIN을
  // 재발급하여 표시(직전 PIN 무효화). 출근 통합은 멱등이라 재호출돼도 중복 기록 없음.
  async reveal(userId: string, response: AuthenticationResponseJSON): Promise<{ pin: string; expiresAt: string }> {
    await this.passkey.verifyStepUpAssertion(userId, response); // 본인 생체 검증 실패 시 throw
    const result = await this.issue(userId);
    await this.audit.safeLog({
      userId,
      action: AuditAction.READ,
      resourceType: 'TERMINAL_DAILY_PIN',
      resourceId: userId,
      changes: { reveal: { old: null, new: this.dateKey() } },
    });
    return result;
  }

  // ── 검증 (복합 컨텍스트 [단말]+[사번]+[PIN], §6.5) ──
  async verify(deviceUuid: string, employeeNumber: string, pin: string) {
    // 단말 유효성(복합 컨텍스트 1) — 등록·활성 단말만
    const terminal = await this.prisma.terminalRegistry.findUnique({ where: { deviceUuid } });
    if (!terminal || terminal.status !== 'ACTIVE') {
      throw new ForbiddenException('유효하지 않은 단말입니다.');
    }

    // 사번 → userId(복합 컨텍스트 2)
    const staff = await this.prisma.staff.findFirst({
      where: { employeeNumber },
      select: { userId: true },
    });
    if (!staff?.userId) throw new ForbiddenException('인증 실패');
    const userId = staff.userId;

    const date = this.dateKey();
    const failKey = `daily_pin_fail:${date}:${userId}`;
    const lockAttempts = Number((await this.configRuntime.get('terminal.pin.lockAttempts')) ?? 5);
    const fails = Number((await this.redis.get(failKey)) || 0);
    if (fails >= lockAttempts) {
      throw new ForbiddenException('PIN 시도 횟수 초과 — 잠금되었습니다.');
    }

    const stored = await this.redis.get(`daily_pin:${date}:${userId}`);
    const ok = stored ? this.safeEq(stored, this.hmac(pin)) : false; // 복합 컨텍스트 3(PIN)
    if (!ok) {
      const lockMin = Number((await this.configRuntime.get('terminal.pin.lockMinutes')) ?? 10);
      // 원자적 증가(INCR) — GET→SET 경합으로 실패 카운트가 유실돼 잠금이 우회되는 것 방지.
      const newFails = await this.redis.incr(failKey);
      if (newFails === 1) await this.redis.expire(failKey, lockMin * 60); // 첫 실패에만 TTL 설정
      await this.audit.safeLog({
        userId,
        action: AuditAction.READ,
        resourceType: 'TERMINAL_DAILY_PIN',
        resourceId: userId,
        changes: { verifyFail: { old: newFails - 1, new: newFails }, date: { old: null, new: date } },
      });
      throw new ForbiddenException('인증 실패');
    }

    await this.redis.del(failKey);
    return { valid: true, userId, deviceUuid };
  }

  // ── 승인 게이트용 PIN 검증 (차트/오더 승인 시 데일리 PIN 재입력, 단말 무관) ──
  // verify()와 동일한 당일 PIN·실패잠금(INCR) 로직 재사용. userId 는 인증 세션에서.
  async verifyByUserId(userId: string, pin: string): Promise<boolean> {
    const date = this.dateKey();
    const failKey = `daily_pin_fail:${date}:${userId}`;
    const lockAttempts = Number((await this.configRuntime.get('terminal.pin.lockAttempts')) ?? 5);
    const fails = Number((await this.redis.get(failKey)) || 0);
    if (fails >= lockAttempts) {
      throw new ForbiddenException('PIN 시도 횟수 초과 — 잠금되었습니다.');
    }
    const stored = await this.redis.get(`daily_pin:${date}:${userId}`);
    const ok = stored ? this.safeEq(stored, this.hmac(pin)) : false;
    if (!ok) {
      const lockMin = Number((await this.configRuntime.get('terminal.pin.lockMinutes')) ?? 10);
      const newFails = await this.redis.incr(failKey);
      if (newFails === 1) await this.redis.expire(failKey, lockMin * 60);
      return false;
    }
    await this.redis.del(failKey);
    return true;
  }

  private safeEq(a: string, b: string): boolean {
    const ba = Buffer.from(a);
    const bb = Buffer.from(b);
    return ba.length === bb.length && timingSafeEqual(ba, bb);
  }
}
