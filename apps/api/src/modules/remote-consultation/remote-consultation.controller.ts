import { Controller, Get, Post, Patch, Body, Param, Query, Req, UseGuards, ForbiddenException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { RemoteConsultationService } from './remote-consultation.service';
import {
  RemoteCompleteDto, RemoteDoctorReplyDto, RemoteInitiateDto, RemotePrescribeDto, RemoteVideoProposeDto, SetRemoteDepartmentConfigDto,
} from './dto/remote-consultation-write.dto';

// ════════════════════════════════════════════════════════════
// HIS 비대면진료 API (의사용) — /api/v1/remote-consultations
// ════════════════════════════════════════════════════════════

@ApiTags('비대면진료 (HIS)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
/**
 * 🔴 (2026-09-16 D4) 쓰기(답변·완료·처방·화상 제안)만 역할이 있고 **읽기·설정 9EP 는 무역할**이었다 —
 *    상담 목록·상세·환자별 이력·처방 조회·화상 토큰과 **진료과 제한 설정 변경(PATCH)** 까지
 *    인증된 전 직원(READ·CRM 포함)에게 열려 있었다. 화면(`/remote-consult`) nav 역할을 기본값으로 못박는다.
 */
@Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
@Controller('api/v1/remote-consultations')
export class RemoteConsultationController {
  constructor(private readonly svc: RemoteConsultationService) {}

  @Get()
  @ApiOperation({ summary: '내 비대면 상담 목록 (의사)' })
  async list(@Req() req: any, @Query('status') status?: string) {
    return { data: await this.svc.getDoctorConsultations(req.user.id, status) };
  }

  @Get('stats')
  @ApiOperation({ summary: '비대면 진료 대시보드 통계' })
  async stats(@Req() req: any) {
    return { data: await this.svc.getDoctorStats(req.user.id) };
  }

  @Get('config/departments')
  @ApiOperation({ summary: '비대면 가능 진료과 설정 조회' })
  async getDeptConfig() {
    return { data: await this.svc.getDepartmentConfig() };
  }

  @Patch('config/departments')
  @ApiOperation({ summary: '비대면 가능 진료과 설정 변경 (ADMIN)' })
  async setDeptConfig(@Req() req: any, @Body() body: SetRemoteDepartmentConfigDto) {
    if (req.user.role !== 'ADMIN') throw new ForbiddenException('관리자만 설정할 수 있습니다');
    // 🔴 (2026-09-15 N4) 서비스가 받은 객체를 통째로 정책 값으로 저장한다 — 선언 필드만 넘긴다
    return { data: await this.svc.setDepartmentConfig({ enabled: body.enabled, infectiousMode: body.infectiousMode }, req.user.id) };
  }

  @Get('patient/:patientId')
  @ApiOperation({ summary: '환자별 비대면 상담 목록 (환자 차트 내)' })
  async patientConsultations(@Param('patientId') patientId: string, @Req() req: any) {
    return { data: await this.svc.getPatientConsultations(patientId, req.user.id) };
  }

  @Get(':id')
  @ApiOperation({ summary: '비대면 상담 상세 (의사)' })
  async detail(@Param('id') id: string, @Req() req: any) {
    const consult = await this.svc.getDoctorConsultationDetail(id, req.user.id);
    return { data: consult };
  }

  @Post(':id/reply')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '의사 답변 전송' })
  async reply(@Param('id') id: string, @Req() req: any, @Body() body: RemoteDoctorReplyDto) {
    return { data: await this.svc.doctorReply(id, req.user.id, body) };
  }

  @Patch(':id/complete')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '상담 종료 (수납 확정)' })
  async complete(@Param('id') id: string, @Req() req: any, @Body() body?: RemoteCompleteDto) {
    return { data: await this.svc.completeConsultation(id, req.user.id, body) };
  }

  @Post(':id/prescribe')
  // 🔴 처방 발행은 의사만 — 종전 @Roles 부재로, 임의 직원이 initiate 로 자기 자신을 doctorId 로
  //    자가배정한 뒤 이 EP 로 처방을 발행할 수 있었음(정본 CPOE EP 의 DOCTOR 역할·step-up 우회).
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '비대면 진료 처방 발행' })
  async prescribe(@Param('id') id: string, @Req() req: any, @Body() body: RemotePrescribeDto) {
    return { data: await this.svc.createPrescription(id, req.user.id, body) };
  }

  @Get(':id/prescriptions')
  @ApiOperation({ summary: '비대면 진료 처방 목록' })
  async prescriptions(@Param('id') id: string, @Req() req: any) {
    return { data: await this.svc.getPrescriptions(id, { doctorId: req.user.id }) };
  }

  @Post('initiate')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '의사 주도 안내 발송 (무료)' })
  async initiate(@Req() req: any, @Body() body: RemoteInitiateDto) {
    return { data: await this.svc.initiateConsultation(req.user.id, body) };
  }

  // ── 화상 전환 (의사) ──

  @Post(':id/video/propose')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '화상 전환 제안 (의사)' })
  async videoPropose(@Param('id') id: string, @Req() req: any, @Body() body: RemoteVideoProposeDto) {
    return { data: await this.svc.requestVideoEscalation(id, 'DOCTOR', req.user.id, body?.scheduledAt) };
  }

  @Post(':id/video/accept')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '화상 전환 수락 (의사) — Jitsi 룸 생성' })
  async videoAccept(@Param('id') id: string, @Req() req: any) {
    return { data: await this.svc.acceptVideoEscalation(id, req.user.id, 'DOCTOR') };
  }

  @Get(':id/video/token')
  @ApiOperation({ summary: '화상 진료 Jitsi 토큰 (의사=모더레이터)' })
  async videoToken(@Param('id') id: string, @Req() req: any) {
    return { data: await this.svc.getVideoToken(id, req.user.id, 'DOCTOR') };
  }

  @Post(':id/video/end')
  @ApiOperation({ summary: '화상 진료 종료 (의사)' })
  async videoEnd(@Param('id') id: string, @Req() req: any) {
    return { data: await this.svc.endVideo(id, req.user.id) };
  }
}
