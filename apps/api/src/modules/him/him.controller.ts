import { Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { HimService } from './him.service';

// /api/v1/admin 프리픽스 — AuditInterceptor(AdminConfig) 자동 커버 (PHI 목록 열람·독촉이 감사 대상)
@ApiTags('의무기록 완결도(HIM)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.DOCTOR)
@Controller('api/v1/admin/him')
export class HimController {
  constructor(private readonly svc: HimService) {}

  @Get('deficiencies')
  @ApiOperation({ summary: '미비기록 목록 — 퇴원요약 미비·미서명 진료/간호기록 (기한 config)' })
  async deficiencies(@Query('overdue') overdue?: string) {
    return { data: await this.svc.getDeficiencies(overdue === 'true') };
  }

  @Post('deficiencies/remind')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '기한 초과 미비기록 책임자 독촉 알림(책임자별 묶음)' })
  async remind() {
    return { data: await this.svc.remind() };
  }
}
