import { Controller, Get, Post, Patch, Param, Body, Query, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { RadiationService } from './radiation.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import {
  CreateRadiationPlanDto, UpdatePlanStatusDto, DeliverFractionDto,
  CancelFractionDto, AddToxicityDto, ResolveStuckFractionDto,
} from './dto/radiation.dto';

@ApiTags('Radiation Oncology (방사선종양학)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.DOCTOR, UserRole.ADMIN)
@Controller('api/v1/radiation')
export class RadiationController {
  constructor(private readonly service: RadiationService) {}

  /* ───── Plans ───── */

  @Post('plans')
  @ApiOperation({ summary: '방사선 치료 계획 생성' })
  async createPlan(
    @Body() dto: CreateRadiationPlanDto,
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
  @ApiOperation({ summary: '계획 상세 (분할+부작용 포함)' })
  async getPlanDetail(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.service.getPlanDetail(id) };
  }

  @Patch('plans/:id/status')
  @ApiOperation({ summary: '상태 변경' })
  async updatePlanStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePlanStatusDto,
  ) {
    return { data: await this.service.updatePlanStatus(id, dto.status) };
  }

  @Patch('plans/:id/approve')
  @ApiOperation({ summary: '계획 승인' })
  async approvePlan(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.service.approvePlan(id, userId) };
  }

  /* ───── Fractions ───── */

  @Post('plans/:id/fractions/generate')
  @ApiOperation({ summary: '분할 일정 자동 생성 (주말 제외)' })
  async generateFractions(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.service.generateFractions(id) };
  }

  @Get('fractions/today')
  // 🔴 조사 기록(deliver)은 치료사·간호사에게 열었는데 그 버튼이 있는 오늘 일정 목록이 403 이라
  //    실무자가 버튼까지 갈 수 없었다(2026-10-07). 같은 역할로 연다.
  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE, UserRole.LAB_TECH)
  @ApiOperation({ summary: '오늘 치료 스케줄' })
  async getTodayFractions() {
    return { data: await this.service.getTodayFractions() };
  }

  @Patch('fractions/:id/deliver')
  // 🔴 조사(delivery) 기록 실무자는 방사선치료사(운영 실측: tx.radiation=LAB_TECH)와 치료실 간호사인데
  //    클래스 @Roles 가 DOCTOR·ADMIN 뿐이라 **실무자 전원이 403** 이었다. 이 핸들러만 연다(처방·계획은 의사 그대로).
  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE, UserRole.LAB_TECH)
  @ApiOperation({ summary: '치료 완료 기록' })
  async deliverFraction(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DeliverFractionDto,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.service.deliverFraction(id, dto, userId) };
  }

  @Patch('fractions/:id/cancel')
  @ApiOperation({ summary: '치료 취소' })
  async cancelFraction(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelFractionDto,
  ) {
    return { data: await this.service.cancelFraction(id, dto.notes) };
  }

  @Patch('fractions/:id/resolve-stuck')
  @ApiOperation({ summary: "'조사 중' 고착 분할 정리 — 조사됨(치료기 선량·시각) 또는 조사 안 됨(취소) · 사유 필수 · 의사·관리자" })
  async resolveStuckFraction(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResolveStuckFractionDto,
  ) {
    const r = await this.service.resolveStuckFraction(id, dto);
    return { data: r.fraction, meta: { warnings: r.warnings } };
  }

  /* ───── Toxicity ───── */

  @Post('plans/:id/toxicity')
  @ApiOperation({ summary: '부작용 기록' })
  async addToxicity(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddToxicityDto,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.service.addToxicity(id, { ...dto, assessedBy: userId }) };
  }

  @Get('plans/:id/toxicity')
  @ApiOperation({ summary: '부작용 추이' })
  async getToxicities(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.service.getToxicities(id) };
  }

  /* ───── Machines ───── */

  @Get('machines')
  @ApiOperation({ summary: '치료기 목록' })
  async getMachines() {
    return { data: await this.service.getMachines() };
  }

  @Get('machines/:id/schedule')
  @ApiOperation({ summary: '기기별 일정' })
  async getMachineSchedule(
    @Param('id') machineName: string,
    @Query('date') date: string,
  ) {
    return { data: await this.service.getMachineSchedule(machineName, date) };
  }

  /* ───── Dashboard / Stats ───── */

  @Get('dashboard')
  @ApiOperation({ summary: '방사선과 대시보드' })
  async getDashboard() {
    return { data: await this.service.getDashboard() };
  }

  @Get('patients/:id/history')
  @ApiOperation({ summary: '환자 조사 이력' })
  async getPatientHistory(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.service.getPatientHistory(id) };
  }

  @Get('stats')
  @ApiOperation({ summary: '통계 (기법별, 부위별, 완료율)' })
  async getStats() {
    return { data: await this.service.getStats() };
  }
}
