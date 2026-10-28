import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  Query,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { CostAnalysisService } from './cost-analysis.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import {
  CostPeriodDto, CreateCostCenterDto, CreateCostDriverDto, CreateManualCostAllocationDto, UpdateCostCenterDto, UpdateCostDriverDto,
} from './dto/cost-analysis.dto';

@ApiTags('Cost Analysis (원가 분석 ABC)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
/**
 * 🔴 (2026-09-16 D4) 쓰기 일부만 `@Roles(ADMIN)` 이고 **읽기 9EP 는 무역할**이었다 —
 *    원가센터·동인·배부·수익성(부서별 실적·이익)까지 인증된 전 직원에게 열려 있었다.
 *    nav 의 `/cost-analysis` 는 ADMIN 전용이라 클래스 기본값도 ADMIN 으로 못박는다.
 */
@Roles(UserRole.ADMIN)
@Controller('api/v1/cost')
export class CostAnalysisController {
  constructor(private readonly svc: CostAnalysisService) {}

  // ── Cost Centers ──────────────────────────

  @Get('centers')
  @ApiOperation({ summary: '원가 중심점 트리 조회' })
  async getCenters() {
    return { data: await this.svc.getCenters() };
  }

  @Post('centers')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '원가 중심점 생성' })
  async createCenter(@Body() body: CreateCostCenterDto) {
    return { data: await this.svc.createCenter(body) };
  }

  @Put('centers/:id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '원가 중심점 수정' })
  async updateCenter(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateCostCenterDto,
  ) {
    return { data: await this.svc.updateCenter(id, body) };
  }

  // ── Cost Drivers ──────────────────────────

  @Get('drivers')
  @ApiOperation({ summary: '원가 동인 목록' })
  async getDrivers(
    @Query('category') category?: string,
    @Query('period') period?: string,
  ) {
    return { data: await this.svc.getDrivers(category, period) };
  }

  @Post('drivers')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '원가 동인 생성' })
  async createDriver(@Body() body: CreateCostDriverDto) {
    return { data: await this.svc.createDriver(body) };
  }

  @Put('drivers/:id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '원가 동인 수정' })
  async updateDriver(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateCostDriverDto,
  ) {
    return { data: await this.svc.updateDriver(id, body) };
  }

  // ── Allocations ───────────────────────────

  @Post('allocations')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '수동 원가 배부' })
  async createAllocation(@Body() body: CreateManualCostAllocationDto) {
    return { data: await this.svc.createAllocation(body) };
  }

  @Post('allocations/auto')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '자동 원가 배부 (동인 기반)' })
  async autoAllocate(@Body() body: CostPeriodDto) {
    return { data: await this.svc.autoAllocate(body.period) };
  }

  @Get('allocations')
  @ApiOperation({ summary: '배부 내역 조회' })
  async getAllocations(
    @Query('costCenterId') costCenterId?: string,
    @Query('period') period?: string,
  ) {
    return { data: await this.svc.getAllocations(costCenterId, period) };
  }

  // ── Procedure Costs ───────────────────────

  @Get('procedure-costs')
  @ApiOperation({ summary: '시술별 원가 목록' })
  async getProcedureCosts(@Query('period') period?: string) {
    return { data: await this.svc.getProcedureCosts(period) };
  }

  @Post('procedure-costs/calculate')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '시술별 원가 산출 (배부/수납 집계)' })
  async calculateProcedureCosts(@Body() body: CostPeriodDto) {
    return { data: await this.svc.calculateProcedureCosts(body.period) };
  }

  // ── Analytics ─────────────────────────────

  @Get('dashboard')
  @ApiOperation({ summary: '경영 대시보드(부서별 원가·추이·전사 손익)' })
  async getDashboard(@Query('period') period?: string) {
    return { data: await this.svc.getDashboard(period) };
  }

  @Get('analytics/department')
  @ApiOperation({ summary: '부서별 원가/매출 분석' })
  async getDepartmentAnalytics(@Query('period') period?: string) {
    return { data: await this.svc.getDepartmentAnalytics(period) };
  }

  @Get('analytics/profitability')
  @ApiOperation({ summary: '시술/DRG 수익성 순위' })
  async getProfitability(@Query('period') period?: string) {
    return { data: await this.svc.getProfitability(period) };
  }

  @Get('analytics/actual-profitability')
  @ApiOperation({ summary: '실제 청구수익 연계 손익(표준수가 대비 편차)' })
  async getActualProfitability(@Query('period') period?: string) {
    return { data: await this.svc.getActualProfitability(period) };
  }

  @Post('export-erp')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'ERP 관리회계 연계(기간 원가배부+실제손익 발행)' })
  async exportToErp(@Body() body: CostPeriodDto) {
    return { data: await this.svc.exportToErp(body.period) };
  }

  @Get('analytics/trend')
  @ApiOperation({ summary: '기간별 원가 추이' })
  async getTrend(
    @Query('startPeriod') startPeriod: string,
    @Query('endPeriod') endPeriod: string,
  ) {
    return { data: await this.svc.getTrend(startPeriod, endPeriod) };
  }
}
