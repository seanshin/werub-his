import { ForbiddenException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { RedisService } from '../../../infrastructure/redis/redis.service';
import { AuthService, type SessionBinding } from '../auth.service';
import type { AuthContext } from '../auth-audit';
import { ExternalCredentialsService } from '../../mobile/external-credentials.service';
import { mobileHomeFor } from './mobile-capabilities';

/** 요청서 AUTH-S-01/02 권고값 — 스탭 네이티브 access 15분 · refresh 7일 */
const NATIVE_ACCESS_TTL = 15 * 60;
const NATIVE_REFRESH_TTL = 7 * 24 * 60 * 60;

export type AssuranceLevel = 'STAFF_S0' | 'STAFF_S1' | 'STAFF_S2' | 'STAFF_S3';

/**
 * 네이티브 스탭 세션 — 쿠키가 아니라 JSON 으로 주고받는다(AUTH-S-01).
 *
 * 🔴 세션 저장·회전·재사용 탐지는 **웹과 같은 정본**(`AuthService`)을 쓴다.
 *    여기서 따로 만들면 한쪽만 고쳐지고 반드시 갈라진다.
 */
@Injectable()
export class MobileAuthService {
  private readonly logger = new Logger(MobileAuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly auth: AuthService,
    private readonly credentials: ExternalCredentialsService,
  ) {}

  /**
   * 앱 개별키를 **요구할 수 있는 상태인가**.
   *
   * 🔴 Apple Team ID·Bundle ID 가 아직 없으면 앱은 키를 만들 수조차 없다.
   *    그 상태에서 키를 필수로 걸면 네이티브 로그인이 통째로 막힌다 — 그래서
   *    **요구는 능력을 따라간다**: 자격증명이 설정되면 필수, 아니면 없이 발급하되
   *    보증 수준을 낮추고 응답에 그 사실을 담는다(있는 척하지 않는다).
   */
  private appKeyRequired(): boolean {
    return this.credentials.isConfigured('apple.appIdentity');
  }

  private async assertAppKey(appKeyId: string | undefined, staffUserId: string) {
    if (!this.appKeyRequired()) {
      return { ok: false as const, reason: 'APP_IDENTITY_NOT_CONFIGURED' as const };
    }
    if (!appKeyId) {
      throw new ForbiddenException({
        code: 'APP_KEY_REGISTRATION_REQUIRED',
        message: '앱 설치 개별키 등록이 필요합니다.',
      });
    }
    const key = await this.prisma.appInstallationKey.findUnique({
      where: { id: appKeyId },
      select: { id: true, app: true, status: true, staffUserId: true },
    });
    if (!key || key.app !== 'STAFF_IOS') {
      throw new ForbiddenException({ code: 'APP_KEY_REGISTRATION_REQUIRED', message: '등록되지 않은 키입니다.' });
    }
    if (key.status === 'REVOKED') {
      throw new ForbiddenException({ code: 'APP_KEY_REVOKED', message: '폐기된 키입니다.' });
    }
    if (key.staffUserId && key.staffUserId !== staffUserId) {
      throw new ForbiddenException({ code: 'APP_KEY_ALREADY_BOUND', message: '다른 사용자에 결합된 키입니다.' });
    }
    return { ok: true as const, reason: null };
  }

  /** 승인 기기 확인 — 요청서 D5 권고대로 **P0 부터 필수**. 없으면 등록 안내로 보낸다 */
  private async assertStaffDevice(staffDeviceId: string | undefined, userId: string) {
    const devices = await this.prisma.staffDevice.findMany({
      where: { userId },
      select: { id: true, status: true },
    });
    if (devices.length === 0) {
      throw new ForbiddenException({
        code: 'DEVICE_ENROLLMENT_REQUIRED',
        message: '승인된 기기가 없습니다. 관리자에게 기기 등록을 요청하세요.',
      });
    }
    const picked = staffDeviceId ? devices.find((d) => d.id === staffDeviceId) : devices.find((d) => d.status === 'ACTIVE');
    if (!picked) {
      throw new ForbiddenException({ code: 'DEVICE_ENROLLMENT_REQUIRED', message: '등록되지 않은 기기입니다.' });
    }
    if (picked.status === 'PENDING_CONFIRM') {
      throw new ForbiddenException({
        code: 'ENROLLMENT_PENDING_CONFIRM',
        message: '관리자 확정 대기 중인 기기입니다.',
      });
    }
    if (picked.status !== 'ACTIVE') {
      throw new ForbiddenException({ code: 'DEVICE_REVOKED', message: '사용할 수 없는 기기입니다.' });
    }
    return picked.id;
  }

  async login(
    dto: {
      identifier: string; password: string; installationId: string;
      staffDeviceId?: string; appKeyId?: string; appVersion?: string; osVersion?: string; deviceModel?: string;
    },
    ctx?: AuthContext,
  ) {
    const failKey = `login:fail:native:${dto.identifier.toLowerCase()}`;
    const fails = await this.redis.get(failKey);
    if (fails && Number(fails) >= 10) {
      throw new UnauthorizedException({ code: 'ACCOUNT_LOCKED', message: '잠시 후 다시 시도해 주세요.' });
    }

    const user = await this.auth.findUserByIdentifier(dto.identifier);
    if (!user || !user.isActive) {
      await this.redis.multi().incr(failKey).expire(failKey, 900).exec();
      // 🔴 계정 존재 여부를 응답으로 알려주지 않는다(열거 방지). 코드는 하나로 고정.
      throw new UnauthorizedException({ code: 'INVALID_CREDENTIALS', message: '로그인에 실패했습니다.' });
    }
    const ok = await bcrypt.compare(dto.password, user.passwordHash);
    if (!ok) {
      await this.redis.multi().incr(failKey).expire(failKey, 900).exec();
      throw new UnauthorizedException({ code: 'INVALID_CREDENTIALS', message: '로그인에 실패했습니다.' });
    }
    await this.redis.del(failKey);

    if (user.accountStage === 'PRE_BOARD') {
      throw new ForbiddenException({ code: 'ACCOUNT_INACTIVE', message: '입사 승인 전 계정입니다.' });
    }

    const staffDeviceId = await this.assertStaffDevice(dto.staffDeviceId, user.id);
    const appKey = await this.assertAppKey(dto.appKeyId, user.id);

    const binding: SessionBinding = {
      client: 'IOS_NATIVE',
      installationId: dto.installationId,
      staffDeviceId,
      appKeyId: appKey.ok ? dto.appKeyId : undefined,
      authMethod: 'PASSWORD',
      // 비밀번호 fallback 은 S1 — Passkey(S2)와 같은 보증으로 취급하지 않는다
      assuranceLevel: 'STAFF_S1',
      accessTtlSeconds: NATIVE_ACCESS_TTL,
      refreshTtlSeconds: NATIVE_REFRESH_TTL,
    };
    const session = await this.auth.issueSession(
      { id: user.id, email: user.email, role: user.role },
      { method: 'PASSWORD', ...ctx },
      binding,
    );
    return this.shape(user, session, binding, appKey.reason);
  }

  async refresh(dto: { refreshToken: string; installationId: string; staffDeviceId?: string; appKeyId?: string }) {
    const result = await this.auth.refresh(dto.refreshToken, {
      installationId: dto.installationId,
      staffDeviceId: dto.staffDeviceId,
      appKeyId: dto.appKeyId,
    });
    // 기기·키가 그 사이 폐기됐으면 회전도 막는다(로그인만 막고 refresh 를 열어두면 우회로가 된다)
    if (dto.staffDeviceId) {
      const d = await this.prisma.staffDevice.findUnique({
        where: { id: dto.staffDeviceId },
        select: { status: true },
      });
      if (d && d.status !== 'ACTIVE') {
        throw new ForbiddenException({ code: 'DEVICE_REVOKED', message: '사용할 수 없는 기기입니다.' });
      }
    }
    if (dto.appKeyId) {
      const k = await this.prisma.appInstallationKey.findUnique({
        where: { id: dto.appKeyId },
        select: { status: true },
      });
      if (k && k.status === 'REVOKED') {
        throw new ForbiddenException({ code: 'APP_KEY_REVOKED', message: '폐기된 키입니다.' });
      }
    }
    return {
      tokens: {
        accessToken: result.accessToken,
        accessTokenExpiresAt: new Date(Date.now() + result.expiresIn * 1000).toISOString(),
        refreshToken: result.refreshToken,
        refreshTokenExpiresAt: new Date(Date.now() + NATIVE_REFRESH_TTL * 1000).toISOString(),
      },
      session: { sessionId: result.sessionId },
    };
  }

  async logout(
    userId: string,
    dto: { refreshToken?: string; scope?: 'CURRENT_SESSION' | 'ALL_SESSIONS' },
    ctx?: AuthContext,
  ) {
    if (dto.scope === 'ALL_SESSIONS') {
      const n = await this.auth.revokeAllSessionsOf(userId);
      return { scope: 'ALL_SESSIONS' as const, revokedSessions: n };
    }
    // 🔴 현재 기기 로그아웃이 다른 승인 기기 세션을 끊지 않는다(요청서 완료 기준)
    await this.auth.logout(userId, dto.refreshToken, ctx);
    return { scope: 'CURRENT_SESSION' as const, revokedSessions: 1 };
  }

  async session(userId: string, sid?: string) {
    return this.auth.sessionInfo(userId, sid);
  }

  /** 응답 모양 — 요청서 AUTH-S-01 계약 */
  private async shape(
    user: { id: string; email: string; role: string; familyName: string; givenName: string; department: string | null; passwordChangedAt?: Date | null },
    session: { accessToken: string; refreshToken: string; expiresIn: number; sessionId: string },
    binding: SessionBinding,
    appKeyUnavailableReason: string | null,
  ) {
    const home = mobileHomeFor(user.role);
    const staff = await this.prisma.staff.findFirst({
      where: { userId: user.id },
      select: { employeeNumber: true, department: true, status: true },
    });
    return {
      account: {
        id: user.id,
        email: user.email,
        employeeId: staff?.employeeNumber ?? null,
        familyName: user.familyName,
        givenName: user.givenName,
        role: user.role,
        department: staff?.department ?? user.department ?? null,
      },
      tokens: {
        accessToken: session.accessToken,
        accessTokenExpiresAt: new Date(Date.now() + session.expiresIn * 1000).toISOString(),
        refreshToken: session.refreshToken,
        refreshTokenExpiresAt: new Date(Date.now() + (binding.refreshTtlSeconds ?? NATIVE_REFRESH_TTL) * 1000).toISOString(),
      },
      session: {
        sessionId: session.sessionId,
        installationId: binding.installationId ?? null,
        staffDeviceId: binding.staffDeviceId ?? null,
        appKeyId: binding.appKeyId ?? null,
        deviceState: 'ACTIVE',
        assuranceLevel: binding.assuranceLevel,
        // 🔴 앱 무결성 검증이 **아직 성립하지 않는 상태**면 그 사실을 그대로 말한다
        appIntegrity: binding.appKeyId
          ? { verified: true, reason: null }
          : { verified: false, reason: appKeyUnavailableReason },
      },
      security: {
        passwordChangeRequired: false,
        stepUpMethods: ['PASSKEY'],
      },
      navigation: home,
    };
  }
}
