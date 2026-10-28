import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes, randomUUID } from 'node:crypto';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { RedisService } from '../../../infrastructure/redis/redis.service';
import { ExternalCredentialsService } from '../external-credentials.service';
import {
  AppAttestError,
  verifyAssertion,
  verifyAttestation,
} from './app-attest.verifier';
import { assertionClientData, attestationClientData } from './app-key.canonical';

import { devSwitchOn } from '../../../common/release-security';
export type MobileApp = 'PATIENT_IOS' | 'STAFF_IOS';

const CHALLENGE_TTL = 300; // 5분 — 요청서 규정
const MAX_KEYS_PER_INSTALLATION = 5;

/**
 * 앱 설치 개별키 — 등록·assertion 검증·결합·폐기.
 *
 * 🔴 **개별키는 사용자 인증이 아니다.** "등록된 정식 앱 설치가 보낸 요청인지"만 말한다.
 *    반대로, 올바른 Passkey·비밀번호가 있어도 요구된 키가 폐기 상태면 세션을 발급하지 않는다.
 */
@Injectable()
export class AppKeyService {
  private readonly logger = new Logger(AppKeyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly credentials: ExternalCredentialsService,
  ) {}

  /** 앱별 App ID — Team ID·Bundle ID 는 밖에서 와야 하는 값이라 미설정이면 **거절한다** */
  private appId(app: MobileApp): { appId: string; bundleId: string } {
    const teamId = this.credentials.requireValue('apple.appIdentity', 'APPLE_TEAM_ID');
    const bundleId = this.credentials.requireValue(
      'apple.appIdentity',
      app === 'STAFF_IOS' ? 'IOS_STAFF_BUNDLE_ID' : 'IOS_PATIENT_BUNDLE_ID',
    );
    return { appId: `${teamId}.${bundleId}`, bundleId };
  }

  /**
   * 허용 attestation 환경 — 🔴 **기본은 PRODUCTION 만**.
   *
   * `NODE_ENV !== 'production'` 으로 갈랐더니 운영 서버에 그 변수가 없어(2026-08-24 실측)
   * development attestation 이 운영에서 통과할 수 있었다. 안전 분기를 미설정 변수에 걸지 않는다.
   * 개발·TestFlight 는 `APP_ATTEST_ALLOW_DEVELOPMENT=true` 로 **명시적으로 켠다**.
   */
  private allowedEnvironments(): Array<'DEVELOPMENT' | 'PRODUCTION'> {
    const allowDev = devSwitchOn('APP_ATTEST_ALLOW_DEVELOPMENT'); // 🔴 T4-3 — REAL 은 development attestation 불허
    return allowDev ? ['DEVELOPMENT', 'PRODUCTION'] : ['PRODUCTION'];
  }

  // ── 등록 ──

  async attestationChallenge(input: {
    app: MobileApp;
    installationId: string;
    bundleId: string;
    appVersion?: string;
    osVersion?: string;
  }) {
    // 요청의 bundleId 는 **주장일 뿐**이다. 최종 판정은 attestation 이 한다.
    const { bundleId: expectedBundleId } = this.appId(input.app);
    if (input.bundleId !== expectedBundleId) {
      throw new BadRequestException({
        code: 'APP_ATTESTATION_INVALID',
        message: '등록되지 않은 Bundle ID 입니다.',
      });
    }

    const created = await this.redis.get(`appkey:count:${input.installationId}`);
    if (Number(created ?? 0) >= MAX_KEYS_PER_INSTALLATION) {
      throw new ForbiddenException({
        code: 'RATE_LIMITED',
        message: '이 설치에서 만들 수 있는 키 수를 초과했습니다.',
      });
    }

    const challengeId = randomUUID();
    const challenge = randomBytes(32).toString('base64url');
    await this.redis.set(
      `appkey:att:${challengeId}`,
      JSON.stringify({ app: input.app, installationId: input.installationId, challenge }),
      'EX',
      CHALLENGE_TTL,
    );
    return {
      challengeId,
      challenge,
      expiresAt: new Date(Date.now() + CHALLENGE_TTL * 1000).toISOString(),
      attestationEnvironment: this.allowedEnvironments()[0],
    };
  }

  async register(input: {
    challengeId: string;
    installationId: string;
    keyId: string;
    attestationObject: string;
    appVersion?: string;
  }) {
    const raw = await this.redis.get(`appkey:att:${input.challengeId}`);
    if (!raw) {
      throw new BadRequestException({ code: 'APP_ASSERTION_EXPIRED', message: 'challenge 가 만료되었습니다.' });
    }
    await this.redis.del(`appkey:att:${input.challengeId}`); // 1회 소비

    const saved = JSON.parse(raw) as { app: MobileApp; installationId: string; challenge: string };
    if (saved.installationId !== input.installationId) {
      throw new BadRequestException({ code: 'APP_ATTESTATION_INVALID', message: '설치 식별자가 일치하지 않습니다.' });
    }
    const { appId, bundleId } = this.appId(saved.app);

    // 🔴 client 가 보낸 clientData 를 받지 않는다 — 서버가 저장한 값으로 **다시 만든다**
    const canonical = attestationClientData({
      app: saved.app,
      bundleId,
      installationId: saved.installationId,
      challenge: saved.challenge,
    });

    let result;
    try {
      result = verifyAttestation({
        attestationObject: input.attestationObject,
        keyId: input.keyId,
        canonicalClientData: canonical,
        appId,
        allowedEnvironments: this.allowedEnvironments(),
      });
    } catch (e) {
      if (e instanceof AppAttestError) {
        this.logger.warn(`App Attest 등록 실패 [${e.code}] installation=${saved.installationId}: ${e.message}`);
        throw new BadRequestException({ code: e.code, message: e.message });
      }
      throw e;
    }

    // 같은 공개키·keyId 가 다른 설치·사용자에 붙지 않게 한다
    const dup = await this.prisma.appInstallationKey.findFirst({
      where: {
        OR: [{ appleKeyId: input.keyId }, { publicKeyFingerprint: result.publicKeyFingerprint }],
      },
      select: { id: true, installationId: true, status: true },
    });
    if (dup) {
      throw new ForbiddenException({
        code: 'APP_KEY_ALREADY_BOUND',
        message: '이미 등록된 키입니다.',
      });
    }

    const key = await this.prisma.appInstallationKey.create({
      data: {
        app: saved.app,
        installationId: saved.installationId,
        appleKeyId: input.keyId,
        publicKey: new Uint8Array(result.publicKey),
        publicKeyFingerprint: result.publicKeyFingerprint,
        receiptEncrypted: result.receipt ? result.receipt.toString('base64') : null,
        attestationEnvironment: result.environment,
        bundleId,
        bundleVersion: input.appVersion ?? null,
        status: 'PENDING',
      },
      select: { id: true, status: true, attestationEnvironment: true },
    });

    await this.redis.multi()
      .incr(`appkey:count:${saved.installationId}`)
      .expire(`appkey:count:${saved.installationId}`, 86400)
      .exec();

    this.logger.log(`App Attest 등록 app=${saved.app} key=${key.id} env=${result.environment}`);
    // 🔴 receipt 는 응답에 담지 않는다(Apple fraud 조회용 · 민감)
    return { appKeyId: key.id, status: key.status, attestationEnvironment: key.attestationEnvironment };
  }

  // ── assertion ──

  async assertionChallenge(input: {
    appKeyId: string;
    purpose: string;
    method: string;
    path: string;
    bodySha256?: string;
    sessionId?: string;
  }) {
    const key = await this.prisma.appInstallationKey.findUnique({
      where: { id: input.appKeyId },
      select: { id: true, status: true, installationId: true },
    });
    if (!key) throw new NotFoundException({ code: 'APP_KEY_REGISTRATION_REQUIRED', message: '등록되지 않은 키입니다.' });
    if (key.status === 'REVOKED') {
      throw new ForbiddenException({ code: 'APP_KEY_REVOKED', message: '폐기된 키입니다.' });
    }

    const challengeId = randomUUID();
    const challenge = randomBytes(32).toString('base64url');
    await this.redis.set(
      `appkey:asr:${challengeId}`,
      JSON.stringify({ ...input, challenge, installationId: key.installationId }),
      'EX',
      CHALLENGE_TTL,
    );
    return { challengeId, challenge, expiresAt: new Date(Date.now() + CHALLENGE_TTL * 1000).toISOString() };
  }

  /**
   * 요청 하나를 검증한다 — 서명·App ID·challenge·목적·method/path/body·설치 결합.
   * challenge 는 **원자적으로 소비**한다(같은 challenge 로 두 요청이 통과하지 않는다).
   */
  async assertRequest(input: {
    appKeyId: string;
    challengeId: string;
    assertion: string;
    purpose: string;
    method: string;
    path: string;
    bodySha256?: string;
    sessionId?: string;
  }) {
    const raw = await this.redis.getdel(`appkey:asr:${input.challengeId}`);
    if (!raw) {
      throw new BadRequestException({
        code: 'APP_ASSERTION_EXPIRED',
        message: 'assertion challenge 가 만료되었거나 이미 사용되었습니다.',
      });
    }
    const saved = JSON.parse(raw) as {
      appKeyId: string; purpose: string; method: string; path: string;
      bodySha256?: string; sessionId?: string; challenge: string; installationId: string;
    };

    // 발급 때 적은 것과 지금 요청이 같은가 — 다른 endpoint·body 로 전용하지 못한다
    const mismatch =
      saved.appKeyId !== input.appKeyId ||
      saved.purpose !== input.purpose ||
      saved.method !== input.method ||
      saved.path !== input.path ||
      (saved.bodySha256 ?? undefined) !== (input.bodySha256 ?? undefined) ||
      (saved.sessionId ?? undefined) !== (input.sessionId ?? undefined);
    if (mismatch) {
      throw new BadRequestException({
        code: 'APP_ASSERTION_INVALID',
        message: 'assertion 이 이 요청에 대해 발급된 것이 아닙니다.',
      });
    }

    const key = await this.prisma.appInstallationKey.findUnique({ where: { id: input.appKeyId } });
    if (!key) throw new NotFoundException({ code: 'APP_KEY_REGISTRATION_REQUIRED', message: '등록되지 않은 키입니다.' });
    if (key.status === 'REVOKED') throw new ForbiddenException({ code: 'APP_KEY_REVOKED', message: '폐기된 키입니다.' });

    const { appId } = this.appId(key.app as MobileApp);
    const canonical = assertionClientData({
      challengeId: input.challengeId,
      challenge: saved.challenge,
      purpose: saved.purpose,
      method: saved.method,
      path: saved.path,
      bodySha256: saved.bodySha256,
      installationId: saved.installationId,
      sessionId: saved.sessionId,
    });

    let result;
    try {
      result = verifyAssertion({
        assertion: input.assertion,
        canonicalClientData: canonical,
        appId,
        publicKey: Buffer.from(key.publicKey),
        storedCounter: Number(key.assertionCounter),
      });
    } catch (e) {
      if (e instanceof AppAttestError) {
        this.logger.warn(`App Attest assertion 실패 [${e.code}] key=${key.id}: ${e.message}`);
        throw new BadRequestException({ code: e.code, message: e.message });
      }
      throw e;
    }

    await this.prisma.appInstallationKey.update({
      where: { id: key.id },
      data: { assertionCounter: BigInt(result.counter), lastAssertedAt: new Date() },
    });
    return { appKeyId: key.id, app: key.app as MobileApp, installationId: key.installationId, status: key.status };
  }

  // ── 결합·상태·폐기 ──

  /** 스탭: 정확히 한 사용자+기기에만 결합한다 */
  async bindStaff(appKeyId: string, staffUserId: string, staffDeviceId: string) {
    const key = await this.prisma.appInstallationKey.findUnique({ where: { id: appKeyId } });
    if (!key) throw new NotFoundException({ code: 'APP_KEY_REGISTRATION_REQUIRED', message: '등록되지 않은 키입니다.' });
    if (key.app !== 'STAFF_IOS') throw new BadRequestException({ code: 'APP_KEY_ALREADY_BOUND', message: '스탭 앱 키가 아닙니다.' });
    if (key.staffUserId && key.staffUserId !== staffUserId) {
      throw new ForbiddenException({ code: 'APP_KEY_ALREADY_BOUND', message: '다른 사용자에 결합된 키입니다.' });
    }
    return this.prisma.appInstallationKey.update({
      where: { id: appKeyId },
      data: { staffUserId, staffDeviceId, status: 'ACTIVE', boundAt: new Date() },
      select: { id: true, status: true },
    });
  }

  async bindPatient(appKeyId: string, patientAccountId: string, patientDeviceId?: string) {
    const key = await this.prisma.appInstallationKey.findUnique({ where: { id: appKeyId } });
    if (!key) throw new NotFoundException({ code: 'APP_KEY_REGISTRATION_REQUIRED', message: '등록되지 않은 키입니다.' });
    if (key.app !== 'PATIENT_IOS') throw new BadRequestException({ code: 'APP_KEY_ALREADY_BOUND', message: '환자 앱 키가 아닙니다.' });
    if (key.patientAccountId && key.patientAccountId !== patientAccountId) {
      throw new ForbiddenException({ code: 'APP_KEY_ALREADY_BOUND', message: '다른 계정에 결합된 키입니다.' });
    }
    return this.prisma.appInstallationKey.update({
      where: { id: appKeyId },
      data: { patientAccountId, patientDeviceId: patientDeviceId ?? null, status: 'ACTIVE', boundAt: new Date() },
      select: { id: true, status: true },
    });
  }

  /**
   * 소유 대조 — 🔴 (2026-09-16 H3) 이 파일 머리말은 "`status/revoke` 는 소유 세션 또는 관리자만 —
   * URL 의 appKeyId 만으로 조회·변경할 수 없다"고 **약속만 하고 있었다**. 컨트롤러가 세션 주체를 넘기지
   * 않아 두 핸들러 다 appKeyId 하나로 동작했다 — 인증된 아무 직원이나 **남의(환자 앱 포함) 설치키를 폐기**할
   * 수 있었다(앱 무결성 결속이 끊겨 그 설치는 동작 불능). 없는 것과 남의 것을 같은 404 로 답한다
   * (403 은 그 id 가 실재한다는 사실을 알려준다).
   */
  private async ownedKey(appKeyId: string, actor: { userId: string; role: string }) {
    const key = await this.prisma.appInstallationKey.findUnique({
      where: { id: appKeyId },
      select: {
        id: true, app: true, status: true, attestationEnvironment: true, attestationLevel: true,
        boundAt: true, lastAssertedAt: true, revokedAt: true, revokeReason: true,
        staffUserId: true, patientAccountId: true,
      },
    });
    const mine = !!key && key.staffUserId === actor.userId;
    if (!key || (!mine && actor.role !== 'ADMIN')) {
      throw new NotFoundException({ code: 'APP_KEY_REGISTRATION_REQUIRED', message: '등록되지 않은 키입니다.' });
    }
    return key;
  }

  async status(appKeyId: string, actor: { userId: string; role: string }) {
    const { staffUserId: _s, patientAccountId: _p, ...key } = await this.ownedKey(appKeyId, actor);
    return key;
  }

  async revoke(appKeyId: string, reason: string, actor: { userId: string; role: string }) {
    await this.ownedKey(appKeyId, actor);
    return this.prisma.appInstallationKey.update({
      where: { id: appKeyId },
      data: { status: 'REVOKED', revokedAt: new Date(), revokeReason: reason.slice(0, 255) },
      select: { id: true, status: true },
    });
  }

  /** 기기·사용자 단위 일괄 폐기 — 퇴사·분실·관리자 revoke 가 부른다 */
  async revokeByStaffDevice(staffDeviceId: string, reason: string) {
    const r = await this.prisma.appInstallationKey.updateMany({
      where: { staffDeviceId, status: { not: 'REVOKED' } },
      data: { status: 'REVOKED', revokedAt: new Date(), revokeReason: reason.slice(0, 255) },
    });
    return r.count;
  }

  async revokeByStaffUser(staffUserId: string, reason: string) {
    const r = await this.prisma.appInstallationKey.updateMany({
      where: { staffUserId, status: { not: 'REVOKED' } },
      data: { status: 'REVOKED', revokedAt: new Date(), revokeReason: reason.slice(0, 255) },
    });
    return r.count;
  }

  async revokeByPatientAccount(patientAccountId: string, reason: string) {
    const r = await this.prisma.appInstallationKey.updateMany({
      where: { patientAccountId, status: { not: 'REVOKED' } },
      data: { status: 'REVOKED', revokedAt: new Date(), revokeReason: reason.slice(0, 255) },
    });
    return r.count;
  }
}
