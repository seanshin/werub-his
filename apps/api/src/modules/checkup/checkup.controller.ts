import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Patch,
  Param,
  Body,
  Query,
  Res,
  UseGuards,
  ParseUUIDPipe,
  Request,
} from '@nestjs/common';
import { Response } from 'express';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Permission } from '../auth/rbac/permission.types';
import { CheckupProgramService } from './checkup-program.service';
import { CheckupService } from './checkup.service';
import { CheckupContractService } from './checkup-contract.service';
import { CheckupQuestionnaireService } from './checkup-questionnaire.service';
import { CheckupStationService } from './checkup-station.service';
import { CheckupTestMasterService } from './checkup-test-master.service';
import { PdfGenerationService } from '../medical-record-copy/pdf-generation.service';
import { AuditAiRead } from '../audit/no-audit.decorator';
import {
  CreateCheckupProgramDto,
  UpdateCheckupProgramDto,
} from './dto/checkup-program.dto';
import {
  CreateCheckupVisitDto,
  CreateWalkInVisitDto,
  UpdateCheckupVisitStatusDto,
  CreateCheckupSummaryDto,
} from './dto/checkup-visit.dto';
import {
  AddCheckupPanelResultsDto,
  AddCheckupResultDto,
  CancelCheckupVisitDto,
  CompleteCheckupInterpretationDto,
  CreateCheckupFollowUpDto,
  CreateCheckupReferralDto,
  RescheduleCheckupVisitDto,
  SkipCheckupItemDto,
} from './dto/checkup-result-write.dto';
import {
  CreateCheckupTestMasterDto,
  UpdateCheckupTestMasterDto,
} from './dto/checkup-test-master.dto';
import {
  BulkReserveCheckupDto,
  BulkUploadCheckupDto,
  CheckInCheckupVisitDto,
  CheckupStationCompleteItemDto,
  CheckupWsArriveDto,
  CheckupWsCompleteDto,
  CheckupWsStartDto,
  CreateCheckupContractDto,
  CreateCheckupQuestionnaireDto,
  SaveCheckupQuestionnaireResponseDto,
  SignCheckupSummaryDto,
  UpdateCheckupQuestionnaireDto,
  UpdateCheckupStationDto,
} from './dto/checkup-ops-write.dto';

@ApiTags('건강검진센터')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/checkup')
export class CheckupController {
  constructor(
    private readonly programService: CheckupProgramService,
    private readonly checkupService: CheckupService,
    private readonly contractService: CheckupContractService,
    private readonly questionnaireService: CheckupQuestionnaireService,
    private readonly stationService: CheckupStationService,
    private readonly pdfService: PdfGenerationService,
    private readonly testMasterService: CheckupTestMasterService,
  ) {}

  // ═══════════════════════════════════════════
  // 검사항목 마스터
  // ═══════════════════════════════════════════

  @Get('test-catalog')
  @RequirePermission(Permission.PATIENT_VIEW)
  @ApiOperation({ summary: '검사항목 마스터 목록' })
  @ApiQuery({ name: 'category', required: false })
  @ApiQuery({ name: 'subCategory', required: false })
  @ApiQuery({ name: 'isActive', required: false })
  @ApiQuery({ name: 'search', required: false })
  async listTestCatalog(
    @Query('category') category?: string,
    @Query('subCategory') subCategory?: string,
    @Query('isActive') isActive?: string,
    @Query('search') search?: string,
  ) {
    return {
      data: await this.testMasterService.findAll({
        category,
        subCategory,
        isActive: isActive !== undefined ? isActive === 'true' : undefined,
        search,
      }),
    };
  }

  @Get('test-catalog/usage')
  @RequirePermission(Permission.PATIENT_VIEW)
  @ApiOperation({ summary: '검사항목별 프로그램 사용 수' })
  async getTestUsage() {
    return { data: await this.testMasterService.getUsageCounts() };
  }

  @Get('test-catalog/:id')
  @RequirePermission(Permission.PATIENT_VIEW)
  @ApiOperation({ summary: '검사항목 상세' })
  async getTestItem(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.testMasterService.findOne(id) };
  }

  @Post('test-catalog')
  @RequirePermission(Permission.PATIENT_EDIT)
  @ApiOperation({ summary: '검사항목 생성' })
  async createTestItem(@Body() dto: CreateCheckupTestMasterDto) {
    return { data: await this.testMasterService.create(dto) };
  }

  @Put('test-catalog/:id')
  @RequirePermission(Permission.PATIENT_EDIT)
  @ApiOperation({ summary: '검사항목 수정' })
  async updateTestItem(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCheckupTestMasterDto,
  ) {
    return { data: await this.testMasterService.update(id, dto) };
  }

  @Delete('test-catalog/:id')
  @RequirePermission(Permission.PATIENT_EDIT)
  @ApiOperation({ summary: '검사항목 비활성화' })
  async removeTestItem(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.testMasterService.remove(id) };
  }

  // ═══════════════════════════════════════════
  // 프로그램 관리
  // ═══════════════════════════════════════════

  @Get('programs')
  @RequirePermission(Permission.PATIENT_VIEW)
  @ApiOperation({ summary: '검진 프로그램 목록' })
  @ApiQuery({ name: 'category', required: false })
  @ApiQuery({ name: 'gender', required: false })
  @ApiQuery({ name: 'isActive', required: false })
  @ApiQuery({ name: 'search', required: false })
  async listPrograms(
    @Query('category') category?: string,
    @Query('gender') gender?: string,
    @Query('isActive') isActive?: string,
    @Query('search') search?: string,
  ) {
    return {
      data: await this.programService.findAll({
        category,
        gender,
        isActive: isActive !== undefined ? isActive === 'true' : undefined,
        search,
      }),
    };
  }

  @Get('programs/:id')
  @RequirePermission(Permission.PATIENT_VIEW)
  @ApiOperation({ summary: '검진 프로그램 상세' })
  async getProgram(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.programService.findOne(id) };
  }

  @Post('programs')
  @RequirePermission(Permission.SYSTEM_MANAGE)
  @ApiOperation({ summary: '검진 프로그램 생성' })
  async createProgram(@Body() dto: CreateCheckupProgramDto) {
    return { data: await this.programService.create(dto) };
  }

  @Put('programs/:id')
  @RequirePermission(Permission.SYSTEM_MANAGE)
  @ApiOperation({ summary: '검진 프로그램 수정' })
  async updateProgram(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCheckupProgramDto,
  ) {
    return { data: await this.programService.update(id, dto) };
  }

  @Delete('programs/:id')
  @RequirePermission(Permission.SYSTEM_MANAGE)
  @ApiOperation({ summary: '검진 프로그램 비활성화' })
  async removeProgram(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.programService.remove(id) };
  }

  // ═══════════════════════════════════════════
  // 검진 예약·접수
  // ═══════════════════════════════════════════

  @Get('capacity')
  @RequirePermission(Permission.PATIENT_VIEW)
  @ApiOperation({ summary: '날짜별 예약 용량 조회' })
  @ApiQuery({ name: 'from', required: true })
  @ApiQuery({ name: 'to', required: true })
  async getCapacity(
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return { data: await this.checkupService.getCapacity({ from, to }) };
  }

  @Post('visits')
  @RequirePermission(Permission.PATIENT_EDIT, Permission.CHECKUP_MANAGE)
  @ApiOperation({ summary: '검진 예약 생성' })
  async createVisit(@Body() dto: CreateCheckupVisitDto) {
    return { data: await this.checkupService.createVisit(dto) };
  }

  @Post('visits/walk-in')
  @RequirePermission(Permission.PATIENT_EDIT, Permission.CHECKUP_MANAGE)
  @ApiOperation({ summary: '당일 접수 (Walk-in) — 예약 없이 즉시 접수' })
  async createWalkInVisit(@Body() dto: CreateWalkInVisitDto) {
    return { data: await this.checkupService.createWalkInVisit(dto) };
  }

  @Get('visits')
  @RequirePermission(Permission.PATIENT_VIEW)
  @ApiOperation({ summary: '검진 예약 목록' })
  @ApiQuery({ name: 'date', required: false })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'patientId', required: false })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  async listVisits(
    @Query('date') date?: string,
    @Query('status') status?: string,
    @Query('patientId') patientId?: string,
    @Query('contractId') contractId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.checkupService.findVisits({
      date,
      status,
      patientId,
      contractId,
      page: page ? parseInt(page) : undefined,
      limit: limit ? parseInt(limit) : undefined,
    });
  }

  @Get('visits/today-stats')
  @RequirePermission(Permission.PATIENT_VIEW)
  @ApiOperation({ summary: '오늘 검진 현황 통계' })
  async getTodayStats() {
    return { data: await this.checkupService.getTodayStats() };
  }

  @Get('visits/:id')
  @RequirePermission(Permission.PATIENT_VIEW)
  @ApiOperation({ summary: '검진 예약 상세' })
  async getVisit(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.checkupService.findVisit(id) };
  }

  @Patch('visits/:id/check-in')
  @RequirePermission(Permission.PATIENT_EDIT, Permission.CHECKUP_MANAGE)
  @ApiOperation({ summary: '당일 접수' })
  async checkIn(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: CheckInCheckupVisitDto,
  ) {
    // 금액은 서버가 재계산한다 — 클라이언트는 **어떤 옵션을 골랐는지**만 보낸다
    return { data: await this.checkupService.checkIn(id, body?.selectedOptions) };
  }

  @Patch('visits/:id/status')
  @RequirePermission(Permission.PATIENT_EDIT, Permission.CHECKUP_MANAGE)
  @ApiOperation({ summary: '상태 변경' })
  async updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCheckupVisitStatusDto,
  ) {
    return { data: await this.checkupService.updateStatus(id, dto) };
  }

  @Get('visits/:id/route-sheet')
  @RequirePermission(Permission.PATIENT_VIEW)
  @ApiOperation({ summary: '검사 순서표' })
  async getRouteSheet(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.checkupService.getRouteSheet(id) };
  }

  @Patch('visits/:id/cancel')
  @RequirePermission(Permission.PATIENT_EDIT, Permission.CHECKUP_MANAGE)
  @ApiOperation({ summary: '예약 취소' })
  async cancelVisit(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: CancelCheckupVisitDto,
  ) {
    return { data: await this.checkupService.cancelVisit(id, body.reason) };
  }

  @Patch('visits/:id/reschedule')
  @RequirePermission(Permission.PATIENT_EDIT, Permission.CHECKUP_MANAGE)
  @ApiOperation({ summary: '예약 변경 (날짜/프로그램)' })
  async rescheduleVisit(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: RescheduleCheckupVisitDto,
  ) {
    return { data: await this.checkupService.rescheduleVisit(id, body) };
  }

  @Patch('visits/:id/skip-item')
  @RequirePermission(Permission.ENCOUNTER_EDIT)
  @ApiOperation({ summary: '검사 항목 스킵 (수검자 거부/금기)' })
  async skipResultItem(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: SkipCheckupItemDto,
  ) {
    return { data: await this.checkupService.skipResultItem(id, body.testName, body.reason) };
  }

  @Post('process-no-shows')
  @RequirePermission(Permission.SYSTEM_MANAGE)
  @ApiOperation({ summary: '미방문(No-show) 일괄 처리' })
  async processNoShows() {
    return { data: await this.checkupService.processNoShows() };
  }

  // ═══════════════════════════════════════════
  // 결과·소견
  // ═══════════════════════════════════════════

  @Get('visits/:id/results')
  @RequirePermission(Permission.PATIENT_VIEW)
  @ApiOperation({ summary: '개별 결과 목록' })
  async getResults(@Param('id', ParseUUIDPipe) id: string) {
    const visit = await this.checkupService.findVisit(id);
    return { data: visit.items };
  }

  @Post('visits/:id/results')
  @RequirePermission(Permission.ENCOUNTER_EDIT)
  @ApiOperation({ summary: '결과 수동 입력' })
  async addResult(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: AddCheckupResultDto,
  ) {
    return { data: await this.checkupService.addResult(id, body) };
  }

  @Get('panel-analytes')
  @RequirePermission(Permission.PATIENT_VIEW)
  @ApiOperation({ summary: '패널→분석물 분해 맵(혈압·지질·간기능·신장)' })
  async getPanelAnalytes() {
    return { data: this.checkupService.getPanelAnalytes() };
  }

  @Post('visits/:id/results/panel')
  @RequirePermission(Permission.ENCOUNTER_EDIT)
  @ApiOperation({ summary: '분석물 분해 입력 — 항목 검사코드별 testCode·프로토콜 자동판정·부모 롤업' })
  async addPanelResults(
    @Param('id', ParseUUIDPipe) id: string,
    // panelCode 는 구 경로(패널 지정). 정본은 parentTestName 으로 그 항목의 검사코드를 서버가 편다.
    @Body() body: AddCheckupPanelResultsDto,
  ) {
    return { data: await this.checkupService.addPanelResults(id, { ...body, values: body.values ?? {} }) };
  }

  @Get('visits/:id/summary')
  @RequirePermission(Permission.PATIENT_VIEW)
  @ApiOperation({ summary: '종합소견 조회' })
  async getSummary(@Param('id', ParseUUIDPipe) id: string) {
    const visit = await this.checkupService.findVisit(id);
    return { data: visit.summary };
  }

  @Post('visits/:id/summary')
  @RequirePermission(Permission.ENCOUNTER_CREATE)
  @ApiOperation({ summary: '종합소견 작성' })
  async createSummary(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateCheckupSummaryDto,
    @Request() req: { user: { id?: string; sub?: string } },
  ) {
    return {
      data: await this.checkupService.createSummary(id, dto, req.user.id ?? req.user.sub!),
    };
  }

  @Get('visits/:id/result-readiness')
  @RequirePermission(Permission.PATIENT_VIEW)
  @ApiOperation({ summary: '결과서 서명 전 검토 완료 점검(미완료 판독·소견 누락 차단 사유)' })
  async getResultReadiness(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.checkupService.getResultReadiness(id) };
  }

  @Patch('visits/:id/sign')
  @RequirePermission(Permission.ENCOUNTER_CREATE)
  @ApiOperation({ summary: '의사 서명 — 검토 완료 게이트(force=true 시 ADMIN 강제 우회)' })
  async signSummary(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: SignCheckupSummaryDto,
    @Request() req: { user: { id?: string; sub?: string } },
  ) {
    return { data: await this.checkupService.signSummary(id, req.user.id ?? req.user.sub!, body?.force === true) };
  }

  // ═══════════════════════════════════════════
  // 결과 자동수집·추적·의뢰·통계
  // ═══════════════════════════════════════════

  @Patch('visits/:id/auto-collect')
  @RequirePermission(Permission.ENCOUNTER_EDIT)
  @ApiOperation({ summary: '결과 자동 수집' })
  async autoCollect(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.checkupService.autoCollectResults(id) };
  }

  @Get('visits/:id/grade-summary')
  @RequirePermission(Permission.PATIENT_VIEW)
  @ApiOperation({ summary: '영역별 자동 판정 집계' })
  async getGradeSummary(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.checkupService.generateGradeSummary(id) };
  }

  @Get('interpretations')
  @RequirePermission(Permission.PATIENT_VIEW)
  @ApiOperation({ summary: '판독 대기열' })
  @ApiQuery({ name: 'department', required: false })
  @ApiQuery({ name: 'status', required: false })
  async getInterpretations(
    @Query('department') department?: string,
    @Query('status') status?: string,
  ) {
    const where: Record<string, unknown> = {};
    if (department) where.department = department;
    if (status) where.status = status;
    else where.status = 'REQUESTED';

    const data = await this.checkupService.findInterpretations(where);
    return { data };
  }

  @Post('interpretations/:id/complete')
  @RequirePermission(Permission.ENCOUNTER_CREATE)
  @ApiOperation({ summary: '판독 소견 입력' })
  async completeInterpretation(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: CompleteCheckupInterpretationDto,
    @Request() req: { user: { id?: string; sub?: string } },
  ) {
    return {
      data: await this.checkupService.completeInterpretation(id, body, (req.user.id ?? req.user.sub)!),
    };
  }

  @Post('visits/:id/follow-ups')
  @RequirePermission(Permission.PATIENT_EDIT, Permission.CHECKUP_MANAGE)
  @ApiOperation({ summary: '추적 관리 생성' })
  async createFollowUp(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: CreateCheckupFollowUpDto,
  ) {
    return { data: await this.checkupService.createFollowUp(id, body) };
  }

  @Post('visits/:id/referrals')
  @RequirePermission(Permission.ENCOUNTER_CREATE)
  @ApiOperation({ summary: '외래 의뢰 생성' })
  async createReferral(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: CreateCheckupReferralDto,
  ) {
    return { data: await this.checkupService.createReferral(id, body) };
  }

  @Get('patient/:patientId/history')
  @RequirePermission(Permission.PATIENT_VIEW)
  @ApiOperation({ summary: '환자별 검진 이력 (차트 연동)' })
  async getPatientHistory(@Param('patientId', ParseUUIDPipe) patientId: string) {
    return { data: await this.checkupService.getPatientCheckupHistory(patientId) };
  }

  @Get('patient/:patientId/comparison')
  @RequirePermission(Permission.PATIENT_VIEW)
  @ApiOperation({ summary: '검진 결과 비교 (최근 N회 추이)' })
  @ApiQuery({ name: 'limit', required: false })
  async getPatientComparison(
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @Query('limit') limit?: string,
  ) {
    return { data: await this.checkupService.getCheckupComparison(patientId, limit ? parseInt(limit) : 5) };
  }

  @Get('stats')
  @RequirePermission(Permission.DASHBOARD_VIEW)
  @ApiOperation({ summary: '프로그램별 통계' })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  async getStats(
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return { data: await this.checkupService.getStats({ from, to }) };
  }

  @Get('stats/abnormal')
  @RequirePermission(Permission.DASHBOARD_VIEW)
  @ApiOperation({ summary: '이상소견 통계' })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  async getAbnormalStats(
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return { data: await this.checkupService.getAbnormalStats({ from, to }) };
  }

  // ═══════════════════════════════════════════
  // 통계 고도화 (Phase 8)
  // ═══════════════════════════════════════════

  @Get('stats/revenue')
  @RequirePermission(Permission.DASHBOARD_VIEW)
  @ApiOperation({ summary: '매출 통계' })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  async getRevenueStats(@Query('from') from?: string, @Query('to') to?: string) {
    return { data: await this.checkupService.getRevenueStats({ from, to }) };
  }

  @Get('stats/demographics')
  @RequirePermission(Permission.DASHBOARD_VIEW)
  @ApiOperation({ summary: '연령·성별 분포' })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  async getDemographicStats(@Query('from') from?: string, @Query('to') to?: string) {
    return { data: await this.checkupService.getDemographicStats({ from, to }) };
  }

  @Get('stats/monthly-report')
  @RequirePermission(Permission.DASHBOARD_VIEW)
  @ApiOperation({ summary: '월간 운영 보고서' })
  @ApiQuery({ name: 'month', required: true, description: '2026-05' })
  async getMonthlyReport(@Query('month') month: string) {
    return { data: await this.checkupService.getMonthlyReport(month) };
  }

  @Get('stats/finding-rate')
  @RequirePermission(Permission.DASHBOARD_VIEW)
  @ApiOperation({ summary: '유소견율 분석' })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  async getFindingRateStats(@Query('from') from?: string, @Query('to') to?: string) {
    return { data: await this.checkupService.getFindingRateStats({ from, to }) };
  }

  // ═══════════════════════════════════════════
  // 대기 디스플레이 (Phase 7)
  // ═══════════════════════════════════════════

  @Get('display')
  @RequirePermission(Permission.PATIENT_VIEW)
  @ApiOperation({ summary: '대기 안내 디스플레이 데이터' })
  async getDisplayData() {
    return { data: await this.checkupService.getDisplayData() };
  }

  // ═══════════════════════════════════════════
  // 단체 검진
  // ═══════════════════════════════════════════

  @Get('contracts')
  @RequirePermission(Permission.SYSTEM_MANAGE, Permission.CHECKUP_MANAGE)
  @ApiOperation({ summary: '단체 계약 목록' })
  @ApiQuery({ name: 'status', required: false })
  async listContracts(@Query('status') status?: string) {
    return { data: await this.contractService.findAll({ status }) };
  }

  @Post('contracts')
  @RequirePermission(Permission.SYSTEM_MANAGE, Permission.CHECKUP_MANAGE)
  @ApiOperation({ summary: '단체 계약 등록' })
  async createContract(
    @Body() body: CreateCheckupContractDto,
  ) {
    return { data: await this.contractService.create(body) };
  }

  @Get('contracts/:id')
  @RequirePermission(Permission.SYSTEM_MANAGE, Permission.CHECKUP_MANAGE)
  @ApiOperation({ summary: '단체 계약 상세 + 수검자 현황' })
  async getContract(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.contractService.findOne(id) };
  }

  @Get('contracts/:id/stats')
  @RequirePermission(Permission.SYSTEM_MANAGE, Permission.CHECKUP_MANAGE)
  @ApiOperation({ summary: '단체 계약 진행 현황' })
  async getContractStats(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.contractService.getContractStats(id) };
  }

  @Post('contracts/:id/bulk-reserve')
  @RequirePermission(Permission.SYSTEM_MANAGE, Permission.CHECKUP_MANAGE)
  @ApiOperation({ summary: '단체 일괄 예약' })
  async bulkReserve(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: BulkReserveCheckupDto,
  ) {
    return { data: await this.contractService.bulkReserve(id, body.reservations) };
  }

  @Post('contracts/:id/bulk-upload')
  @RequirePermission(Permission.SYSTEM_MANAGE, Permission.CHECKUP_MANAGE)
  @ApiOperation({ summary: '단체 수검자 엑셀 일괄 등록' })
  async bulkUpload(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: BulkUploadCheckupDto,
  ) {
    return { data: await this.contractService.bulkUpload(id, body.rows) };
  }

  // ═══════════════════════════════════════════
  // 추적 관리 (Phase 11)
  // ═══════════════════════════════════════════

  @Get('follow-ups')
  @RequirePermission(Permission.PATIENT_VIEW)
  @ApiOperation({ summary: '추적 대상 목록' })
  @ApiQuery({ name: 'dueFrom', required: false })
  @ApiQuery({ name: 'dueTo', required: false })
  @ApiQuery({ name: 'completed', required: false })
  async listFollowUps(
    @Query('dueFrom') dueFrom?: string,
    @Query('dueTo') dueTo?: string,
    @Query('completed') completed?: string,
  ) {
    return {
      data: await this.checkupService.findFollowUps({ dueFrom, dueTo, completed }),
    };
  }

  @Patch('follow-ups/:id/complete')
  // 🔴 사후관리 연락은 CRM 이 한다 — 목록은 읽히는데 완료만 막혀 워크리스트가 줄지 않았다
  //    (운영 실측: CRM_MANAGER 로 대상 11건 조회 200 · 완료 403). 좁은 권한 하나만 더한다.
  @RequirePermission(Permission.PATIENT_EDIT, Permission.CHECKUP_MANAGE, Permission.CHECKUP_FOLLOWUP_COMPLETE)
  @ApiOperation({ summary: '추적 완료 처리' })
  async completeFollowUp(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.checkupService.completeFollowUp(id) };
  }

  // ═══════════════════════════════════════════
  // 검사실 워크스테이션 (Legacy — ws/* API로 대체, 하위 호환 유지)
  // ═══════════════════════════════════════════

  @Get('station/:stationId/queue')
  @RequirePermission(Permission.PATIENT_VIEW)
  @ApiOperation({ summary: '검사실별 대기 환자 목록', deprecated: true, description: 'ws/stations/:stationId/queue 사용 권장' })
  async getStationQueue(@Param('stationId') stationId: string) {
    return { data: await this.checkupService.getStationQueue(stationId) };
  }

  @Post('station/:stationId/complete')
  @RequirePermission(Permission.ENCOUNTER_EDIT)
  @ApiOperation({ summary: '검사실 결과 입력 (항목 완료)', deprecated: true, description: 'ws/:visitId/complete 사용 권장' })
  async stationComplete(
    @Param('stationId') stationId: string,
    @Body() body: CheckupStationCompleteItemDto,
  ) {
    return {
      data: await this.checkupService.stationCompleteItem(body.visitId, body),
    };
  }

  @Get('stations')
  @RequirePermission(Permission.PATIENT_VIEW)
  @ApiOperation({ summary: '사용 가능한 스테이션 목록', deprecated: true, description: 'ws/stations 사용 권장' })
  async getStations() {
    const stations = Object.entries(CheckupService.STATION_MAP).map(([id, def]) => ({
      id,
      label: STATION_LABELS[id] ?? id,
      categories: def.categories,
    }));
    return { data: stations };
  }

  @Get('visits/:id/result-pdf')
  @RequirePermission(Permission.PATIENT_VIEW)
  @ApiOperation({ summary: '검진 결과서 (HTML 또는 PDF)' })
  @ApiQuery({ name: 'format', required: false, description: 'html | pdf (기본: html)' })
  async getResultPdf(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('format') format: string,
    @Res() res: Response,
  ) {
    const html = await this.pdfService.generateCheckupResultPdf(id);
    if (format === 'pdf') {
      const pdfBuffer = await this.pdfService.htmlToPdfBuffer(html);
      res.set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="checkup-result-${id.slice(0, 8)}.pdf"`,
      });
      res.send(pdfBuffer);
    } else {
      res.set({ 'Content-Type': 'text/html; charset=utf-8' });
      res.send(html);
    }
  }

  @AuditAiRead('AiCheckupInterpret')

  @Get('visits/:id/ai-interpret')
  @RequirePermission(Permission.PATIENT_VIEW)
  @ApiOperation({ summary: 'AI 검진 결과 종합 해석' })
  async interpretCheckupAI(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.checkupService.interpretCheckupAI(id) };
  }

  @AuditAiRead('AiCheckupFollowup')

  @Get('visits/:id/ai-followup')
  @RequirePermission(Permission.PATIENT_VIEW)
  @ApiOperation({ summary: 'AI 추적 검진 권고' })
  async suggestFollowupCheckup(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.checkupService.suggestFollowupCheckup(id) };
  }

  // ═══════════════════════════════════════════
  // 문진표 관리 (Phase 2)
  // ═══════════════════════════════════════════

  @Get('questionnaires')
  @RequirePermission(Permission.PATIENT_VIEW)
  @ApiOperation({ summary: '문진 템플릿 목록' })
  @ApiQuery({ name: 'programId', required: false })
  async listQuestionnaires(@Query('programId') programId?: string) {
    return { data: await this.questionnaireService.findAllTemplates({ programId }) };
  }

  @Get('questionnaires/:id')
  @RequirePermission(Permission.PATIENT_VIEW)
  @ApiOperation({ summary: '문진 템플릿 상세' })
  async getQuestionnaire(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.questionnaireService.findTemplate(id) };
  }

  @Post('questionnaires')
  @RequirePermission(Permission.SYSTEM_MANAGE)
  @ApiOperation({ summary: '문진 템플릿 생성' })
  async createQuestionnaire(@Body() body: CreateCheckupQuestionnaireDto) {
    return { data: await this.questionnaireService.createTemplate({ ...body, programId: body.programId || undefined }) };
  }

  @Put('questionnaires/:id')
  @RequirePermission(Permission.SYSTEM_MANAGE)
  @ApiOperation({ summary: '문진 템플릿 수정' })
  async updateQuestionnaire(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateCheckupQuestionnaireDto,
  ) {
    return { data: await this.questionnaireService.updateTemplate(id, body) };
  }

  @Delete('questionnaires/:id')
  @RequirePermission(Permission.SYSTEM_MANAGE)
  @ApiOperation({ summary: '문진 템플릿 비활성화' })
  async removeQuestionnaire(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.questionnaireService.removeTemplate(id) };
  }

  @Get('visits/:id/questionnaire')
  @RequirePermission(Permission.PATIENT_VIEW)
  @ApiOperation({ summary: '방문별 문진 응답 + 템플릿 조회' })
  async getVisitQuestionnaire(@Param('id', ParseUUIDPipe) id: string) {
    const [response, template] = await Promise.all([
      this.questionnaireService.getResponseByVisit(id),
      this.questionnaireService.getTemplateForVisit(id),
    ]);
    return { data: { template, response } };
  }

  @Post('visits/:id/questionnaire')
  @RequirePermission(Permission.PATIENT_EDIT, Permission.CHECKUP_MANAGE)
  @ApiOperation({ summary: '문진 응답 저장' })
  async saveVisitQuestionnaire(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: SaveCheckupQuestionnaireResponseDto,
  ) {
    return { data: await this.questionnaireService.saveResponse(id, body) };
  }
  // ═══════════════════════════════════════════
  // 워크스테이션 (Phase 6)
  // ═══════════════════════════════════════════

  @Get('ws/stations')
  @RequirePermission(Permission.PATIENT_VIEW)
  @ApiOperation({ summary: '검진 스테이션 목록 (DB 기반)' })
  @ApiQuery({ name: 'category', required: false })
  async getWsStations(@Query('category') category?: string) {
    return { data: await this.stationService.getStations(category) };
  }

  @Get('ws/stations/:stationId')
  @RequirePermission(Permission.PATIENT_VIEW)
  @ApiOperation({ summary: '스테이션 상세 (입력 템플릿 포함)' })
  async getWsStation(@Param('stationId') stationId: string) {
    return { data: await this.stationService.getStation(stationId) };
  }

  @Put('ws/stations/:stationId')
  @RequirePermission(Permission.SYSTEM_MANAGE)
  @ApiOperation({ summary: '스테이션 설정 수정' })
  async updateWsStation(
    @Param('stationId') stationId: string,
    @Body() body: UpdateCheckupStationDto,
  ) {
    return { data: await this.stationService.updateStation(stationId, body) };
  }

  @Post('ws/:visitId/arrive')
  @RequirePermission(Permission.ENCOUNTER_EDIT)
  @ApiOperation({ summary: '스테이션 도착 기록' })
  async wsArrive(
    @Param('visitId', ParseUUIDPipe) visitId: string,
    @Body() body: CheckupWsArriveDto,
  ) {
    return { data: await this.stationService.arrive(visitId, body.stationId) };
  }

  @Patch('ws/:visitId/start')
  @RequirePermission(Permission.ENCOUNTER_EDIT)
  @ApiOperation({ summary: '검사 시작' })
  async wsStart(
    @Param('visitId', ParseUUIDPipe) visitId: string,
    @Body() body: CheckupWsStartDto,
    @Request() req: { user: { id?: string; sub?: string } },
  ) {
    // 사람 결정 대기: `policy.clinical.actorAttribution` — 본문 operatorId(시행자 대리 지정)를 받을지 · 지정 대상 역할 미확인
    return { data: await this.stationService.start(visitId, body.stationId, body.operatorId ?? req.user.id ?? req.user.sub) };
  }

  @Patch('ws/:visitId/complete')
  @RequirePermission(Permission.ENCOUNTER_EDIT)
  @ApiOperation({ summary: '검사 완료 + 결과 저장' })
  async wsComplete(
    @Param('visitId', ParseUUIDPipe) visitId: string,
    @Body() body: CheckupWsCompleteDto,
    @Request() req: { user: { id?: string; sub?: string } },
  ) {
    return {
      data: await this.stationService.complete(visitId, body.stationId, {
        resultData: body.resultData,
        finding: body.finding,
        note: body.note,
        testNames: body.testNames,
        operatorId: (req.user.id ?? req.user.sub)!,
      }),
    };
  }

  @Get('ws/flow-board')
  @RequirePermission(Permission.PATIENT_VIEW)
  @ApiOperation({ summary: '전체 동선 현황 (수검자 × 스테이션 매트릭스)' })
  async getFlowBoard() {
    return { data: await this.stationService.getFlowBoard() };
  }

  @Get('ws/:visitId/next-station')
  @RequirePermission(Permission.PATIENT_VIEW)
  @ApiOperation({ summary: '다음 추천 스테이션 (대기시간 기반)' })
  async getNextStation(@Param('visitId', ParseUUIDPipe) visitId: string) {
    return { data: await this.stationService.getNextStation(visitId) };
  }

  @Get('ws/stations/:stationId/queue')
  @RequirePermission(Permission.PATIENT_VIEW)
  @ApiOperation({ summary: '스테이션별 대기 큐' })
  async getWsStationQueue(@Param('stationId') stationId: string) {
    return { data: await this.stationService.getStationQueue(stationId) };
  }

  @Get('ws/stations/:stationId/stats')
  @RequirePermission(Permission.DASHBOARD_VIEW)
  @ApiOperation({ summary: '스테이션 처리량 통계' })
  @ApiQuery({ name: 'date', required: false })
  async getWsStationStats(
    @Param('stationId') stationId: string,
    @Query('date') date?: string,
  ) {
    return { data: await this.stationService.getStationStats(stationId, date) };
  }
}

const STATION_LABELS: Record<string, string> = {
  blood: '채혈실', urine: '검체실 (소변/대변)', xray: 'X-ray실',
  ultrasound: '초음파실', ecg: '심전도실', endoscopy: '내시경실',
  physical: '신체계측실', eye: '안과검사실', pulmonary: '폐기능검사실',
};
