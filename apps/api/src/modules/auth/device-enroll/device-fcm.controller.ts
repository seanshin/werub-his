import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { DeviceEnrollService } from './device-enroll.service';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';

class FcmTokenDto {
  @IsString()
  fcmToken!: string;

  @IsOptional()
  @IsString()
  deviceId?: string;
}

@ApiTags('staff-device-fcm')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('api/v1/devices')
export class DeviceFcmController {
  constructor(private readonly enroll: DeviceEnrollService) {}

  @Post('fcm-token')
  @ApiOperation({ summary: '스태프 FCM 토큰 등록(본인 디바이스 바인딩)' })
  async register(@CurrentUser('id') userId: string, @Body() body: FcmTokenDto) {
    return { data: await this.enroll.registerFcmToken(userId, body.fcmToken, body.deviceId) };
  }
}
