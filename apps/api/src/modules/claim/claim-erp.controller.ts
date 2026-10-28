import { Controller, Post, Body, Headers, UnauthorizedException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiHeader } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { ClaimService } from './claim.service';
import { ConfigRuntimeService } from '../config/config-runtime.service';
import { secureKeyEqual } from '../../common/util/secure-compare';
import { ClaimReviewCallbackDto } from './dto/claim-erp.dto';

// 심사 결과 인바운드(심사 P3) — ERP/심사 시스템이 호출. 공유 연동키 인증.
@ApiTags('Claim ERP (심사 결과 릴레이)')
@SkipThrottle()
@Controller('api/v1/integration/claims')
export class ClaimErpController {
  constructor(private readonly svc: ClaimService, private readonly configRuntime: ConfigRuntimeService) {}

  private async auth(key?: string) {
    const expected = (await this.configRuntime.get('erp.integrationKey')) as string;
    if (!secureKeyEqual(key, expected)) throw new UnauthorizedException('연동 키가 올바르지 않습니다');
  }

  @Post('review-callback')
  @ApiHeader({ name: 'X-Integration-Key' })
  @ApiOperation({ summary: '심사 결과 콜백 → 의료진 알림 릴레이 (ERP/심사→HIS, 샘플 인터페이스)' })
  async reviewCallback(
    @Headers('x-integration-key') key: string,
    @Body() body: ClaimReviewCallbackDto,
  ) {
    await this.auth(key);
    return { data: await this.svc.reviewCallback(body) };
  }
}
