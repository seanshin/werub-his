import { Controller, Get, Put, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { OnboardingService } from './onboarding.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

// 환영·회사소개 콘텐츠 편집(관리자) — SystemConfig `onboarding.welcome` (FR-G2)
@ApiTags('Onboarding (환영 콘텐츠 편집)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('api/v1/admin/onboarding')
export class OnboardingWelcomeController {
  constructor(private readonly svc: OnboardingService) {}

  @Get('welcome')
  @ApiOperation({ summary: '환영 콘텐츠 조회(편집용)' })
  async get() {
    return { data: await this.svc.getWelcome() };
  }

  @Put('welcome')
  @ApiOperation({ summary: '환영 콘텐츠 저장' })
  async put(@Body() body: { content: unknown }, @CurrentUser('id') adminId: string) {
    return { data: await this.svc.setWelcome(body?.content ?? body, adminId) };
  }
}
