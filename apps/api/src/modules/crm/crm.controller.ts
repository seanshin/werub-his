import { Controller, Get, Post, Put, Patch, Delete, Body, Param, Query, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole, Prisma } from '@prisma/client';
import { CrmService } from './crm.service';
import { CrmAiService } from './crm-ai.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CampaignLogsQueryDto, ReminderAutomationQueryDto } from './dto/crm-logs-query.dto';
import { CrmProxyCancelDto, CrmProxyCreateAppointmentDto, CrmProxyRescheduleDto } from './dto/crm-proxy-appointment.dto';
import {
  CreateCrmCampaignDto,
  CreateCrmSegmentDto,
  CreateCrmTemplateDto,
  CreateForeignCaseDto,
  CreatePortalBannerDto,
  LogCrmCommunicationDto,
  UpdateCrmCampaignDto,
  UpdateCrmPatientConsentDto,
  UpdateCrmTemplateDto,
  UpdateForeignCaseDto,
  UpdatePortalBannerDto,
} from './dto/crm-write.dto';

@ApiTags('CRM')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.CRM_MANAGER, UserRole.CRM_STAFF, UserRole.ADMIN)
@Controller('api/v1/crm')
export class CrmController {
  constructor(
    private readonly service: CrmService,
    private readonly ai: CrmAiService,
  ) {}

  // ── 대시보드 ──

  @Get('dashboard')
  @ApiOperation({ summary: 'CRM 대시보드' })
  async getDashboard() {
    return { data: await this.service.getDashboard() };
  }

  // ── 캠페인 ──

  @Post('campaigns')
  @ApiOperation({ summary: '캠페인 생성' })
  async createCampaign(
    @Body() body: CreateCrmCampaignDto,
    @CurrentUser('id') userId: string,
  ) {
    return {
      data: await this.service.createCampaign({
        ...body,
        variables: body.variables as Prisma.InputJsonValue | undefined,
        scheduledAt: body.scheduledAt ? new Date(body.scheduledAt) : undefined,
      }, userId),
    };
  }

  @Get('campaigns')
  @ApiOperation({ summary: '캠페인 목록' })
  async findCampaigns(
    @Query('status') status?: string,
    @Query('type') type?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.findCampaigns({
      status, type,
      page: page ? parseInt(page) : undefined,
      limit: limit ? parseInt(limit) : undefined,
    });
  }

  @Get('campaigns/:id')
  @ApiOperation({ summary: '캠페인 상세' })
  async getCampaign(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.service.getCampaign(id) };
  }

  @Get('campaigns/:id/logs')
  @ApiOperation({ summary: '캠페인 발송 기록(환자별) — SENT·SIMULATED(나가지 않음)·FAILED(사유) 그대로 · 도달은 기록 경로 없음' })
  async getCampaignLogs(@Param('id', ParseUUIDPipe) id: string, @Query() q: CampaignLogsQueryDto) {
    return this.service.getCampaignLogs(id, q);
  }

  @Put('campaigns/:id')
  @ApiOperation({ summary: '캠페인 수정 (DRAFT만)' })
  async updateCampaign(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateCrmCampaignDto,
  ) {
    return { data: await this.service.updateCampaign(id, body) };
  }

  @Post('campaigns/:id/send')
  @Roles(UserRole.CRM_MANAGER, UserRole.ADMIN)
  @ApiOperation({ summary: '캠페인 발송' })
  async sendCampaign(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.service.sendCampaign(id) };
  }

  @Patch('campaigns/:id/cancel')
  @ApiOperation({ summary: '캠페인 취소' })
  async cancelCampaign(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.service.cancelCampaign(id) };
  }

  // ── 세그먼트 ──

  @Post('segments')
  @ApiOperation({ summary: '세그먼트 생성' })
  async createSegment(@Body() body: CreateCrmSegmentDto) {
    return { data: await this.service.createSegment({ ...body, rules: body.rules as Prisma.InputJsonValue }) };
  }

  @Get('segments')
  @ApiOperation({ summary: '세그먼트 목록' })
  async findSegments() {
    return { data: await this.service.findSegments() };
  }

  @Get('segments/:id')
  @ApiOperation({ summary: '세그먼트 상세 + 환자 목록' })
  async getSegment(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.service.getSegment(id) };
  }

  @Post('segments/:id/refresh')
  @ApiOperation({ summary: '세그먼트 환자 수 갱신' })
  async refreshSegment(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.service.refreshSegment(id) };
  }

  @Delete('segments/:id')
  @ApiOperation({ summary: '세그먼트 삭제 (soft)' })
  async deleteSegment(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.service.deleteSegment(id) };
  }

  // ── 템플릿 ──

  @Post('templates')
  @ApiOperation({ summary: '템플릿 생성' })
  async createTemplate(@Body() body: CreateCrmTemplateDto) {
    return { data: await this.service.createTemplate(body) };
  }

  @Get('templates')
  @ApiOperation({ summary: '템플릿 목록' })
  async findTemplates(
    @Query('type') type?: string,
    @Query('channel') channel?: string,
    @Query('locale') locale?: string,
  ) {
    return { data: await this.service.findTemplates({ type, channel, locale }) };
  }

  @Put('templates/:id')
  @ApiOperation({ summary: '템플릿 수정' })
  async updateTemplate(@Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateCrmTemplateDto) {
    return { data: await this.service.updateTemplate(id, body) };
  }

  @Delete('templates/:id')
  @ApiOperation({ summary: '템플릿 삭제 (soft)' })
  async deleteTemplate(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.service.deleteTemplate(id) };
  }

  @Post('templates/:id/preview')
  @ApiOperation({ summary: '템플릿 변수 치환 미리보기' })
  async previewTemplate(@Param('id', ParseUUIDPipe) id: string, @Body() body: { variables: Record<string, string> }) {
    return { data: await this.service.previewTemplate(id, body.variables) };
  }

  // ── 환자 CRM 프로필 ──

  @Get('patients/:id/profile')
  @ApiOperation({ summary: '환자 CRM 프로필 (의료 정보 제외)' })
  async getPatientProfile(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.service.getPatientProfile(id) };
  }

  @Get('patients/:id/communications')
  @ApiOperation({ summary: '환자 소통 이력' })
  async getPatientCommunications(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.getPatientCommunications(id, page ? parseInt(page) : 1, limit ? parseInt(limit) : 20);
  }

  @Put('patients/:id/consent')
  @ApiOperation({ summary: '마케팅 동의 관리' })
  async updatePatientConsent(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateCrmPatientConsentDto,
  ) {
    return { data: await this.service.updatePatientConsent(id, body) };
  }

  // ── 검진 CRM ──

  @Get('checkup/targets')
  @ApiOperation({ summary: '검진 대상자 목록' })
  async getCheckupTargets(
    @Query('category') category?: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.getCheckupTargets({
      category, status,
      page: page ? parseInt(page) : undefined,
      limit: limit ? parseInt(limit) : undefined,
    });
  }

  @Get('checkup/analytics')
  @ApiOperation({ summary: '검진 실적 분석' })
  async getCheckupAnalytics() {
    return { data: await this.service.getCheckupAnalytics() };
  }

  // ── 해외환자 CRM ──

  @Post('international/cases')
  @ApiOperation({ summary: '해외환자 케이스 생성' })
  async createForeignCase(
    @Body() body: CreateForeignCaseDto,
    @CurrentUser('id') userId: string,
  ) {
    return {
      data: await this.service.createForeignCase({
        ...body,
        arrivalDate: body.arrivalDate ? new Date(body.arrivalDate) : undefined,
        departureDate: body.departureDate ? new Date(body.departureDate) : undefined,
      }, userId),
    };
  }

  @Get('international/cases')
  @ApiOperation({ summary: '해외환자 케이스 목록' })
  async findForeignCases(
    @Query('status') status?: string,
    @Query('assignedTo') assignedTo?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.findForeignCases({
      status, assignedTo,
      page: page ? parseInt(page) : undefined,
      limit: limit ? parseInt(limit) : undefined,
    });
  }

  @Get('international/cases/:id')
  @ApiOperation({ summary: '해외환자 케이스 상세' })
  async getForeignCase(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.service.getForeignCase(id) };
  }

  @Put('international/cases/:id')
  @ApiOperation({ summary: '해외환자 케이스 수정' })
  async updateForeignCase(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateForeignCaseDto,
  ) {
    return { data: await this.service.updateForeignCase(id, body) };
  }

  @Get('international/analytics')
  @ApiOperation({ summary: '해외환자 실적 분석' })
  async getForeignAnalytics() {
    return { data: await this.service.getForeignAnalytics() };
  }

  @Get('international/agencies')
  @ApiOperation({ summary: '에이전시별 실적 — 케이스 agencyName 축 집계(계약 CRUD 없음)' })
  async getAgencyStats() {
    return { data: await this.service.getAgencyStats() };
  }

  // ── 상담/검색 ──

  @Get('proxy/patient-search')
  @ApiOperation({ summary: '환자 검색 (CRM 허용 데이터)' })
  async searchPatients(@Query('q') q: string) {
    return { data: await this.service.searchPatients(q || '') };
  }

  @Post('communications')
  @ApiOperation({ summary: '소통 이력 기록' })
  async logCommunication(
    @Body() body: LogCrmCommunicationDto,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.service.logCommunication(body, userId) };
  }

  // ── 포털 배너 ──

  @Post('portal/banners')
  @Roles(UserRole.CRM_MANAGER, UserRole.ADMIN)
  @ApiOperation({ summary: '포털 배너 생성' })
  async createBanner(
    @Body() body: CreatePortalBannerDto,
    @CurrentUser('id') userId: string,
  ) {
    return {
      data: await this.service.createBanner({
        ...body,
        publishFrom: new Date(body.publishFrom),
        publishUntil: new Date(body.publishUntil),
      }, userId),
    };
  }

  @Get('portal/banners')
  @ApiOperation({ summary: '포털 배너 목록' })
  async findBanners(@Query('active') active?: string) {
    return { data: await this.service.findBanners(active !== 'false') };
  }

  @Put('portal/banners/:id')
  @ApiOperation({ summary: '포털 배너 수정' })
  async updateBanner(@Param('id', ParseUUIDPipe) id: string, @Body() body: UpdatePortalBannerDto) {
    return { data: await this.service.updateBanner(id, body) };
  }

  @Delete('portal/banners/:id')
  @ApiOperation({ summary: '포털 배너 삭제 (soft)' })
  async deleteBanner(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.service.deleteBanner(id) };
  }

  @Post('portal/banners/:id/click')
  @ApiOperation({ summary: '배너 클릭 추적' })
  async clickBanner(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.service.clickBanner(id) };
  }

  // ── 자동화 ──

  @Get('automation/status')
  @ApiOperation({ summary: '자동화 현황' })
  async getAutomationStatus() {
    return { data: await this.service.getAutomationStatus() };
  }

  @Get('automation/reminders')
  @ApiOperation({ summary: '자동 연락 크론 현황(작업별 발송 기록 집계) — 수동 실행 없음(대외 발신 3조건 미해소)' })
  async getReminderAutomation(@Query() q: ReminderAutomationQueryDto) {
    return { data: await this.service.getReminderAutomation(q.days ?? 7) };
  }

  @Post('automation/churn-analysis')
  @Roles(UserRole.CRM_MANAGER, UserRole.ADMIN)
  @ApiOperation({ summary: '이탈 분석 실행' })
  async runChurnAnalysis() {
    return { data: await this.service.runChurnAnalysis() };
  }

  @Get('dashboard/rfm')
  @ApiOperation({ summary: 'RFM 세그먼트 분포' })
  async getRfmDashboard() {
    return { data: await this.service.getRfmDashboard() };
  }

  // ── A/B 테스트 ──

  @Post('campaigns/:id/ab-test')
  @Roles(UserRole.CRM_MANAGER, UserRole.ADMIN)
  @ApiOperation({ summary: 'A/B 테스트 생성' })
  async createAbTest(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { variantContent: string; variantSubject?: string; splitRatio: number },
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.service.createAbTest(id, body, userId) };
  }

  @Get('campaigns/:id/ab-results')
  @ApiOperation({ summary: 'A/B 테스트 결과' })
  async getAbTestResults(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.service.getAbTestResults(id) };
  }

  // ── 분석 ──

  @Get('dashboard/retention')
  @ApiOperation({ summary: '코호트 리텐션 분석' })
  async getRetentionCohort() {
    return { data: await this.service.getRetentionCohort() };
  }

  @Get('dashboard/performance')
  @ApiOperation({ summary: '캠페인 성과 요약 (30일)' })
  async getCampaignPerformance() {
    return { data: await this.service.getCampaignPerformance() };
  }

  // ── AI 최적화 ──

  @Get('ai/recommend-time')
  @ApiOperation({ summary: 'AI 최적 발송 시간 추천' })
  async recommendSendTime(@Query('segmentId') segmentId?: string) {
    return { data: await this.ai.recommendSendTime(segmentId) };
  }

  @Get('ai/recommend-segment')
  @ApiOperation({ summary: 'AI 세그먼트 추천 (캠페인 유형별)' })
  async recommendSegment(@Query('type') type: string) {
    return { data: await this.ai.recommendSegment(type || 'PROMOTION') };
  }

  @Post('ai/generate-content')
  @ApiOperation({ summary: 'AI 캠페인 콘텐츠 생성' })
  async generateContent(@Body() body: { campaignType: string; channel: string; targetSegment?: string; locale?: string }) {
    return { data: await this.ai.generateContent(body) };
  }

  // ── 예약·접수 대행 ──

  @Post('proxy/appointment')
  @ApiOperation({ summary: '예약 대행 (CRM → 환자 대신)' })
  async proxyCreateAppointment(
    @Body() body: CrmProxyCreateAppointmentDto,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.service.proxyCreateAppointment(body, userId) };
  }

  @Put('proxy/appointment/:id/reschedule')
  @ApiOperation({ summary: '예약 변경 대행' })
  async proxyReschedule(@Param('id', ParseUUIDPipe) id: string, @Body() body: CrmProxyRescheduleDto, @CurrentUser('id') userId: string) {
    return { data: await this.service.proxyRescheduleAppointment(id, body.scheduledAt, userId) };
  }

  @Delete('proxy/appointment/:id')
  @ApiOperation({ summary: '예약 취소 대행 (사유 필수)' })
  async proxyCancelAppointment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: CrmProxyCancelDto,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.service.proxyCancelAppointment(id, body.cancelReason, userId) };
  }

  @Get('proxy/available-slots')
  @ApiOperation({ summary: '가용 시간대 조회' })
  async proxyAvailableSlots(@Query('doctorId') doctorId: string, @Query('date') date: string) {
    return { data: await this.service.proxyGetAvailableSlots(doctorId, date) };
  }

  // ── 포털 메시지 ──

  @Post('portal/message')
  @ApiOperation({ summary: '포털 메시지 발송 (개별)' })
  async sendPortalMessage(
    @Body() body: { patientId: string; subject: string; content: string; type?: string },
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.service.sendPortalMessage(body, userId) };
  }

  @Post('portal/message/bulk')
  @ApiOperation({ summary: '포털 메시지 대량 발송' })
  async sendPortalMessageBulk(
    @Body() body: { patientIds: string[]; subject: string; content: string; type?: string },
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.service.sendPortalMessageBulk(body, userId) };
  }

  // ── 캠페인 예약 발송 ──

  @Post('campaigns/:id/schedule')
  @ApiOperation({ summary: '캠페인 예약 발송' })
  async scheduleCampaign(@Param('id', ParseUUIDPipe) id: string, @Body() body: { scheduledAt: string }) {
    return { data: await this.service.scheduleCampaign(id, new Date(body.scheduledAt)) };
  }
}
