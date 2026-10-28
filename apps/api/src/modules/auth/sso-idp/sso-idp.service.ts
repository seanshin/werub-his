import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { RedisService } from '../../../infrastructure/redis/redis.service';

// 내부 IdP SSO — HIS 세션 → 하위 시스템 단기 토큰 (FR-06~08, 18)
// FR-06: 메인 access JWT와 분리된 독립 서명키, jti 1회소비, 단명(≤60s)
const TOKEN_TTL = 60; // 초
const ALLOWED_AUDIENCES = ['ohif', 'pacs', 'jitsi', 'clinic'];
// 경로 A(무수정 OHIF/PACS): URL 토큰 직접. 경로 B(제어가능): redemption code 백채널(FR-08)
const PATH_A = ['ohif', 'pacs'];

interface SsoTokenPayload {
  sub: string;
  role: string;
  aud: string;
  jti: string;
  typ: 'internal_sso';
}

@Injectable()
export class SsoIdpService {
  private readonly logger = new Logger(SsoIdpService.name);
  private readonly signingKey: string;
  private readonly introspectKey: string;

  constructor(
    private readonly jwt: JwtService,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {
    // 독립 키 (없으면 명시적 폴백 — 운영에선 반드시 설정)
    this.signingKey =
      this.config.get<string>('AUTH_SSO_SIGNING_KEY') ||
      this.config.getOrThrow<string>('AUTH_SECRET') + ':sso';
    this.introspectKey = this.config.get<string>('SSO_INTROSPECT_KEY') || this.signingKey;
  }

  // ── 발급 (FR-06) ──
  async grant(userId: string, role: string, audience: string) {
    if (!ALLOWED_AUDIENCES.includes(audience)) {
      throw new BadRequestException(`허용되지 않은 audience: ${audience}`);
    }
    const jti = randomUUID();
    const payload: SsoTokenPayload = { sub: userId, role, aud: audience, jti, typ: 'internal_sso' };
    const token = this.jwt.sign(payload, { secret: this.signingKey, expiresIn: TOKEN_TTL });

    // jti 추적(존재=유효·미소비) + 사용자별 자식 토큰 추적(SLO, FR-18)
    await this.redis
      .multi()
      .set(`sso:jti:${jti}`, userId, 'EX', TOKEN_TTL)
      .sadd(`sso:children:${userId}`, jti)
      .expire(`sso:children:${userId}`, TOKEN_TTL)
      .exec();

    if (PATH_A.includes(audience)) {
      // 경로 A: URL ?token= (OHIF 무수정). 보상통제: ≤60s·1회용·로그마스킹(nginx)·Referrer-Policy(FE)
      return { mode: 'url' as const, token, expiresIn: TOKEN_TTL };
    }
    // 경로 B: redemption code → 백채널 교환(FR-08)
    const code = randomUUID().replace(/-/g, '');
    await this.redis.set(`sso:redeem:${code}`, token, 'EX', TOKEN_TTL);
    return { mode: 'redeem' as const, redemptionCode: code, expiresIn: TOKEN_TTL };
  }

  // ── redemption 교환 (경로 B 백채널) ──
  async redeem(code: string) {
    const token = await this.redis.get(`sso:redeem:${code}`);
    if (!token) throw new BadRequestException('유효하지 않거나 만료된 코드입니다.');
    await this.redis.del(`sso:redeem:${code}`); // 1회 소비
    return { token };
  }

  // ── 검증 (FR-07, 하위시스템/프록시가 호출) ──
  async introspect(token: string, providedKey?: string) {
    if (providedKey !== this.introspectKey) {
      return { active: false };
    }
    let payload: SsoTokenPayload;
    try {
      payload = this.jwt.verify<SsoTokenPayload>(token, { secret: this.signingKey });
    } catch {
      return { active: false };
    }
    // jti 존재 확인 + 1회 소비(FR-06)
    const exists = await this.redis.get(`sso:jti:${payload.jti}`);
    if (!exists) return { active: false };
    await this.redis.del(`sso:jti:${payload.jti}`);
    return { active: true, sub: payload.sub, role: payload.role, aud: payload.aud };
  }

  // ── SLO / 수명주기: 사용자의 모든 SSO 자식 토큰 무효화 (FR-18/23) ──
  async revokeAllForUser(userId: string) {
    const jtis = await this.redis.smembers(`sso:children:${userId}`);
    if (jtis.length) {
      await this.redis.del(...jtis.map((j) => `sso:jti:${j}`));
    }
    await this.redis.del(`sso:children:${userId}`);
    this.logger.log(`SSO 자식 토큰 무효화 user=${userId} count=${jtis.length}`);
    return { revoked: jtis.length };
  }
}
