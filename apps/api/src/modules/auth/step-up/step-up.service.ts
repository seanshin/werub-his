import { Injectable, BadRequestException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import type { AuthenticationResponseJSON } from '@simplewebauthn/server';
import { RedisService } from '../../../infrastructure/redis/redis.service';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { PasskeyService } from '../passkey/passkey.service';

// Step-up 재인증 토큰 (FR-09) — (action, resourceId, bodyHash) 바인딩 + jti 1회소비
const STEPUP_TTL = 300; // 5분

export interface StepUpClaims {
  sub: string;
  action: string;
  resourceId?: string;
  bodyHash?: string;
  jti: string;
  typ: 'stepup';
}

@Injectable()
export class StepUpService {
  private readonly signingKey: string;

  constructor(
    private readonly jwt: JwtService,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
    private readonly passkey: PasskeyService,
    private readonly prisma: PrismaService,
  ) {
    this.signingKey =
      this.config.get<string>('AUTH_STEPUP_SIGNING_KEY') ||
      this.config.getOrThrow<string>('AUTH_SECRET') + ':stepup';
  }

  async getOptions(userId: string) {
    return this.passkey.getStepUpOptions(userId);
  }

  /**
   * 전자서명 액션용 유효 인증서 가드 — 둘 중 하나면 통과:
   *  ① 레거시 자체발급 ACTIVE blockchainCertificate(STAFF)  ② sign 발급 serial(user.signCertSerial·EXTERNAL).
   * sign 단독발급 전환 후엔 ②가 정상 경로(자체발급 OFF면 ①은 없음).
   */
  private async assertSignCert(userId: string) {
    const [cert, user] = await Promise.all([
      this.prisma.blockchainCertificate.findFirst({
        where: { ownerType: 'STAFF', userId, status: 'ACTIVE' },
        select: { id: true },
      }),
      this.prisma.user.findUnique({ where: { id: userId }, select: { signCertSerial: true } }),
    ]);
    if (!cert && !user?.signCertSerial) {
      throw new UnauthorizedException({ code: 'CERT_REQUIRED', message: '유효한 전자서명 인증서가 없습니다(폐기/만료 또는 미발급). sign enroll 후 재시도하세요.' });
    }
  }

  /** Tier2 생체 step-up 가능 여부 — 활성 패스키 보유(없으면 step-up 자체 불가). */
  async hasPasskey(userId: string): Promise<boolean> {
    return (await this.prisma.webAuthnCredential.count({ where: { userId, status: 'ACTIVE' } })) > 0;
  }

  /** Tier2 준비도 리포트(파일럿 선정용) — 의사별 패스키·FCM폰 보유 현황. */
  async tier2Readiness() {
    const doctors = await this.prisma.user.findMany({
      where: { role: 'DOCTOR' },
      select: { id: true, familyName: true, givenName: true },
      orderBy: [{ familyName: 'asc' }, { givenName: 'asc' }],
    });
    const ids = doctors.map((d) => d.id);
    const [passkeys, devices] = await Promise.all([
      this.prisma.webAuthnCredential.findMany({ where: { userId: { in: ids }, status: 'ACTIVE' }, select: { userId: true }, distinct: ['userId'] }),
      this.prisma.staffDevice.findMany({ where: { userId: { in: ids }, status: 'ACTIVE', fcmToken: { not: null } }, select: { userId: true }, distinct: ['userId'] }),
    ]);
    const pk = new Set(passkeys.map((p) => p.userId));
    const fc = new Set(devices.map((d) => d.userId));
    const rows = doctors.map((d) => ({
      userId: d.id,
      name: `${d.familyName ?? ''}${d.givenName ?? ''}`,
      passkey: pk.has(d.id),
      fcmPhone: fc.has(d.id),
      ready: pk.has(d.id) && fc.has(d.id),
    }));
    return { total: rows.length, ready: rows.filter((r) => r.ready).length, withPasskey: pk.size, withFcmPhone: fc.size, doctors: rows };
  }

  async verify(
    userId: string,
    response: AuthenticationResponseJSON,
    action: string,
    resourceId?: string,
    bodyHash?: string,
  ) {
    if (!action) throw new BadRequestException('action is required');
    await this.passkey.verifyStepUpAssertion(userId, response);

    // FR-44: 전자서명 액션은 유효 인증서 필수 — 폐기/미발급 시 서명용 step-up 차단(과거 서명은 무관)
    if (action.includes('SIGN')) await this.assertSignCert(userId);

    const jti = randomUUID();
    const claims: StepUpClaims = { sub: userId, action, resourceId, bodyHash, jti, typ: 'stepup' };
    const stepUpToken = this.jwt.sign(claims, { secret: this.signingKey, expiresIn: STEPUP_TTL });
    await this.redis.set(`stepup:jti:${jti}`, userId, 'EX', STEPUP_TTL);
    return { stepUpToken, expiresIn: STEPUP_TTL };
  }

  /**
   * 푸시 승인 경로 토큰 발급 — 폰 생체 승인 후(passkey assertion 없이). 폰(등록 단말+로컬 생체)이 second factor.
   * PushApprovalService 에서만 호출(승인 소유권·PENDING·만료 검증 후). verify()와 동일 클레임·jti·서명.
   */
  async issueDirect(userId: string, action: string, resourceId?: string, bodyHash?: string) {
    if (!action) throw new BadRequestException('action is required');
    if (action.includes('SIGN')) await this.assertSignCert(userId);
    const jti = randomUUID();
    const claims: StepUpClaims = { sub: userId, action, resourceId, bodyHash, jti, typ: 'stepup' };
    const stepUpToken = this.jwt.sign(claims, { secret: this.signingKey, expiresIn: STEPUP_TTL });
    await this.redis.set(`stepup:jti:${jti}`, userId, 'EX', STEPUP_TTL);
    return { stepUpToken, expiresIn: STEPUP_TTL };
  }

  /** 가드용: 토큰 검증 + action·sub 확인 + jti 1회 소비 (FR-09/10) */
  async consume(
    token: string,
    userId: string,
    requiredAction: string,
    opts?: { resourceId?: string; bodyHash?: string },
  ): Promise<StepUpClaims> {
    let claims: StepUpClaims;
    try {
      claims = this.jwt.verify<StepUpClaims>(token, { secret: this.signingKey });
    } catch {
      throw new UnauthorizedException({ code: 'STEPUP_REQUIRED', message: '재인증 토큰이 유효하지 않습니다.' });
    }
    if (claims.typ !== 'stepup' || claims.sub !== userId || claims.action !== requiredAction) {
      throw new UnauthorizedException({ code: 'STEPUP_REQUIRED', message: '재인증이 필요합니다.' });
    }
    if (opts?.resourceId && claims.resourceId && claims.resourceId !== opts.resourceId) {
      throw new UnauthorizedException({ code: 'STEPUP_MISMATCH', message: '대상이 일치하지 않습니다.' });
    }
    if (opts?.bodyHash && claims.bodyHash && claims.bodyHash !== opts.bodyHash) {
      throw new UnauthorizedException({ code: 'STEPUP_MISMATCH', message: '요청 내용이 변경되었습니다.' });
    }
    // jti 존재 확인 + 1회 소비
    const exists = await this.redis.get(`stepup:jti:${claims.jti}`);
    if (!exists) throw new UnauthorizedException({ code: 'STEPUP_REQUIRED', message: '재인증이 만료/소비되었습니다.' });
    await this.redis.del(`stepup:jti:${claims.jti}`);
    return claims;
  }
}
