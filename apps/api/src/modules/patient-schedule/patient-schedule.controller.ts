import { Controller, Get, Param, Query, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { PatientScheduleService } from './patient-schedule.service';

@ApiTags('환자 통합 일정')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/patients/:patientId/schedule')
export class PatientScheduleController {
  constructor(private readonly svc: PatientScheduleService) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  @ApiOperation({ summary: '환자 통합 일정 (예약·수술·투약·사전처방·임상경로 병합, read-only)' })
  @ApiQuery({ name: 'from', required: false, description: 'ISO 날짜 (기본: 오늘-7일)' })
  @ApiQuery({ name: 'to', required: false, description: 'ISO 날짜 (기본: 오늘+60일)' })
  @ApiQuery({ name: 'sources', required: false, description: '콤마구분 APPOINTMENT|SURGERY|MEDICATION|PRE_ORDER|PATHWAY' })
  async getSchedule(
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('sources') sources?: string,
  ) {
    return {
      data: await this.svc.getSchedule(patientId, {
        from: from ? new Date(from) : undefined,
        to: to ? new Date(to + (to.length === 10 ? 'T23:59:59.999+09:00' : '')) : undefined,
        sources: sources ? sources.split(',').filter(Boolean) : undefined,
      }),
    };
  }
}
