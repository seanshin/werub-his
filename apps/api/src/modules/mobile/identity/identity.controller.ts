import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsObject, IsOptional, IsString, Length } from 'class-validator';
import { IdentityService } from './identity.service';

export class IdentityStartDto {
  @ApiProperty({ enum: ['PATIENT_SIGNUP', 'PATIENT_RECOVERY'] })
  @IsIn(['PATIENT_SIGNUP', 'PATIENT_RECOVERY'])
  purpose!: 'PATIENT_SIGNUP' | 'PATIENT_RECOVERY';

  @ApiPropertyOptional() @IsOptional() @IsString() @Length(8, 64)
  installationId?: string;

  @ApiPropertyOptional() @IsOptional() @IsString()
  appKeyId?: string;
  // 🔴 `provider` 와 `returnUrl` 은 **받지 않는다.** 앱이 정하면 공격자가 자기 서버를 callback 으로 지정한다.
}

export class IdentityCallbackDto {
  @ApiProperty() @IsString() @IsNotEmpty()
  verificationId!: string;

  @ApiProperty() @IsString()
  state!: string;

  @ApiPropertyOptional() @IsOptional() @IsObject()
  raw?: Record<string, string>;
}

/**
 * 환자 본인확인 — EXT-ID-01 / AUTH-P-01.
 *
 * 🔴 CI·공급자 토큰은 **어떤 응답에도 담기지 않는다.** 앱은 일회용 `verificationId` 와
 *    마스킹된 결과만 받는다.
 */
@ApiTags('mobile-external-identity')
@Controller('api/v1/patient-auth/identity')
export class IdentityController {
  constructor(private readonly identity: IdentityService) {}

  @Post('start')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: '본인확인 시작 — 공급자는 서버가 고른다' })
  async start(@Body() dto: IdentityStartDto) {
    return { data: await this.identity.start(dto) };
  }

  @Post('callback')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: '공급자 callback 수신(서버 간) — state·만료·1회 사용 검증' })
  async callback(@Body() dto: IdentityCallbackDto) {
    return { data: await this.identity.completeCallback(dto.verificationId, dto.state, dto.raw ?? {}) };
  }

  @Get(':verificationId/status')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: '거래 상태 — 마스킹된 결과만' })
  async status(@Param('verificationId') verificationId: string) {
    return { data: await this.identity.status(verificationId) };
  }

  @Get('health')
  @ApiOperation({ summary: '본인확인 공급자 준비 상태 — 미설정을 초록으로 보이지 않게' })
  async health(@Query('_') _unused?: string) {
    return { data: await this.identity.health() };
  }
}
