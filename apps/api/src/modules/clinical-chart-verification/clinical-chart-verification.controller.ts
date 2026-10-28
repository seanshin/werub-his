import { Controller, Get, Post, Body, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { ClinicalChartVerificationService } from './clinical-chart-verification.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CreateChartVerificationDto } from './dto/clinical-chart-verification.dto';

interface ReqUser { id: string; familyName?: string; givenName?: string }

@ApiTags('Clinical Chart Verification (임상도구 검수)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/clinical-chart-verifications')
export class ClinicalChartVerificationController {
  constructor(private readonly svc: ClinicalChartVerificationService) {}

  @Post()
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '검수 기록(승인/반려) — 의사·관리자' })
  async create(@Body() dto: CreateChartVerificationDto, @CurrentUser() user: ReqUser) {
    return { data: await this.svc.create(dto, user) };
  }

  @Get()
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN, UserRole.READ)
  @ApiOperation({ summary: '차트별 검수 요약(최신 상태·4-eyes 승인자 집계·설정)' })
  async getSummary() {
    return { data: await this.svc.getSummary() };
  }

  @Get(':chartId/history')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN, UserRole.READ)
  @ApiOperation({ summary: '차트 검수 이력' })
  async findHistory(@Param('chartId') chartId: string) {
    return { data: await this.svc.findHistory(chartId) };
  }
}
