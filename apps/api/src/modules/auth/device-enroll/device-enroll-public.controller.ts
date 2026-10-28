import { Body, Controller, Get, Post, Param } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { DeviceEnrollService } from './device-enroll.service';
import { EnrollClaimDto, EnrollRegisterDto, EnrollRemoteFactorDto } from './dto/device-enroll.dto';

// 직원 디바이스 측(미인증) — 인증번호로만 접근, 세션·시도제한으로 보호(FR-32)
@ApiTags('staff-device-enroll')
@Controller('api/v1/staff-devices/enroll')
export class DeviceEnrollPublicController {
  constructor(private readonly enroll: DeviceEnrollService) {}

  @Post(':sessionId/claim')
  @Throttle({ auth: { ttl: 60000, limit: 30 } })
  @ApiOperation({ summary: '인증번호 입력 → 패스키 등록 옵션' })
  async claim(@Param('sessionId') sessionId: string, @Body() body: EnrollClaimDto) {
    return { data: await this.enroll.claim(sessionId, body.code) };
  }

  @Post(':sessionId/remote-factor/send')
  @Throttle({ auth: { ttl: 60000, limit: 5 } })
  @ApiOperation({ summary: '원격 등록 2차 인증 발송 — HR 등록 연락처로만' })
  async sendRemoteFactor(@Param('sessionId') sessionId: string) {
    return { data: await this.enroll.sendRemoteFactor(sessionId) };
  }

  @Post(':sessionId/remote-factor/verify')
  @Throttle({ auth: { ttl: 60000, limit: 10 } })
  @ApiOperation({ summary: '원격 등록 2차 인증 확인' })
  async verifyRemoteFactor(@Param('sessionId') sessionId: string, @Body() body: EnrollRemoteFactorDto) {
    return { data: await this.enroll.verifyRemoteFactor(sessionId, body.code) };
  }

  @Get(':sessionId/status')
  @Throttle({ auth: { ttl: 60000, limit: 60 } })
  @ApiOperation({ summary: '등록 진행 상태 — 다음 단계는 서버가 정한다' })
  async status(@Param('sessionId') sessionId: string) {
    return { data: await this.enroll.enrollStatus(sessionId) };
  }

  @Post(':sessionId/register')
  @Throttle({ auth: { ttl: 60000, limit: 30 } })
  @ApiOperation({ summary: '패스키 등록 검증 → StaffDevice 생성(확정 대기)' })
  async register(@Param('sessionId') sessionId: string, @Body() body: EnrollRegisterDto) {
    return { data: await this.enroll.register(sessionId, body.code, body.response, body.deviceName) };
  }
}
