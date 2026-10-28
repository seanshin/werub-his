import { Controller, Get, Post, Patch, Param, Body, Query, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { RehabService } from './rehab.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import {
  CreateRehabAssessmentDto, CreateRehabPlanDto, UpdateRehabPlanDto,
  CreateRehabSessionDto, CompleteRehabSessionDto, GenerateRehabSessionsDto, StartRehabSessionDto,
} from './dto/rehab.dto';

@ApiTags('Rehabilitation (재활의학)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
@Controller('api/v1/rehab')
export class RehabController {
  constructor(private readonly service: RehabService) {}

  /* ───── Assessments ───── */

  @Post('assessments')
  @ApiOperation({ summary: '재활 평가 생성' })
  async createAssessment(
    @Body() dto: CreateRehabAssessmentDto,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.service.createAssessment({ ...dto, assessedBy: userId }) };
  }

  @Get('assessments')
  @ApiOperation({ summary: '재활 평가 목록(최근순) — 부서 화면 재활평가 탭' })
  async listAssessments() {
    return { data: await this.service.getAssessments() };
  }

  @Get('assessments/:patientId')
  @ApiOperation({ summary: '환자 재활 평가 이력' })
  async getAssessments(@Param('patientId', ParseUUIDPipe) patientId: string) {
    return { data: await this.service.getAssessments(patientId) };
  }

  /* ───── Plans ───── */

  @Post('plans')
  @ApiOperation({ summary: '치료 계획 생성' })
  async createPlan(
    @Body() dto: CreateRehabPlanDto,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.service.createPlan({ ...dto, prescribedBy: userId }) };
  }

  @Get('plans')
  @ApiOperation({ summary: '치료 계획 목록' })
  async getPlans(@Query('patientId') patientId?: string, @Query('status') status?: string) {
    return { data: await this.service.getPlans({ patientId, status }) };
  }

  @Get('plans/:id')
  @ApiOperation({ summary: '계획 상세 (세션 포함)' })
  async getPlanDetail(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.service.getPlanDetail(id) };
  }

  @Patch('plans/:id')
  @ApiOperation({ summary: '계획 수정/종료' })
  async updatePlan(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRehabPlanDto,
  ) {
    return { data: await this.service.updatePlan(id, dto) };
  }

  /* ───── Sessions ───── */

  @Post('sessions')
  @ApiOperation({ summary: '치료 세션 예약' })
  async createSession(@Body() dto: CreateRehabSessionDto) {
    return { data: await this.service.createSession(dto) };
  }

  @Post('sessions/generate')
  @ApiOperation({ summary: '세션 자동 생성 (계획 기반)' })
  async generateSessions(
    @Body() body: GenerateRehabSessionsDto,
  ) {
    return { data: await this.service.generateSessions(body) };
  }

  @Get('sessions')
  // 치료사(LAB_TECH+치료 직종)가 자기 세션을 보고 기록한다(2026-09-29) — 종전 클래스 @Roles 로 치료사 전면 403
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN, UserRole.LAB_TECH)
  @ApiOperation({ summary: '세션 목록 (날짜/치료사)' })
  async getSessions(
    @Query('date') date?: string,
    @Query('therapistId') therapistId?: string,
    @Query('patientId') patientId?: string,
  ) {
    return { data: await this.service.getSessions({ date, therapistId, patientId }) };
  }

  @Patch('sessions/:id/start')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN, UserRole.LAB_TECH)
  @ApiOperation({ summary: '세션 시작 — 안전게이트(낙상 Berg·활력징후 hold, rehab.sessionGate) 경유' })
  async startSession(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: StartRehabSessionDto,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.service.startSession(id, { overrideGate: body?.overrideGate, overrideReason: body?.overrideReason, userId }) };
  }

  @Patch('sessions/:id/complete')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN, UserRole.LAB_TECH)
  @ApiOperation({ summary: '세션 완료 (활동/활력징후/소견)' })
  async completeSession(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CompleteRehabSessionDto,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.service.completeSession(id, dto, userId) };
  }

  /* ───── Dashboard / Stats ───── */

  @Get('therapist/schedule')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN, UserRole.LAB_TECH)
  @ApiOperation({ summary: '치료사 일정' })
  async getTherapistSchedule(
    @Query('therapistId') therapistId: string,
    @Query('date') date: string,
  ) {
    return { data: await this.service.getTherapistSchedule(therapistId, date) };
  }

  @Get('dashboard')
  @ApiOperation({ summary: '재활 대시보드' })
  async getDashboard() {
    return { data: await this.service.getDashboard() };
  }

  @Get('patients/:id/progress')
  @ApiOperation({ summary: '환자 경과 추적 (Barthel/FIM 추이)' })
  async getPatientProgress(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.service.getPatientProgress(id) };
  }

  @Get('stats')
  @ApiOperation({ summary: '재활 통계' })
  async getStats() {
    return { data: await this.service.getStats() };
  }
}
