import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { SafetyGateService } from './safety-gate.service';

@ApiTags('Safety Gates (안전 게이트 관제)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/admin/safety-gates')
export class SafetyGateController {
  constructor(private readonly svc: SafetyGateService) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.EXECUTIVE)
  @ApiOperation({ summary: '게이트별 모드+위반 통계(7/30일)+최근 사례 — WARN→BLOCK 승격 판단용' })
  async dashboard() {
    return { data: await this.svc.getDashboard() };
  }
}
