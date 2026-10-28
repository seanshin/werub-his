import { Controller, Get, Post, Patch, Param, Query, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { WorkgroupService } from './workgroup.service';
import { UserRole } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import {
  SubmitHandoffDto, AdministerMedicationDto, AutoAssignDutyDto,
  RequestDutySwapDto, AcknowledgeAlertDto, IssueTicketDto,
} from './dto/workgroup.dto';

@ApiTags('Workgroup (Clinic 워크그룹 연동)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
/**
 * 🔴 (2026-09-16 D4) 이 컨트롤러는 **20EP 전부 역할 선언이 없었다** — 인증만 되면 READ·CRM·영양 직군까지
 *    병동 환자 목록·투약 일정·인계 기록을 읽고 **투약 실시(`POST medication/:id/administer`)** 까지 쓸 수 있었다.
 *    HIS 화면 소비처는 간호 대시보드 위젯(`roles: ['NURSE']`) 하나뿐이라 임상 3역할로 좁힌다.
 *    🔴 이 표면은 외부 Clinic 앱 연동용이다 — 그쪽이 다른 직군 계정을 쓰고 있었다면 403 이 된다(연동 계정 역할 확인 필요).
 */
@Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
@Controller('api/workgroup')
export class WorkgroupController {
  constructor(private readonly service: WorkgroupService) {}

  @Get('schedule/doctor/:doctorId')
  @ApiOperation({ summary: '#1 의사 오늘 진료 목록' })
  async getDoctorSchedule(@Param('doctorId') doctorId: string, @Query('date') date?: string) {
    return { ok: true, data: await this.service.getDoctorSchedule(doctorId, date), timestamp: new Date().toISOString() };
  }

  @Get('surgery/schedule')
  @ApiOperation({ summary: '#2 수술 일정' })
  async getSurgerySchedule(@Query('date') date?: string, @Query('doctorId') doctorId?: string) {
    return { ok: true, data: await this.service.getSurgerySchedule(date, doctorId), timestamp: new Date().toISOString() };
  }

  @Get('ward/patients/:doctorId')
  @ApiOperation({ summary: '#3 담당 입원 환자' })
  async getWardPatients(@Param('doctorId') doctorId: string) {
    return { ok: true, data: await this.service.getWardPatients(doctorId), timestamp: new Date().toISOString() };
  }

  @Get('ward/status/:floorId')
  @ApiOperation({ summary: '#4 병동 현황' })
  async getWardStatus(@Param('floorId') floorId: string) {
    return { ok: true, data: await this.service.getWardStatus(floorId), timestamp: new Date().toISOString() };
  }

  @Get('reception/status')
  @Roles(UserRole.ADMIN, UserRole.NURSE, UserRole.RECEPTIONIST) // 접수·키오스크는 원무 화면 역할
  @ApiOperation({ summary: '#5 접수 현황' })
  async getReceptionStatus() {
    return { ok: true, data: await this.service.getReceptionStatus(), timestamp: new Date().toISOString() };
  }

  @Get('billing/summary')
  @ApiOperation({ summary: '#6 수납 통계' })
  async getBillingSummary(@Query('date') date?: string) {
    return { ok: true, data: await this.service.getBillingSummary(date), timestamp: new Date().toISOString() };
  }

  @Get('duty/schedule')
  @ApiOperation({ summary: '#10 당직 스케줄' })
  async getDutySchedule(@Query('month') month?: string, @Query('department') department?: string) {
    return { ok: true, data: await this.service.getDutySchedule(month, department), timestamp: new Date().toISOString() };
  }

  @Get('surgery/today')
  @ApiOperation({ summary: '#12 오늘 수술' })
  async getTodaySurgery() {
    return { ok: true, data: await this.service.getSurgerySchedule(), timestamp: new Date().toISOString() };
  }

  @Get('medication/schedule/:nurseId')
  @ApiOperation({ summary: '#14 투약 스케줄' })
  async getMedicationSchedule(@Param('nurseId') nurseId: string, @Query('hours') hours?: string) {
    return { ok: true, data: await this.service.getMedicationSchedule(nurseId, hours ? parseInt(hours) : 4), timestamp: new Date().toISOString() };
  }

  @Post('medication/:medicationId/administer')
  @ApiOperation({ summary: '#15 투약 완료 기록' })
  async administerMedication(@Param('medicationId') id: string, @Body() dto: AdministerMedicationDto) {
    return { ok: true, data: { id, status: 'administered', administeredAt: new Date().toISOString() }, timestamp: new Date().toISOString() };
  }

  @Get('medication/overdue')
  @ApiOperation({ summary: '#16 미투약 목록' })
  async getOverdueMedications(@Query('wardId') wardId?: string) {
    return { ok: true, data: await this.service.getOverdueMedications(wardId), timestamp: new Date().toISOString() };
  }

  @Post('duty/auto-assign')
  @ApiOperation({ summary: 'AI 당직 자동 배정' })
  async autoAssignDuty(@Body() dto: AutoAssignDutyDto) {
    return { ok: true, data: await this.service.autoAssignDuty(dto.month), timestamp: new Date().toISOString() };
  }

  // Phase 2 — 인수인계

  @Get('handoff/template/:wardId')
  @ApiOperation({ summary: '#7 인수인계 양식 (환자 정보 자동 채움)' })
  async getHandoffTemplate(@Param('wardId') wardId: string, @Query('shift') shift?: string) {
    return { ok: true, data: await this.service.getHandoffTemplate(wardId, shift), timestamp: new Date().toISOString() };
  }

  @Post('handoff/submit')
  @ApiOperation({ summary: '#8 인수인계 제출' })
  async submitHandoff(@Body() dto: SubmitHandoffDto) {
    return { ok: true, data: await this.service.submitHandoff(dto), timestamp: new Date().toISOString() };
  }

  @Get('handoff/history')
  @ApiOperation({ summary: '#9 인수인계 이력' })
  async getHandoffHistory(@Query('wardId') wardId?: string, @Query('from') from?: string, @Query('to') to?: string, @Query('limit') limit?: string) {
    return { ok: true, data: await this.service.getHandoffHistory(wardId, from, to, limit ? parseInt(limit) : 20), timestamp: new Date().toISOString() };
  }

  // Phase 3 — 교대 요청

  @Post('duty/swap-request')
  @ApiOperation({ summary: '#11 당직 교대 요청' })
  async requestDutySwap(@Body() dto: RequestDutySwapDto) {
    return { ok: true, data: await this.service.requestDutySwap(dto), timestamp: new Date().toISOString() };
  }

  // Phase 5 — 긴급 알림

  @Get('alerts/active')
  @ApiOperation({ summary: '#17 현재 활성 알림 (폴링)' })
  async getActiveAlerts(@Query('severity') severity?: string) {
    return { ok: true, data: await this.service.getActiveAlerts(severity), timestamp: new Date().toISOString() };
  }

  @Patch('alerts/:alertId/acknowledge')
  @ApiOperation({ summary: '#18 알림 확인/대응' })
  async acknowledgeAlert(@Param('alertId') alertId: string, @Body() dto: AcknowledgeAlertDto) {
    return { ok: true, data: await this.service.acknowledgeAlert(alertId, dto), timestamp: new Date().toISOString() };
  }

  // Phase 6 — 키오스크

  @Get('kiosk/waiting/:departmentId')
  @Roles(UserRole.ADMIN, UserRole.NURSE, UserRole.RECEPTIONIST) // 접수·키오스크는 원무 화면 역할
  @ApiOperation({ summary: '#19 대기 현황 (키오스크)' })
  async getKioskWaiting(@Param('departmentId') departmentId: string) {
    return { ok: true, data: await this.service.getKioskWaiting(departmentId), timestamp: new Date().toISOString() };
  }

  @Post('kiosk/ticket')
  @Roles(UserRole.ADMIN, UserRole.NURSE, UserRole.RECEPTIONIST) // 접수·키오스크는 원무 화면 역할
  @ApiOperation({ summary: '#20 번호표 발급' })
  async issueTicket(@Body() dto: IssueTicketDto) {
    return { ok: true, data: await this.service.issueKioskTicket(dto), timestamp: new Date().toISOString() };
  }
}
