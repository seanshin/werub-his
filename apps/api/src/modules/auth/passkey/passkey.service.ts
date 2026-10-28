import {
  Injectable,
  Logger,
  BadRequestException,
  UnauthorizedException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import type {
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
} from '@simplewebauthn/server';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { RedisService } from '../../../infrastructure/redis/redis.service';
import { AuthService } from '../auth.service';
import type { AuthContext } from '../auth-audit';

const CHALLENGE_TTL = 300; // 5분 (FR-28)
const MAX_CREDENTIALS_PER_USER = 3; // D-5 (FR-52)

@Injectable()
export class PasskeyService {
  private readonly logger = new Logger(PasskeyService.name);
  private readonly rpID: string;
  private readonly rpName: string;
  private readonly expectedOrigins: string[];

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
    private readonly auth: AuthService,
  ) {
    // FR-22: RP ID는 환경변수 기반 고정 (hostname 직접 사용 금지)
    this.rpID = this.config.get<string>('WEBAUTHN_RP_ID') || 'localhost';
    this.rpName = this.config.get<string>('WEBAUTHN_RP_NAME') || '위루비병원';
    const originEnv = this.config.get<string>('WEBAUTHN_ORIGIN');
    this.expectedOrigins = originEnv
      ? originEnv.split(',').map((o) => o.trim()).filter(Boolean)
      : [`https://${this.rpID}`, 'http://localhost:3000'];
  }

  /**
   * FR-13: 정책 maxDevices 동적 반영 — 인증정책 3중화 수렴(§7 P2·2026-08-04).
   * 🔴 종전엔 Redis `auth:policy` 만 봐서 /admin/identity(DB AuthPolicy) 변경이 패스키 한도에 무효였다.
   * 우선순위: DB AuthPolicy(GLOBAL→ROLE 병합·정본) → Redis(lifecycle 레거시 경로) → 상수 폴백.
   */
  private async policyMaxDevices(role?: string | null): Promise<number> {
    try {
      const rows = await this.prisma.authPolicy.findMany({
        where: { OR: [{ scope: 'GLOBAL', scopeRef: '*' }, ...(role ? [{ scope: 'ROLE', scopeRef: role }] : [])] },
        select: { scope: true, maxDevices: true },
      });
      const roleRow = rows.find((r) => r.scope === 'ROLE');
      const globalRow = rows.find((r) => r.scope === 'GLOBAL');
      const dbVal = roleRow?.maxDevices ?? globalRow?.maxDevices;
      if (Number.isFinite(dbVal) && (dbVal as number) > 0) return dbVal as number;
    } catch { /* DB 실패 시 레거시 경로로 */ }
    try {
      const raw = await this.redis.get('auth:policy');
      const n = raw ? Number(JSON.parse(raw).maxDevices) : NaN;
      return Number.isFinite(n) && n > 0 ? n : MAX_CREDENTIALS_PER_USER;
    } catch {
      return MAX_CREDENTIALS_PER_USER;
    }
  }

  // ── 등록 (FR-02) ──
  async getRegistrationOptions(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const existing = await this.prisma.webAuthnCredential.findMany({
      where: { userId, status: 'ACTIVE' },
    });
    const maxDevices = await this.policyMaxDevices(user.role);
    if (existing.length >= maxDevices) {
      throw new ConflictException(
        `최대 ${maxDevices}개의 패스키만 등록할 수 있습니다.`,
      );
    }

    const options = await generateRegistrationOptions({
      rpName: this.rpName,
      rpID: this.rpID,
      userName: user.email,
      userDisplayName: `${user.familyName}${user.givenName}`,
      attestationType: 'none', // D-7: 고보증 역할 attestation은 후속 강화
      excludeCredentials: existing.map((c) => ({
        id: c.credentialId,
        transports: c.transports as AuthenticatorTransportLike[],
      })),
      authenticatorSelection: {
        residentKey: 'preferred', // D-3
        userVerification: 'required', // FR-20
        authenticatorAttachment: 'platform', // 단말 내장 생체
      },
    });

    await this.redis.set(
      `webauthn:reg:${userId}`,
      options.challenge,
      'EX',
      CHALLENGE_TTL,
    );
    return options;
  }

  async verifyRegistration(
    userId: string,
    response: RegistrationResponseJSON,
    deviceName?: string,
  ) {
    const expectedChallenge = await this.redis.get(`webauthn:reg:${userId}`);
    if (!expectedChallenge) {
      throw new BadRequestException('등록 세션이 만료되었습니다. 다시 시도하세요.');
    }
    await this.redis.del(`webauthn:reg:${userId}`); // 1회 소비 (FR-28)

    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response,
        expectedChallenge,
        expectedOrigin: this.expectedOrigins,
        expectedRPID: this.rpID,
        requireUserVerification: true,
      });
    } catch (e) {
      this.logger.warn(`passkey 등록 검증 실패 user=${userId}: ${(e as Error).message}`);
      throw new BadRequestException('패스키 등록 검증에 실패했습니다.');
    }

    if (!verification.verified || !verification.registrationInfo) {
      throw new BadRequestException('패스키 등록을 확인할 수 없습니다.');
    }

    const { credential, credentialBackedUp, aaguid } = verification.registrationInfo;

    const saved = await this.prisma.webAuthnCredential.create({
      data: {
        userId,
        credentialId: credential.id,
        publicKey: Buffer.from(credential.publicKey),
        counter: BigInt(credential.counter ?? 0),
        transports: credential.transports ?? [],
        aaguid: aaguid ?? null,
        backedUp: credentialBackedUp ?? false,
        deviceName: deviceName ?? null,
      },
    });

    // 생체 등록 변경 로그 — 패스키 등록(셀프 포함)
    await this.prisma.auditLog.create({
      data: { userId, action: 'CREATE', resourceType: 'PASSKEY', resourceId: saved.id, changes: { action: 'PASSKEY_REGISTER', deviceName: saved.deviceName, credentialId: credential.id } },
    }).catch(() => undefined);

    return { id: saved.id, deviceName: saved.deviceName, createdAt: saved.createdAt };
  }

  // ── 로그인 (FR-03/25) ──
  async getLoginOptions(identifier?: string) {
    let allowCredentials: { id: string; transports?: AuthenticatorTransportLike[] }[] = [];

    if (identifier) {
      // 식별자 제공 시 해당 사용자 credential. 미존재여도 동일 응답(FR-25 계정열거 방어)
      const user = await this.prisma.user.findUnique({ where: { email: identifier } });
      if (user) {
        const creds = await this.prisma.webAuthnCredential.findMany({
          where: { userId: user.id, status: 'ACTIVE' },
        });
        allowCredentials = creds.map((c) => ({
          id: c.credentialId,
          transports: c.transports as AuthenticatorTransportLike[],
        }));
      }
    }

    const options = await generateAuthenticationOptions({
      rpID: this.rpID,
      userVerification: 'required',
      allowCredentials: allowCredentials.length ? allowCredentials : undefined,
    });

    const flowId = randomUUID();
    await this.redis.set(
      `webauthn:auth:${flowId}`,
      options.challenge,
      'EX',
      CHALLENGE_TTL,
    );
    return { flowId, options };
  }

  async verifyLogin(flowId: string, response: AuthenticationResponseJSON, ctx?: AuthContext) {
    const expectedChallenge = await this.redis.get(`webauthn:auth:${flowId}`);
    if (!expectedChallenge) {
      throw new UnauthorizedException('로그인 세션이 만료되었습니다.');
    }
    await this.redis.del(`webauthn:auth:${flowId}`); // 1회 소비

    const cred = await this.prisma.webAuthnCredential.findUnique({
      where: { credentialId: response.id },
      include: { device: { select: { id: true, status: true } } },
    });
    if (!cred || cred.status !== 'ACTIVE') {
      throw new UnauthorizedException({ code: 'NO_CREDENTIAL', message: '등록된 패스키가 없습니다.' });
    }

    /**
     * 🔴 credential 이 ACTIVE 인 것과 **병원이 그 기기를 승인한 것**은 다른 사실이다.
     *
     * 등록 흐름(`DeviceEnrollService.register`)은 미인증 공개 EP 에서 패스키를 만들고
     * `WebAuthnCredential.status` 기본값이 `ACTIVE` 인데 StaffDevice 는 `PENDING_CONFIRM` 으로 둔다.
     * 여기서 기기를 보지 않았으므로 **관리자 확정 전 패스키로 로그인이 됐다** —
     * 등록 세션ID와 6자리 코드만 알면 대상 직원 계정으로 들어갈 수 있는 경로였다.
     *
     * 실측(2026-08-24 운영): `PENDING_CONFIRM` 기기 **0건** · credential 4건 전부 기기 상태와 일치
     * (ACTIVE/ACTIVE 2 · REVOKED/REVOKED 2) — **구조적 결함이고 실제 통과 이력은 없다.**
     * `deviceId` 가 없는 credential 도 0건이라, 검사를 켜도 잠기는 기존 사용자가 없다.
     *
     * `deviceId` 가 없는 레거시 패스키는 막지 않는다(막으면 로그인이 통째로 막힌다).
     * 대신 그 경로가 남아 있다는 사실을 로그로 남긴다 — 조용히 통과시키지 않는다.
     */
    if (cred.deviceId) {
      if (cred.device?.status !== 'ACTIVE') {
        this.logger.warn(
          `🚨 패스키 로그인 차단 — 기기 미승인 cred=${cred.id} device=${cred.deviceId} status=${cred.device?.status ?? '(없음)'}`,
        );
        throw new UnauthorizedException({
          code: cred.device?.status === 'PENDING_CONFIRM' ? 'ENROLLMENT_PENDING_CONFIRM' : 'DEVICE_NOT_ACTIVE',
          message:
            cred.device?.status === 'PENDING_CONFIRM'
              ? '관리자 확정 대기 중인 기기입니다. 확정 후 로그인할 수 있습니다.'
              : '승인되지 않은 기기입니다. 관리자에게 문의하세요.',
        });
      }
    } else {
      this.logger.log(`패스키 로그인 — 기기 미연결 credential(레거시) cred=${cred.id} user=${cred.userId}`);
    }

    // 진단: 클라이언트가 보낸 origin (in-app 브라우저 origin 불일치 추적)
    let clientOrigin = '?';
    try {
      const cd = JSON.parse(Buffer.from(response.response.clientDataJSON, 'base64').toString('utf8'));
      clientOrigin = cd.origin;
    } catch { /* ignore */ }

    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response,
        expectedChallenge,
        expectedOrigin: this.expectedOrigins,
        expectedRPID: this.rpID,
        requireUserVerification: true,
        credential: {
          id: cred.credentialId,
          publicKey: new Uint8Array(cred.publicKey),
          counter: Number(cred.counter),
          transports: cred.transports as AuthenticatorTransportLike[],
        },
      });
    } catch (e) {
      this.logger.warn(`passkey 로그인 검증 실패 cred=${cred.id} clientOrigin=${clientOrigin} expected=${JSON.stringify(this.expectedOrigins)} rpID=${this.rpID}: ${(e as Error).message}`);
      throw new UnauthorizedException({ code: 'PASSKEY_INVALID', message: '패스키 인증에 실패했습니다.' });
    }

    if (!verification.verified) {
      this.logger.warn(`passkey 로그인 미검증 cred=${cred.id} clientOrigin=${clientOrigin} expected=${JSON.stringify(this.expectedOrigins)}`);
      throw new UnauthorizedException({ code: 'PASSKEY_INVALID', message: '패스키 인증에 실패했습니다.' });
    }

    // FR-21: signCount 검사 — 역행 시 복제 의심 → 잠금
    const newCounter = verification.authenticationInfo.newCounter;
    if (newCounter > 0 && newCounter <= Number(cred.counter) && cred.backedUp === false) {
      await this.prisma.webAuthnCredential.update({
        where: { id: cred.id },
        data: { status: 'LOCKED' },
      });
      this.logger.warn(`🚨 signCount 역행 — credential 잠금 cred=${cred.id}`);
      throw new UnauthorizedException({
        code: 'SIGN_COUNT_REGRESS',
        message: '보안 점검이 필요합니다. 관리자에게 문의하세요.',
      });
    }

    await this.prisma.webAuthnCredential.update({
      where: { id: cred.id },
      data: { counter: BigInt(newCounter), lastUsedAt: new Date() },
    });
    // StaffDevice 최근 사용 갱신(미사용 만료 판정용, credential-admin FR-02)
    if (cred.deviceId) {
      await this.prisma.staffDevice
        .update({ where: { id: cred.deviceId }, data: { lastUsedAt: new Date() } })
        .catch(() => undefined);
    }

    const user = await this.prisma.user.findUnique({ where: { id: cred.userId } });
    if (!user || !user.isActive) {
      throw new UnauthorizedException('비활성 계정입니다.');
    }
    // 온보딩 임시계정(PRE_BOARD)은 정규 staff 세션 발급 금지(§5.6 격리). 활성화(ACTIVE) 후에만 로그인.
    if (user.accountStage === 'PRE_BOARD') {
      throw new UnauthorizedException('아직 입사 승인 전 계정입니다. 담당자 승인 후 이용할 수 있습니다.');
    }

    return this.auth.issueSession({ id: user.id, email: user.email, role: user.role }, { method: 'PASSKEY', ...ctx });
  }

  // ── Step-up 재인증용 (FR-09) — 세션 발급 없이 본인 패스키 assertion만 검증 ──
  async getStepUpOptions(userId: string) {
    const creds = await this.prisma.webAuthnCredential.findMany({
      where: { userId, status: 'ACTIVE' },
    });
    if (!creds.length) {
      throw new NotFoundException({ code: 'NO_CREDENTIAL', message: '등록된 패스키가 없습니다.' });
    }
    const options = await generateAuthenticationOptions({
      rpID: this.rpID,
      userVerification: 'required',
      allowCredentials: creds.map((c) => ({
        id: c.credentialId,
        transports: c.transports as AuthenticatorTransportLike[],
      })),
    });
    await this.redis.set(`stepup:chal:${userId}`, options.challenge, 'EX', CHALLENGE_TTL);
    return options;
  }

  /** step-up assertion 검증 — 반드시 userId 본인 credential 이어야 함. 성공 시 void */
  async verifyStepUpAssertion(userId: string, response: AuthenticationResponseJSON) {
    const expectedChallenge = await this.redis.get(`stepup:chal:${userId}`);
    if (!expectedChallenge) {
      this.logger.warn(`step-up 챌린지 없음 user=${userId} credId=${response?.id?.slice(0, 12)} — options 미선행/만료/중복소비`);
      throw new UnauthorizedException('재인증 세션이 만료되었습니다.');
    }
    await this.redis.del(`stepup:chal:${userId}`);

    // 진단: 클라이언트 origin(인앱/도메인 불일치 추적)
    let clientOrigin = '?';
    try {
      const cd = JSON.parse(Buffer.from(response.response.clientDataJSON, 'base64').toString('utf8'));
      clientOrigin = cd.origin;
    } catch { /* ignore */ }

    const cred = await this.prisma.webAuthnCredential.findUnique({
      where: { credentialId: response.id },
    });
    if (!cred || cred.status !== 'ACTIVE' || cred.userId !== userId) {
      this.logger.warn(`step-up 패스키 불일치 user=${userId} credFound=${!!cred} status=${cred?.status} owner=${cred?.userId} origin=${clientOrigin}`);
      throw new UnauthorizedException({ code: 'PASSKEY_INVALID', message: '본인 패스키가 아닙니다.' });
    }

    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response,
        expectedChallenge,
        expectedOrigin: this.expectedOrigins,
        expectedRPID: this.rpID,
        requireUserVerification: true,
        credential: {
          id: cred.credentialId,
          publicKey: new Uint8Array(cred.publicKey),
          counter: Number(cred.counter),
          transports: cred.transports as AuthenticatorTransportLike[],
        },
      });
    } catch (e) {
      this.logger.warn(`step-up 검증 예외 user=${userId} origin=${clientOrigin} expected=${JSON.stringify(this.expectedOrigins)} rpID=${this.rpID}: ${(e as Error).message}`);
      throw new UnauthorizedException({ code: 'PASSKEY_INVALID', message: '재인증에 실패했습니다.' });
    }
    if (!verification.verified) {
      this.logger.warn(`step-up 검증 false user=${userId} origin=${clientOrigin}`);
      throw new UnauthorizedException({ code: 'PASSKEY_INVALID', message: '재인증에 실패했습니다.' });
    }

    const newCounter = verification.authenticationInfo.newCounter;
    if (newCounter > 0 && newCounter <= Number(cred.counter) && cred.backedUp === false) {
      await this.prisma.webAuthnCredential.update({ where: { id: cred.id }, data: { status: 'LOCKED' } });
      throw new UnauthorizedException({ code: 'SIGN_COUNT_REGRESS', message: '보안 점검이 필요합니다.' });
    }
    await this.prisma.webAuthnCredential.update({
      where: { id: cred.id },
      data: { counter: BigInt(newCounter), lastUsedAt: new Date() },
    });
  }

  // ── 관리 (FR-12/52) ──
  async listCredentials(userId: string) {
    const creds = await this.prisma.webAuthnCredential.findMany({
      where: { userId, status: { not: 'REVOKED' } },
      orderBy: { createdAt: 'desc' },
    });
    return creds.map((c) => ({
      id: c.id,
      deviceName: c.deviceName,
      status: c.status,
      backedUp: c.backedUp,
      createdAt: c.createdAt,
      lastUsedAt: c.lastUsedAt,
    }));
  }

  async rename(userId: string, id: string, deviceName: string) {
    const cred = await this.prisma.webAuthnCredential.findFirst({ where: { id, userId } });
    if (!cred) throw new NotFoundException('패스키를 찾을 수 없습니다.');
    await this.prisma.webAuthnCredential.update({ where: { id }, data: { deviceName } });
    return { id, deviceName };
  }

  async remove(userId: string, id: string) {
    const cred = await this.prisma.webAuthnCredential.findFirst({ where: { id, userId } });
    if (!cred) throw new NotFoundException('패스키를 찾을 수 없습니다.');

    // FR-52: 최소 1개 유지 (전부 삭제 차단 — 락아웃 방지)
    const activeCount = await this.prisma.webAuthnCredential.count({
      where: { userId, status: 'ACTIVE' },
    });
    if (cred.status === 'ACTIVE' && activeCount <= 1) {
      throw new ConflictException(
        '마지막 패스키는 삭제할 수 없습니다. 새 패스키를 먼저 등록하세요.',
      );
    }
    await this.prisma.webAuthnCredential.update({
      where: { id },
      data: { status: 'REVOKED' },
    });
    // 생체 등록 변경 로그 — 패스키 폐기
    await this.prisma.auditLog.create({
      data: { userId, action: 'DELETE', resourceType: 'PASSKEY', resourceId: id, changes: { action: 'PASSKEY_REVOKE', deviceName: cred.deviceName } },
    }).catch(() => undefined);
    return { id, status: 'REVOKED' };
  }
}

// @simplewebauthn v13 transports 타입 호환용 alias
type AuthenticatorTransportLike =
  | 'ble'
  | 'cable'
  | 'hybrid'
  | 'internal'
  | 'nfc'
  | 'smart-card'
  | 'usb';
