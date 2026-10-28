import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { PortalOrPatientGuard } from '../patient-auth/guards/portal-or-patient.guard';
import { PortalRequest } from '../../common/interfaces/portal-request.interface';
import { PatientScheduleService } from './patient-schedule.service';

// 환자 포털 치료일정(P3) — 예약·수술·검사 예정만(내부 항목 비노출, 기획 §3.3)
@ApiTags('환자 포털 - 치료 일정')
@ApiBearerAuth()
@UseGuards(PortalOrPatientGuard)
@Controller('api/v1/portal/treatment-schedule')
export class PortalScheduleController {
  constructor(private readonly svc: PatientScheduleService) {}

  @Get()
  @ApiOperation({ summary: '내 치료 일정 (예약·수술·검사 예정 — read-only)' })
  async getMySchedule(@Req() req: PortalRequest, @Query('from') from?: string, @Query('to') to?: string) {
    return {
      data: await this.svc.getPortalSchedule(req.portalPatientId!, {
        from: from ? new Date(from) : undefined,
        to: to ? new Date(to) : undefined,
      }),
    };
  }
}
