import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { ExecutiveService } from './executive.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { FeatureAccessGuard } from '../access-control/feature-access.guard';
import { RequireFeature } from '../access-control/require-feature.decorator';

// 기능 접근 매트릭스(executive.console)로 진입 통제 — defaultRoles=[ADMIN] 라 기존 동작 보존,
// 관리자가 매트릭스에서 EXECUTIVE 등 추가 허용/특정 사용자 grant·deny 가능.
@ApiTags('Executive Dashboard')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, FeatureAccessGuard)
@RequireFeature('executive.console')
@Controller('api/v1/executive')
export class ExecutiveController {
  constructor(private readonly svc: ExecutiveService) {}

  @Get('hourly')
  @ApiOperation({ summary: '시간대별 진료 분포' })
  async getHourlyDistribution(@Query('date') date?: string) {
    return { data: await this.svc.getHourlyDistribution(date) };
  }

  @Get('top-diagnoses')
  @ApiOperation({ summary: '상위 진단코드' })
  async getTopDiagnoses(
    @Query('limit') limit?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return { data: await this.svc.getTopDiagnoses(limit ? parseInt(limit) : 10, from, to) };
  }

  @Get('insurance-breakdown')
  @ApiOperation({ summary: '보험유형별 매출 분석' })
  async getInsuranceBreakdown() {
    return { data: await this.svc.getInsuranceBreakdown() };
  }

  @Get('overview')
  @ApiOperation({ summary: '경영 대시보드 — 오늘 현황 요약' })
  async getOverview() { return { data: await this.svc.getOverview() }; }

  @Get('revenue/weekly')
  @ApiOperation({ summary: '주간 매출 추이' })
  async getWeeklyRevenue() { return { data: await this.svc.getWeeklyRevenue() }; }

  @Get('revenue/monthly')
  @ApiOperation({ summary: '월간 진료 추이' })
  async getMonthlyTrend() { return { data: await this.svc.getMonthlyTrend() }; }

  @Get('departments')
  @ApiOperation({ summary: '부서별 실적' })
  async getDepartmentStats() { return { data: await this.svc.getDepartmentStats() }; }

  @Get('staff-summary')
  @ApiOperation({ summary: '인력 현황' })
  async getStaffSummary() { return { data: await this.svc.getStaffSummary() }; }

  @Get('kpi')
  @ApiOperation({ summary: 'KPI 지표' })
  async getKpi() { return { data: await this.svc.getKpi() }; }

  @Get('claims')
  @ApiOperation({ summary: '보험 청구 현황' })
  async getClaims() { return { data: await this.svc.getClaimsSummary() }; }

  @Get('alerts')
  @ApiOperation({ summary: '경영 알림' })
  async getAlerts() { return { data: await this.svc.getAlerts() }; }

  // ── 의료 품질 대시보드 ──

  @Get('clinical/overview')
  @ApiOperation({ summary: '의료 품질 — 오늘 진료 현황' })
  async getClinicalOverview() { return { data: await this.svc.getClinicalOverview() }; }

  @Get('clinical/doctors')
  @ApiOperation({ summary: '의료진별 진료 실적' })
  async getDoctorStats() { return { data: await this.svc.getDoctorStats() }; }

  @Get('clinical/safety')
  @ApiOperation({ summary: '안전/질관리 지표' })
  async getSafety() { return { data: await this.svc.getSafety() }; }

  @Get('clinical/infection')
  @ApiOperation({ summary: '감염관리 현황' })
  async getInfection() { return { data: await this.svc.getInfection() }; }

  @Get('clinical/weekly-trend')
  @ApiOperation({ summary: '진료과별 주간 추이' })
  async getClinicalWeeklyTrend() { return { data: await this.svc.getClinicalWeeklyTrend() }; }
}
