import { Controller, Get, Post, Patch, Param, Body, Query, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { UserRole } from '@prisma/client';
import { PartnerRequestService } from './partner-request.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ApplyPartnerRequestDto, ReviewPartnerRequestDto, ApprovePartnerRequestDto } from './dto/partner-request.dto';

@ApiTags('Partner Request (파트너 신청)')
@Controller('api/v1')
export class PartnerRequestController {
  constructor(private readonly partnerRequestService: PartnerRequestService) {}

  // ── Public endpoints (인증 불필요) ──

  @Post('partner/apply')
  /**
   * 🔴 (2026-09-16 H2) 무인증 쓰기인데 전역 기본(600회/분)만 걸려 있었다 — 형제 공개 폼은 전부
   *    자기 한도를 명시한다(비회원 VoC 5·만족도 60·키오스크 10 "전역 600/분 override").
   *    공개 신청 폼은 한 IP 가 분당 600건을 만들 수 있으면 심사 큐가 스팸으로 막힌다.
   */
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({ summary: '파트너 신청 (공개)' })
  // 🔴 `@Body() dto: any` 는 ValidationPipe 를 통째로 스킵한다 — 빈/불완전 바디가 Prisma 까지 내려가
  //    **500** 이 났다(2026-09-02 운영 실호출). 공개 신청자가 받아야 할 것은 "무엇이 빠졌는지"다.
  async apply(@Body() dto: ApplyPartnerRequestDto) {
    return { data: await this.partnerRequestService.apply(dto) };
  }

  @Get('partner/apply/:id/status')
  @ApiOperation({ summary: '신청 상태 조회 (공개)' })
  async getStatus(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.partnerRequestService.getStatus(id) };
  }

  // ── Admin endpoints ──

  @Get('admin/partner-requests')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '파트너 신청 목록 (관리자)' })
  async findAll(@Query('status') status?: string) {
    return { data: await this.partnerRequestService.findAll(status) };
  }

  @Get('admin/partner-requests/:id')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '파트너 신청 상세 (관리자)' })
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.partnerRequestService.findOne(id) };
  }

  @Patch('admin/partner-requests/:id/review')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '파트너 신청 검토' })
  async review(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ReviewPartnerRequestDto,
    @CurrentUser('id') reviewerId: string,
  ) {
    return { data: await this.partnerRequestService.review(id, body.status, body.reviewNote, reviewerId) };
  }

  @Post('admin/partner-requests/:id/approve')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '파트너 신청 승인 (기관+클라이언트 자동 생성)' })
  async approve(
    @Param('id', ParseUUIDPipe) id: string,
    // 🔴 종전에는 `@Body` 자체가 없어 화면이 보낸 승인 메모가 통째로 버려졌다(컬럼은 있었다).
    @Body() body: ApprovePartnerRequestDto,
    @CurrentUser('id') reviewerId: string,
  ) {
    return { data: await this.partnerRequestService.approve(id, reviewerId, body?.reviewNote) };
  }

  @Post('admin/partner-requests/:id/sandbox')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '샌드박스 환경 생성' })
  async createSandbox(@Param('id', ParseUUIDPipe) id: string) {
    return { data: { sandboxUrl: `https://sandbox.his.example.org/partner/${id}`, status: 'provisioned', message: '샌드박스 환경이 생성되었습니다' } };
  }

  @Get('admin/partner-requests/:id/test')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '파트너 연결 테스트 (FHIR metadata)' })
  async testConnection(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.partnerRequestService.testConnection(id) };
  }

  // ── Partner Monitoring ──

  @Get('admin/partner-monitoring/stats')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '파트너 모니터링 전체 통계' })
  async getMonitoringStats() {
    return { data: await this.partnerRequestService.getMonitoringStats() };
  }

  @Get('admin/partner-monitoring/alerts')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '이상 감지 알림 목록' })
  async getAlerts() {
    return { data: await this.partnerRequestService.getAlerts() };
  }

  @Get('admin/partner-monitoring/:orgId')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '기관별 상세 모니터링' })
  async getOrgMonitoring(@Param('orgId', ParseUUIDPipe) orgId: string) {
    return { data: await this.partnerRequestService.getOrgMonitoring(orgId) };
  }

  @Get('admin/partner-monitoring/:orgId/logs')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '기관별 API 호출 이력' })
  async getOrgLogs(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return { data: await this.partnerRequestService.getOrgLogs(orgId, parseInt(page ?? '1'), parseInt(limit ?? '50')) };
  }
}
