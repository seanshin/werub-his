import { Body, Controller, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { LifecycleService, AuthPolicy } from './lifecycle.service';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { RolesGuard } from '../guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { DeprovisionStaffDto, SetAuthPolicyDto } from './dto/auth-policy.dto';

@ApiTags('auth-lifecycle')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/admin')
export class LifecycleController {
  constructor(private readonly svc: LifecycleService) {}

  @Get('auth-policy')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '인증 정책 조회 (FR-13)' })
  async getPolicy() {
    return { data: await this.svc.getPolicy() };
  }

  @Put('auth-policy')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '인증 정책 변경' })
  async setPolicy(@CurrentUser('id') adminId: string, @Body() body: SetAuthPolicyDto) {
    return { data: await this.svc.setPolicy(adminId, body) };
  }

  @Post('staff/:userId/passkey/reset')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '패스키 강제 재설정 (FR-13)' })
  async reset(@CurrentUser('id') adminId: string, @Param('userId') userId: string) {
    return { data: await this.svc.forceResetPasskeys(adminId, userId) };
  }

  @Post('staff/:userId/deprovision')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '수명주기 폐기 — 퇴사/역할변경 시 일괄 무효화 (FR-23)' })
  async deprovision(
    @CurrentUser('id') adminId: string,
    @Param('userId') userId: string,
    @Body() body: DeprovisionStaffDto,
  ) {
    return { data: await this.svc.deprovision(adminId, userId, body?.reason) };
  }
}
