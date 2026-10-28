import { BadRequestException, Controller, Get, Post, Put, Patch, Param, Body, Query, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { LabService } from './lab.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Permission } from '../auth/rbac/permission.types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuditAiRead } from '../audit/no-audit.decorator';
import {
  SubmitLabResultDto,
  AmendLabResultDto,
  CollectLabSampleDto,
  UpdateInstrumentDto,
  CancelTestingDto,
  CreateInstrumentDto,
  ReceiveInterfaceResultDto,
  MatchInterfaceResultDto,
  RejectInterfaceResultDto,
  AddLabAttachmentDto,
  CreateWorksheetDto,
  AddWorksheetItemDto,
  GenerateBarcodeDto,
  ScanBarcodeDto,
  CreateReferenceLabDto,
  CreateCatalogItemDto,
  CreateSendOutDto,
  UpdateSendOutStatusDto,
  AcknowledgeCriticalValueDto,
  RecordCriticalValueActionDto,
  SignLabWorksheetDto,
} from './dto/lab-result.dto';
import { CriticalValueEscalationService } from './critical-value-escalation.service';

@ApiTags('Lab')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.LAB_TECH, UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
@Controller('api/v1/lab')
export class LabController {
  constructor(
    private readonly labService: LabService,
    private readonly escalation: CriticalValueEscalationService,
  ) {}

  @Get('queue')
  @RequirePermission(Permission.ORDER_VIEW)
  @ApiOperation({ summary: '검사 대기열' })
  @ApiResponse({ status: 200, description: '검사 대기열 조회 성공' })
  async getQueue() {
    return { data: await this.labService.getQueue() };
  }

  @Get('critical-values/pending')
  @ApiOperation({ summary: '내 미확인 위급검사값 + 담당의 미지정 경보 + 허용시간 초과로 상향된 경보 전건 (IPSG.2 read-back)' })
  async getPendingCriticalAlerts(
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: string,
  ) {
    const [data, total] = await Promise.all([
      this.labService.getPendingCriticalAlerts(userId, role),
      this.labService.countPendingCriticalAlerts(userId, role),
    ]);
    // 자르면 자른다고 말한다 — 화면이 "N건 중 M건"으로 쓴다
    return { data, meta: { total, limit: LabService.PENDING_CRITICAL_LIMIT } };
  }

  @Patch('critical-values/:id/acknowledge')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  // 🔴 역할만으로는 부족하다 — 종전엔 여기까지가 전부라 **아무 의사나 남의 환자 위급값을 종결**했다.
  //    객체 수준 판정(담당의 본인 / 담당의 미지정 / 대리+사유 필수)은 LabService.acknowledgeCriticalAlert 가 한다.
  //    막기만 하면 담당의 부재 시 위급값이 방치되므로 **열되 기록에 남긴다**(사유·acknowledgedBy).
  @ApiOperation({ summary: '위급검사값 확인 (복창 대조 + 조치 기록)' })
  async acknowledgeCriticalAlert(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: AcknowledgeCriticalValueDto,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.labService.acknowledgeCriticalAlert(id, userId, body) };
  }

  @Get('critical-values/escalation-policy')
  @ApiOperation({ summary: '위급값 허용시간(상향 보고 기준) — 미설정이면 afterMinutes=null(상향 보고 안 함)' })
  async getCriticalEscalationPolicy() {
    return { data: await this.escalation.policy() };
  }

  @Get('critical-values/follow-ups')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '확인 이후 조치 기록·종결이 남은 위급값(ACKNOWLEDGED·ACTED)' })
  async getCriticalAlertFollowUps() {
    return { data: await this.labService.getCriticalAlertFollowUps() };
  }

  @Patch('critical-values/:id/act')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '위급값 조치 기록 (ACKNOWLEDGED → ACTED)' })
  async recordCriticalAlertAction(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: RecordCriticalValueActionDto,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.labService.recordCriticalAlertAction(id, userId, body) };
  }

  @Patch('critical-values/:id/close')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '위급값 종결 (ACTED → CLOSED)' })
  async closeCriticalAlert(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.labService.closeCriticalAlert(id, userId) };
  }

  @Post('collect/:orderId')
  @RequirePermission(Permission.ORDER_EDIT)
  @ApiOperation({ summary: '검체 접수' })
  @ApiResponse({ status: 201, description: '검체 접수 성공' })
  async collect(
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() dto: CollectLabSampleDto,
    @CurrentUser('id') userId: string
  ) {
    return { data: await this.labService.collect(orderId, userId, dto.notes) };
  }

  @Post('result/:orderId')
  @RequirePermission(Permission.ORDER_EDIT)
  @ApiOperation({ summary: '검사 결과 입력' })
  @ApiResponse({ status: 201, description: '검사 결과 입력 성공' })
  async submitResult(
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() dto: SubmitLabResultDto,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.labService.submitResult(orderId, dto.items, dto.notes, userId) };
  }

  @Get('result/:orderId')
  @RequirePermission(Permission.ORDER_VIEW)
  @ApiOperation({ summary: '검사 결과 조회' })
  @ApiResponse({ status: 200, description: '검사 결과 조회 성공' })
  async getResult(@Param('orderId', ParseUUIDPipe) orderId: string) {
    return { data: await this.labService.getResult(orderId) };
  }

  @Get('results/pending-verification')
  @Roles(UserRole.LAB_TECH, UserRole.DOCTOR, UserRole.ADMIN)
  @RequirePermission(Permission.ORDER_VIEW)
  @ApiOperation({ summary: '검증 대기 목록 — 결과 입력 완료(COMPLETED)·독립 검증 전(오래된 순)' })
  async getPendingVerification() {
    return { data: await this.labService.getPendingVerification() };
  }

  @Patch('result/:orderId/verify')
  @Roles(UserRole.LAB_TECH, UserRole.DOCTOR, UserRole.ADMIN)
  @RequirePermission(Permission.ORDER_EDIT)
  @ApiOperation({ summary: '검사 결과 독립 검증·확정(입력자와 다른 검사자)' })
  async verifyResult(
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.labService.verifyResult(orderId, userId) };
  }

  @Patch('result/:orderId/amend')
  @Roles(UserRole.LAB_TECH, UserRole.DOCTOR, UserRole.ADMIN)
  @RequirePermission(Permission.ORDER_EDIT)
  @ApiOperation({ summary: '검사 결과 정정(이전값 보존·재검증 요구·위급값 재통보)' })
  async amendResult(
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() dto: AmendLabResultDto,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.labService.amendResult(orderId, dto.items, dto.reason, userId) };
  }

  @Get('patients/:patientId/results')
  @RequirePermission(Permission.PATIENT_VIEW)
  @ApiOperation({ summary: '환자별 검사 이력' })
  @ApiResponse({ status: 200, description: '환자별 검사 이력 조회 성공' })
  async getPatientResults(@Param('patientId', ParseUUIDPipe) patientId: string, @Query('days') days?: string) {
    // 🔴 종전엔 `days` 를 받지 않아 화면의 "최근 3일 위급값"·"7일 이상수치"가 **전 기간 200건**을 그렸다(2026-10-02)
    let windowDays: number | undefined;
    if (days !== undefined && days !== '') {
      const n = Number(days);
      if (!Number.isInteger(n) || n < 1 || n > 3650) throw new BadRequestException('days 는 1~3650 사이 정수여야 합니다');
      windowDays = n;
    }
    return { data: await this.labService.getPatientResults(patientId, windowDays) };
  }

  @Patch('result/:labResultId/start')
  @RequirePermission(Permission.ORDER_EDIT)
  @ApiOperation({ summary: '검사 시작' })
  @ApiResponse({ status: 200, description: '검사 시작 성공' })
  async startTesting(@Param('labResultId', ParseUUIDPipe) labResultId: string) {
    return { data: await this.labService.startTesting(labResultId) };
  }

  @Patch('result/:labResultId/cancel')
  @RequirePermission(Permission.ORDER_EDIT)
  @ApiOperation({ summary: '검사 취소' })
  @ApiResponse({ status: 200, description: '검사 취소 성공' })
  async cancelTesting(
    @Param('labResultId', ParseUUIDPipe) labResultId: string,
    @Body() dto: CancelTestingDto
  ) {
    return { data: await this.labService.cancelTesting(labResultId, dto.reason || '') };
  }

  // ── 장비 관리 ──

  @Get('instruments')
  @Roles(UserRole.ADMIN, UserRole.LAB_TECH)
  @ApiOperation({ summary: '검사 장비 목록' })
  async getInstruments() {
    return { data: await this.labService.getInstruments() };
  }

  @Post('instruments')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '검사 장비 등록' })
  async createInstrument(@Body() dto: CreateInstrumentDto) {
    return { data: await this.labService.createInstrument(dto) };
  }

  @Put('instruments/:id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '검사 장비 수정' })
  async updateInstrument(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateInstrumentDto) {
    return { data: await this.labService.updateInstrument(id, dto) };
  }

  @Get('instruments/:id')
  @Roles(UserRole.ADMIN, UserRole.LAB_TECH)
  @ApiOperation({ summary: '검사 장비 상세 (최근 수신 이력 포함)' })
  async getInstrumentDetail(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.labService.getInstrumentDetail(id) };
  }

  // ── 파일 수신 (Interface) ──

  @Post('interface/receive')
  @Roles(UserRole.ADMIN, UserRole.LAB_TECH)
  @ApiOperation({ summary: '장비 결과 수신 (파일 파싱 후)' })
  async receiveResult(@Body() dto: ReceiveInterfaceResultDto) {
    return { data: await this.labService.receiveFile(dto) };
  }

  @Get('interface/pending')
  @Roles(UserRole.ADMIN, UserRole.LAB_TECH)
  @ApiOperation({ summary: '미매칭/미적용 결과 목록' })
  async getPendingResults(@Query('instrumentId') instrumentId?: string) {
    return { data: await this.labService.getPendingInterfaceResults(instrumentId) };
  }

  @Patch('interface/:id/match')
  @Roles(UserRole.LAB_TECH, UserRole.ADMIN)
  @ApiOperation({ summary: '수동 매칭 (결과 → 오더)' })
  async matchResult(@Param('id', ParseUUIDPipe) id: string, @Body() dto: MatchInterfaceResultDto) {
    return { data: await this.labService.matchInterfaceResult(id, dto.orderId) };
  }

  @Patch('interface/:id/apply')
  @Roles(UserRole.LAB_TECH, UserRole.ADMIN)
  @ApiOperation({ summary: '매칭 결과 적용 (LabResult 자동 생성)' })
  async applyResult(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('id') userId: string) {
    return { data: await this.labService.applyInterfaceResult(id, userId) };
  }

  @Patch('interface/:id/reject')
  @Roles(UserRole.LAB_TECH, UserRole.ADMIN)
  @ApiOperation({ summary: '수신 결과 거부' })
  async rejectResult(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RejectInterfaceResultDto) {
    return { data: await this.labService.rejectInterfaceResult(id, dto.reason) };
  }

  // ── 결과 첨부파일 ──

  @Post('result/:labResultId/attachments')
  @Roles(UserRole.LAB_TECH, UserRole.ADMIN)
  @ApiOperation({ summary: '검사 결과 PDF/파일 첨부' })
  async addAttachment(
    @Param('labResultId', ParseUUIDPipe) labResultId: string,
    @Body() dto: AddLabAttachmentDto,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.labService.addAttachment(labResultId, { ...dto, uploadedBy: userId }) };
  }

  @Get('result/:labResultId/attachments')
  @Roles(UserRole.LAB_TECH, UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '검사 결과 첨부파일 목록' })
  async getAttachments(@Param('labResultId', ParseUUIDPipe) labResultId: string) {
    return { data: await this.labService.getAttachments(labResultId) };
  }

  // ── 검사기록지 (Worksheet) ──

  @Get('worksheets')
  @Roles(UserRole.LAB_TECH, UserRole.ADMIN)
  @ApiOperation({ summary: '검사기록지 목록' })
  async getWorksheets(@Query('date') date?: string) {
    return { data: await this.labService.getWorksheets(date) };
  }

  @Post('worksheets')
  @Roles(UserRole.LAB_TECH, UserRole.ADMIN)
  @ApiOperation({ summary: '검사기록지 생성' })
  async createWorksheet(@Body() dto: CreateWorksheetDto, @CurrentUser('id') userId: string) {
    return { data: await this.labService.createWorksheet({ ...dto, technicianId: userId }) };
  }

  @Get('worksheets/:id')
  @Roles(UserRole.LAB_TECH, UserRole.ADMIN)
  @ApiOperation({ summary: '검사기록지 상세 (오더+환자 포함)' })
  async getWorksheetDetail(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.labService.getWorksheetDetail(id) };
  }

  @Post('worksheets/:id/items')
  @Roles(UserRole.LAB_TECH, UserRole.ADMIN)
  @ApiOperation({ summary: '기록지에 오더 추가' })
  async addWorksheetItem(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddWorksheetItemDto,
  ) {
    return { data: await this.labService.addWorksheetItem(id, dto) };
  }

  @Patch('worksheets/:id/items/:itemId/remove')
  @Roles(UserRole.LAB_TECH, UserRole.ADMIN)
  @ApiOperation({ summary: '기록지에서 오더 제거' })
  async removeWorksheetItem(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
  ) {
    return { data: await this.labService.removeWorksheetItem(id, itemId) };
  }

  @Patch('worksheets/:id/sign')
  @Roles(UserRole.LAB_TECH, UserRole.ADMIN)
  @ApiOperation({ summary: '검사기록지 서명/완료' })
  async signWorksheet(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') userId: string,
    @Body() body: SignLabWorksheetDto,
  ) {
    return { data: await this.labService.signWorksheet(id, userId, body?.blockchainSignature) };
  }

  // ── 바코드 ──

  @Post('barcode/generate')
  @Roles(UserRole.LAB_TECH, UserRole.ADMIN)
  @ApiOperation({ summary: '검체 바코드 생성' })
  async generateBarcode(@Body() dto: GenerateBarcodeDto) {
    return { data: await this.labService.generateBarcode(dto.orderId, dto.patientId) };
  }

  @Post('barcode/scan')
  @Roles(UserRole.LAB_TECH, UserRole.ADMIN)
  @ApiOperation({ summary: '바코드 스캔 → 검체 매칭' })
  async scanBarcode(@Body() dto: ScanBarcodeDto) {
    return { data: await this.labService.scanBarcode(dto.barcode) };
  }

  // ── 위탁검사 (Send-Out) ──

  @Get('reference-labs')
  @Roles(UserRole.LAB_TECH, UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '수탁기관 목록' })
  async getReferenceLabs() {
    return { data: await this.labService.getReferenceLabs() };
  }

  @Post('reference-labs')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '수탁기관 등록' })
  async createReferenceLab(@Body() dto: CreateReferenceLabDto) {
    return { data: await this.labService.createReferenceLab(dto) };
  }

  @Get('reference-labs/:id/catalog')
  @Roles(UserRole.LAB_TECH, UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '수탁기관 검사 카탈로그' })
  async getRefLabCatalog(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.labService.getRefLabCatalog(id) };
  }

  @Post('reference-labs/:id/catalog')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '카탈로그 항목 추가' })
  async createCatalogItem(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateCatalogItemDto) {
    return { data: await this.labService.createCatalogItem({ ...dto, referenceLabId: id }) };
  }

  @Get('send-outs')
  @Roles(UserRole.LAB_TECH, UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '위탁검사 목록' })
  async getSendOuts(@Query('status') status?: string, @Query('referenceLabId') referenceLabId?: string, @Query('patientId') patientId?: string) {
    return { data: await this.labService.getSendOuts({ status, referenceLabId, patientId }) };
  }

  @Post('send-outs')
  @Roles(UserRole.LAB_TECH, UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '위탁검사 의뢰' })
  async createSendOut(@Body() dto: CreateSendOutDto, @CurrentUser('id') userId: string) {
    return { data: await this.labService.createSendOut({ ...dto, requestedBy: userId }) };
  }

  @Get('send-outs/:id')
  @Roles(UserRole.LAB_TECH, UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '위탁검사 상세' })
  async getSendOutDetail(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.labService.getSendOutDetail(id) };
  }

  @Patch('send-outs/:id/status')
  @Roles(UserRole.LAB_TECH, UserRole.ADMIN)
  @ApiOperation({ summary: '위탁검사 상태 변경' })
  async updateSendOutStatus(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateSendOutStatusDto) {
    return { data: await this.labService.updateSendOutStatus(id, dto.status, dto) };
  }

  @AuditAiRead('AiLabInterpret')

  @Get('orders/:orderId/ai-interpret')
  @ApiOperation({ summary: 'AI 검사 결과 해석' })
  async interpretResultAI(@Param('orderId', ParseUUIDPipe) orderId: string) {
    return { data: await this.labService.interpretResultAI(orderId) };
  }

  @AuditAiRead('AiLabFollowup')

  @Get('orders/:orderId/ai-followup')
  @ApiOperation({ summary: 'AI 추가 검사 추천' })
  async suggestFollowupTests(@Param('orderId', ParseUUIDPipe) orderId: string) {
    return { data: await this.labService.suggestFollowupTests(orderId) };
  }

  @AuditAiRead('AiLabTrend')

  @Get('patients/:patientId/ai-trend')
  @ApiOperation({ summary: 'AI 검사 트렌드 분석' })
  async analyzeLabTrend(@Param('patientId', ParseUUIDPipe) patientId: string) {
    return { data: await this.labService.analyzeLabTrend(patientId) };
  }
}
