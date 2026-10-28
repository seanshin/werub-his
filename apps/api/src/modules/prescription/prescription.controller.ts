import {
  Controller, Get, Post, Put, Patch, Delete, Param, Body, Query, Headers,
  UseGuards, ParseUUIDPipe, BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { EVERY_STAFF_ROLE } from '@hospital-run/shared';
import { PrescriptionService, type PrescriberRules } from './prescription.service';
import { CreatePrescriptionDto, CreatePrescriptionWithContextDto } from './dto/create-prescription.dto';
import { CopyFromEncounterDto, CopyPrescriptionsDto, RepeatPrescriptionDto } from './dto/copy-prescription.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { GatedStepUpGuard } from '../auth/step-up/gated-step-up.guard';
import { RequireStepUp } from '../auth/step-up/require-step-up.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AddDesignatedDoctorDto, DiscontinuePrescriptionDto, RenewPrescriptionDto, DurOverrideDto, PrescriberDelegateRequestDto, PrescriberRulesDto } from './dto/prescription-body.dto';

@ApiTags('Prescriptions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1')
export class PrescriptionController {
  constructor(private readonly prescriptionService: PrescriptionService) {}

  @Post('encounters/:encounterId/prescriptions')
  // 간호사(구두처방 대리입력)·임상병리사(워크인 검사 등록)도 **입력**은 가능하다.
  // 다만 처방 주체는 의사여야 하므로, 비처방 역할은 서비스(resolvePrescriber)에서
  // 지정 처방의 + 그 의사의 승인 없이는 통과하지 못한다(fail-closed).
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.LAB_TECH, UserRole.ADMIN)
  @UseGuards(GatedStepUpGuard) // method-level — JwtAuthGuard(클래스) 이후 실행, req.user 보장
  @RequireStepUp('PRESCRIPTION_CREATE') // config terminal.stepUpActions 에 등록 시에만 강제(기본 OFF)
  @ApiOperation({ summary: '처방 추가 (DUR 자동 점검) — 생명직결 step-up 게이트(opt-in)' })
  async create(
    @Param('encounterId', ParseUUIDPipe) encounterId: string,
    // 🔴 교차 타입(`A & { … }`)은 metatype 이 Object 라 ValidationPipe 를 통째로 건너뛴다 —
    //    CreatePrescriptionDto 의 검증이 처방 주경로에서 실행되지 않고 있었다. 클래스 상속으로 되살린다.
    @Body() dto: CreatePrescriptionWithContextDto,
    @CurrentUser('id') userId: string,
    @Headers('x-prescriber-step-up-token') prescriberStepUpToken?: string, // 지정 처방의 폰 승인 토큰
  ) {
    const { blockchainSignature, prescriberId, orderSource, readBackConfirmed, ...prescriptionDto } = dto;
    const result = await this.prescriptionService.create(
      encounterId,
      prescriptionDto as CreatePrescriptionDto,
      userId,
      blockchainSignature,
      // 지시 경로·복창은 처방 본문이 아니라 맥락이다(승인 토큰 bodyHash 에 섞이지 않게 분리해 넘긴다)
      { prescriberId, prescriberStepUpToken, orderSource, readBackConfirmed },
    );
    return { data: result.prescription, durWarnings: result.durWarnings };
  }

  @Post('encounters/:encounterId/prescriptions/delegate-request')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.LAB_TECH, UserRole.ADMIN)
  @ApiOperation({ summary: '위임 처방: 지정 처방의 폰 승인 요청(서버가 처방 내용으로 bodyHash 바인딩)' })
  async requestPrescriberDelegate(
    @Param('encounterId', ParseUUIDPipe) encounterId: string,
    @Body() body: PrescriberDelegateRequestDto,
    @CurrentUser('id') userId: string,
  ) {
    const { prescriberId, ...rx } = body;
    return { data: await this.prescriptionService.requestPrescriberDelegate(encounterId, userId, prescriberId, rx) };
  }

  // ── 퇴원약 오더화(2026-09-30) ── 퇴원약은 처방 원장에(dischargeMed) — 발행 정본을 그대로 지난다
  @Get('admissions/:admissionId/discharge-prescriptions')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.PHARMACIST, UserRole.ADMIN)
  @ApiOperation({ summary: '입원의 퇴원약 처방 목록 + 옮겨 올 수 있는 입원 중 활성 약' })
  async listDischargePrescriptions(@Param('admissionId', ParseUUIDPipe) admissionId: string) {
    return { data: await this.prescriptionService.listDischargePrescriptions(admissionId) };
  }

  @Post('admissions/:admissionId/discharge-prescriptions')
  // 퇴원약은 의사의 결정이다 — 대리입력(간호사) 경로를 열지 않는다
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @UseGuards(GatedStepUpGuard)
  @RequireStepUp('PRESCRIPTION_CREATE')
  @ApiOperation({ summary: '퇴원약 처방 — DUR(입원 중 약 제외)·처방집·사전승인·약국 오더 · 일수·총량 필수' })
  async createDischargePrescription(
    @Param('admissionId', ParseUUIDPipe) admissionId: string,
    @Body() dto: CreatePrescriptionDto,
    @CurrentUser('id') userId: string,
  ) {
    const result = await this.prescriptionService.createDischargePrescription(admissionId, dto, userId);
    return { data: result.prescription, durWarnings: result.durWarnings };
  }

  @Get('patients/:patientId/order-encounter')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.LAB_TECH, UserRole.ADMIN)
  @ApiOperation({ summary: '오더를 붙일 진행 중 진료(재원 입원 → 오늘 진료) — 비의사는 새 진료를 열지 않는다' })
  async orderEncounter(@Param('patientId', ParseUUIDPipe) patientId: string) {
    return { data: await this.prescriptionService.findOrderEncounter(patientId) };
  }

  @Get('prescriptions/entry-scope/me')
  // 자기 자신의 입력 범위만 돌려준다(다른 사람 조회 없음) — 오더 화면을 여는 모든 직원이 부를 수 있다
  @Roles(...(EVERY_STAFF_ROLE as unknown as UserRole[]))
  @ApiOperation({ summary: '내 오더 입력 범위 — 직종·유형별 본인 권한/의사 승인/불가(정본 shared order-entry-scope)' })
  async myEntryScope(@CurrentUser('id') userId: string) {
    return { data: await this.prescriptionService.getEntryScope(userId) };
  }

  @Get('encounters/:encounterId/authorized-prescribers')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.LAB_TECH, UserRole.ADMIN)
  @ApiOperation({ summary: '처방의로 지정 가능한 사용자 목록 + 진료과 가이드라인(처방 작성 화면)' })
  async authorizedPrescribers(
    @Param('encounterId', ParseUUIDPipe) encounterId: string,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.prescriptionService.getAuthorizedPrescribers(encounterId, userId) };
  }

  @Get('admissions/:admissionId/designated-doctors')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '입원별 추가 지정의(담당 의료군) 목록' })
  async listDesignatedDoctors(@Param('admissionId', ParseUUIDPipe) admissionId: string) {
    return { data: await this.prescriptionService.listDesignatedDoctors(admissionId) };
  }

  @Post('admissions/:admissionId/designated-doctors')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '특수환자 지정의 배치(담당 의료군 추가) — 감사 기록' })
  async addDesignatedDoctor(
    @Param('admissionId', ParseUUIDPipe) admissionId: string,
    @Body() body: AddDesignatedDoctorDto,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.prescriptionService.addDesignatedDoctor(admissionId, body.doctorId, body.reason, userId) };
  }

  @Delete('admissions/:admissionId/designated-doctors/:doctorId')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '지정의 배치 해제(담당 의료군 제거) — 감사 기록' })
  async removeDesignatedDoctor(
    @Param('admissionId', ParseUUIDPipe) admissionId: string,
    @Param('doctorId', ParseUUIDPipe) doctorId: string,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.prescriptionService.removeDesignatedDoctor(admissionId, doctorId, userId) };
  }

  @Get('prescriptions/prescriber-rules')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '처방의 지정 규칙 조회(관리자)' })
  async getPrescriberRules() {
    return { data: await this.prescriptionService.getPrescriberRules() };
  }

  @Put('prescriptions/prescriber-rules')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '처방의 지정 규칙 저장(관리자)' })
  async setPrescriberRules(
    @Body() body: PrescriberRulesDto,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.prescriptionService.setPrescriberRules(body, userId) };
  }

  @Get('encounters/:encounterId/prescriptions')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.PHARMACIST)
  @ApiOperation({ summary: '처방 목록' })
  async findByEncounter(@Param('encounterId', ParseUUIDPipe) encounterId: string) {
    const prescriptions = await this.prescriptionService.findByEncounter(encounterId);
    return { data: prescriptions };
  }

  // 🔴 (2026-09-30) 발효된 처방(투약 기록·시작된 오더)은 취소하지 않는다 — 409 PRESCRIPTION_TOOK_EFFECT, 중단으로
  @Delete('prescriptions/:id')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '처방 취소(무효 — 발효 전만) (책임 처방의·담당 의료군만 — 규칙 활성 시)' })
  async cancel(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('id') userId: string) {
    const prescription = await this.prescriptionService.cancel(id, userId);
    return { data: prescription };
  }

  // ── 지속 처방 갱신·만료(2026-09-30) ──
  @Get('prescriptions/renewals/due')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '갱신 대기 — 내 입원 환자의 곧 만료·만료됨·기간 없는 활성 약 처방(자동으로 끊지 않는다)' })
  async renewalsDue(@CurrentUser('id') userId: string) {
    return { data: await this.prescriptionService.renewalsDue(userId) };
  }

  @Post('prescriptions/:id/renew')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '처방 갱신 — 새 처방으로 잇고 원처방은 같은 순간 중단(일수·총량 필수 · 발행 게이트 경유)' })
  async renew(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RenewPrescriptionDto, @CurrentUser('id') userId: string) {
    return { data: await this.prescriptionService.renew(id, userId, dto) };
  }

  @Post('prescriptions/:id/discontinue')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '처방 중단(지금 이후 멈춤 · 이미 조제·투약된 사실은 유효 · 사유 필수)' })
  async discontinue(@Param('id', ParseUUIDPipe) id: string, @Body() dto: DiscontinuePrescriptionDto, @CurrentUser('id') userId: string) {
    return { data: await this.prescriptionService.discontinue(id, userId, dto.reason ?? '') };
  }

  @Patch('prescriptions/:id/dur-override')
  @Roles(UserRole.DOCTOR, UserRole.PHARMACIST, UserRole.ADMIN)
  @ApiOperation({ summary: 'DUR 경고 무시(오버라이드) — 사유·비고 감사기록' })
  async durOverride(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: DurOverrideDto,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.prescriptionService.overrideDur(id, body, userId) };
  }

  @Post('encounters/:encounterId/prescriptions/copy')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '이전 처방 복사' })
  async copy(
    @Param('encounterId', ParseUUIDPipe) encounterId: string,
    @Body() body: CopyFromEncounterDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.prescriptionService.copyFromEncounter(encounterId, body.sourceEncounterId, userId, body.prescriptionIds, { overrideDur: body.overrideDur, overrideReason: body.overrideReason });
  }

  @Post('prescriptions/copy')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '처방 복사 (Encounter 간, 타입 필터)' })
  async copyPrescriptions(
    @Body() body: CopyPrescriptionsDto,
    @CurrentUser('id') userId: string,
  ) {
    const result = await this.prescriptionService.copyPrescriptions(
      body.sourceEncounterId,
      body.targetEncounterId,
      userId,
      body.types,
      { overrideDur: body.overrideDur, overrideReason: body.overrideReason },
    );
    return { data: result };
  }

  @Post('prescriptions/:id/repeat')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '개별 처방 반복 (동일 Encounter에 복제)' })
  async repeatPrescription(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') userId: string,
    @Body() body?: RepeatPrescriptionDto,
  ) {
    const result = await this.prescriptionService.repeatPrescription(id, userId, { overrideDur: body?.overrideDur, overrideReason: body?.overrideReason });
    return { data: result };
  }

  @Get('prescriptions/patient/:patientId')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE, UserRole.PHARMACIST)
  @ApiOperation({ summary: '환자별 처방 목록 (?status=ACTIVE|CANCELLED · ?limit=)' })
  async findByPatient(
    @Param('patientId', ParseUUIDPipe) patientId: string,
    // 🔴 종전엔 이 두 쿼리를 **받지도 않았다**. `OverviewTab` 이 `?status=ACTIVE&limit=20` 으로
    //    부르는데 서버는 전건을 돌려줬고, 취소된 처방까지 "현재 복용 중" 카드와 자동 DUR
    //    입력에 들어갔다. 필터를 흉내내면 화면은 걸러진 줄 안다.
    @Query('status') status?: string,
    @Query('limit') limit?: string,
  ) {
    const n = limit == null || limit === '' ? undefined : Number(limit);
    if (n !== undefined && (!Number.isInteger(n) || n < 1 || n > 500)) {
      throw new BadRequestException('limit 은 1~500 사이 정수여야 합니다');
    }
    const prescriptions = await this.prescriptionService.findByPatient(patientId, { status, limit: n });
    return { data: prescriptions };
  }

  @Get('prescriptions/patient/:patientId/active')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE, UserRole.PHARMACIST)
  @ApiOperation({ summary: '환자별 활성 처방 목록' })
  async findActiveByPatient(@Param('patientId', ParseUUIDPipe) patientId: string) {
    const prescriptions = await this.prescriptionService.findActiveByPatient(patientId);
    return { data: prescriptions };
  }

  @Post('dur/check')
  // 🔴 종전 DOCTOR 전용 — 처방 입력은 DOCTOR·NURSE·LAB_TECH·ADMIN 에 열려 있는데 약 선택 즉시 DUR(읽기 전용 점검)만
  //    의사에게 묶여 관리자·간호사(대리 입력)·치료사는 늘 403 → 실시간 DUR 이 한 번도 돌지 않았다(2026-09-30).
  //    처방 생성과 같은 역할로 연다(점검은 쓰기 없음 · 생성 시 서버 DUR 은 그대로).
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.LAB_TECH, UserRole.ADMIN)
  @ApiOperation({ summary: 'DUR 수동 점검 (처방 전 미리보기)' })
  async checkDur(
    @Query('encounterId', ParseUUIDPipe) encounterId: string,
    @Query('medicationCodeId', ParseUUIDPipe) medicationCodeId: string,
  ) {
    const result = await this.prescriptionService.checkDur(encounterId, medicationCodeId);
    return { data: result };
  }
}
