import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards, ParseUUIDPipe, NotFoundException } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { ConciergeService } from './concierge.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import { ConciergePatientAuthDto } from './dto/concierge-patient-auth.dto';

@ApiTags('Concierge')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/concierge')
export class ConciergeController {
  constructor(private readonly conciergeService: ConciergeService) {}

  @Post('chat')
  @Roles(UserRole.ADMIN, UserRole.NURSE, UserRole.DOCTOR, UserRole.PHARMACIST)
  @ApiOperation({ summary: '예약 상담 챗(세션리스) — reply + 진료과 제안' })
  async bookingChat(@Body() body: { message?: string; patientId?: string; context?: string }) {
    return { data: await this.conciergeService.bookingChat(body?.message ?? '', body?.patientId, body?.context) };
  }

  @Post('sessions')
  @Roles(UserRole.ADMIN, UserRole.NURSE, UserRole.DOCTOR, UserRole.PHARMACIST)
  @ApiOperation({ summary: '컨시어지 세션 생성' })
  async createSession(@Body('patientId') patientId: string) {
    return { data: await this.conciergeService.createSession(patientId) };
  }

  @Post('sessions/:sessionId/messages')
  @Roles(UserRole.ADMIN, UserRole.NURSE, UserRole.DOCTOR, UserRole.PHARMACIST)
  @ApiOperation({ summary: '메시지 전송 + AI 응답' })
  async sendMessage(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Body('patientId') patientId: string,
    @Body('content') content: string,
  ) {
    return { data: await this.conciergeService.sendMessage(sessionId, patientId, content) };
  }

  @Get('encounters')
  @Roles(UserRole.ADMIN, UserRole.NURSE, UserRole.DOCTOR)
  @ApiOperation({ summary: '환자 진료 이력 (컨시어지용)' })
  async getEncounters(@Query('patientId') patientId: string) {
    return { data: await this.conciergeService.getEncounters(patientId) };
  }

  @Get('lab-results')
  @Roles(UserRole.ADMIN, UserRole.NURSE, UserRole.DOCTOR)
  @ApiOperation({ summary: '환자 검사 결과 (컨시어지용)' })
  async getLabResults(@Query('patientId') patientId: string) {
    return { data: await this.conciergeService.getLabResults(patientId) };
  }

  @Get('medications')
  @Roles(UserRole.ADMIN, UserRole.NURSE, UserRole.DOCTOR, UserRole.PHARMACIST)
  @ApiOperation({ summary: '환자 투약 정보 (컨시어지용)' })
  async getMedications(@Query('patientId') patientId: string) {
    return { data: await this.conciergeService.getMedications(patientId) };
  }

  @Get('appointments')
  @Roles(UserRole.ADMIN, UserRole.NURSE, UserRole.DOCTOR)
  @ApiOperation({ summary: '환자 예약 현황 (컨시어지용)' })
  async getAppointments(@Query('patientId') patientId: string) {
    return { data: await this.conciergeService.getAppointments(patientId) };
  }

  @Get('billings')
  @Roles(UserRole.ADMIN, UserRole.NURSE)
  @ApiOperation({ summary: '환자 수납 내역 (컨시어지용)' })
  async getBillings(@Query('patientId') patientId: string) {
    return { data: await this.conciergeService.getBillings(patientId) };
  }

  @Get('vitals')
  @Roles(UserRole.ADMIN, UserRole.NURSE, UserRole.DOCTOR)
  @ApiOperation({ summary: '환자 바이탈 사인 (컨시어지용)' })
  async getVitals(@Query('patientId') patientId: string) {
    return { data: await this.conciergeService.getVitals(patientId) };
  }

  @Get('admissions')
  @Roles(UserRole.ADMIN, UserRole.NURSE, UserRole.DOCTOR)
  @ApiOperation({ summary: '환자 입원 정보 (컨시어지용)' })
  async getAdmissionInfo(@Query('patientId') patientId: string) {
    return { data: await this.conciergeService.getAdmissionInfo(patientId) };
  }

  @Patch('sessions/:sessionId/close')
  @Roles(UserRole.ADMIN, UserRole.NURSE, UserRole.DOCTOR, UserRole.PHARMACIST)
  @ApiOperation({ summary: '세션 종료' })
  async closeSession(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Body('patientId') patientId: string,
  ) {
    await this.conciergeService.closeSession(sessionId, patientId);
    return { data: { message: '세션이 종료되었습니다.' } };
  }

  /**
   * 🔴 (2026-09-16 H3) 이 컨트롤러에서 **혼자 `@Roles` 가 없었다** — 바로 위 형제 `close` 는 4역할이다.
   *    그래서 READ·CRM 을 포함한 인증된 전 직원이 만족도 평가를 남길 수 있었고, 그 값은 ADMIN 지표
   *    `ratings/stats` 로 집계된다. 형제와 같은 역할로 맞춘다(역할을 지어내지 않는다).
   * 🔴 서비스가 `updateMany` 라 **세션↔환자 짝이 틀리면 0건 갱신인데 "등록되었습니다"** 를 돌려줬다
   *    (P16: 실행하지 않고 성공만 기록). 반영 건수가 0이면 그렇게 말한다.
   */
  @Patch('sessions/:sessionId/rate')
  @Roles(UserRole.ADMIN, UserRole.NURSE, UserRole.DOCTOR, UserRole.PHARMACIST)
  @ApiOperation({ summary: '만족도 평가 (1~5점)' })
  async rateSession(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Body() body: { patientId: string; rating: number; comment?: string },
  ) {
    const r = await this.conciergeService.rateSession(sessionId, body.patientId, body.rating, body.comment);
    if (r.count === 0) {
      throw new NotFoundException({ code: 'CONCIERGE_SESSION_NOT_FOUND', message: '세션을 찾을 수 없습니다.' });
    }
    return { data: { message: '평가가 등록되었습니다.' } };
  }

  @Get('ratings/stats')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '만족도 통계' })
  async getRatingStats() {
    return { data: await this.conciergeService.getRatingStats() };
  }
}

/**
 * 환자 본인 인증 전용 컨트롤러 (JWT 불필요)
 */
@ApiTags('Concierge (Patient Auth)')
@Controller('api/v1/concierge/patient-auth')
export class ConciergePatientAuthController {
  constructor(private readonly conciergeService: ConciergeService) {}

  @Post('verify')
  // 🔴 신원 대입(MRN×생년월일)이 곧 이 EP 의 호출이다 — 무인증에 전역 기본(600/분)이 붙어 있었다.
  //    민감 등급(30/분)으로 내린다. 같은 저장소의 공개 예약 챗도 대입 우려로 10/분을 쓴다.
  @Throttle({ sensitive: { limit: 30, ttl: 60000 } })
  @ApiOperation({ summary: '환자 본인 인증 (MRN + 생년월일)' })
  async authenticatePatient(@Body() dto: ConciergePatientAuthDto) {
    return { data: await this.conciergeService.authenticatePatient(dto.mrn, dto.dateOfBirth) };
  }
}
