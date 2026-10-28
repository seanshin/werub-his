import { Controller, Get, Header, NotFoundException, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { ExternalCredentialsService } from './external-credentials.service';

/**
 * Apple App Site Association — LINK-01.
 *
 * 🔴 Team ID·Bundle ID 는 **밖에서 와야 하는 값**이다. 없으면 **404 로 정직하게 없다고 말한다** —
 *    자리표시자를 넣어 파일을 내보내면 iOS 는 "연결됐다"고 읽고 Universal Link 가 조용히 깨진다.
 *    (없는 것을 있는 것처럼 내보내지 않는다)
 */
@ApiTags('mobile-device-push')
@Controller()
export class AasaController {
  constructor(private readonly credentials: ExternalCredentialsService) {}

  @Get('.well-known/apple-app-site-association')
  @Header('Content-Type', 'application/json')
  @ApiOperation({ summary: 'AASA — 환자/스탭 applinks + 스탭 webcredentials' })
  get(@Res({ passthrough: true }) _res: Response) {
    const teamId = this.credentials.optionalValue('APPLE_TEAM_ID');
    const patientBundle = this.credentials.optionalValue('IOS_PATIENT_BUNDLE_ID');
    const staffBundle = this.credentials.optionalValue('IOS_STAFF_BUNDLE_ID');
    if (!teamId || (!patientBundle && !staffBundle)) {
      throw new NotFoundException({
        code: 'APP_IDENTITY_NOT_CONFIGURED',
        message: 'Apple Team ID / Bundle ID 가 아직 설정되지 않아 AASA 를 제공할 수 없습니다.',
      });
    }

    const patientAppId = patientBundle ? `${teamId}.${patientBundle}` : null;
    const staffAppId = staffBundle ? `${teamId}.${staffBundle}` : null;

    const details: Array<{ appID: string; paths: string[] }> = [];
    if (patientAppId) {
      details.push({
        appID: patientAppId,
        paths: ['/mobile/patient/*', '/portal/*', '/mobile/patient/identity/callback', '/pay/*'],
      });
    }
    if (staffAppId) {
      details.push({ appID: staffAppId, paths: ['/mobile/staff/*', '/staff/*', '/mobile/staff/enroll/*'] });
    }

    return {
      applinks: { apps: [], details },
      // Passkey associated domain — 승인된 스탭 앱만 우선 등록한다
      webcredentials: { apps: staffAppId ? [staffAppId] : [] },
    };
  }
}
