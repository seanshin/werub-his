import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { OperationalStatsService } from './operational-stats.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Permission } from '../auth/rbac/permission.types';
import { GetStatsDto } from './dto/operational-stats.dto';

@ApiTags('Operational Stats')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/operational-stats')
export class OperationalStatsController {
  constructor(private readonly statsService: OperationalStatsService) {}

  @Get('ward')
  @RequirePermission(Permission.DASHBOARD_VIEW)
  @ApiOperation({ summary: '병동별 통계' })
  @ApiResponse({ status: 200, description: '병동별 통계 조회 성공' })
  async getWardStats(@Query() dto: GetStatsDto) {
    return { data: await this.statsService.getWardStats(dto.startDate, dto.endDate) };
  }

  @Get('admission-trends')
  @RequirePermission(Permission.DASHBOARD_VIEW)
  @ApiOperation({ summary: '입원 추세' })
  @ApiResponse({ status: 200, description: '입원 추세 조회 성공' })
  async getAdmissionTrends(@Query() dto: GetStatsDto) {
    return { data: await this.statsService.getAdmissionTrends(dto.startDate, dto.endDate) };
  }

  @Get('patient-flow')
  @RequirePermission(Permission.DASHBOARD_VIEW)
  @ApiOperation({ summary: '환자 유입/퇴원' })
  @ApiResponse({ status: 200, description: '환자 유입/퇴원 조회 성공' })
  async getPatientFlow(@Query() dto: GetStatsDto) {
    return { data: await this.statsService.getPatientFlow(dto.startDate, dto.endDate) };
  }

  @Get('disease')
  @RequirePermission(Permission.DASHBOARD_VIEW)
  @ApiOperation({ summary: '질환별 통계' })
  @ApiResponse({ status: 200, description: '질환별 통계 조회 성공' })
  async getDiseaseStats(@Query() dto: GetStatsDto) {
    return { data: await this.statsService.getDiseaseStats(dto.startDate, dto.endDate) };
  }

  @Get('financial')
  @RequirePermission(Permission.DASHBOARD_VIEW)
  @ApiOperation({ summary: '재무 통계' })
  @ApiResponse({ status: 200, description: '재무 통계 조회 성공' })
  async getFinancialStats(@Query() dto: GetStatsDto) {
    return { data: await this.statsService.getFinancialStats(dto.startDate, dto.endDate) };
  }
}
