import { Body, Controller, Delete, Get, Put, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Length } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PatientAccountAuthGuard } from '../patient-auth/guards/patient-account-auth.guard';
import type { PatientAccountRequest } from '../../common/interfaces/portal-request.interface';
import { PushTokenService } from './push-token.service';

/** 해제 요청 — 🔴 인라인 `@Body()` 객체로 받으면 ValidationPipe 가 통째로 스킵된다(v4.3.0) */
export class PushTokenClearDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 128)
  deviceId?: string;
}

export class PushTokenDto {
  @ApiProperty({ enum: ['PATIENT_IOS', 'STAFF_IOS'] })
  @IsIn(['PATIENT_IOS', 'STAFF_IOS'])
  app!: 'PATIENT_IOS' | 'STAFF_IOS';

  @ApiProperty() @IsString() @Length(8, 64)
  installationId!: string;

  @ApiProperty() @IsString() @Length(8, 500)
  token!: string;

  @ApiPropertyOptional() @IsOptional() @IsString()
  deviceId?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 30)
  appVersion?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 30)
  osVersion?: string;
}

/**
 * 푸시 토큰 — 모바일 계약 하나(PUSH-01). 내부 저장은 스탭/환자로 나뉜다.
 *
 * 🔴 스탭과 환자는 **주체가 다르므로 가드도 다르다.** 하나의 경로에 두 주체를 태우지 않고
 *    경로를 나누되, 요청/응답 모양은 같게 둔다(앱이 분기하지 않아도 되게).
 */
@ApiTags('mobile-device-push')
@Controller('api/v1/mobile-devices')
export class PushTokenController {
  constructor(private readonly push: PushTokenService) {}

  @Put('staff/push-token')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '스탭 푸시 토큰 등록' })
  async staff(@Body() dto: PushTokenDto, @Req() req: { user: { id: string } }) {
    return { data: await this.push.registerStaff(req.user.id, { token: dto.token, deviceId: dto.deviceId }) };
  }

  @Delete('staff/push-token')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '스탭 푸시 토큰 해제' })
  async staffOff(@Body() dto: PushTokenClearDto, @Req() req: { user: { id: string } }) {
    return { data: await this.push.unregisterStaff(req.user.id, dto?.deviceId) };
  }

  @Put('patient/push-token')
  @UseGuards(PatientAccountAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '환자 푸시 토큰 등록' })
  async patient(@Body() dto: PushTokenDto, @Req() req: PatientAccountRequest) {
    return {
      data: await this.push.registerPatient(req.patientAccountId, {
        token: dto.token,
        deviceId: dto.deviceId ?? dto.installationId,
        appVersion: dto.appVersion,
        osVersion: dto.osVersion,
      }),
    };
  }

  @Delete('patient/push-token')
  @UseGuards(PatientAccountAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '환자 푸시 토큰 해제' })
  async patientOff(@Body() dto: PushTokenClearDto, @Req() req: PatientAccountRequest) {
    return { data: await this.push.unregisterPatient(req.patientAccountId, dto?.deviceId) };
  }

  @Get('push-readiness')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '푸시 발송 준비 상태 — 미설정이 초록으로 보이지 않게' })
  readiness() {
    return { data: this.push.readiness() };
  }
}
