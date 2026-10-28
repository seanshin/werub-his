import { Controller, Get, Post, Patch, Param, Body, Query, UseGuards, ParseUUIDPipe, ParseIntPipe, Headers } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiHeader } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { shiftHandoffTypeFor } from '@hospital-run/shared';
import { InpatientService } from './inpatient.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import {
  CreateRoundDto, CreateHandoffDto,
  AdmitPatientDto, DischargePatientDto, TransferPatientDto,
  AddProgressNoteDto, ChangeAttendingDto, PayInterimBillingDto, VoidInterimBillingDto, RefundInterimBillingDto,
} from './dto/inpatient.dto';
import { CancelAdmissionDto, SetExpectedDischargeDto, SetHandoffActionStatusDto } from './dto/inpatient.dto';
import { assertKnownQueryKeys } from '../../common/known-query-keys';

/** `GET handoffs` 가 받는 필터 키 — 여기에 없는 키는 400(조용히 버리지 않는다) */
export const HANDOFF_LIST_QUERY_KEYS = ['limit', 'admissionId', 'doctorId'] as const;

@ApiTags('Inpatient')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
@Controller('api/v1')
export class InpatientController {
  constructor(private readonly service: InpatientService) {}

  // ── 기본 입원 ──

  /**
   * 🔴 (2026-09-16 I3 실로그인 프로브) 클래스 게이트(ADMIN·DOCTOR·NURSE)만 있어 **급양(NUTRITION)이 403** 이었다.
   *    nav 는 `/nutrition`(급식)을 ADMIN·NURSE·NUTRITION 에게 열고, 그 화면의 '식이처방' 탭이 이 목록으로
   *    재원 환자를 붙인다 — 화면은 실패를 접지 않는다고 선언까지 해뒀는데(`"접으면 '재원 환자가 없다'로 보인다"`)
   *    정작 급양 계정에는 그 탭이 통째로 오류였다. nav 만 여는 것은 dead-menu 다.
   *    응답은 환자 식별·병상·담당의·**식이 유형**까지다(진단·기록 없음) — 식이처방 업무 범위와 같다.
   */
  @Get('inpatient')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE, UserRole.NUTRITION)
  @ApiOperation({ summary: '현재 입원 환자 목록' })
  async list() { return { data: await this.service.getCurrentAdmissions() }; }

  @Post('inpatient/admit')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '입원 처리' })
  async admit(@Body() dto: AdmitPatientDto, @CurrentUser('id') userId: string) {
    return { data: await this.service.admit({ ...dto, doctorId: dto.doctorId ?? userId }) };
  }

  @Get('inpatient/patient/:patientId')
  @ApiOperation({ summary: '환자별 입원 이력' })
  async findByPatient(@Param('patientId', ParseUUIDPipe) patientId: string) {
    return { data: await this.service.findByPatient(patientId) };
  }

  @Get('inpatient/:id')
  @ApiOperation({ summary: '입원 상세' })
  async detail(@Param('id', ParseUUIDPipe) id: string) { return { data: await this.service.getAdmission(id) }; }

  @Patch('inpatient/:id/discharge')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '퇴원' })
  async discharge(@Param('id', ParseUUIDPipe) id: string, @Body() dto: DischargePatientDto) {
    return { data: await this.service.discharge(id, dto.summary, dto.disposition) };
  }

  @Patch('inpatient/:id/cancel')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '입원 취소 (병상 반납·팀 종료)' })
  async cancelAdmission(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelAdmissionDto) {
    return { data: await this.service.cancelAdmission(id, dto?.reason ?? '입원 취소') };
  }

  @Patch('inpatient/:id/expected-discharge')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '퇴원 예정일 설정/해제' })
  async setExpectedDischarge(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetExpectedDischargeDto) {
    return { data: await this.service.setExpectedDischarge(id, dto?.date ?? null) };
  }

  @Patch('inpatient/:id/transfer')
  @Roles(UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '병상 이동' })
  async transfer(@Param('id', ParseUUIDPipe) id: string, @Body() dto: TransferPatientDto) {
    return { data: await this.service.transfer(id, dto.newBedId, dto.reason) };
  }

  @Post('inpatient/:id/progress-note')
  @Roles(UserRole.DOCTOR)
  @ApiOperation({ summary: '경과기록 작성' })
  async addNote(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AddProgressNoteDto, @CurrentUser('id') doctorId: string) {
    return { data: await this.service.addProgressNote(id, doctorId, dto) };
  }

  // ── 주치의 관리 ──

  @Get('inpatient/:id/attending')
  @ApiOperation({ summary: '현재 주치의 조회' })
  async getAttending(@Param('id', ParseUUIDPipe) id: string) { return { data: await this.service.getAttending(id) }; }

  @Patch('inpatient/:id/attending')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '주치의 변경' })
  async changeAttending(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ChangeAttendingDto, @CurrentUser('id') userId: string) {
    return { data: await this.service.changeAttending(id, dto, userId) };
  }

  @Get('inpatient/:id/care-team')
  @ApiOperation({ summary: '진료팀 이력' })
  async getCareTeam(@Param('id', ParseUUIDPipe) id: string) { return { data: await this.service.getCareTeam(id) }; }

  // ── 회진 ──

  @Post('inpatient/:id/rounds')
  @Roles(UserRole.DOCTOR)
  @ApiOperation({ summary: '회진 기록 추가' })
  async addRound(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateRoundDto, @CurrentUser('id') doctorId: string) {
    return this.service.addRound(id, doctorId, dto);
  }

  @Get('inpatient/:id/rounds')
  @ApiOperation({ summary: '회진 이력' })
  async getRounds(@Param('id', ParseUUIDPipe) id: string) { return { data: await this.service.getRounds(id) }; }

  @Get('rounds/today')
  @ApiOperation({ summary: '오늘 회진 대상' })
  async getTodayRounds() { return { data: await this.service.getTodayRounds() }; }

  // ── 병상 이력 ──

  @Get('inpatient/:id/bed-history')
  @ApiOperation({ summary: '병상 이동 이력' })
  async getBedHistory(@Param('id', ParseUUIDPipe) id: string) { return { data: await this.service.getBedHistory(id) }; }

  // ── 인수인계 ──

  @Post('handoffs')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '인수인계 생성 — 인계자는 로그인 사용자(본문 fromDoctorId 는 무시)' })
  async createHandoff(@Body() dto: CreateHandoffDto, @CurrentUser('id') userId: string, @CurrentUser('role') role: string) {
    // 🔴 교대 인계 종류는 보낸 사람 직종으로 서버가 정한다(2026-10-26 — 화면이 고르면 같은 간호 교대에 두 단어가 생겼다)
    const type = dto.type === 'SHIFT_CHANGE' || dto.type === 'NURSING_SHIFT' ? shiftHandoffTypeFor(role) : dto.type;
    return this.service.createHandoff({ ...dto, type, fromDoctorId: userId });
  }

  @Get('handoffs')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  /**
   * 🔴 입원 상세의 인수인계 섹션은 **그 입원의** 목록을 원하는데 필터가 없었다.
   *    화면은 없는 `/inpatient/:id/handoffs` 를 불러 **개통 이래 404** 였다(운영 실측).
   *    생성(`POST handoffs`)은 이미 `admissionId` 를 받고 모델에도 있다 — 조회만 없었다.
   */
  /**
   * 🔴 (2026-09-30) 주치의 워크스테이션이 `doctorId` 를 보냈는데 서버가 받지 않아 **전 병원 최근 인계**를
   *    "내 인수인계"로 그렸다. `doctorId` = 그 의사가 인계자(from) **또는** 인수자(to)인 건.
   *    모르는 필터는 400(`assertKnownQueryKeys`) — 조용히 버리면 같은 일이 또 생긴다.
   */
  @ApiOperation({ summary: '최근 인수인계 목록 (admissionId 로 그 입원 건만 · doctorId 로 그 의사가 주거나 받은 건만)' })
  async getRecentHandoffs(
    @Query('limit') limit?: string,
    @Query('admissionId') admissionId?: string,
    @Query('doctorId', new ParseUUIDPipe({ optional: true })) doctorId?: string,
    @Query() rawQuery?: Record<string, unknown>,
  ) {
    assertKnownQueryKeys(rawQuery, HANDOFF_LIST_QUERY_KEYS);
    return { data: await this.service.getRecentHandoffs(Number(limit) || 10, admissionId, doctorId) };
  }

  @Get('handoffs/pending')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '미확인 인수인계' })
  async getPendingHandoffs(@CurrentUser('id') userId: string) { return { data: await this.service.getPendingHandoffs(userId) }; }

  @Get('handoffs/next-shift-nurses')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '다음 교대 근무 간호사 — 근무표(DutyEntry) 기반 인수자 제안(없으면 빈 배열·fail-open)' })
  async getNextShiftNurses() { return { data: await this.service.getNextShiftNurses() }; }

  @Get('handoffs/patient/:patientId')
  @ApiOperation({ summary: '환자별 인수인계 이력' })
  async getHandoffs(@Param('patientId', ParseUUIDPipe) patientId: string) { return { data: await this.service.getHandoffs(patientId) }; }

  @Patch('handoffs/:id/acknowledge')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '인수인계 인수 확인 — 지정 인수자 본인만(ADMIN 예외)' })
  async acknowledgeHandoff(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: string,
  ) { return { data: await this.service.acknowledgeHandoff(id, userId, role) }; }

  /**
   * 인계 조치 항목 완료/되돌림 — 🔴 종전엔 조치 목록이 읽기 전용이라 "남은 조치"가 끝내 줄지 않았다.
   * 인계 당사자(인계자·인수자)만 · 관리자 예외 · 누가·언제를 그 항목에 남긴다.
   */
  @Patch('handoffs/:id/actions/:index')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '인계 조치 항목 완료/되돌림 — 인계 당사자만(ADMIN 예외) · 완료자·시각 기록' })
  async setHandoffActionStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('index', ParseIntPipe) index: number,
    @Body() dto: SetHandoffActionStatusDto,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: string,
  ) { return { data: await this.service.setHandoffActionStatus(id, index, dto, userId, role) }; }

  // ── 중간 정산 ──

  @Get('inpatient/:id/interim-billings')
  @ApiOperation({ summary: '중간 정산 목록 조회' })
  async getInterimBillings(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.getInterimBillings(id);
  }

  @Post('inpatient/:id/interim-billings/generate')
  // 2026-10-22 원무(RECEPTIONIST) 추가 — 중간정산은 원무 일인데 만들 수 없었다(수납만 됐다)
  @Roles(UserRole.DOCTOR, UserRole.ADMIN, UserRole.NURSE, UserRole.RECEPTIONIST)
  @ApiOperation({ summary: '중간 정산 생성 — 퇴원 입원료 청구와 같은 산식 · 재원 중만 · 새 기간 없으면 409' })
  async generateInterimBilling(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('id') userId: string) {
    return this.service.generateInterimBilling(id, userId);
  }

  @Patch('inpatient/:id/interim-billings/:billingId/pay')
  // 🔴 (P3-2) 수납은 원무 일인데 원무(RECEPTIONIST)가 없었다 — 일반 수납(`billings/:id/pay`)과 같은 역할로
  @Roles(UserRole.ADMIN, UserRole.NURSE, UserRole.RECEPTIONIST)
  @ApiOperation({ summary: '중간 정산 수납 처리' })
  async payInterimBilling(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('billingId', ParseUUIDPipe) billingId: string,
    @Body() dto: PayInterimBillingDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.service.payInterimBilling(id, billingId, dto, userId);
  }

  @Patch('inpatient/:id/interim-billings/:billingId/void')
  @Roles(UserRole.ADMIN, UserRole.NURSE, UserRole.RECEPTIONIST)
  @ApiOperation({ summary: '중간 정산 무효 — 수납 전·마지막 회차만 · 사유 필수(지우지 않는다)' })
  async voidInterimBilling(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('billingId', ParseUUIDPipe) billingId: string,
    @Body() dto: VoidInterimBillingDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.service.voidInterimBilling(id, billingId, dto.reason, userId);
  }

  @Post('inpatient/:id/interim-billings/:billingId/refund')
  @Roles(UserRole.ADMIN, UserRole.RECEPTIONIST)
  @ApiHeader({ name: 'Idempotency-Key', required: true, description: '요청 중복 방지 키(화면이 요청마다 하나 · 같은 키 재요청 = 첫 결과)' })
  @ApiOperation({ summary: '중간 정산 환불 — 수납된 회차만 · 부분 환불 · 누적 ≤ 수납액(409) · 사유 필수 · 회차는 PAID 그대로' })
  async refundInterimBilling(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('billingId', ParseUUIDPipe) billingId: string,
    @Body() dto: RefundInterimBillingDto,
    @CurrentUser('id') userId: string,
    @Headers('idempotency-key') idempotencyKey: string,
  ) {
    return this.service.refundInterimBilling(id, billingId, dto, userId, idempotencyKey);
  }

  @Get('inpatient/:id/discharge-settlement')
  @ApiOperation({ summary: '퇴원 정산서 — 입원 전체 진료비 통합·중간정산 차감 잔액' })
  async getDischargeSettlement(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.getDischargeSettlement(id);
  }

  @Post('inpatient/:id/discharge-settlement/export')
  @Roles(UserRole.ADMIN, UserRole.NURSE)
  @ApiOperation({ summary: '퇴원 정산 ERP export(A-6) — 정산 스냅샷 outbox 발행(값-멱등)' })
  async exportDischargeSettlement(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('id') userId: string) {
    return { data: await this.service.exportDischargeSettlement(id, userId) };
  }

  @Post('inpatient/:id/stay-billing')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '입원료 Billing 수동 생성/재시도(입원 EDI 청구 P1) — 병상등급 수가코드 × 재원일수·멱등' })
  async createStayBilling(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.service.createStayBilling(id) };
  }

  @Get('inpatient/:id/discharge-readiness')
  @ApiOperation({ summary: '퇴원 준비 현황 — 요약 서명·정산 잔액·미결 오더·교육/퇴원약/추적 (R3-1)' })
  async getDischargeReadiness(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.service.getDischargeReadiness(id) };
  }

  // ── 입원 바이탈/간호 데이터 ──

  @Get('inpatient/:id/vitals')
  @ApiOperation({ summary: '입원 환자 최근 바이탈 (FlowSheet)' })
  async getVitals(@Param('id', ParseUUIDPipe) id: string) {
    const latest = await this.service.getLatestVitals(id);
    const history = await this.service.getVitals(id);
    return { data: latest, history };
  }

  @Get('inpatient/:id/io')
  @ApiOperation({ summary: '오늘 섭취/배설 기록' })
  async getIO(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.service.getIntakeOutputs(id) };
  }

  @Get('inpatient/:id/nursing-notes')
  @ApiOperation({ summary: '간호 기록 목록' })
  async getNursingNotes(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.service.getNursingNotes(id) };
  }

  @Get('inpatient/:id/nursing-assessments')
  @ApiOperation({ summary: '간호 사정 목록' })
  async getNursingAssessments(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.service.getNursingAssessments(id) };
  }

  @Get('inpatient/:id/mar')
  @ApiOperation({ summary: '투약 기록 (MAR)' })
  async getMAR(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.service.getMedicationAdministrations(id) };
  }

  @Get('inpatient/:id/flowsheet')
  @ApiOperation({ summary: '플로우시트 전체 데이터 (차트용)' })
  async getFlowSheet(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.service.getFlowSheet(id) };
  }

  // ── 입원 일지 ──

  @Get('inpatient/:id/daily-summary')
  @ApiOperation({ summary: '입원 일지 (Daily Summary) 자동 생성' })
  async getDailySummary(@Param('id', ParseUUIDPipe) id: string, @Query('date') date?: string) {
    return { data: await this.service.getDailySummary(id, date) };
  }

  // ── 간호 워크스테이션 ──

  @Get('nurse/vital-unchecked')
  @Roles(UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '오늘 바이탈 미체크 환자 목록' })
  async getVitalUnchecked() {
    return { data: await this.service.getVitalUncheckedPatients() };
  }

  @Get('nurse/upcoming-medications')
  @Roles(UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '오늘 남은 투약 스케줄' })
  async getUpcomingMeds() {
    return { data: await this.service.getUpcomingMedications() };
  }

  // ── 환자 여정 타임라인 ──

  @Get('patients/:patientId/journey')
  @ApiOperation({ summary: '환자 여정 타임라인' })
  async getTimeline(@Param('patientId', ParseUUIDPipe) patientId: string, @Query('from') from?: string, @Query('to') to?: string) {
    return { data: await this.service.getPatientTimeline(patientId, from, to) };
  }
}
