import { Controller, Get, Put, Post, Query, Param, Body, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { QiService } from './qi.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('Quality Improvement')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/qi')
export class QiController {
  constructor(private readonly service: QiService) {}

  @Get('metrics')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR)
  @ApiOperation({ summary: '질관리 지표 조회' })
  async getMetrics(
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('department') department?: string,
  ) {
    return this.service.getMetrics(from, to, department);
  }

  // ─── C4. 의료 질 지표 관리 고도화 (10 endpoints) ───────────────────

  @Get('adequacy')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR)
  @ApiOperation({ summary: 'HIRA 적정성 평가 지표 조회' })
  @ApiResponse({ status: 200, description: '적정성 평가 지표 반환' })
  async getAdequacyIndicators(@Query('diseaseGroup') diseaseGroup?: string) {
    return { data: await this.service.getAdequacyIndicators(diseaseGroup) };
  }

  @Get('psi')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR)
  @ApiOperation({ summary: 'Patient Safety Indicators 자동 계산' })
  @ApiResponse({ status: 200, description: 'PSI 계산 결과 반환' })
  async calculatePsi() {
    return { data: await this.service.calculatePsi() };
  }

  @Get('hsmr')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR)
  @ApiOperation({ summary: 'HSMR (표준화 사망비) 계산' })
  @ApiResponse({ status: 200, description: 'HSMR 계산 결과 반환' })
  async calculateHsmr(@Query('period') period?: string) {
    return { data: await this.service.calculateHsmr(period) };
  }

  @Get('readmission-rate')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR)
  @ApiOperation({ summary: '30일 재입원율 추적' })
  @ApiResponse({ status: 200, description: '재입원율 데이터 반환' })
  async getReadmissionRate(@Query('period') period?: string) {
    return { data: await this.service.getReadmissionRate(period) };
  }

  @Get('accreditation')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR)
  @ApiOperation({ summary: 'JCI/KoHIAS 인증 체크리스트 조회' })
  @ApiResponse({ status: 200, description: '체크리스트 반환' })
  async getAccreditationChecklist(@Query('standard') standard?: string) {
    return { data: await this.service.getAccreditationChecklist(standard) };
  }

  @Put('accreditation/:id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '인증 체크리스트 항목 업데이트' })
  @ApiResponse({ status: 200, description: '항목 업데이트 완료' })
  async updateAccreditationItem(
    @Param('id') id: string,
    @Body() data: Record<string, unknown>,
    @CurrentUser('id') userId: string,
  ) {
    const result = await this.service.updateAccreditationItem(id, data, userId);
    return { data: result };
  }

  @Get('indicator-dashboard')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR)
  @ApiOperation({ summary: '월별 지표 대시보드 (트렌드+벤치마크+목표)' })
  @ApiResponse({ status: 200, description: '대시보드 데이터 반환' })
  async getIndicatorDashboard(@Query('period') period?: string) {
    return { data: await this.service.getIndicatorDashboard(period) };
  }

  @Get('benchmark')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR)
  @ApiOperation({ summary: '전국 벤치마크 비교' })
  @ApiResponse({ status: 200, description: '벤치마크 비교 데이터 반환' })
  async getBenchmarkComparison(@Query('indicator') indicator?: string) {
    return { data: await this.service.getBenchmarkComparison(indicator) };
  }

  @Get('target-achievement')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR)
  @ApiOperation({ summary: '목표 달성률 조회' })
  @ApiResponse({ status: 200, description: '목표 달성률 반환' })
  async getTargetAchievement(@Query('period') period?: string) {
    return { data: await this.service.getTargetAchievement(period) };
  }

  @Post('report')
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'QI 보고서 생성' })
  @ApiResponse({ status: 201, description: 'QI 보고서 생성 완료' })
  async generateQiReport(@Body() body: Record<string, unknown>) {
    const period = (body.period as string) || new Date().toISOString().slice(0, 7);
    return { data: await this.service.generateQiReport(period), meta: { status: 'generated' } };
  }
}
