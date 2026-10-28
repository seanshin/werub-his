import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { ExternalCredentialsService } from '../external-credentials.service';
import { EncryptionService } from '../../patient-auth/services/encryption.service';
import { LocalFakeIdentityAdapter } from './local-fake.adapter';
import type { IdentityProviderAdapter } from './identity-provider.types';

import { devSwitchOn } from '../../../common/release-security';
const VERIFICATION_TTL_MIN = 10;

/**
 * 개발용 fake 본인확인 허용 스위치 — **기본 차단**.
 * 🔴 `NODE_ENV` 처럼 "설정돼 있겠지" 싶은 변수에 안전을 걸지 않는다(운영에 없었다).
 */
// 🔴 T4-3 — REAL 에서는 켜져 있어도 fake 본인확인을 쓰지 않는다(부팅도 거부).
export const allowLocalFake = () => devSwitchOn('IDENTITY_ALLOW_LOCAL_FAKE');

/**
 * 본인확인 거래 — 시작·callback·결과 조회·소비.
 *
 * 🔴 앱에는 **CI·공급자 토큰·암호화 원문을 절대 돌려주지 않는다.** 일회용 `verificationId` 와
 *    마스킹된 결과만 준다. 가입 API 는 클라이언트가 보낸 CI 가 아니라 이 행을 믿는다.
 */
@Injectable()
export class IdentityService {
  private readonly logger = new Logger(IdentityService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly credentials: ExternalCredentialsService,
    private readonly encryption: EncryptionService,
    private readonly fake: LocalFakeIdentityAdapter,
  ) {}

  /**
   * 운영 공급자 선택 — **서버 설정만이 정한다**(앱 요청의 provider 를 쓰지 않는다).
   *
   * 🔴 운영(`NODE_ENV=production`)에서는 `usableInProduction=false` 인 어댑터를 고르지 않는다.
   *    설정이 없으면 **기능이 꺼진 것으로 정직하게 응답**하고, fake 로 대신하지 않는다.
   */
  private adapter(): IdentityProviderAdapter {
    const configured = this.credentials.isConfigured('identity.provider');
    if (!configured) {
      /**
       * 🔴 fake 는 **명시적 옵트인이 있을 때만** 쓴다. `NODE_ENV !== 'production'` 으로 갈랐더니
       *    운영 서버에 `NODE_ENV` 가 아예 설정돼 있지 않아(2026-08-24 실측) **운영이 개발 취급**을 받았다.
       *    안전 분기를 "설정되지 않은 변수"에 걸면, 설정을 잊은 환경이 곧 위험한 환경이 된다.
       *    기본값은 어디서나 **차단**이고, 개발자가 켜야 열린다.
       */
      if (allowLocalFake()) return this.fake;
      throw new ServiceUnavailableException({
        code: 'IDENTITY_PROVIDER_NOT_CONFIGURED',
        message: '본인확인 서비스가 아직 연동되지 않았습니다.',
      });
    }
    // 실제 공급자 어댑터는 자격증명이 들어온 뒤 이 자리에 등록한다.
    // 🔴 지금 없는 것을 있는 척하지 않는다 — 설정만 되고 어댑터가 없으면 그 사실을 말한다.
    throw new ServiceUnavailableException({
      code: 'IDENTITY_PROVIDER_NOT_IMPLEMENTED',
      message: '설정된 본인확인 공급자의 어댑터가 아직 구현되지 않았습니다.',
    });
  }

  private ciHash(ci: string): string {
    const pepper = this.credentials.requireValue('identity.pepper', 'IDENTITY_CI_PEPPER');
    return createHmac('sha256', pepper).update(ci).digest('hex');
  }

  async start(input: {
    purpose: 'PATIENT_SIGNUP' | 'PATIENT_RECOVERY';
    installationId?: string;
    appKeyId?: string;
  }) {
    const adapter = this.adapter();
    const verificationId = randomUUID();
    const stateNonce = randomBytes(24).toString('base64url');
    const expiresAt = new Date(Date.now() + VERIFICATION_TTL_MIN * 60_000);

    const callbackUrl = `${process.env.FRONTEND_URL ?? 'https://his.example.org'}/api/v1/patient-auth/identity/callback`;
    const started = await adapter.start({ purpose: input.purpose, verificationId, stateNonce, callbackUrl });

    await this.prisma.identityVerification.create({
      data: {
        id: verificationId,
        provider: adapter.name,
        purpose: input.purpose,
        status: 'STARTED',
        installationId: input.installationId ?? null,
        appKeyId: input.appKeyId ?? null,
        providerTxRef: started.providerTxRef,
        stateNonce,
        expiresAt,
      },
    });
    return {
      verificationId,
      authUrl: started.authUrl,
      expiresAt: expiresAt.toISOString(),
      provider: adapter.name,
    };
  }

  /** 공급자 callback — 서버가 받는다. 앱의 "성공했다"는 말은 근거가 아니다 */
  async completeCallback(verificationId: string, stateNonce: string, raw: Record<string, string>) {
    const row = await this.prisma.identityVerification.findUnique({ where: { id: verificationId } });
    if (!row) throw new BadRequestException({ code: 'IDENTITY_RESULT_INVALID', message: '알 수 없는 거래입니다.' });
    if (row.status !== 'STARTED') {
      throw new BadRequestException({ code: 'IDENTITY_REPLAYED', message: '이미 처리된 거래입니다.' });
    }
    if (row.expiresAt < new Date()) {
      await this.prisma.identityVerification.update({ where: { id: row.id }, data: { status: 'EXPIRED' } });
      throw new BadRequestException({ code: 'IDENTITY_EXPIRED', message: '거래가 만료되었습니다.' });
    }
    if (row.stateNonce !== stateNonce) {
      this.logger.warn(`🚨 본인확인 state 불일치 verification=${verificationId}`);
      throw new ForbiddenException({ code: 'IDENTITY_RESULT_INVALID', message: 'state 가 일치하지 않습니다.' });
    }

    const adapter = this.adapter();
    const { providerTxRef } = await adapter.completeCallback({ verificationId, stateNonce, raw });
    const verified = await adapter.fetchVerifiedResult(providerTxRef);

    // 이름·생년으로 환자 정본 매칭 — 🔴 여러 명이면 **고르지 않는다**
    const nameParts =
      verified.name.length >= 2
        ? { familyName: verified.name[0], givenName: verified.name.slice(1) }
        : { familyName: verified.name, givenName: '' };
    const candidates = await this.prisma.patient.findMany({
      where: {
        familyName: nameParts.familyName,
        givenName: nameParts.givenName,
        dateOfBirth: new Date(verified.birthDate),
        gender: verified.gender,
        validTo: null,
      },
      select: { id: true },
      take: 3,
    });

    await this.prisma.identityVerification.update({
      where: { id: row.id },
      data: {
        status: 'VERIFIED',
        providerTxRef,
        ciEncrypted: this.encryption.encrypt(verified.ci),
        ciLookupHash: this.ciHash(verified.ci),
        verifiedName: verified.name,
        verifiedBirth: verified.birthDate,
        verifiedGender: verified.gender,
        verifiedPhone: verified.phone,
        matchedPatientId: candidates.length === 1 ? candidates[0].id : null,
        verifiedAt: new Date(),
      },
    });

    return {
      verificationId,
      // 🔴 창구 확인이 필요한 상태를 "매칭 실패"와 섞지 않는다
      nextAction:
        candidates.length > 1 ? ('VISIT_HOSPITAL' as const)
        : candidates.length === 1 ? ('SIGNUP' as const)
        : ('SIGNUP' as const),
      ambiguous: candidates.length > 1,
    };
  }

  /** 상태 조회 — 🔴 CI 원문·공급자 토큰은 나가지 않는다 */
  async status(verificationId: string) {
    const row = await this.prisma.identityVerification.findUnique({ where: { id: verificationId } });
    if (!row) throw new BadRequestException({ code: 'IDENTITY_RESULT_INVALID', message: '알 수 없는 거래입니다.' });
    const mask = (v: string | null) => (v ? v.replace(/^(.).*(.)$/u, '$1***$2') : null);
    return {
      verificationId,
      status: row.status,
      expiresAt: row.expiresAt.toISOString(),
      matchedPatient: !!row.matchedPatientId,
      maskedPatient: {
        name: mask(row.verifiedName),
        phone: row.verifiedPhone ? row.verifiedPhone.replace(/^(\d{3})\d+(\d{4})$/, '$1-****-$2') : null,
      },
      nextAction: row.status === 'VERIFIED' ? 'SIGNUP' : row.status === 'CONSUMED' ? 'LOGIN' : null,
    };
  }

  /**
   * 가입이 이 거래를 **소비**한다 — 1회용·목적·만료·기기 결합을 모두 확인한 뒤 CI 를 돌려준다.
   * 🔴 이 메서드만이 CI 를 반환한다. 컨트롤러·응답에는 절대 실리지 않는다.
   */
  async consumeForSignup(
    verificationId: string,
    binding: { installationId?: string; appKeyId?: string },
  ): Promise<{ ci: string; name: string; birthDate: string; gender: string; phone: string; patientId: string | null }> {
    const row = await this.prisma.identityVerification.findUnique({ where: { id: verificationId } });
    if (!row) throw new BadRequestException({ code: 'IDENTITY_RESULT_INVALID', message: '알 수 없는 거래입니다.' });
    if (row.purpose !== 'PATIENT_SIGNUP') {
      throw new ForbiddenException({ code: 'IDENTITY_RESULT_INVALID', message: '목적이 다른 거래입니다.' });
    }
    if (row.status === 'CONSUMED') {
      throw new ForbiddenException({ code: 'IDENTITY_REPLAYED', message: '이미 사용된 인증입니다.' });
    }
    if (row.status !== 'VERIFIED') {
      throw new BadRequestException({ code: 'IDENTITY_VERIFICATION_REQUIRED', message: '본인확인이 완료되지 않았습니다.' });
    }
    if (row.expiresAt < new Date()) {
      throw new BadRequestException({ code: 'IDENTITY_EXPIRED', message: '인증이 만료되었습니다.' });
    }
    // 🔴 다른 앱 설치에서 남의 verificationId 를 쓰지 못한다
    if (row.installationId && binding.installationId && row.installationId !== binding.installationId) {
      throw new ForbiddenException({ code: 'IDENTITY_RESULT_INVALID', message: '다른 기기에서 시작한 인증입니다.' });
    }
    if (!row.ciEncrypted) {
      throw new BadRequestException({ code: 'IDENTITY_RESULT_INVALID', message: '인증 결과가 비어 있습니다.' });
    }

    await this.prisma.identityVerification.update({
      where: { id: row.id },
      data: { status: 'CONSUMED', consumedAt: new Date() },
    });

    return {
      ci: this.encryption.decrypt(row.ciEncrypted),
      name: row.verifiedName ?? '',
      birthDate: row.verifiedBirth ?? '',
      gender: row.verifiedGender ?? '',
      phone: row.verifiedPhone ?? '',
      patientId: row.matchedPatientId,
    };
  }

  async health() {
    const configured = this.credentials.isConfigured('identity.provider');
    if (!configured) {
      return {
        provider: null,
        available: false,
        reason: 'IDENTITY_PROVIDER_NOT_CONFIGURED',
        // 🔴 fake 가 실제로 **선택 가능한 상태일 때만** 이름을 말한다(꺼져 있으면 null)
        developmentFallback: allowLocalFake() ? this.fake.name : null,
      };
    }
    return { provider: null, available: false, reason: 'IDENTITY_PROVIDER_NOT_IMPLEMENTED', developmentFallback: null };
  }
}
