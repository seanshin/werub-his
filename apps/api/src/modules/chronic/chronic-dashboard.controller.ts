import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { ChronicService } from './chronic.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';

@ApiTags('만성질환 대시보드')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
@Controller('api/v1/chronic')
export class ChronicDashboardController {
  constructor(private readonly svc: ChronicService) {}

  @Get('dashboard')
  @ApiOperation({ summary: '만성질환 관리 대시보드 — 코호트 최신값·조절상태(목표 미달) 집계' })
  async dashboard(@Query('condition') condition?: string, @Query('status') status?: string) {
    return { data: await this.svc.getDashboard({ condition, status }) };
  }

  @Get('care-gaps')
  @ApiOperation({ summary: '만성질환 추적관리 — 리콜 미수행·목표 미달 케어갭 워크리스트' })
  async careGaps() {
    return { data: await this.svc.getCareGaps() };
  }
}
