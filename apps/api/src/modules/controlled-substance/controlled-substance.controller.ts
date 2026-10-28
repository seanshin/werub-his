import { Controller, Get, Post, Param, Body, Query, UseGuards, ParseUUIDPipe, Res } from '@nestjs/common';
import { Response } from 'express';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { ControlledSubstanceService } from './controlled-substance.service';
import { ControlledSubstanceStockService } from './controlled-substance-stock.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ReceiveStockDto, StockMoveDto, AdjustStockDto, CountStockDto } from './dto/stock.dto';
import { RecordWasteDto, ReportIncidentDto, FileIncidentDto, RecordNimsAckDto, AdministerControlledSubstanceDto } from './dto/waste.dto';
import { DispenseControlledSubstanceDto, PrescribeControlledSubstanceDto } from './dto/prescribe.dto';

@ApiTags('Controlled Substance (마약류 관리)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.DOCTOR, UserRole.PHARMACIST, UserRole.NURSE, UserRole.ADMIN)
@Controller('api/v1/controlled-substance')
export class ControlledSubstanceController {
  constructor(
    private readonly controlledSubstanceService: ControlledSubstanceService,
    private readonly stockService: ControlledSubstanceStockService,
  ) {}

  @Post('prescribe')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '마약류 처방' })
  async prescribe(@Body() data: PrescribeControlledSubstanceDto) {
    return { data: await this.controlledSubstanceService.prescribe({ ...data }) };
  }

  @Post(':id/verify')
  @Roles(UserRole.DOCTOR, UserRole.PHARMACIST, UserRole.NURSE, UserRole.ADMIN) // 공개판: 역할을 경로에 명시(처방자 ≠ 확인자는 서비스가 검사)
  @ApiOperation({ summary: '2차 확인 (Double-check)' })
  async verify(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('id') verifierId: string) {
    return { data: await this.controlledSubstanceService.verify(id, verifierId) };
  }

  @Post(':id/dispense')
  @Roles(UserRole.PHARMACIST, UserRole.ADMIN)
  @ApiOperation({ summary: '마약류 조제/불출' })
  async dispense(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') dispensedBy: string,
    @Body() body: DispenseControlledSubstanceDto,
  ) {
    return { data: await this.controlledSubstanceService.dispense(id, dispensedBy, body?.scanCode) };
  }

  @Post(':id/administer')
  @Roles(UserRole.NURSE, UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '마약류 투약' })
  async administer(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('id') administeredBy: string, @Body() dto: AdministerControlledSubstanceDto) {
    // 🔴 인라인 @Body('administeredQty') 는 ValidationPipe 를 건너뛴다 → DTO 로 받아 0 초과·수치 보장
    return { data: await this.controlledSubstanceService.administer(id, administeredBy, dto.administeredQty) };
  }

  @Post(':id/waste')
  @Roles(UserRole.PHARMACIST, UserRole.NURSE, UserRole.ADMIN) // 공개판: 재고 폐기 경로와 같은 역할
  @ApiOperation({ summary: '마약류 폐기 (독립 증인·잔량)' })
  async recordWaste(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RecordWasteDto,
    @CurrentUser('id') wastedById: string,
  ) {
    // 폐기 수행자는 인증 사용자(감사 귀속) — 증인과 동일인 불가.
    // 🔴 인라인 @Body('x') 는 ValidationPipe 를 건너뛴다 → DTO 로 받아 witnessId 가 uuid 임을 보장.
    return { data: await this.controlledSubstanceService.recordWaste(id, dto.reason, dto.witnessId, wastedById, dto.wastedQty) };
  }

  /** 폐기·실사 증인 후보 — 증인은 성명이 아니라 사람(User.id)이어야 2인 무결성이 성립한다. */
  @Get('witness-candidates')
  @ApiOperation({ summary: '증인 후보 목록(2인 무결성·본인 제외)' })
  async getWitnessCandidates(@CurrentUser('id') userId: string, @Query('q') q?: string) {
    return { data: await this.controlledSubstanceService.getWitnessCandidates(userId, q) };
  }

  // ── 사고마약류(§12) ──
  @Post('incidents')
  @Roles(UserRole.PHARMACIST, UserRole.NURSE, UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '사고마약류 보고(도난·분실·파손·재해)' })
  async reportIncident(@Body() dto: ReportIncidentDto, @CurrentUser('id') userId: string) {
    return { data: await this.controlledSubstanceService.reportIncident(dto, userId) };
  }

  @Get('incidents')
  @Roles(UserRole.PHARMACIST, UserRole.NURSE, UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '사고마약류 목록' })
  async getIncidents(@Query('status') status?: string) {
    return { data: await this.controlledSubstanceService.getIncidents(status) };
  }

  @Post('incidents/:id/file')
  @Roles(UserRole.PHARMACIST, UserRole.ADMIN)
  @ApiOperation({ summary: '사고마약류 관할 신고 기록(전송 아님 — 사람이 신고한 사실 기록)' })
  async fileIncident(@Param('id', ParseUUIDPipe) id: string, @Body() dto: FileIncidentDto, @CurrentUser('id') userId: string) {
    return { data: await this.controlledSubstanceService.fileIncident(id, dto, userId) };
  }

  // ── NIMS 취급보고 아웃박스 ──
  @Get('nims/queue')
  @Roles(UserRole.PHARMACIST, UserRole.ADMIN)
  @ApiOperation({ summary: 'NIMS 취급보고 큐(식약처 마약류통합관리)' })
  async getNimsQueue(@Query('status') status?: string) {
    return { data: await this.controlledSubstanceService.getNimsQueue(status) };
  }

  /**
   * 🔴 이 엔드포인트는 **제출이 아니라 제출용 서식 파일 생성**이다(식약처로 나가는 전송은 없다).
   * 응답 헤더 `X-Nims-Transmitted: false` 로 그 사실을 계약에 박아 둔다.
   */
  @Get('nims/export')
  @Roles(UserRole.PHARMACIST, UserRole.ADMIN)
  @ApiOperation({ summary: 'NIMS 제출서식 내려받기(원내 생성 — 전송 아님·csv/xml)' })
  async exportNims(@Res() res: Response, @CurrentUser('id') userId: string, @Query('format') format?: string, @Query('status') status?: string) {
    const fmt = format === 'xml' ? 'xml' : 'csv';
    const file = await this.controlledSubstanceService.buildNimsBatch(status, fmt, userId);
    res.set({
      'Content-Type': file.mime,
      'Content-Disposition': `attachment; filename="${file.filename}"`,
      'X-Nims-Count': String(file.count),
      'X-Nims-Batch-No': file.batchNo,
      'X-Nims-Transmitted': String(file.transmitted),
    });
    res.send(file.content);
  }

  /**
   * 🔴 적재 실패로 **법정 보고가 남지 않은 건**을 원장에서 다시 담는다(전송이 아니라 적재).
   *    누락 수는 `nims/queue` 의 `counts.missing` 이 말한다.
   */
  @Post('nims/reenqueue-missing')
  @Roles(UserRole.PHARMACIST, UserRole.ADMIN)
  @ApiOperation({ summary: 'NIMS 보고 누락분 재적재(원장 대조)' })
  async reenqueueMissingNims(@CurrentUser('id') userId: string) {
    return { data: await this.controlledSubstanceService.reenqueueMissingNims(userId) };
  }

  @Post('nims/:id/submit')
  @Roles(UserRole.PHARMACIST, UserRole.ADMIN)
  @ApiOperation({ summary: 'NIMS 전송 시도(연동 미구축 — 현재는 원내 기록·미전송으로 남는다)' })
  async submitNims(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('id') userId: string) {
    return { data: await this.controlledSubstanceService.submitNimsReport(id, userId) };
  }

  @Post('nims/:id/ack')
  @Roles(UserRole.PHARMACIST, UserRole.ADMIN)
  @ApiOperation({ summary: 'NIMS 수기 접수번호 기록(웹 업로드 후 받은 실제 접수번호)' })
  async recordNimsAck(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RecordNimsAckDto, @CurrentUser('id') userId: string) {
    return { data: await this.controlledSubstanceService.recordManualNimsAck({ id }, dto, userId) };
  }

  @Post('nims/ack-batch')
  @Roles(UserRole.PHARMACIST, UserRole.ADMIN)
  @ApiOperation({ summary: 'NIMS 수기 접수번호 기록(배치 단위)' })
  async recordNimsAckBatch(@Body() dto: RecordNimsAckDto, @CurrentUser('id') userId: string) {
    return { data: await this.controlledSubstanceService.recordManualNimsAck({ batchNo: dto.batchNo }, dto, userId) };
  }

  @Post(':id/return')
  @Roles(UserRole.PHARMACIST, UserRole.NURSE, UserRole.ADMIN) // 공개판: 재고 반납 경로와 같은 역할
  @ApiOperation({ summary: '마약류 반납' })
  async returnDrug(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('id') userId: string) {
    return { data: await this.controlledSubstanceService.returnDrug(id, userId) };
  }

  /** 응답 봉투 = `{ data: { items, total, page, limit } }` — 화면은 total 로 '전체 기록'을 말한다. */
  @Get('logs')
  @ApiOperation({ summary: '마약류 관리 기록 목록(items·total 봉투)' })
  async getLogs(
    @Query('patientId') patientId?: string,
    @Query('deaSchedule') deaSchedule?: string,
    @Query('status') status?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return {
      data: await this.controlledSubstanceService.getLogs({
        patientId,
        deaSchedule,
        status,
        dateFrom,
        dateTo,
        page: Math.max(1, page ? parseInt(page, 10) || 1 : 1),
        limit: Math.min(200, Math.max(1, limit ? parseInt(limit, 10) || 20 : 20)),
      }),
    };
  }

  @Get('logs/:id')
  @ApiOperation({ summary: '마약류 관리 기록 상세' })
  async getLogById(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.controlledSubstanceService.getLogById(id) };
  }

  @Get('daily-ledger')
  @ApiOperation({ summary: '일일 마약류 원장' })
  async getDailyLedger(@Query('date') date?: string) {
    return { data: await this.controlledSubstanceService.getDailyLedger(date) };
  }

  @Get('stats')
  @ApiOperation({ summary: '마약류 관리 통계' })
  async getStats() {
    return { data: await this.controlledSubstanceService.getStats() };
  }

  @Get('unverified')
  @ApiOperation({ summary: '미확인 마약류 처방 목록' })
  async getUnverified() {
    return { data: await this.controlledSubstanceService.getUnverified() };
  }

  // ── 영속재고 수불부 ──

  @Get('stock')
  @ApiOperation({ summary: '마약류 재고 목록(장부 잔량)' })
  async getStocks(@Query('deaSchedule') deaSchedule?: string, @Query('location') location?: string) {
    return { data: await this.stockService.getStocks({ deaSchedule, location }) };
  }

  @Get('stock/discrepancies')
  @ApiOperation({ summary: '실사 불일치(유용 의심) 이력' })
  async getDiscrepancies() {
    return { data: await this.stockService.getDiscrepancies() };
  }

  @Get('stock/:id/ledger')
  @ApiOperation({ summary: '재고 수불 이력(전후 잔량)' })
  async getLedger(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.stockService.getLedger(id) };
  }

  @Post('stock/receive')
  @Roles(UserRole.PHARMACIST, UserRole.ADMIN)
  @ApiOperation({ summary: '입고' })
  async receiveStock(@Body() dto: ReceiveStockDto, @CurrentUser('id') userId: string) {
    return { data: await this.stockService.receive(dto, userId) };
  }

  @Post('stock/:id/issue')
  @Roles(UserRole.PHARMACIST, UserRole.ADMIN)
  @ApiOperation({ summary: '불출(재고 부족 차단)' })
  async issueStock(@Param('id', ParseUUIDPipe) id: string, @Body() dto: StockMoveDto, @CurrentUser('id') userId: string) {
    return { data: await this.stockService.issue(id, dto.quantity, userId, { reason: dto.reason, refId: dto.refId }) };
  }

  @Post('stock/:id/return')
  @Roles(UserRole.PHARMACIST, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '반납' })
  async returnStock(@Param('id', ParseUUIDPipe) id: string, @Body() dto: StockMoveDto, @CurrentUser('id') userId: string) {
    return { data: await this.stockService.returnStock(id, dto.quantity, userId, { reason: dto.reason, refId: dto.refId }) };
  }

  @Post('stock/:id/waste')
  @Roles(UserRole.PHARMACIST, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '폐기(증인 필수)' })
  async wasteStock(@Param('id', ParseUUIDPipe) id: string, @Body() dto: StockMoveDto, @CurrentUser('id') userId: string) {
    return { data: await this.stockService.waste(id, dto.quantity, userId, { reason: dto.reason, witnessedBy: dto.witnessedBy }) };
  }

  @Post('stock/:id/adjust')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '재고 조정(사유 필수·ADMIN)' })
  async adjustStock(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AdjustStockDto, @CurrentUser('id') userId: string) {
    return { data: await this.stockService.adjust(id, dto.delta, dto.reason, userId, dto.witnessedBy) };
  }

  @Post('stock/:id/count')
  @Roles(UserRole.PHARMACIST, UserRole.ADMIN)
  @ApiOperation({ summary: '실사 대사(불일치 시 증인+유용 경보)' })
  async countStock(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CountStockDto, @CurrentUser('id') userId: string) {
    return { data: await this.stockService.count(id, dto.countedQty, userId, { witnessedBy: dto.witnessedBy, reason: dto.reason }) };
  }
}
