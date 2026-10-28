import { Injectable, UnauthorizedException, Logger, Optional, HttpStatus } from '@nestjs/common';
import { passwordPolicyViolations, PASSWORD_MAX_AGE_DAYS } from './password-policy';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { createHash, randomUUID } from 'crypto';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { RedisService } from '../../infrastructure/redis/redis.service';
import { LoginDto } from './dto/login.dto';
import { JwtPayload } from './strategies/jwt.strategy';
import { SsoIdpService } from './sso-idp/sso-idp.service';
import { AuditService } from '../audit/audit.service';
import {
  AUTH_AUDIT_RESOURCE,
  AUTH_FAILURE_AUDIT_RESOURCE,
  type AuthContext,
  type AuthFailureReason,
} from './auth-audit';
import { ConfigRuntimeService } from '../config/config-runtime.service';
import { DomainException } from '../../common/errors/domain.exception';
import { PASSWORD_CURRENT_MISMATCH, PASSWORD_POLICY_VIOLATION } from '../../common/errors/domain-error-codes';

/**
 * 네이티브 세션 결합 — 이 세션이 **어느 앱 설치·어느 승인 기기**에서 났는지.
 *
 * 🔴 결합을 access token claim 과 Redis 세션 **양쪽**에 둔다. claim 만 두면 위조 검증이 되지만
 *    refresh 때 서버가 대조할 원본이 없고, Redis 만 두면 요청마다 조회해야 한다.
 */
export interface SessionBinding {
  client: 'WEB' | 'IOS_NATIVE';
  installationId?: string;
  staffDeviceId?: string;
  appKeyId?: string;
  authMethod?: 'PASSWORD' | 'PASSKEY' | 'RECOVERY';
  assuranceLevel?: 'STAFF_S0' | 'STAFF_S1' | 'STAFF_S2' | 'STAFF_S3';
  accessTtlSeconds?: number;
  refreshTtlSeconds?: number;
}

const bindingClaims = (b?: SessionBinding) =>
  b
    ? {
        client: b.client,
        ...(b.staffDeviceId ? { sdid: b.staffDeviceId } : {}),
        ...(b.appKeyId ? { akid: b.appKeyId } : {}),
        ...(b.assuranceLevel ? { al: b.assuranceLevel } : {}),
      }
    : {};

// refresh 토큰 페이로드 — 세션(기기)별 분리를 위한 sid 포함(레거시 토큰은 sid 없음)
type RefreshPayload = JwtPayload & { sid?: string };

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly refreshSecret: string;
  private readonly refreshExpiresIn: number = 7 * 24 * 60 * 60; // 7 days in seconds
  private readonly maxConcurrentSessions = 3;
  private readonly sessionInactiveTimeout = 30 * 60; // 30분 (초)

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
    private readonly ssoIdp: SsoIdpService,
    private readonly audit: AuditService,
    @Optional() private readonly configRuntime?: ConfigRuntimeService,
  ) {
    this.refreshSecret = this.config.getOrThrow<string>('AUTH_REFRESH_SECRET');
  }

  /** 로그인 잠금 임계 — config 정본. 못 읽으면 종전 동작(10)을 유지하고 조용히 완화하지 않는다. */
  /**
   * 잠금 시간(분) — 🔴 형제 키 `security.login.maxAttempts` 는 배선됐는데 이것만 남아
   *    **900초와 "15 minutes" 문자열이 코드에 박혀** 있었다. 화면에는 다이얼이 있고
   *    돌려도 아무것도 안 바뀌었다.
   * 🔴 **기본값은 종전 동작과 같은 15분** — 배포만으로 보안 동작이 달라지지 않는다.
   */
  private async loginLockMinutes(): Promise<number> {
    const v = await this.configRuntime?.get('security.login.lockMinutes');
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 15;
  }

  private async loginLockThreshold(): Promise<number> {
    const v = await this.configRuntime?.get('security.login.maxAttempts');
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 10;
  }

  /**
   * 세션 만료(분) — `security.session.timeoutMinutes` 배선(R9-③).
   * 🔴 종전엔 화면에 다이얼(기본 480)이 있는데 아무도 읽지 않아 JwtModule 하드코딩 8h 그대로였다.
   * null 반환 = 미설정/이상값 → 종전 동작(모듈 기본 8h) 유지(fail-safe — 배포만으로 만료가 달라지지 않는다).
   * 상한 24h·하한 5분 클램프 — 오타(48000)로 사실상 무만료 토큰이 나가는 것을 막는다.
   */
  private async sessionTimeoutSeconds(): Promise<number | null> {
    const v = await this.configRuntime?.get('security.session.timeoutMinutes').catch(() => null);
    const n = typeof v === 'number' ? v : Number(v);
    if (!Number.isFinite(n) || n < 5) return null;
    return Math.min(Math.floor(n), 24 * 60) * 60;
  }

  async login(dto: LoginDto, ctx?: AuthContext) {
    const authCtx: AuthContext = { method: 'PASSWORD', ...ctx };
    // 계정 잠금 확인 (brute force 방어)
    const failKey = `login:fail:${dto.email}`;
    const failCount = await this.redis.get(failKey);
    // 🔴 종전엔 상수 10 이었고 `security.login.maxAttempts`(표시 5)는 **아무도 읽지 않았다** —
    //    화면이 보안 통제를 실제보다 엄격하게 말했다. 이제 그 키가 실제 임계다(미주입·조회 실패 시 종전값 10).
    const maxAttempts = await this.loginLockThreshold();
    const lockMinutes = await this.loginLockMinutes();
    if (failCount && parseInt(failCount, 10) >= maxAttempts) {
      // 잠금 중 시도도 접속기록이다(브루트포스의 실제 규모는 여기서만 보인다).
      // 🔴 여기서 주체를 한 번 더 조회한다 — 잠금 판정은 이메일 키라 userId 를 아직 모르는데,
      //    주체 없이 남기면 "누가 잠겼는지"가 원장에서 사라진다(잠금은 드물어 비용은 무시할 만하다).
      const locked = await this.prisma.user.findUnique({ where: { email: dto.email }, select: { id: true } });
      await this.auditLoginFailure(dto.email, 'LOCKED', authCtx, locked?.id);
      // 🔴 메시지도 실제 값을 말한다 — 코드가 30분 잠그면서 "15분"이라 하면 화면이 거짓말한다
      throw new UnauthorizedException(`Too many failed attempts. Account locked for ${lockMinutes} minutes.`);
    }

    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (!user || !user.isActive) {
      await this.redis.multi().incr(failKey).expire(failKey, lockMinutes * 60).exec();
      // 🔴 계정 부재와 비활성을 구분해 기록한다 — 응답은 종전대로 구분하지 않는다(계정 열거 방지)
      await this.auditLoginFailure(dto.email, user ? 'INACTIVE' : 'BAD_PASSWORD', authCtx, user?.id);
      throw new UnauthorizedException('Invalid credentials');
    }

    const passwordValid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!passwordValid) {
      await this.redis.multi().incr(failKey).expire(failKey, lockMinutes * 60).exec();
      await this.auditLoginFailure(dto.email, 'BAD_PASSWORD', authCtx, user.id);
      throw new UnauthorizedException('Invalid credentials');
    }

    // 로그인 성공 시 실패 카운터 초기화
    await this.redis.del(failKey);

    return this.issueSession({ id: user.id, email: user.email, role: user.role }, authCtx);
  }

  /**
   * 접속기록 — 로그인 성공/로그아웃. 🔴 감사 실패가 인증을 막지는 않는다(가용성 우선).
   * AuditService 는 DB 실패를 Redis 버퍼로 흡수하므로 여기 catch 는 마지막 방어선이다.
   */
  private async auditSession(
    userId: string,
    kind: 'LOGIN' | 'LOGOUT',
    ctx: AuthContext | undefined,
    extra?: Record<string, unknown>,
  ) {
    try {
      await this.audit.log({
        userId,
        action: kind === 'LOGIN' ? 'CREATE' : 'DELETE',
        resourceType: AUTH_AUDIT_RESOURCE,
        resourceId: userId, // 🔴 resourceId 는 @db.Uuid — 주체(본인)를 지목한다
        changes: {
          session: { old: null, new: { kind, method: ctx?.method ?? 'UNSPECIFIED', ...extra } },
        },
        ipAddress: ctx?.ipAddress,
        userAgent: ctx?.userAgent,
      });
    } catch (e) {
      this.logger.error(`접속기록 저장 실패(${kind}) user=${userId}: ${(e as Error)?.message}`);
    }
  }

  /**
   * 로그인 실패 기록. userId 를 아는 경우에만 원장에 남는다(AuditLog.userId 는 User FK).
   * 🔴 미존재 계정 시도는 원장에 담을 수 없어 로거로만 남긴다 — 별도 테이블은 스키마 제안(사람 승인).
   *    이메일 원문은 원장·로그 어디에도 넣지 않는다(계정 열거 단서).
   */
  private async auditLoginFailure(
    email: string,
    reason: AuthFailureReason,
    ctx: AuthContext | undefined,
    userId?: string,
  ) {
    const masked = email.replace(/^(.).*(@.*)$/, '$1***$2');
    if (!userId) {
      this.logger.warn(`로그인 실패(미식별 계정) ${masked} reason=${reason} ip=${ctx?.ipAddress ?? '-'}`);
      return;
    }
    try {
      await this.audit.log({
        userId,
        action: 'CREATE',
        resourceType: AUTH_FAILURE_AUDIT_RESOURCE,
        resourceId: userId,
        changes: { login: { old: null, new: { reason, method: ctx?.method ?? 'UNSPECIFIED' } } },
        ipAddress: ctx?.ipAddress,
        userAgent: ctx?.userAgent,
      });
    } catch (e) {
      this.logger.error(`로그인 실패 기록 저장 실패 user=${userId}: ${(e as Error)?.message}`);
    }
  }

  /**
   * 인증 성공 후 토큰·세션 발급 (login·passkey 로그인 공용).
   * 비밀번호 검증 자체는 호출 측 책임 — 이 메서드는 검증 통과 전제.
   */
  /** ERP SSO 전용 단기 토큰 — aud:erp-sso(토큰 confusion 차단) + jti(replay 방지). 60초. */
  issueErpSsoToken(user: { id: string; email: string; role: string }): string {
    return this.jwt.sign(
      { sub: user.id, email: user.email, role: user.role, aud: 'erp-sso', jti: randomUUID() },
      { expiresIn: 60 },
    );
  }

  /**
   * 인증 성공 후 세션 발급 **공용 지점** — password·passkey·recovery·레거시 refresh 이관이 전부 여기로 온다.
   * 🔴 접속기록을 이 한 곳에 둔다(호출부마다 두면 새 인증 경로가 생길 때 조용히 갈라진다).
   */
  async issueSession(
    user: { id: string; email: string; role: string },
    ctx?: AuthContext,
    binding?: SessionBinding,
  ) {
    // Update last login
    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role as JwtPayload['role'],
    };

    // refresh 토큰을 세션(기기)별로 분리 — PC(서명)+폰(승인) 등 다기기 동시 로그인 충돌 방지.
    // 각 세션이 독립 refresh 토큰을 가지므로 한 기기 로그인이 다른 기기를 무효화하지 않음.
    const sessionId = createHash('sha256').update(`${user.id}:${Date.now()}:${randomUUID()}`).digest('hex').slice(0, 16);

    // 🔴 access token 에 `sid` 를 넣는다 — 없으면 **개별 세션을 즉시 끊을 방법이 없다**
    //    (권한 회수·기기 폐기가 access token 만료까지 최대 8시간 늦어졌다).
    //    idle 판정도 사용자 단위가 아니라 세션 단위로 갈린다(다른 기기 활동이 내 세션을 연장하지 않는다).
    // 만료 우선순위: 결합 정책(binding) > security.session.timeoutMinutes > 모듈 기본(8h)
    const sessionTtl = await this.sessionTimeoutSeconds();
    const accessToken = this.jwt.sign(
      { ...payload, aud: 'his', sid: sessionId, ...bindingClaims(binding) },
      binding?.accessTtlSeconds ? { expiresIn: binding.accessTtlSeconds } : sessionTtl ? { expiresIn: sessionTtl } : undefined,
    );
    const refreshToken = this.jwt.sign({ ...payload, sid: sessionId }, {
      secret: this.refreshSecret,
      expiresIn: binding?.refreshTtlSeconds ?? this.refreshExpiresIn,
    });

    const refreshTtl = binding?.refreshTtlSeconds ?? this.refreshExpiresIn;
    await this.redis.multi()
      .set(`refresh:sess:${sessionId}`, refreshToken, 'EX', refreshTtl)
      .set(`session:${sessionId}`, JSON.stringify({
        userId: user.id,
        createdAt: new Date().toISOString(),
        lastActiveAt: new Date().toISOString(),
        ...(binding ? { binding } : {}),
      }), 'EX', refreshTtl)
      .sadd(`sessions:${user.id}`, sessionId)
      .expire(`sessions:${user.id}`, refreshTtl)
      .exec();

    // 동시 세션 초과 시 가장 오래된 세션 정리
    await this.enforceMaxSessions(user.id);

    await this.auditSession(user.id, 'LOGIN', ctx, { sid: sessionId });

    return {
      accessToken,
      refreshToken,
      expiresIn: this.expiresInOf(accessToken),
      sessionId,
    };
  }

  /**
   * 응답의 만료초는 **발급된 토큰에서 읽는다**.
   *
   * 🔴 종전에는 로그인이 `28800`, 회전이 `900` 을 손으로 적었는데 두 토큰 모두 JwtModule 기본값
   *    `8h` 로 서명된다 — 회전 응답은 **실제와 32배 다른 만료를 말하고 있었다.** 클라이언트는
   *    이 값으로 갱신 주기를 정한다. 정책을 바꾸려면 서명 옵션을 바꾸는 것이 맞고,
   *    응답은 언제나 서명된 사실을 그대로 옮긴다(둘을 따로 적으면 반드시 갈라진다).
   */
  private expiresInOf(token: string): number {
    const decoded = this.jwt.decode(token) as { exp?: number; iat?: number } | null;
    if (!decoded?.exp) return 0;
    const base = decoded.iat ?? Math.floor(Date.now() / 1000);
    return Math.max(0, decoded.exp - base);
  }

  async refresh(refreshToken: string, expectBinding?: Partial<SessionBinding>) {
    let payload: RefreshPayload;
    try {
      payload = this.jwt.verify<RefreshPayload>(refreshToken, {
        secret: this.refreshSecret,
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    // 레거시(세션ID 없는) 토큰 — 본 변경 배포 전 발급분: 검증 후 새 세션으로 이관(무중단)
    if (!payload.sid) {
      const legacy = await this.redis.get(`refresh:${payload.sub}`);
      if (legacy && legacy === refreshToken) {
        await this.redis.multi()
          .del(`refresh:${payload.sub}`).del(`refresh:hash:${payload.sub}`).del(`refresh:used:${payload.sub}`)
          .exec();
        const s = await this.issueSession({ id: payload.sub, email: payload.email, role: payload.role }, { method: 'REFRESH_MIGRATE' });
        return { accessToken: s.accessToken, refreshToken: s.refreshToken, expiresIn: this.expiresInOf(s.accessToken), sessionId: s.sessionId };
      }
      throw new UnauthorizedException('Refresh token revoked');
    }

    const sid = payload.sid;
    const storedToken = await this.redis.get(`refresh:sess:${sid}`);

    // Case 1: 해당 세션의 현재 토큰과 일치 → 정상 회전
    if (storedToken && storedToken === refreshToken) {
      return this.rotateToken(payload, expectBinding);
    }

    // Case 2: 이미 회전된 토큰 재사용 → 도난 의심 → 해당 세션만 무효화
    const wasUsed = await this.redis.sismember(`refresh:used:sess:${sid}`, this.hashToken(refreshToken));
    if (wasUsed) {
      this.logger.warn(`🚨 Refresh token reuse for session ${sid} (user ${payload.sub}) — revoking session`);
      await this.revokeSession(payload.sub, sid);
      throw new UnauthorizedException({
        code: 'REFRESH_TOKEN_REUSED',
        message: '이전 refresh 토큰이 다시 사용되어 이 세션을 종료했습니다.',
      });
    }

    // Case 3: 알 수 없는/만료된 토큰
    throw new UnauthorizedException('Refresh token revoked');
  }

  private async rotateToken(payload: RefreshPayload, expectBinding?: Partial<SessionBinding>) {
    const sid = payload.sid!;
    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || !user.isActive) {
      throw new UnauthorizedException('User not found or inactive');
    }

    // 🔴 세션에 새겨둔 결합과 지금 요청이 같은가 — 다르면 **다른 기기가 남의 refresh 를 쓰는 것**이다.
    const sessionRaw = await this.redis.get(`session:${sid}`);
    const binding = (() => {
      try { return (JSON.parse(sessionRaw ?? '{}') as { binding?: SessionBinding }).binding; } catch { return undefined; }
    })();
    if (expectBinding) {
      const mismatched =
        (binding?.installationId && binding.installationId !== expectBinding.installationId) ||
        (binding?.staffDeviceId && binding.staffDeviceId !== expectBinding.staffDeviceId) ||
        (binding?.appKeyId && binding.appKeyId !== expectBinding.appKeyId);
      if (mismatched) {
        this.logger.warn(`🚨 refresh 결합 불일치 — 세션 폐기 sid=${sid} user=${payload.sub}`);
        await this.revokeSession(payload.sub, sid);
        throw new UnauthorizedException({ code: 'SESSION_REVOKED', message: '세션 결합이 일치하지 않습니다.' });
      }
    }

    // 현재 토큰을 해당 세션의 "사용됨" 세트에 추가(재사용 탐지)
    const currentToken = await this.redis.get(`refresh:sess:${sid}`);
    if (currentToken) {
      await this.redis.sadd(`refresh:used:sess:${sid}`, this.hashToken(currentToken));
      await this.redis.expire(`refresh:used:sess:${sid}`, this.refreshExpiresIn);
    }

    const newPayload: JwtPayload = { sub: user.id, email: user.email, role: user.role };
    // 결합·만료 정책은 **세션이 처음 났을 때 정해진 것**을 그대로 잇는다(회전에서 바뀌면 계약이 갈라진다)
    const rotatedTtl = await this.sessionTimeoutSeconds();
    const newAccessToken = this.jwt.sign(
      { ...newPayload, aud: 'his', sid, ...bindingClaims(binding) },
      binding?.accessTtlSeconds ? { expiresIn: binding.accessTtlSeconds } : rotatedTtl ? { expiresIn: rotatedTtl } : undefined,
    );
    const refreshTtl = binding?.refreshTtlSeconds ?? this.refreshExpiresIn;
    const newRefreshToken = this.jwt.sign({ ...newPayload, sid }, {
      secret: this.refreshSecret,
      expiresIn: refreshTtl,
    });

    await this.redis.multi()
      .set(`refresh:sess:${sid}`, newRefreshToken, 'EX', refreshTtl)
      .expire(`session:${sid}`, refreshTtl)
      .exec();

    return {
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
      expiresIn: this.expiresInOf(newAccessToken),
      sessionId: sid,
    };
  }

  /** 단일 세션 무효화(per-device 로그아웃·재사용 탐지) */
  private async revokeSession(userId: string, sid: string) {
    await this.redis.multi()
      .del(`refresh:sess:${sid}`)
      .del(`refresh:used:sess:${sid}`)
      .del(`session:${sid}`)
      .srem(`sessions:${userId}`, sid)
      .exec();
  }

  private async revokeAllTokens(userId: string) {
    const sids = await this.redis.smembers(`sessions:${userId}`);
    const m = this.redis.multi();
    for (const sid of sids) {
      m.del(`refresh:sess:${sid}`).del(`refresh:used:sess:${sid}`).del(`session:${sid}`);
    }
    // 세션 인덱스 + 레거시 키 함께 정리
    m.del(`sessions:${userId}`)
      .del(`refresh:${userId}`)
      .del(`refresh:hash:${userId}`)
      .del(`refresh:used:${userId}`);
    await m.exec();
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /**
   * 식별자로 사용자 찾기 — **이메일 또는 사번**.
   *
   * 🔴 화면은 이미 "사번 또는 이메일"을 안내하는데 DTO 는 이메일만 받고 있었다
   *    (요청서 AUTH-S-05 지적 — 실측 확인). 정본을 여기 하나로 둔다.
   *    사번은 `Staff.employeeNumber` 이고 `Staff.userId` 로 계정에 이어진다.
   */
  async findUserByIdentifier(identifier: string) {
    const value = identifier.trim();
    if (value.includes('@')) {
      return this.prisma.user.findUnique({ where: { email: value.toLowerCase() } });
    }
    const staff = await this.prisma.staff.findUnique({
      where: { employeeNumber: value },
      select: { userId: true, status: true },
    });
    if (!staff?.userId) return null;
    return this.prisma.user.findUnique({ where: { id: staff.userId } });
  }

  /** 직원 맥락(사번·부서) — `/auth/me` 가 앱에 사번을 내려주기 위해 읽는다 */
  async staffContextOf(userId: string) {
    return this.prisma.staff.findFirst({
      where: { userId },
      select: { employeeNumber: true, department: true, status: true },
    });
  }

  /** 세션 상태 — 앱이 foreground 복귀 때 묻는다(살아 있는가·어느 기기인가) */
  async sessionInfo(userId: string, sid?: string) {
    if (!sid) return { active: false, reason: 'NO_SESSION_ID' as const };
    const raw = await this.redis.get(`session:${sid}`);
    if (!raw) return { active: false, reason: 'SESSION_REVOKED' as const };
    let parsed: { userId?: string; createdAt?: string; lastActiveAt?: string; binding?: SessionBinding } = {};
    try { parsed = JSON.parse(raw); } catch { /* 손상 → 아래에서 비활성 처리 */ }
    if (parsed.userId !== userId) return { active: false, reason: 'SESSION_REVOKED' as const };
    return {
      active: true,
      sessionId: sid,
      createdAt: parsed.createdAt ?? null,
      lastActiveAt: parsed.lastActiveAt ?? null,
      binding: parsed.binding ?? null,
    };
  }

  /** 세션 결합 조회(다른 모듈이 기기·키 상태를 되물을 때) */
  async sessionBinding(sid: string): Promise<SessionBinding | null> {
    const raw = await this.redis.get(`session:${sid}`);
    if (!raw) return null;
    try { return (JSON.parse(raw) as { binding?: SessionBinding }).binding ?? null; } catch { return null; }
  }

  /** 사용자 전 세션 폐기 — 퇴사·기기 폐기·권한 회수가 부른다 */
  async revokeAllSessionsOf(userId: string) {
    const sids = await this.redis.smembers(`sessions:${userId}`);
    await this.revokeAllTokens(userId);
    return sids.length;
  }

  /** 특정 기기에 결합된 세션만 폐기 — 기기 하나를 끊는데 다른 기기를 끊지 않는다 */
  async revokeSessionsByStaffDevice(userId: string, staffDeviceId: string) {
    const sids = await this.redis.smembers(`sessions:${userId}`);
    let revoked = 0;
    for (const sid of sids) {
      const binding = await this.sessionBinding(sid);
      if (binding?.staffDeviceId === staffDeviceId) {
        await this.revokeSession(userId, sid);
        revoked++;
      }
    }
    return revoked;
  }

  async logout(userId: string, refreshToken?: string, ctx?: AuthContext) {
    let sid: string | undefined;
    if (refreshToken) {
      try { sid = this.jwt.verify<RefreshPayload>(refreshToken, { secret: this.refreshSecret }).sid; } catch { /* 손상/만료 토큰 무시 */ }
    }
    if (sid) {
      // per-device 로그아웃 — 해당 세션만 종료(다른 기기 로그인 유지). SSO 자식은 60s 단명이라 미회수.
      await this.revokeSession(userId, sid);
    } else {
      // sid 불명(레거시 토큰/쿠키 없음) → 전 세션 로그아웃(안전 기본값)
      await this.revokeAllTokens(userId);
      await this.ssoIdp.revokeAllForUser(userId);
    }
    // 무엇을 끊었는지까지 남긴다 — 'ALL' 은 그 시점 다른 기기 세션도 함께 끊긴 것
    await this.auditSession(userId, 'LOGOUT', ctx, { scope: sid ? 'SESSION' : 'ALL', ...(sid ? { sid } : {}) });
  }

  /** 동시 세션 수 제한 — 초과 시 가장 오래된 세션 만료 */
  private async enforceMaxSessions(userId: string): Promise<void> {
    const sessionIds = await this.redis.smembers(`sessions:${userId}`);
    if (sessionIds.length <= this.maxConcurrentSessions) return;

    // 세션 정보 조회 + 정렬
    const sessions: Array<{ id: string; createdAt: string }> = [];
    for (const id of sessionIds) {
      const data = await this.redis.get(`session:${id}`);
      if (data) {
        try { sessions.push({ id, ...JSON.parse(data) }); } catch { /* skip */ }
      } else {
        // 만료된 세션 제거
        await this.redis.srem(`sessions:${userId}`, id);
      }
    }

    // 오래된 순으로 정렬, 초과분 삭제
    sessions.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    const toRemove = sessions.slice(0, sessions.length - this.maxConcurrentSessions);
    for (const s of toRemove) {
      await this.revokeSession(userId, s.id);
      this.logger.warn(`Session evicted for user ${userId}: ${s.id} (max ${this.maxConcurrentSessions} sessions)`);
    }
  }

  /** 비밀번호 변경 (정책 적용) */
  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('User not found');

    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    // 🔴 (2026-09-15) 종전 401 — web apiClient 는 401 을 **토큰 만료**로 읽어 refresh 후 재시도했다(입력 실수가 재인증 흐름을 탔다).
    //    사용자 입력 문제는 400 이다. 401 은 인증 자체 실패(토큰 없음·사용자 없음)에만 남긴다.
    //    불일치를 구체적으로 말하는 것은 정당하다 — 이미 로그인한 **본인** EP 라 계정 열거가 성립하지 않는다.
    if (!valid) throw new DomainException(PASSWORD_CURRENT_MISMATCH, '현재 비밀번호가 일치하지 않습니다.', HttpStatus.BAD_REQUEST);

    await this.validatePasswordPolicy(newPassword);

    const newHash = await bcrypt.hash(newPassword, 12);
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash: newHash,
        passwordChangedAt: new Date(),
      },
    });

    // 비밀번호 변경 시 모든 세션 만료 (보안)
    await this.revokeAllTokens(userId);
    return { message: '비밀번호가 변경되었습니다. 다시 로그인해주세요.' };
  }

  /**
   * 비밀번호 정책 검증 — 🔴 정본은 `password-policy.ts` 하나다.
   *    종전엔 이 함수 안에 규칙이 적혀 있었고, **관리자 초기화·사용자 생성 경로는
   *    이 함수를 부르지 않아** 8자만으로 통과했다(선언 기준 아래의 뒷문).
   */
  private async validatePasswordPolicy(password: string): Promise<void> {
    // security.password.minLength(R9-④) — 강화 전용. 조회 실패는 정본 하한(12) 유지.
    const v = await this.configRuntime?.get('security.password.minLength').catch(() => null);
    const n = typeof v === 'number' ? v : Number(v);
    const errors = passwordPolicyViolations(password, { minLength: Number.isFinite(n) ? n : null });
    if (errors.length > 0) {
      // 400 — 입력 문제(위 불일치와 같은 이유). 위반 목록은 details 로도 싣는다(화면이 한 번에 보여 준다).
      throw new DomainException(PASSWORD_POLICY_VIOLATION, `비밀번호 정책 위반: ${errors.join(', ')}`, HttpStatus.BAD_REQUEST, { violations: errors });
    }
  }

  /** 비밀번호 만료 확인 — 기간은 정본 `PASSWORD_MAX_AGE_DAYS` */
  async isPasswordExpired(userId: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { passwordChangedAt: true },
    });
    if (!user?.passwordChangedAt) return true; // 최초 설정 필요
    const daysSinceChange = (Date.now() - new Date(user.passwordChangedAt).getTime()) / 86400000;
    return daysSinceChange > PASSWORD_MAX_AGE_DAYS;
  }

  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        familyName: true,
        givenName: true,
        role: true,
        department: true,
        specialty: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    return user;
  }
}
