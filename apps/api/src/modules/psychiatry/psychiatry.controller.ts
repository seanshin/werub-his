import { Controller, Get, Post, Patch, Param, Body, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { PsychiatryService } from './psychiatry.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import {
  CreatePsychiatryExamDto, CreatePsychAdmissionDto, SuitabilityReviewDto, ConvertPsychTypeDto, DischargePsychAdmissionDto, ContinuationReviewDto,
  CreateSeclusionDto, SeclusionMonitoringDto, ExtendSeclusionDto, ReleaseSeclusionDto,
  CreateEctDto, CompleteEctDto, CancelEctDto,
} from './dto/psychiatry.dto';
import { specialtyPatientResponse } from '../../common/specialty-board';

@ApiTags('Psychiatry (정신건강의학과)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.DOCTOR, UserRole.ADMIN)
@Controller('api/v1/psychiatry')
export class PsychiatryController {
  constructor(private readonly service: PsychiatryService) {}

  @Get('patients')
  @ApiOperation({ summary: '정신건강의학과 환자 목록' })
  async getPatients() {
    // 최근 기록 순 상한 — 전체 수·잘림은 meta(2026-10-10)
    return specialtyPatientResponse(await this.service.getPatients());
  }

  @Get('exams/:patientId')
  @ApiOperation({ summary: '환자 검사 이력' })
  async getExams(@Param('patientId', ParseUUIDPipe) patientId: string) {
    return { data: await this.service.getExams(patientId) };
  }

  @Post('exams')
  @ApiOperation({ summary: '검사 기록 생성' })
  async createExam(
    @Body() body: CreatePsychiatryExamDto,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.service.createExam({ ...body, examinedBy: userId }) };
  }

  @Get('score-trend/:patientId')
  @ApiOperation({ summary: 'PHQ-9/GAD-7/MMSE 점수 추이' })
  async getScoreTrend(@Param('patientId', ParseUUIDPipe) patientId: string) {
    return { data: await this.service.getScoreTrend(patientId) };
  }

  @Get('today')
  @ApiOperation({ summary: '오늘 정신건강의학과 일정' })
  async getToday() {
    return { data: await this.service.getToday() };
  }

  @Get('stats')
  @ApiOperation({ summary: '정신건강의학과 통계' })
  async getStats() {
    return { data: await this.service.getStats() };
  }

  /* ───── 비자의입원(정신건강복지법) ───── */

  @Post('admissions')
  @ApiOperation({ summary: '비자의입원 등록(유형별 법정요건 게이팅)' })
  async createAdmission(@Body() dto: CreatePsychAdmissionDto, @CurrentUser('id') userId: string) {
    return { data: await this.service.createAdmission(dto, userId) };
  }

  @Get('admissions/active')
  @ApiOperation({ summary: '활성 비자의입원 목록 + 법정 경고' })
  async getActiveAdmissions() {
    return { data: await this.service.getActiveAdmissions() };
  }

  @Get('admissions/alerts')
  @ApiOperation({ summary: '법정기한 경고(만료·심사지연)' })
  async getComplianceAlerts() {
    return { data: await this.service.getComplianceAlerts() };
  }

  @Get('admissions/patient/:patientId')
  @ApiOperation({ summary: '환자 비자의입원 상태(배너)' })
  async getPatientAdmissionStatus(@Param('patientId', ParseUUIDPipe) patientId: string) {
    return { data: await this.service.getPatientAdmissionStatus(patientId) };
  }

  @Patch('admissions/:id/suitability-review')
  @ApiOperation({ summary: '입원적합성심사 결과 기록' })
  async recordSuitabilityReview(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SuitabilityReviewDto) {
    return { data: await this.service.recordSuitabilityReview(id, dto) };
  }

  @Patch('admissions/:id/continuation-review')
  @ApiOperation({ summary: '계속입원심사 완료(기한 연장)' })
  async recordContinuationReview(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ContinuationReviewDto) {
    return { data: await this.service.recordContinuationReview(id, dto) };
  }

  @Patch('admissions/:id/convert')
  @ApiOperation({ summary: '입원유형 전환(안전장치 재산출)' })
  async convertType(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ConvertPsychTypeDto, @CurrentUser('id') userId: string) {
    return { data: await this.service.convertType(id, dto, userId) };
  }

  @Patch('admissions/:id/discharge')
  @ApiOperation({ summary: '비자의입원 퇴원' })
  async dischargeAdmission(@Param('id', ParseUUIDPipe) id: string, @Body() dto: DischargePsychAdmissionDto) {
    return { data: await this.service.dischargeAdmission(id, dto) };
  }

  // ── §75 격리·강박 (정신건강복지법) ──

  @Post('seclusions')
  @ApiOperation({ summary: '§75 격리·강박 지시 — 정신과 전문의 게이트·법정 최대시간(격리12h/강박4h) 자동 산출' })
  async createSeclusion(@Body() dto: CreateSeclusionDto, @CurrentUser('id') userId: string) {
    return { data: await this.service.createSeclusion(dto, userId) };
  }

  @Get('seclusions/active')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '활성 격리·강박 현황 — 법정시간 초과·관찰지연 표시' })
  async getActiveSeclusions() {
    return { data: await this.service.getActiveSeclusions() };
  }

  @Get('seclusions/patient/:patientId')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '환자 격리·강박 이력' })
  async getPatientSeclusions(@Param('patientId', ParseUUIDPipe) patientId: string) {
    return { data: await this.service.getPatientSeclusions(patientId) };
  }

  @Post('seclusions/:id/monitorings')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '주기 관찰 기록 — continued=false 시 자동 해제' })
  async recordSeclusionMonitoring(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SeclusionMonitoringDto,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.service.recordSeclusionMonitoring(id, dto, userId) };
  }

  @Patch('seclusions/:id/extend')
  @ApiOperation({ summary: '연장 — 전문의 대면진찰 사유 필수·법정 단위(격리12h/강박4h)로 갱신' })
  async extendSeclusion(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ExtendSeclusionDto, @CurrentUser('id') userId: string) {
    return { data: await this.service.extendSeclusion(id, dto, userId) };
  }

  @Patch('seclusions/:id/release')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '해제' })
  async releaseSeclusion(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReleaseSeclusionDto, @CurrentUser('id') userId: string) {
    return { data: await this.service.releaseSeclusion(id, userId, dto.notes) };
  }

  // ── ECT(전기경련치료) ──

  @Post('ect')
  @ApiOperation({ summary: 'ECT 처방 — 전문의 게이트+서명 동의서 게이트(기본 BLOCK)' })
  async createEct(@Body() dto: CreateEctDto, @CurrentUser('id') userId: string) {
    return { data: await this.service.createEct(dto, userId) };
  }

  @Get('ect/patient/:patientId')
  @ApiOperation({ summary: '환자 ECT 이력' })
  async getPatientEct(@Param('patientId', ParseUUIDPipe) patientId: string) {
    return { data: await this.service.getPatientEct(patientId) };
  }

  @Patch('ect/:id/complete')
  @ApiOperation({ summary: 'ECT 시행 완료 기록(발작시간·합병증)' })
  async completeEct(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CompleteEctDto) {
    return { data: await this.service.completeEct(id, dto) };
  }

  @Patch('ect/:id/cancel')
  @ApiOperation({ summary: 'ECT 취소' })
  async cancelEct(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelEctDto) {
    return { data: await this.service.cancelEct(id, dto.reason) };
  }
}
