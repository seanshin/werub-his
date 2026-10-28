import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ConfigRuntimeService } from '../config/config-runtime.service';
import { ExternalCredentialsService } from './external-credentials.service';

/**
 * 앱 운영 설정 — CONFIG-01. 인증 전 호출 가능.
 *
 * 🔴 feature flag 에 secret 을 넣지 않는다. 그리고 이 플래그는 **권한 통제를 대신하지 않는다**
 *    (앱이 화면을 여는 것과 서버가 데이터를 주는 것은 다른 판단이다).
 */
@ApiTags('mobile-device-push')
@Controller('api/v1/mobile/config')
export class MobileConfigController {
  constructor(
    private readonly config: ConfigRuntimeService,
    private readonly credentials: ExternalCredentialsService,
  ) {}

  @Get()
  @ApiOperation({ summary: '최소 버전·점검·기능 플래그' })
  async get(@Query('app') app?: string, @Query('version') _version?: string) {
    const key = app === 'STAFF_IOS' ? 'mobile.staff' : 'mobile.patient';
    const raw = (await this.config.get(`${key}.release`).catch(() => null)) as
      | { minimumVersion?: string; latestVersion?: string; updatePolicy?: string }
      | null;
    const maint = (await this.config.get('mobile.maintenance').catch(() => null)) as
      | { enabled?: boolean; message?: string; endsAt?: string }
      | null;

    return {
      data: {
        // 🔴 미설정을 "제한 없음"으로 지어내지 않는다 — 모르면 null 이고, 앱은 강제 업데이트를 걸지 않는다
        minimumVersion: raw?.minimumVersion ?? null,
        latestVersion: raw?.latestVersion ?? null,
        updatePolicy: raw?.updatePolicy ?? 'OPTIONAL',
        maintenance: {
          enabled: !!maint?.enabled,
          message: maint?.message ?? null,
          endsAt: maint?.endsAt ?? null,
        },
        featureFlags: {
          // 외부 자격증명이 없으면 그 기능은 **꺼진 것으로 정직하게 말한다**
          patientSignupIdentity: this.credentials.isConfigured('identity.provider'),
          appAttest: this.credentials.isConfigured('apple.appIdentity'),
          push: this.credentials.isConfigured('push.provider'),
        },
        routeSchemaVersion: '1',
        support: {
          phone: ((await this.config.get('hospital.phone').catch(() => null)) as string | null) ?? null,
          url: null,
        },
      },
    };
  }
}
