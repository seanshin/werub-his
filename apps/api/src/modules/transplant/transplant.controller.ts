import { Controller, Get, Post, Patch, Param, Body, Query, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { TransplantService } from './transplant.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import {
  AddTransplantWaitlistDto, CreateTransplantRecordDto, DecideTransplantDonorDto, RecordTransplantCrossmatchDto, RecordTransplantFollowUpDto, RecordTransplantHlaDto,
  RecordTransplantTdmDto, RegisterKonosDto, RegisterTransplantDonorDto, ReportTransplantRejectionDto, UpdateTransplantCrossmatchDto,
  UpdateTransplantRejectionOutcomeDto, UpdateTransplantWaitlistStatusDto,
} from './dto/transplant.dto';

@ApiTags('Transplant (장기이식)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.DOCTOR, UserRole.ADMIN)
@Controller('api/v1/transplant')
export class TransplantController {
  constructor(private readonly service: TransplantService) {}

  // ── 대기자 ──
  @Post('waitlist')
  @ApiOperation({ summary: '대기자 등록' })
  async addToWaitlist(@Body() body: AddTransplantWaitlistDto) { return { data: await this.service.addToWaitlist(body) }; }

  @Get('waitlist')
  @ApiOperation({ summary: '대기자 목록' })
  async getWaitlist(@Query('organType') organType?: string, @Query('status') status?: string) { return { data: await this.service.getWaitlist(organType, status) }; }

  @Patch('waitlist/:id/status')
  @ApiOperation({ summary: '대기자 상태 변경' })
  async updateWaitlistStatus(@Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateTransplantWaitlistStatusDto) { return { data: await this.service.updateWaitlistStatus(id, body.status, body.removeReason) }; }

  // ── 기증자 ──
  @Post('donors')
  @ApiOperation({ summary: '기증자 등록' })
  async registerDonor(@Body() body: RegisterTransplantDonorDto) { return { data: await this.service.registerDonor(body) }; }

  @Get('donors')
  @ApiOperation({ summary: '기증자 목록' })
  async getDonors(@Query('organType') organType?: string) { return { data: await this.service.getDonors(organType) }; }

  // 공개판: 기증자 승인 · 거절 — 이식 게이트는 승인(APPROVED)된 기증자만 통과시키는데, 그 상태로 가는 경로가 없었다
  @Post('donors/:id/approve')
  @ApiOperation({ summary: '기증자 승인(등록 · 평가 → 승인 · 판정자 기록)' })
  async approveDonor(@Param('id', ParseUUIDPipe) id: string, @Body() body: DecideTransplantDonorDto, @CurrentUser('id') userId: string) {
    return { data: await this.service.decideDonor(id, 'APPROVED', userId, body?.note) };
  }

  @Post('donors/:id/reject')
  @ApiOperation({ summary: '기증자 거절(등록 · 평가 → 거절 · 사유 필수 · 판정자 기록)' })
  async rejectDonor(@Param('id', ParseUUIDPipe) id: string, @Body() body: DecideTransplantDonorDto, @CurrentUser('id') userId: string) {
    return { data: await this.service.decideDonor(id, 'REJECTED', userId, body?.note) };
  }

  @Patch('donors/:id/crossmatch')
  @ApiOperation({ summary: '교차시험 결과 등록(수혈자 결속)' })
  async updateCrossmatch(@Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateTransplantCrossmatchDto) { return { data: await this.service.updateCrossmatch(id, body.result, body.recipientId) }; }

  // ── 이식 기록 ──
  @Post('records')
  @ApiOperation({ summary: '이식 기록 생성' })
  async createTransplant(@Body() body: CreateTransplantRecordDto) { return { data: await this.service.createTransplant(body) }; }

  @Get('records')
  @ApiOperation({ summary: '이식 기록 목록' })
  async getTransplants(@Query('recipientId') recipientId?: string) { return { data: await this.service.getTransplants(recipientId) }; }

  @Get('records/:id')
  @ApiOperation({ summary: '이식 기록 상세' })
  async getTransplantDetail(@Param('id', ParseUUIDPipe) id: string) { return { data: await this.service.getTransplantDetail(id) }; }

  // ── 거부반응 ──
  @Post('rejections')
  @ApiOperation({ summary: '거부반응 보고' })
  async reportRejection(@Body() body: ReportTransplantRejectionDto) { return { data: await this.service.reportRejection(body) }; }

  @Patch('rejections/:id/outcome')
  @ApiOperation({ summary: '거부반응 결과 업데이트' })
  async updateRejectionOutcome(@Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateTransplantRejectionOutcomeDto) { return { data: await this.service.updateRejectionOutcome(id, body.outcome) }; }

  // ── 통계 ──
  @Get('stats')
  @ApiOperation({ summary: '장기이식 통계' })
  async getStats() { return { data: await this.service.getStats() }; }

  // ── KONOS 등록 ──
  @Post('waitlist/:id/konos')
  @ApiOperation({ summary: 'KONOS 대기자 등록' })
  async registerKonos(@Param('id', ParseUUIDPipe) id: string, @Body() body: RegisterKonosDto) {
    return { data: await this.service.registerKonos(id, { ...body }) };
  }

  // ── MELD/PELD 계산 ──
  @Get('waitlist/:id/meld')
  @ApiOperation({ summary: 'MELD/PELD 자동 계산' })
  async calculateMeld(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.service.calculateMeld(id) };
  }

  // ── HLA 타이핑 ──
  @Post('waitlist/:id/hla')
  @ApiOperation({ summary: 'HLA 타이핑 기록' })
  async recordHla(@Param('id', ParseUUIDPipe) id: string, @Body() body: RecordTransplantHlaDto, @CurrentUser('id') userId: string) {
    return { data: await this.service.recordHla(id, { ...body }, userId) };
  }

  @Get('waitlist/:id/hla')
  @ApiOperation({ summary: 'HLA 타이핑 이력 조회' })
  async listHla(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.service.listHla(id) };
  }

  // ── 교차시험 (CDC/FCXM) ──
  @Post('donors/:id/crossmatch-detail')
  @ApiOperation({ summary: 'CDC/FCXM 교차시험 결과 기록' })
  async recordCrossmatch(@Param('id', ParseUUIDPipe) id: string, @Body() body: RecordTransplantCrossmatchDto, @CurrentUser('id') userId: string) {
    return { data: await this.service.recordCrossmatch(id, { ...body }, userId) };
  }

  // ── 면역억제제 TDM ──
  @Post('records/:id/tdm')
  @ApiOperation({ summary: '면역억제제 TDM 기록' })
  async recordTdm(@Param('id', ParseUUIDPipe) id: string, @Body() body: RecordTransplantTdmDto, @CurrentUser('id') userId: string) {
    return { data: await this.service.recordTdm(id, { ...body }, userId) };
  }

  @Get('records/:id/tdm')
  @ApiOperation({ summary: '면역억제제 TDM 이력 조회' })
  async listTdm(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.service.listTdm(id) };
  }

  // ── 이식 후 추적관찰 ──
  @Post('records/:id/follow-up')
  @ApiOperation({ summary: '이식 후 추적관찰 기록' })
  async recordFollowUp(@Param('id', ParseUUIDPipe) id: string, @Body() body: RecordTransplantFollowUpDto, @CurrentUser('id') userId: string) {
    return { data: await this.service.recordFollowUp(id, { ...body }, userId) };
  }

  @Get('records/:id/follow-up')
  @ApiOperation({ summary: '이식 후 추적관찰 이력 조회' })
  async listFollowUp(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.service.listFollowUp(id) };
  }

  // ── 이식편 생존율 ──
  @Get('graft-survival')
  @ApiOperation({ summary: '이식편 생존율 데이터 (Kaplan-Meier)' })
  async getGraftSurvival() {
    return { data: await this.service.getGraftSurvival() };
  }
}
