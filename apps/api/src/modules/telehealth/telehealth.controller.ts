import { Controller, Get, Post, Patch, Param, Body, Query, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { TelehealthService } from './telehealth.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuditAiRead } from '../audit/no-audit.decorator';
import { SubmitTelehealthDoctorReplyDto, SubmitTelehealthPatientMessageDto } from './dto/telehealth-async.dto';
import { CreateTelehealthSessionDto, EndTelehealthSessionDto } from './dto/telehealth-write.dto';

@ApiTags('Telehealth (원격진료)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard) // 🔴 종전 RolesGuard 부재 — 임의 인증사용자가 의사답변·처방발행 가능했음
@Controller('api/v1/telehealth')
export class TelehealthController {
  constructor(private readonly service: TelehealthService) {}

  @Post('sessions')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN, UserRole.NURSE)
  @ApiOperation({ summary: '원격진료 세션 생성 — 담당의(doctorId) 필수(의사 본인이 잡으면 생략 가능)' })
  async createSession(
    @Body() body: CreateTelehealthSessionDto,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role?: string,
  ) {
    // 🔴 종전엔 담당의를 **호출자 id 로 강제**했다(`{ ...body, doctorId: 호출자 }`). 화면에도 담당의
    //    선택이 없었으므로 관리자·간호사가 잡은 예약은 담당의가 본인이 됐고, 그 세션은 어느 의사의
    //    목록에도 뜨지 않았다 — 환자는 누가 볼지 모르는 채로 확정됐다.
    //    의사 본인이 잡을 때만 생략을 허용하고, 그 외에는 서버가 거절한다(fail-closed).
    const doctorId = body.doctorId ?? (role === 'DOCTOR' ? userId : undefined);
    return { data: await this.service.createSession({ ...body, doctorId }) };
  }

  @Get('sessions')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN, UserRole.NURSE) // 원격진료 메뉴 역할(Sidebar /telehealth) — 2026-09-15 @Roles 부재 봉합
  @ApiOperation({ summary: '원격진료 세션 목록 — 의사=내 담당·관리자/간호사=전체' })
  async getSessions(
    @Query('status') status?: string,
    @Query('date') date?: string,
    @CurrentUser('id') userId?: string,
    @CurrentUser('role') role?: string,
  ) {
    // 🔴 전 역할을 본인 doctorId 로 거르면 관리자·간호사에겐 목록이 영구 공집합이고,
    //    관리자가 만든 데모 세션(담당의=첫 활성 의사)은 생성 즉시 목록에서 사라졌다(P2·2026-08-13 W3).
    const scopeToSelf = role === 'DOCTOR';
    return { data: await this.service.getSessions(scopeToSelf ? userId : undefined, status, date) };
  }

  @Get('sessions/:id')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.PHARMACIST, UserRole.ADMIN) // 세션 방 참여 역할(화면 역할 뷰: 의사·간호사·약사) — 2026-09-15 @Roles 부재 봉합
  @ApiOperation({ summary: '세션 상세' })
  async getSession(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.service.getSession(id) };
  }

  @Patch('sessions/:id/start')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN, UserRole.NURSE)
  @ApiOperation({ summary: '진료 시작' })
  async startSession(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.service.startSession(id) };
  }

  @Patch('sessions/:id/end')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN, UserRole.NURSE)
  @ApiOperation({ summary: '진료 종료 (Encounter + Billing 자동 생성)' })
  async endSession(@Param('id', ParseUUIDPipe) id: string, @Body() body: EndTelehealthSessionDto) {
    return { data: await this.service.endSession(id, body.notes, body.diagnosisCode) };
  }

  @Patch('sessions/:id/cancel')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN, UserRole.NURSE)
  @ApiOperation({ summary: '세션 취소' })
  async cancelSession(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.service.cancelSession(id) };
  }

  @Patch('sessions/:id/patient-join')
  // 🔴 (2026-09-14) @Roles 부재 — 클래스 RolesGuard 는 역할 미지정 핸들러를 모든 인증 직원(READ·CRM 포함)에게 열었다.
  //    환자는 포털 인증이라 이 staff JWT EP 를 부를 수 없고 web·mobile 호출부도 0 — 직원 대리 입력 경로이므로 세션 관리 역할과 같게.
  @Roles(UserRole.DOCTOR, UserRole.ADMIN, UserRole.NURSE)
  @ApiOperation({ summary: '환자 대기실 입장' })
  async patientJoin(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.service.patientJoin(id) };
  }

  @Patch('sessions/:id/patient-message')
  // 🔴 (2026-09-14) @Roles 부재 — 클래스 RolesGuard 는 역할 미지정 핸들러를 모든 인증 직원(READ·CRM 포함)에게 열었다.
  //    환자는 포털 인증이라 이 staff JWT EP 를 부를 수 없고 web·mobile 호출부도 0 — 직원 대리 입력 경로이므로 세션 관리 역할과 같게.
  @Roles(UserRole.DOCTOR, UserRole.ADMIN, UserRole.NURSE)
  @ApiOperation({ summary: '비동기 진료 — 환자 메시지' })
  async submitPatientMessage(@Param('id', ParseUUIDPipe) id: string, @Body() body: SubmitTelehealthPatientMessageDto) {
    return { data: await this.service.submitPatientMessage(id, body.message, body.photos) };
  }

  @Patch('sessions/:id/doctor-reply')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '비동기 진료 — 의사 답변' })
  async submitDoctorReply(@Param('id', ParseUUIDPipe) id: string, @Body() body: SubmitTelehealthDoctorReplyDto) {
    return { data: await this.service.submitDoctorReply(id, body.reply) };
  }

  @Patch('sessions/:id/prescription-issued')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '원격 처방전 발행 완료' })
  async markPrescriptionIssued(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.service.markPrescriptionIssued(id) };
  }

  // 🔴 (2026-09-15) 직원 JWT `PATCH sessions/:id/rate`(환자 평가) 제거 — @Roles 가 없어 READ·CRM 을 포함한 **아무 직원이나**
  //    환자 만족도(patientRating·patientFeedback)를 써넣을 수 있었다. 평가는 환자 본인의 진술이라 대리 입력 성격이 아니고,
  //    환자 경로는 포털 `POST /api/v1/portal/telehealth/:id/rate`(본인 세션 대조) 가 따로 있다 · 직원 화면 호출부 0.

  @Get('sessions/:id/jitsi-token')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.PHARMACIST, UserRole.ADMIN) // 세션 방 참여 역할(화면 역할 뷰: 의사·간호사·약사) — 2026-09-15 @Roles 부재 봉합
  @ApiOperation({ summary: 'Jitsi JWT 토큰 발급 (의사: 모더레이터)' })
  async getJitsiToken(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('id') userId: string) {
    const token = await this.service.getJitsiToken(id, userId);
    return { data: { token } };
  }

  @Get('sessions/:id/patient-token')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN, UserRole.NURSE) // 원격진료 메뉴 역할(Sidebar /telehealth) — 2026-09-15 @Roles 부재 봉합
  @ApiOperation({ summary: '환자용 Jitsi 토큰 발급 (게스트)' })
  async getPatientJitsiToken(@Param('id', ParseUUIDPipe) id: string) {
    const token = await this.service.getPatientJitsiToken(id);
    return { data: { token } };
  }

  @Patch('sessions/:id/pharmacy-review')
  @Roles(UserRole.PHARMACIST, UserRole.ADMIN)
  @ApiOperation({ summary: '약사 처방 검토 의견 저장' })
  async submitPharmacyReview(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('id') userId: string, @Body('review') review: string) {
    return { data: await this.service.submitPharmacyReview(id, userId, review) };
  }

  @Get('sessions/:id/pharmacy-review')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.PHARMACIST, UserRole.ADMIN) // 세션 방 참여 역할(화면 역할 뷰: 의사·간호사·약사) — 2026-09-15 @Roles 부재 봉합
  @ApiOperation({ summary: '약사 검토 의견 조회' })
  async getPharmacyReview(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.service.getPharmacyReview(id) };
  }

  @Get('sessions/:id/prescriptions')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.PHARMACIST, UserRole.ADMIN) // 세션 방 참여 역할(화면 역할 뷰: 의사·간호사·약사) — 2026-09-15 @Roles 부재 봉합
  @ApiOperation({ summary: '세션 내 처방 목록 (약사용)' })
  async getSessionPrescriptions(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.service.getSessionPrescriptions(id) };
  }

  @Post('demo')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN, UserRole.NURSE) // 원격진료 메뉴 역할(Sidebar /telehealth) — 2026-09-15 @Roles 부재 봉합
  @ApiOperation({ summary: '데모 세션 생성 (환자/의사 자동 매칭)' })
  async createDemoSession(@CurrentUser('id') userId: string, @Body('sessionType') sessionType?: string) {
    return { data: await this.service.createDemoSession(userId, sessionType || 'VIDEO') };
  }

  @Get('stats')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN, UserRole.NURSE) // 원격진료 메뉴 역할(Sidebar /telehealth) — 2026-09-15 @Roles 부재 봉합
  @ApiOperation({ summary: '원격진료 통계 — 의사=내 담당·관리자/간호사=전체' })
  async getStats(@CurrentUser('id') userId: string, @CurrentUser('role') role?: string) {
    return { data: await this.service.getStats(role === 'DOCTOR' ? userId : undefined) };
  }

  @Get('patient/:patientId')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN, UserRole.NURSE) // 원격진료 메뉴 역할(Sidebar /telehealth) — 2026-09-15 @Roles 부재 봉합
  @ApiOperation({ summary: '환자별 원격진료 이력' })
  async getPatientSessions(@Param('patientId', ParseUUIDPipe) patientId: string) {
    return { data: await this.service.getPatientSessions(patientId) };
  }

  @AuditAiRead('AiTelehealthClassify')

  @Get('sessions/:id/ai-classify')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN, UserRole.NURSE) // 원격진료 메뉴 역할(Sidebar /telehealth) — 2026-09-15 @Roles 부재 봉합
  @ApiOperation({ summary: 'AI 비동기 메시지 분류 (긴급/일반/재진)' })
  async classifyPatientMessage(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.service.classifyPatientMessage(id) };
  }

  @AuditAiRead('AiTelehealthReply')

  @Get('sessions/:id/ai-reply')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN) // 의사 답변 초안 — 답변 권한(doctor-reply)과 같게 · 2026-09-15 @Roles 부재 봉합
  @ApiOperation({ summary: 'AI 의사 답변 초안 생성' })
  async suggestReply(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.service.suggestReply(id) };
  }
}
