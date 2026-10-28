import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PatientEducationService } from './patient-education.service';
import { CreateEducationRecordDto, VoidEducationRecordDto } from './dto/patient-education.dto';

/**
 * 환자 교육 기록(2026-09-30) — 경로를 `patients/:id/…` 에 두어 열람·변이 감사가 환자에 귀속된다(audit-routes 규약).
 * 교육은 의사·간호사·약사·영양사·치료사(의료기사)가 한다 — 기록도 그 직군이 · 의무기록은 조회만.
 */
@ApiTags('Patient Education (환자 교육 기록)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/patients')
export class PatientEducationController {
  constructor(private readonly svc: PatientEducationService) {}

  @Get(':id/education')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.PHARMACIST, UserRole.NUTRITION, UserRole.LAB_TECH, UserRole.MEDICAL_RECORDS, UserRole.ADMIN)
  @ApiOperation({ summary: '환자 교육 — 교육 기록 + 다른 기록에 적힌 교육(복약상담·영양상담·간호기록·퇴원요약, 읽기 전용)' })
  async list(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.svc.list(id) };
  }

  @Post(':id/education')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.PHARMACIST, UserRole.NUTRITION, UserRole.LAB_TECH, UserRole.ADMIN)
  @ApiOperation({ summary: '환자 교육 기록 추가 — 주제·대상·내용 필수 · 이해도는 평가한 경우에만' })
  async create(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateEducationRecordDto, @CurrentUser('id') userId: string) {
    return { data: await this.svc.create(id, dto, userId) };
  }

  @Post(':id/education/:recordId/void')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.PHARMACIST, UserRole.NUTRITION, UserRole.LAB_TECH, UserRole.ADMIN)
  @ApiOperation({ summary: '환자 교육 기록 무효 처리(지우지 않는다) — 기록한 사람·관리자 · 사유 필수' })
  async void(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('recordId', ParseUUIDPipe) recordId: string,
    @Body() dto: VoidEducationRecordDto,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: string,
  ) {
    return { data: await this.svc.void(id, recordId, userId, role, dto.reason) };
  }
}
