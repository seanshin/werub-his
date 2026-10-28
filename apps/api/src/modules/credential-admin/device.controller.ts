import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permission } from '../auth/rbac/permission.types';
import { CredentialGuard } from './cred.guard';
import { RequireCred } from './cred.decorator';
import { DevicePolicyService } from './device-policy.service';
import { DeviceReasonDto } from './dto/credential.dto';

// FR-04/05/24: 디바이스 보안 운영
@ApiTags('credential-admin')
@ApiBearerAuth()
@Controller('api/v1/admin/credential/devices')
@UseGuards(JwtAuthGuard, CredentialGuard)
@RequireCred(Permission.CRED_DEVICE_MANAGE)
export class DeviceController {
  constructor(private readonly devices: DevicePolicyService) {}

  @Get()
  @ApiOperation({ summary: '디바이스 목록(등록일·최근사용·만료·상태)' })
  list(@Query('userId') userId?: string, @Query('status') status?: string) {
    return this.devices.list({ userId, status }).then((data) => ({ data }));
  }

  @Post(':id/force-reenroll')
  @ApiOperation({ summary: '강제 재등록(FR-05)' })
  forceReEnroll(@CurrentUser('id') actorId: string, @Param('id') id: string) {
    return this.devices.forceReEnroll(actorId, id).then((data) => ({ data }));
  }

  @Post(':id/report-lost')
  @ApiOperation({ summary: '분실 신고 — 인증수단 즉시 폐기(FR-04)' })
  reportLost(@CurrentUser('id') actorId: string, @Param('id') id: string, @Body() dto: DeviceReasonDto) {
    return this.devices.reportLost(actorId, id, false, dto.reason).then((data) => ({ data }));
  }

  @Post(':id/unenroll')
  @ApiOperation({ summary: '등록 해제(FR-24)' })
  unenroll(@CurrentUser('id') actorId: string, @Param('id') id: string, @Body() dto: DeviceReasonDto) {
    return this.devices.unenroll(actorId, id, dto.reason).then((data) => ({ data }));
  }
}
