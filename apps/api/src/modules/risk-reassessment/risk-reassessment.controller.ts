import { Controller, Get, Post, Param, Body, Query, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { RiskReassessmentService } from './risk-reassessment.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CreateRiskScheduleDto, RecordAssessmentDto } from './dto/risk-reassessment.dto';

@ApiTags('Risk Reassessment (재평가 관리)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.NURSE, UserRole.DOCTOR, UserRole.ADMIN)
@Controller('api/v1/risk-reassessment')
export class RiskReassessmentController {
  constructor(private readonly riskReassessmentService: RiskReassessmentService) {}

  // 🔴 원 결함: `@Body() data: Record<string, unknown>` 인라인 바디는 전역 ValidationPipe 를 건너뛴다.
  //    필드명이 틀려도 서버까지 그대로 흘러 들어와 재평가 점수가 조용히 사라졌다 → DTO 로 계약을 고정.
  @Post('schedule')
  @ApiOperation({ summary: '재평가 스케줄 생성' })
  async createSchedule(@Body() dto: CreateRiskScheduleDto) {
    return { data: await this.riskReassessmentService.createSchedule(dto) };
  }

  @Get('schedules')
  @ApiOperation({ summary: '재평가 스케줄 목록' })
  async getSchedules(
    @Query('patientId') patientId?: string,
    @Query('assessmentType') assessmentType?: string,
    @Query('overdue') overdue?: string,
  ) {
    return {
      data: await this.riskReassessmentService.getSchedules({
        patientId,
        assessmentType,
        overdue: overdue === 'true',
      }),
    };
  }

  @Get('schedules/:id')
  @ApiOperation({ summary: '재평가 스케줄 상세' })
  async getScheduleById(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.riskReassessmentService.getScheduleById(id) };
  }

  @Post('schedules/:id/assess')
  @ApiOperation({ summary: '재평가 기록' })
  async recordAssessment(
    @Param('id', ParseUUIDPipe) scheduleId: string,
    @Body() dto: RecordAssessmentDto,
    @CurrentUser('id') assessedBy: string,
  ) {
    return {
      data: await this.riskReassessmentService.recordAssessment(scheduleId, {
        ...dto,
        assessedBy,
      }),
    };
  }

  @Post('schedules/:id/deactivate')
  @ApiOperation({ summary: '재평가 스케줄 비활성화 (퇴원 등)' })
  async deactivate(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.riskReassessmentService.deactivate(id) };
  }

  @Get('overdue')
  @ApiOperation({ summary: '지연된 재평가 목록' })
  async getOverdue() {
    return { data: await this.riskReassessmentService.getOverdue() };
  }

  @Get('stats')
  @ApiOperation({ summary: '재평가 통계' })
  async getStats() {
    return { data: await this.riskReassessmentService.getStats() };
  }

  // ⚠️ 이 EP 는 호출처가 전역 0 이다(운영 스케줄 0행의 직접 원인). 배선 보류 사유는 module 주석 참조.
  @Post('auto-create/:patientId')
  @ApiOperation({ summary: '입원 시 자동 재평가 스케줄 생성 (낙상+욕창) — 멱등' })
  async autoCreateOnAdmission(
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @Body('admissionId', ParseUUIDPipe) admissionId: string,
  ) {
    return { data: await this.riskReassessmentService.autoCreateOnAdmission(patientId, admissionId) };
  }
}
