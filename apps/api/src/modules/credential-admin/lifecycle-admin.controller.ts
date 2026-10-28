import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permission } from '../auth/rbac/permission.types';
import { CredentialGuard } from './cred.guard';
import { RequireCred } from './cred.decorator';
import { LifecycleAdminService } from './lifecycle-admin.service';
import { DeprovisionDto, OnboardDto } from './dto/credential.dto';

// FR-50/51: 온보딩 / 오프보딩
@ApiTags('credential-admin')
@ApiBearerAuth()
@Controller('api/v1/admin/credential')
@UseGuards(JwtAuthGuard, CredentialGuard)
export class LifecycleAdminController {
  constructor(private readonly svc: LifecycleAdminService) {}

  @Post('onboard/:userId')
  @RequireCred(Permission.CRED_DEVICE_MANAGE)
  @ApiOperation({ summary: '온보딩 — 디바이스 등록 QR + 체크리스트(FR-50)' })
  onboard(@CurrentUser('id') actorId: string, @Param('userId') userId: string, @Body() dto: OnboardDto) {
    return this.svc.onboard(actorId, userId, dto.deviceName).then((data) => ({ data }));
  }

  @Post('staff/:userId/deprovision')
  @RequireCred(Permission.CRED_CERT_REVOKE)
  @ApiOperation({ summary: '오프보딩 — 자격증명·세션 일괄 폐기(4-eyes, FR-51)' })
  deprovision(@CurrentUser('id') actorId: string, @Param('userId') userId: string, @Body() dto: DeprovisionDto) {
    return this.svc.deprovision(actorId, userId, dto.reason).then((data) => ({ data }));
  }
}
