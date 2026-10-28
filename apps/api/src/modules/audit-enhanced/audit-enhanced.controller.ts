import { Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards, ParseUUIDPipe, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { BtgService } from './btg.service';
import { VipPatientService } from './vip-patient.service';
import { AnomalyDetectionService } from './anomaly-detection.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CreateBtgDto, ReviewBtgDto, DesignateVipDto } from './dto/audit-enhanced.dto';

@ApiTags('Audit Enhanced')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1')
export class AuditEnhancedController {
  constructor(
    private readonly btgService: BtgService,
    private readonly vipService: VipPatientService,
    private readonly anomalyService: AnomalyDetectionService,
  ) {}

  // ── Break-the-Glass ──

  @Post('break-the-glass')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: 'Break-the-Glass 접근 기록' })
  async createBtg(@Body() body: CreateBtgDto, @CurrentUser('id') userId: string) {
    return { data: await this.btgService.createAccess(body, userId) };
  }

  @Get('break-the-glass')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'BTG 접근 이력 (관리자)' })
  async listBtg(@Query('userId') userId?: string, @Query('dateFrom') dateFrom?: string, @Query('dateTo') dateTo?: string) {
    return { data: await this.btgService.findAll({ userId, dateFrom, dateTo }) };
  }

  @Patch('break-the-glass/:id/review')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'BTG 접근 검토' })
  async reviewBtg(@Param('id', ParseUUIDPipe) id: string, @Body() body: ReviewBtgDto, @CurrentUser('id') reviewerId: string) {
    return { data: await this.btgService.review(id, body.isApproved, reviewerId) };
  }

  // ── VIP 환자 ──

  @Post('vip-patients')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'VIP 환자 지정' })
  async designateVip(@Body() body: DesignateVipDto, @CurrentUser('id') userId: string) {
    return { data: await this.vipService.designate(body.patientId, body.reason, userId) };
  }

  @Get('vip-patients')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'VIP 환자 목록' })
  async listVip() {
    return { data: await this.vipService.findAll() };
  }

  @Delete('vip-patients/:patientId')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'VIP 해제' })
  async removeVip(@Param('patientId', ParseUUIDPipe) patientId: string) {
    await this.vipService.remove(patientId);
    return { data: { deleted: true } };
  }

  // ── 환자 열람 이력 ──

  @Get('patients/:patientId/access-history')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN, UserRole.MEDICAL_RECORDS)
  @ApiOperation({ summary: '환자 기록 열람 이력 — 전체 수·쪽 나눔(limit≤200·offset) · IP·브라우저는 관리자에게만' })
  async accessHistory(
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @CurrentUser('role') role: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const num = (v?: string) => (v == null || v === '' ? undefined : Number(v));
    const l = num(limit), o = num(offset);
    if ((l != null && !Number.isFinite(l)) || (o != null && !Number.isFinite(o))) throw new BadRequestException('limit·offset 은 숫자여야 합니다');
    return { data: await this.btgService.getPatientAccessHistory(patientId, { viewerRole: role, limit: l, offset: o }) };
  }

  // ── 감사 대시보드 ──

  @Get('audit/dashboard')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '감사 대시보드 통계' })
  async dashboard(@Query('dateFrom') dateFrom?: string, @Query('dateTo') dateTo?: string) {
    return { data: await this.anomalyService.getDashboardStats(dateFrom, dateTo) };
  }
}
