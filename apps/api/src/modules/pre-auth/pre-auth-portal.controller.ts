import { Controller, Get, Post, Body, Param, Req, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { PreAuthService } from './pre-auth.service';
import { PortalOrPatientGuard } from '../patient-auth/guards/portal-or-patient.guard';
import { PortalRequest } from '../../common/interfaces/portal-request.interface';
import { SubmitPortalPreAuthDto } from './dto/pre-auth.dto';

// 환자 포털 사전승인 신청 — 환자 기안 → 행정 접수 → 주치의 승인 다단계. PortalOrPatientGuard로 본인 patientId 주입.
@ApiTags('사전승인(환자 포털)')
@UseGuards(PortalOrPatientGuard)
@Controller('api/v1/portal/pre-auth')
export class PreAuthPortalController {
  constructor(private readonly svc: PreAuthService) {}

  @Post()
  @ApiOperation({ summary: '환자 사전승인 신청(재처방·검사·의뢰·시술상담) → 행정→주치의 결재. 게이트 preauth.portal.enabled' })
  async submit(@Req() req: PortalRequest, @Body() dto: SubmitPortalPreAuthDto) {
    return { data: await this.svc.submitPortalPreAuth(req.portalPatientId as string, dto) };
  }

  @Get()
  @ApiOperation({ summary: '내 사전승인 신청 진행상태' })
  async mine(@Req() req: PortalRequest) {
    return { data: await this.svc.listPortalMine(req.portalPatientId as string) };
  }

  @Post(':id/cancel')
  @ApiOperation({ summary: '내 사전승인 신청 취소(진행 중만)' })
  async cancel(@Req() req: PortalRequest, @Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.svc.cancelPortal(req.portalPatientId as string, id) };
  }
}
