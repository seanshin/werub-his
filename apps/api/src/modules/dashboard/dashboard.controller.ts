import { Controller, Get, Query, Sse, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Observable, interval, switchMap, map, startWith } from 'rxjs';
import { DashboardService } from './dashboard.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Permission } from '../auth/rbac/permission.types';

@ApiTags('Dashboard')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('summary')
  @RequirePermission(Permission.DASHBOARD_VIEW)
  @ApiOperation({ summary: '전체 대시보드 요약' })
  @ApiResponse({ status: 200, description: '대시보드 요약 조회 성공' })
  async getDashboardSummary(@Query('range') range?: 'today' | 'week' | 'month') {
    return {
      data: await this.dashboardService.getDashboardSummary(range || 'today'),
    };
  }

  @Get('overview')
  @RequirePermission(Permission.DASHBOARD_VIEW)
  @ApiOperation({ summary: '대시보드 오버뷰 (summary alias)' })
  async getDashboardOverview(@Query('range') range?: 'today' | 'week' | 'month') {
    return {
      data: await this.dashboardService.getDashboardSummary(range || 'today'),
    };
  }

  @Get('charts')
  @RequirePermission(Permission.DASHBOARD_VIEW)
  @ApiOperation({ summary: '대시보드 차트 데이터' })
  async getChartData() {
    return { data: await this.dashboardService.getChartData() };
  }

  @Get('pharmacy/stats')
  @RequirePermission(Permission.DASHBOARD_VIEW)
  @ApiOperation({ summary: '약국 통계' })
  @ApiResponse({ status: 200, description: '약국 통계 조회 성공' })
  async getPharmacyStats(@Query('range') range?: 'today' | 'week' | 'month') {
    return {
      data: await this.dashboardService.getPharmacyStats(range || 'today'),
    };
  }

  @Get('lab/stats')
  @RequirePermission(Permission.DASHBOARD_VIEW)
  @ApiOperation({ summary: '검사실 통계' })
  @ApiResponse({ status: 200, description: '검사실 통계 조회 성공' })
  async getLabStats(@Query('range') range?: 'today' | 'week' | 'month') {
    return {
      data: await this.dashboardService.getLabStats(range || 'today'),
    };
  }

  @Get('imaging/stats')
  @RequirePermission(Permission.DASHBOARD_VIEW)
  @ApiOperation({ summary: '영상실 통계' })
  @ApiResponse({ status: 200, description: '영상실 통계 조회 성공' })
  async getImagingStats(@Query('range') range?: 'today' | 'week' | 'month') {
    return {
      data: await this.dashboardService.getImagingStats(range || 'today'),
    };
  }

  @Get('pharmacy/queue')
  @RequirePermission(Permission.DASHBOARD_VIEW)
  @ApiOperation({ summary: '약국 대기열' })
  @ApiResponse({ status: 200, description: '약국 대기열 조회 성공' })
  async getPharmacyQueue() {
    return {
      data: await this.dashboardService.getPharmacyQueue(),
    };
  }

  @Get('lab/queue')
  @RequirePermission(Permission.DASHBOARD_VIEW)
  @ApiOperation({ summary: '검사실 대기열' })
  @ApiResponse({ status: 200, description: '검사실 대기열 조회 성공' })
  async getLabQueue() {
    return {
      data: await this.dashboardService.getLabQueue(),
    };
  }

  @Get('imaging/queue')
  @RequirePermission(Permission.DASHBOARD_VIEW)
  @ApiOperation({ summary: '영상실 대기열' })
  @ApiResponse({ status: 200, description: '영상실 대기열 조회 성공' })
  async getImagingQueue() {
    return {
      data: await this.dashboardService.getImagingQueue(),
    };
  }

  @Get('financial/summary')
  @RequirePermission(Permission.DASHBOARD_VIEW)
  @ApiOperation({ summary: '재무 요약' })
  @ApiResponse({ status: 200, description: '재무 요약 조회 성공' })
  async getFinancialSummary(@Query('range') range?: 'today' | 'week' | 'month') {
    return {
      data: await this.dashboardService.getFinancialSummary(range || 'today'),
    };
  }

  @Get('monthly-revenue')
  @RequirePermission(Permission.DASHBOARD_VIEW)
  @ApiOperation({ summary: '월별 매출 추이 (6개월)' })
  async getMonthlyRevenue() {
    return { data: await this.dashboardService.getMonthlyRevenue() };
  }

  @Get('department-revenue')
  @RequirePermission(Permission.DASHBOARD_VIEW)
  @ApiOperation({ summary: '진료과별 매출 통계 (이번 달)' })
  async getDepartmentRevenue() {
    return { data: await this.dashboardService.getDepartmentRevenue() };
  }

  @Get('bed-occupancy')
  @RequirePermission(Permission.DASHBOARD_VIEW)
  @ApiOperation({ summary: '병상 가동률 추이 (7일)' })
  async getBedOccupancy() {
    return { data: await this.dashboardService.getBedOccupancyTrend() };
  }

  @Sse('stream')
  @RequirePermission(Permission.DASHBOARD_VIEW)
  @ApiOperation({ summary: '실시간 대시보드 SSE (30초 간격)' })
  dashboardStream(): Observable<MessageEvent> {
    return interval(30_000).pipe(
      startWith(0),
      switchMap(() => this.dashboardService.getDashboardSummary('today')),
      map((data) => ({ data: JSON.stringify(data) }) as MessageEvent),
    );
  }
}
