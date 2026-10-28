import { Controller, Get, Post, Put, Patch, Delete, Body, Param, Query, UseGuards, Req, Res, BadRequestException, ForbiddenException, NotFoundException, PayloadTooLargeException, ServiceUnavailableException, BadGatewayException, HttpException, HttpStatus, Headers, Sse, MessageEvent, Optional, UnauthorizedException, ParseUUIDPipe } from '@nestjs/common';
import { DriftRecorderService } from '../../sentinel/drift-recorder.service';
import { PacsProxyService } from '../pacs-proxy/pacs-proxy.service';
import { portalAccountFeatures, type PortalSessionInfo, type PortalSessionKind } from '@hospital-run/shared';
import type { Response as ExpressResponse } from 'express';
import { ApiTags, ApiOperation, ApiHeader, ApiBearerAuth, ApiOkResponse } from '@nestjs/swagger';
import * as PortalSchema from './portal.response-schemas';
import { Throttle } from '@nestjs/throttler';
import { Observable, interval, switchMap, from } from 'rxjs';
import { PortalRequest } from '../../common/interfaces/portal-request.interface';
import { PortalService } from './portal.service';
import { RemoteConsultationService } from '../remote-consultation/remote-consultation.service';
import { RegistrationConsentService } from '../registration-consent/registration-consent.service';
import { PortalOrPatientGuard } from '../patient-auth/guards/portal-or-patient.guard';
import { ErFlowDisplayService } from '../emergency/er-flow-display.service';
import { PacsExportService } from './pacs-export.service';
import { assertPatientOwnsStudies, pacsApiBase } from './pacs-study-ownership';
import { ChronicService } from '../chronic/chronic.service';
import { DrugExplainService } from './drug-explain.service';
import { PortalBookAppointmentDto, PortalWaitlistDto } from '../schedule/dto/portal-book.dto';
import {
  PortalAiAskDto, PortalCheckupQuestionnaireDto, PortalRevokeRegistrationConsentDto, PortalSelfCheckInDto, PortalSignRegistrationConsentDto,
  PortalSubmitQuestionnaireDto, PortalTelehealthBookDto, PortalTelehealthMessageDto, PortalTelehealthRateDto, RecordSmbgDto,
} from './dto/portal-patient-write.dto';
import {
  PortalAuthDto,
  RescheduleAppointmentDto,
  CancelAppointmentDto,
  UpdatePortalProfileDto,
  RequestDocumentDto,
  CreateHealthMemoDto,
  SubmitSatisfactionDto,
  SendPortalMessageDto,
  SignConsentDto,
  MedicationCheckDto,
  PortalDrugInteractionsDto,
  SwitchFamilyDto,
  ReplyMessageDto,
  RequestCertificateDto,
  CreateRemoteConsultDto,
  RemoteConsultMessageDto,
  PayConsultDto,
  CancelConsultDto,
  RateConsultDto,
  VideoEscalationDto,
  RemoteConsentDto,
  GuardianRequestDto,
  BreakTheGlassDto,
  ImagingExportRequestDto,
  CheckupReserveDto,
} from './dto/portal.dto';

@ApiTags('Patient Portal')
@UseGuards(PortalOrPatientGuard)
@Controller('api/v1/portal')
export class PortalController {
  constructor(
    private readonly svc: PortalService,
    private readonly remoteConsult: RemoteConsultationService,
    private readonly regConsentSvc: RegistrationConsentService,
    private readonly pacsExport: PacsExportService,
    private readonly chronic: ChronicService,
    private readonly drugExplain: DrugExplainService,
    private readonly erFlow: ErFlowDisplayService,
    private readonly pacsProxy: PacsProxyService,
    @Optional() private readonly drift?: DriftRecorderService,
  ) {}

  /** 만성질환 추이 — 환자 본인의 ChronicObservation(차트·발급본과 동일 SoT). 만성 맥락만 */
  @Get('chronic-trend')
  @ApiHeader({ name: 'X-Portal-Token', description: '인증 후 발급된 포털 토큰 (patientId)', required: true })
  @ApiOperation({ summary: '만성질환 추이(본인) — 차트와 동일 SoT' })
  async getChronicTrend(@Req() req: PortalRequest, @Query('codes') codes?: string, @Query('from') from?: string) {
    return { data: await this.chronic.getTrend(req.portalPatientId, {
      codes: codes ? codes.split(',').map((c) => c.trim()).filter(Boolean) : undefined,
      from: from ? new Date(from) : undefined,
    }) };
  }

  /** 자가측정(SMBG) 입력 — 환자 본인이 혈압·혈당·체중 기록 → ChronicObservation(source=SMBG) 합류 */
  @Post('chronic-observations')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @ApiHeader({ name: 'X-Portal-Token', description: '인증 후 발급된 포털 토큰 (patientId)', required: true })
  @ApiOperation({ summary: '자가측정(SMBG) 입력 — 혈압·혈당·체중' })
  async recordSmbg(@Req() req: PortalRequest, @Body() body: RecordSmbgDto) {
    const ALLOWED = ['SBP', 'DBP', 'FBS', 'PPG', 'WEIGHT']; // 환자 자가측정 가능 지표(검사실 지표 HbA1c 등 제외)
    if (!ALLOWED.includes(body?.code)) throw new BadRequestException('자가측정 가능한 항목이 아닙니다.');
    const value = Number(body?.value);
    if (!Number.isFinite(value) || value <= 0 || value > 1000) throw new BadRequestException('값이 올바르지 않습니다.');
    return { data: await this.chronic.create(req.portalPatientId, { code: body.code, value, source: 'SMBG', measuredAt: body.measuredAt }) };
  }

  /** 환자 본인 인증 (MRN + 생년월일) → JWT 발급 */
  @Post('auth')
  @Throttle({ default: { limit: 5, ttl: 60000 } }) // 5회/분 제한 (brute-force 방지)
  @ApiOperation({ summary: '환자 본인 인증 → JWT 토큰 발급' })
  async authenticate(@Body() dto: PortalAuthDto, @Req() req: PortalRequest) {
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0] ?? req.ip;
    const ua = req.headers['user-agent'] as string;
    const result = await this.svc.authenticate(dto.mrn, dto.dateOfBirth, ip, ua);
    return { data: result.patient, token: result.token, expiresAt: result.expiresAt };
  }

  /** 로그아웃 (세션 무효화) */
  @Post('auth/logout')
  @ApiOperation({ summary: '포털 로그아웃' })
  async logout(@Req() req: PortalRequest) {
    const token = (req.headers['authorization'] as string)?.replace('Bearer ', '') ?? req.headers['x-portal-token'] as string;
    if (token) await this.svc.logout(token);
    return { data: { success: true } };
  }

  /** 응급 진행 상태(P1·emergency-flow-tv-board) — 본인/가족 스코프라 실명·담당의 표시. 재실 없으면 null */
  @Get('er-status')
  @ApiHeader({ name: 'X-Portal-Token', description: '인증 후 발급된 포털 토큰 (patientId)', required: true })
  @ApiOperation({ summary: '응급실 진행 단계(본인·가족) — 재실/종결 60분 내 방문' })
  async erStatus(@Req() req: PortalRequest) {
    return { data: await this.erFlow.getPatientFlow(req.portalPatientId) };
  }

  /** 예약 목록 — 포털 인증 필요 */
  @Get('appointments')
  @ApiHeader({ name: 'X-Portal-Token', description: '인증 후 발급된 포털 토큰 (patientId)', required: true })
  @ApiOperation({ summary: '예약 목록' })
  async getAppointments(@Req() req: PortalRequest) {
    const patientId = req.portalPatientId;
    return { data: await this.svc.getAppointments(patientId) };
  }

  /** 예약 진료 예상 본인부담(B6 · 예측 자료 — 결정 portal.costEstimate) */
  @Get('appointments/:appointmentId/cost-estimate')
  @ApiHeader({ name: 'X-Portal-Token', description: '인증 후 발급된 포털 토큰 (patientId)', required: true })
  @ApiOperation({ summary: '예약 진료 예상 본인부담(예측 자료)' })
  @ApiOkResponse({ schema: PortalSchema.CostEstimate })
  async getAppointmentCostEstimate(@Req() req: PortalRequest, @Param('appointmentId', ParseUUIDPipe) appointmentId: string) {
    return { data: await this.svc.getAppointmentCostEstimate(req.portalPatientId, appointmentId) };
  }

  /** 예약 진료실까지 길안내(B1 · 접수 전 — 접수 뒤엔 대기표 길안내 id 만) */
  @Get('appointments/:appointmentId/route')
  @ApiHeader({ name: 'X-Portal-Token', description: '인증 후 발급된 포털 토큰 (patientId)', required: true })
  @ApiOperation({ summary: '예약 진료실까지 길안내 — 진료표 기준 예정 진료실 · 접수 창구 · 통제 구역 제외' })
  async getAppointmentRoute(
    @Req() req: PortalRequest,
    @Param('appointmentId', ParseUUIDPipe) appointmentId: string,
    @Query('origin') origin?: string,
    @Query('accessible') accessible?: string,
  ) {
    // 🔴 `from` 은 전역 DateQueryPipe 의 날짜 키 — 출입구 id 는 origin 으로(대기표 길안내와 같은 이유)
    if (origin && !/^[A-Za-z0-9-]{1,40}$/.test(origin)) throw new BadRequestException({ code: 'ENTRANCE_UNKNOWN', message: '출입구를 찾을 수 없습니다.' });
    return { data: await this.svc.getAppointmentRoute(req.portalPatientId, appointmentId, origin || undefined, accessible === 'true' || accessible === '1') };
  }

  /** 셀프예약 가용 슬롯 — 포털 인증 필요 */
  @Get('appointments/availability')
  @ApiHeader({ name: 'X-Portal-Token', description: '인증 후 발급된 포털 토큰 (patientId)', required: true })
  @ApiOperation({ summary: '셀프예약 가용 슬롯' })
  async appointmentAvailability(
    @Query('date') date: string,
    @Query('departmentName') departmentName?: string,
    @Query('doctorId') doctorId?: string,
    @Query('duration') duration?: string,
  ) {
    return this.svc.getAppointmentAvailability({ departmentName, doctorId, date, duration: duration ? Number(duration) : undefined });
  }

  /** 셀프 신규예약 — 포털 인증 필요(본인 patientId 고정·신청 후 병원 확정) */
  @Post('appointments')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiHeader({ name: 'X-Portal-Token', description: '인증 후 발급된 포털 토큰 (patientId)', required: true })
  @ApiOperation({ summary: '셀프 신규예약' })
  async createAppointment(
    @Req() req: PortalRequest,
    @Body() body: PortalBookAppointmentDto,
  ) {
    const result = await this.svc.createAppointment(req.portalPatientId, body);
    return { data: result.appointment, meta: { warnings: result.warnings } };
  }

  /** 셀프 대기자 등록 — 포털 인증 필요(만석 시) */
  @Post('appointments/waitlist')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiHeader({ name: 'X-Portal-Token', description: '인증 후 발급된 포털 토큰 (patientId)', required: true })
  @ApiOperation({ summary: '셀프 대기자 등록' })
  async registerWaitlist(
    @Req() req: PortalRequest,
    @Body() body: PortalWaitlistDto,
  ) {
    return { data: await this.svc.registerAppointmentWaitlist(req.portalPatientId, body) };
  }

  /** 진료 이력 — 포털 인증 필요 */
  @Get('encounters')
  @ApiHeader({ name: 'X-Portal-Token', description: '인증 후 발급된 포털 토큰 (patientId)', required: true })
  @ApiOperation({ summary: '진료 이력' })
  @ApiOkResponse({ schema: PortalSchema.Encounters })
  async getEncounters(@Req() req: PortalRequest) {
    const patientId = req.portalPatientId;
    // 보호자 위임 열람이고 민감정보 동의가 없으면 민감 진료과 제외
    const hideSensitive = !!req.isGuardianAccess && req.guardianScope?.sensitive !== true;
    return { data: await this.svc.getEncounters(patientId, { hideSensitive }) };
  }

  /** 진료 후 요약(B2 · 일반 수준) — 서명된 진료만 · 의사 소견 원문 없음(결정 portal.visitSummaryScope) */
  @Get('encounters/:encounterId/summary')
  @ApiHeader({ name: 'X-Portal-Token', description: '인증 후 발급된 포털 토큰 (patientId)', required: true })
  @ApiOperation({ summary: '진료 후 요약(일반 수준)' })
  @ApiOkResponse({ schema: PortalSchema.VisitSummary })
  async getVisitSummary(@Req() req: PortalRequest, @Param('encounterId', ParseUUIDPipe) encounterId: string) {
    const hideSensitive = !!req.isGuardianAccess && req.guardianScope?.sensitive !== true;
    return { data: await this.svc.getVisitSummary(req.portalPatientId, encounterId, { hideSensitive }) };
  }

  /** 검사 결과 — 포털 인증 필요 */
  @Get('lab-results')
  @ApiHeader({ name: 'X-Portal-Token', description: '인증 후 발급된 포털 토큰 (patientId)', required: true })
  @ApiOperation({ summary: '검사 결과' })
  @ApiOkResponse({ schema: PortalSchema.LabResults })
  async getLabResults(@Req() req: PortalRequest) {
    const patientId = req.portalPatientId;
    return { data: await this.svc.getLabResults(patientId) };
  }

  /** 기초검사 결과 — 포털 인증 필요 */
  @Get('diagnostic-tests')
  @ApiHeader({ name: 'X-Portal-Token', description: '인증 후 발급된 포털 토큰 (patientId)', required: true })
  @ApiOperation({ summary: '기초검사 결과' })
  async getDiagnosticTests(@Req() req: PortalRequest) {
    const patientId = req.portalPatientId;
    return { data: await this.svc.getDiagnosticTests(patientId) };
  }

  /** 수납 내역 — 포털 인증 필요 */
  @Get('billings')
  @ApiBearerAuth()
  @ApiOperation({ summary: '수납 내역' })
  @ApiOkResponse({ schema: PortalSchema.Billings })
  async getBillings(@Req() req: PortalRequest) {
    const patientId = req.portalPatientId;
    const hideSensitive = !!req.isGuardianAccess && req.guardianScope?.sensitive !== true;
    return { data: await this.svc.getBillings(patientId, { hideSensitive }) };
  }

  // ── Phase 1 추가 엔드포인트 ──

  @Put('appointments/:id/reschedule')
  @ApiBearerAuth()
  @ApiOperation({ summary: '예약 변경 (셀프)' })
  async rescheduleAppointment(@Param('id') id: string, @Body() dto: RescheduleAppointmentDto, @Req() req: PortalRequest) {
    const patientId = req.portalPatientId;
    return { data: await this.svc.rescheduleAppointment(patientId, id, dto.scheduledAt) };
  }

  @Put('appointments/:id/cancel')
  @ApiBearerAuth()
  @ApiOperation({ summary: '예약 취소 (셀프)' })
  async cancelAppointment(@Param('id') id: string, @Body() dto: CancelAppointmentDto, @Req() req: PortalRequest) {
    const patientId = req.portalPatientId;
    return { data: await this.svc.cancelAppointment(patientId, id, dto.reason) };
  }

  // ── 세션 능력표(2026-10-19 포털 세련화 A1) ──
  // 🔴 화면이 계정 전용 기능을 불러 보고 실패로 알던 것을 끝낸다 — 이 세션의 종류·계정 전용 기능 가능 여부·만료 시각.
  //    정본 shared `portal-session.ts` · 서버 가드와 기계 대조(test/portal/portal-session-capabilities.spec.ts).
  @Get('session')
  @ApiBearerAuth()
  @ApiOperation({ summary: '포털 세션 능력표 — 종류(ACCOUNT·MRN·GUARDIAN)·계정 전용 기능·만료 시각' })
  async getSession(@Req() req: PortalRequest): Promise<{ data: PortalSessionInfo }> {
    const kind: PortalSessionKind = req.isGuardianAccess ? 'GUARDIAN' : req.patientAccountId ? 'ACCOUNT' : 'MRN';
    const viewerAccountId = req.patientAccountId ?? req.guardianAccountId ?? null;
    const [inpatientLife, onboarding] = await Promise.all([
      this.svc.isInpatientLifeEnabled(),
      this.svc.getOnboardingState(viewerAccountId),
    ]);
    return { data: { kind, features: portalAccountFeatures(kind), expiresAt: tokenExpiresAt(req.headers['authorization']), services: { inpatientLife }, onboarding } };
  }

  /**
   * 포털 첫 안내를 마쳤다 — 계정 단위 기록(2026-10-20). 보는 사람의 계정(본인 또는 보호자)에 처음 한 번만 남긴다(멱등).
   * 계정이 없는 등록번호 세션은 남길 곳이 없다 → `{ recorded: false, scope: 'DEVICE' }`(화면이 기기에만 남긴다 · 오류 아님).
   */
  @Post('onboarding/complete')
  @ApiBearerAuth()
  @ApiOperation({ summary: '포털 첫 안내 완료 기록(계정 단위)' })
  async completeOnboarding(@Req() req: PortalRequest) {
    return { data: await this.svc.completeOnboarding(req.patientAccountId ?? req.guardianAccountId ?? null) };
  }

  @Get('waiting-status')
  @ApiBearerAuth()
  @ApiOperation({ summary: '대기 현황 (내 순번)' })
  async getWaitingStatus(@Req() req: PortalRequest) {
    const patientId = req.portalPatientId;
    return { data: await this.svc.getWaitingStatus(patientId) };
  }

  // ── R10: 셀프 체크인 ──
  @Get('clinic-schedule')
  @ApiBearerAuth()
  @ApiOperation({ summary: '셀프 체크인 — 오늘 진료 의사 목록' })
  async getClinicSchedule(@Query('department') department: string | undefined) {
    return { data: await this.svc.getClinicScheduleToday(department) };
  }

  @Post('check-in')
  @ApiBearerAuth()
  @ApiOperation({ summary: '셀프 체크인 (본인 접수)' })
  async selfCheckIn(@Req() req: PortalRequest, @Body() body: PortalSelfCheckInDto) {
    return { data: await this.svc.selfCheckIn(req.portalPatientId, body) };
  }

  @Get('profile')
  @ApiBearerAuth()
  @ApiOperation({ summary: '내 정보 조회' })
  async getProfile(@Req() req: PortalRequest) {
    const patientId = req.portalPatientId;
    return { data: await this.svc.getProfile(patientId) };
  }

  @Put('profile')
  @ApiBearerAuth()
  @ApiOperation({ summary: '내 정보 변경 (연락처/주소)' })
  async updateProfile(@Body() dto: UpdatePortalProfileDto, @Req() req: PortalRequest) {
    const patientId = req.portalPatientId;
    return { data: await this.svc.updateProfile(patientId, dto) };
  }

  @Get('lab-trends')
  @ApiBearerAuth()
  @ApiOperation({ summary: '검사 결과 추이 (트렌드)' })
  async getLabTrends(@Req() req: PortalRequest, @Query('tests') tests?: string) {
    const patientId = req.portalPatientId;
    const testNames = tests ? tests.split(',').map(t => t.trim()) : undefined;
    return { data: await this.svc.getLabTrends(patientId, testNames) };
  }

  @Get('billings/:id/receipt')
  @ApiBearerAuth()
  @ApiOperation({ summary: '영수증 데이터' })
  async getReceipt(@Param('id') id: string, @Req() req: PortalRequest) {
    const patientId = req.portalPatientId;
    return { data: await this.svc.getReceipt(patientId, id) };
  }

  @Get('medical-expenses')
  @ApiBearerAuth()
  @ApiOperation({ summary: '연말정산 의료비 내역' })
  async getMedicalExpenses(@Req() req: PortalRequest, @Query('year') year?: string) {
    const patientId = req.portalPatientId;
    const y = year ? parseInt(year) : new Date().getFullYear();
    return { data: await this.svc.getMedicalExpenses(patientId, y) };
  }

  @Get('medications')
  @ApiBearerAuth()
  @ApiOperation({ summary: '현재 복용약 목록' })
  @ApiOkResponse({ schema: PortalSchema.Medications })
  async getCurrentMedications(@Req() req: PortalRequest) {
    const patientId = req.portalPatientId;
    return { data: await this.svc.getCurrentMedications(patientId) };
  }

  // ── F-7 처방·투약 AI 쉬운 설명 (config portal.aiDrugExplain — OFF면 404·FE 조용한 폴백) ──
  // ⚠️ Nest 라우트: 리터럴('explain-jobs')이 ':id'류 파라미터 라우트보다 위 선언(리터럴 선점 규칙)

  @Get('medications/explain-jobs/:jobId')
  @ApiBearerAuth()
  @ApiOperation({ summary: '약 설명 잡 폴링 — 잡은 세션 환자에 바인딩(타 환자 404)' })
  async getMedicationExplainJob(@Param('jobId') jobId: string, @Req() req: PortalRequest) {
    return { data: this.drugExplain.getJob(req.portalPatientId, jobId) };
  }

  @Get('medications/explain-by-name')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiBearerAuth()
  @ApiOperation({ summary: '퇴원약(명칭 진입) 쉬운 설명 — 본인 퇴원요약 내 명칭 + 마스터 정확일치 단일만' })
  async explainMedicationByName(@Query('name') name: string, @Req() req: PortalRequest) {
    return { data: await this.drugExplain.explainByName(req.portalPatientId, name) };
  }

  @Get('medications/:prescriptionId/explain')
  @ApiBearerAuth()
  @ApiOperation({ summary: '약 단위 쉬운 설명 — UNAVAILABLE | READY(캐시·LLM 0회) | PENDING+jobId' })
  async explainMedication(@Param('prescriptionId') prescriptionId: string, @Req() req: PortalRequest) {
    return { data: await this.drugExplain.explainForPrescription(req.portalPatientId, prescriptionId) };
  }

  @Get('prescriptions/explain-jobs/:jobId')
  @ApiBearerAuth()
  @ApiOperation({ summary: '처방전 한눈에 잡 폴링 — 잡은 세션 환자에 바인딩(타 환자 404)' })
  async getPrescriptionExplainJob(@Param('jobId') jobId: string, @Req() req: PortalRequest) {
    return { data: this.drugExplain.getJob(req.portalPatientId, jobId) };
  }

  @Post('prescriptions/:encounterId/explain')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiBearerAuth()
  @ApiOperation({ summary: '이번 처방 한눈에(encounter 단위) — 항상 비동기 잡(nginx 60s 회피)' })
  async explainEncounterPrescriptions(@Param('encounterId') encounterId: string, @Req() req: PortalRequest) {
    return { data: await this.drugExplain.startEncounterExplain(req.portalPatientId, encounterId) };
  }

  /** P2 배선 교정 — 기존 FE PortalAiDrugInteractions가 직원 전용 /api/v1/ai/drug-interactions 호출로 포털에서 항상 401이던 것을 포털 프록시로 교정 */
  @Post('ai/drug-interactions')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiBearerAuth()
  @ApiOperation({ summary: '약물 상호작용 확인(포털 프록시 — WeRU.B)' })
  async portalDrugInteractions(@Body() dto: PortalDrugInteractionsDto) {
    return { data: await this.drugExplain.drugInteractions(dto.drugs) };
  }

  @Get('notices')
  @ApiBearerAuth()
  @ApiOperation({ summary: '병원 공지사항' })
  @ApiOkResponse({ schema: PortalSchema.Notices })
  async getNotices() {
    return { data: await this.svc.getNotices() };
  }

  // ── 서류 발급 신청 ──

  @Post('documents/request')
  @ApiBearerAuth()
  @ApiOperation({ summary: '서류 발급 신청' })
  async requestDocument(@Body() dto: RequestDocumentDto, @Req() req: PortalRequest) {
    const patientId = req.portalPatientId;
    return { data: await this.svc.requestDocument(patientId, dto) };
  }

  @Get('documents/requests')
  @ApiBearerAuth()
  @ApiOperation({ summary: '서류 신청 내역' })
  async getDocumentRequests(@Req() req: PortalRequest) {
    const patientId = req.portalPatientId;
    return { data: await this.svc.getDocumentRequests(patientId) };
  }

  @Get('documents/requests/:id')
  @ApiBearerAuth()
  @ApiOperation({ summary: '서류 신청 상세' })
  async getDocumentRequest(@Param('id') id: string, @Req() req: PortalRequest) {
    const patientId = req.portalPatientId;
    return { data: await this.svc.getDocumentRequest(patientId, id) };
  }

  // ── Phase 3: 예방접종 ──

  @Get('vaccinations')
  @ApiBearerAuth()
  @ApiOperation({ summary: '예방접종 이력' })
  @ApiOkResponse({ schema: PortalSchema.Vaccinations })
  async getVaccinations(@Req() req: PortalRequest) {
    const patientId = req.portalPatientId;
    return { data: await this.svc.getVaccinations(patientId) };
  }

  // ── Phase 3: 건강 메모 ──

  @Get('health-memos')
  @ApiBearerAuth()
  @ApiOperation({ summary: '건강 메모 목록' })
  async getHealthMemos(@Req() req: PortalRequest) {
    const patientId = req.portalPatientId;
    return { data: await this.svc.getHealthMemos(patientId) };
  }

  @Post('health-memos')
  @ApiBearerAuth()
  @ApiOperation({ summary: '건강 메모 작성' })
  async createHealthMemo(@Req() req: PortalRequest, @Body() dto: CreateHealthMemoDto) {
    const patientId = req.portalPatientId;
    return { data: await this.svc.createHealthMemo(patientId, dto) };
  }

  @Delete('health-memos/:id')
  @ApiBearerAuth()
  @ApiOperation({ summary: '건강 메모 삭제' })
  async deleteHealthMemo(@Param('id') id: string, @Req() req: PortalRequest) {
    const patientId = req.portalPatientId;
    await this.svc.deleteHealthMemo(patientId, id);
    return { data: { deleted: true } };
  }

  // ── Phase 3: 만족도 평가 ──

  @Get('satisfaction')
  @ApiBearerAuth()
  @ApiOperation({ summary: '만족도 평가 이력' })
  async getSatisfaction(@Req() req: PortalRequest) {
    const patientId = req.portalPatientId;
    return { data: await this.svc.getSatisfactionSurveys(patientId) };
  }

  @Post('satisfaction')
  @ApiBearerAuth()
  @ApiOperation({ summary: '만족도 평가 제출' })
  async submitSatisfaction(@Req() req: PortalRequest, @Body() dto: SubmitSatisfactionDto) {
    const patientId = req.portalPatientId;
    return { data: await this.svc.submitSatisfaction(patientId, dto) };
  }

  // ── Phase 3: 수술 전 체크리스트 (환자용 조회) ──

  @Get('surgery-checklist')
  @ApiBearerAuth()
  @ApiOperation({ summary: '내 수술 전 체크리스트' })
  async getSurgeryChecklist(@Req() req: PortalRequest) {
    const patientId = req.portalPatientId;
    return { data: await this.svc.getPatientSurgeryChecklists(patientId) };
  }

  // ── Phase 3: 실비보험 청구 안내 ──

  @Get('insurance-guide')
  @ApiBearerAuth()
  @ApiOperation({ summary: '실비보험 청구서류 안내' })
  async getInsuranceGuide() {
    return { data: this.svc.getInsuranceClaimGuide() };
  }

  // ── 담당의 메시지 ──

  @Get('messages')
  @ApiBearerAuth()
  @ApiOperation({ summary: '담당의 메시지 목록' })
  async getMessages(@Req() req: PortalRequest) {
    const patientId = req.portalPatientId;
    return { data: await this.svc.getMessages(patientId) };
  }

  @Post('messages')
  @ApiBearerAuth()
  @ApiOperation({ summary: '담당의에게 메시지 보내기' })
  async sendMessage(@Req() req: PortalRequest, @Body() dto: SendPortalMessageDto) {
    const patientId = req.portalPatientId;
    return { data: await this.svc.sendMessage(patientId, dto.content, dto.doctorId) };
  }

  // ── 판독 알림 (PACS 프록시) ──

  @Get('imaging/notifications')
  @ApiBearerAuth()
  @ApiOperation({ summary: '판독 완료 알림 (PACS 프록시)' })
  async getImagingNotifications(@Req() req: PortalRequest) {
    const patientId = req.portalPatientId;
    const mrn = await this.svc.getPatientMrn(patientId);
    const pacsUrl = process.env.PACS_API_URL || 'http://127.0.0.1:8000';
    // PACS notifications는 doctor용이므로, patient studies에서 completed 필터
    // 🔴 형제 EP(imaging/studies·reports)는 실패를 503 으로 말하는데 **이 한 곳만 빈 배열**이었다
    //    (2026-08-18 회수) — 판독 완료 알림이 조회 실패 때 "새 판독 없음"으로 보였다.
    //    네트워크 장애도 형제와 같게 다룬다(종전엔 catch 가 없어 500 으로 갈렸다).
    const res = await fetch(`${pacsUrl}/api/v1/patients/${encodeURIComponent(mrn)}/studies?limit=50`, {
      headers: await this.pacsProxy.serviceAuthHeaders(),
    }).catch(() => null);
    if (!res || !res.ok) {
      throw new ServiceUnavailableException({
        error: 'PACS_UNAVAILABLE',
        message: '영상 보관 시스템에 연결하지 못했습니다. 새 판독이 없는 것이 아니라 조회에 실패했습니다.',
      });
    }
    const data = await res.json() as any;
    // 🔴 관측점(axis C): 200 인데 studies 배열이 없으면 계약이 어긋난 것 — 화면은 이것을 "새 판독 없음"으로 접는다
    if (!Array.isArray(data?.studies)) {
      this.drift?.record({
        kind: 'KEY_MISSING',
        producer: 'openpacs.patient-studies',
        consumer: 'portal.imagingNotifications',
        detail: `응답에 studies 배열이 없음 · 실제 키: ${Object.keys(data ?? {}).join(', ').slice(0, 300)}`,
      });
    }
    const completed = (data.studies ?? []).filter((s: any) => s.read_status === 'completed' || s.read_status === 'final');
    return {
      data: completed.slice(0, 10).map((s: any) => ({
        studyUid: s.study_instance_uid,
        modality: s.modality,
        description: s.description || s.study_description,
        studyDate: s.study_date,
        impression: s.report_summary || s.findings,
        viewerUrl: s.viewer_url,
      })),
    };
  }

  // ── 온라인 결제 (미수납) ──

  @Get('billings/unpaid')
  @ApiBearerAuth()
  @ApiOperation({ summary: '미수납 목록' })
  async getUnpaidBillings(@Req() req: PortalRequest) {
    const patientId = req.portalPatientId;
    return { data: await this.svc.getUnpaidBillings(patientId) };
  }

  // ── 동의서 (환자 전자 서명) ──

  @Get('consents')
  @ApiBearerAuth()
  @ApiOperation({ summary: '내 동의서 목록' })
  async getConsents(@Req() req: PortalRequest) {
    const patientId = req.portalPatientId;
    return { data: await this.svc.getPatientConsents(patientId) };
  }

  @Put('consents/:id/sign')
  @ApiBearerAuth()
  @ApiOperation({ summary: '동의서 전자 서명' })
  async signConsent(@Param('id') id: string, @Req() req: PortalRequest, @Body() dto: SignConsentDto) {
    const patientId = req.portalPatientId;
    return { data: await this.svc.signConsent(patientId, id, dto.signature) };
  }

  // ── 알레르기/문진표 (patientId 검증 프록시) ──

  @Get('allergies/status')
  @ApiBearerAuth()
  @ApiOperation({ summary: '내 알레르기 문진 상태 (미문진/무알레르기확인/알레르기있음)' })
  async getAllergyStatus(@Req() req: PortalRequest) {
    const patientId = req.portalPatientId;
    return { data: await this.svc.getAllergyStatus(patientId) };
  }

  @Get('allergies')
  @ApiBearerAuth()
  @ApiOperation({ summary: '내 알레르기 목록 (patientId 서버 주입)' })
  @ApiOkResponse({ schema: PortalSchema.Allergies })
  async getAllergies(@Req() req: PortalRequest) {
    const patientId = req.portalPatientId;
    return { data: await this.svc.getAllergies(patientId) };
  }

  @Get('questionnaires')
  @ApiBearerAuth()
  @ApiOperation({ summary: '내 문진표 목록 (patientId 서버 주입)' })
  async getQuestionnaires(@Req() req: PortalRequest) {
    const patientId = req.portalPatientId;
    return { data: await this.svc.getQuestionnaires(patientId) };
  }

  // ── 영상검사 (PACS 프록시) ──

  @Get('imaging/studies')
  @ApiBearerAuth()
  @ApiOperation({ summary: '환자 영상검사 목록 (PACS 프록시)' })
  async getImagingStudies(@Req() req: PortalRequest, @Query('limit') limit?: string) {
    const patientId = req.portalPatientId;
    const mrn = await this.svc.getPatientMrn(patientId);
    const pacsUrl = process.env.PACS_API_URL || 'http://127.0.0.1:8000';
    // 🔴 조회 실패를 "영상 없음"으로 바꿔 말하던 것 — 화면 실사용 점검 W9(2026-08-14).
    //    PACS 가 죽어도 환자에게는 빈 목록이 갔다. 환자는 "내 영상이 없다"고 읽는다(P17).
    //    이 저장소 이력: PACS 프록시가 실패를 삼켜 쓰기가 전부 "성공"이던 사고가 있었다 —
    //    **성공 로그는 증거가 아니다.** 실패는 실패로 알린다.
    const res = await fetch(`${pacsUrl}/api/v1/patients/${encodeURIComponent(mrn)}/studies?limit=${limit || '50'}`, { headers: await this.pacsProxy.serviceAuthHeaders() })
      .catch(() => null);
    if (!res || !res.ok) {
      throw new ServiceUnavailableException({
        error: 'PACS_UNAVAILABLE',
        message: '영상 보관 시스템에 연결하지 못했습니다. 영상이 없는 것이 아니라 조회에 실패했습니다.',
      });
    }
    return { data: await res.json() };
  }

  @Get('imaging/reports')
  @ApiBearerAuth()
  @ApiOperation({ summary: '환자 판독 리포트 목록 (PACS 프록시)' })
  async getImagingReports(@Req() req: PortalRequest) {
    const patientId = req.portalPatientId;
    const mrn = await this.svc.getPatientMrn(patientId);
    const pacsUrl = process.env.PACS_API_URL || 'http://127.0.0.1:8000';
    // 🔴 위와 같은 이유 — 판독문 조회 실패를 "판독문 없음"으로 말하지 않는다(W9).
    const res = await fetch(`${pacsUrl}/api/v1/patients/${encodeURIComponent(mrn)}/reports`, { headers: await this.pacsProxy.serviceAuthHeaders() }).catch(() => null);
    if (!res || !res.ok) {
      throw new ServiceUnavailableException({
        error: 'PACS_UNAVAILABLE',
        message: '영상 보관 시스템에 연결하지 못했습니다. 판독문이 없는 것이 아니라 조회에 실패했습니다.',
      });
    }
    return { data: await res.json() };
  }

  // ── 영상 바이너리·멀티파트 중계 (PACS 직접 호출 이관 · 2026-08-18) ──
  //
  // 🔴 브라우저가 `/pacs-api/*` 를 직접 부르면 HIS 의 JWT·RBAC·감사를 통째로 우회한다.
  //    게다가 <img> 직접 호출은 401/타임아웃을 onError 로 삼켜 "영상 없음"처럼 보인다 —
  //    이 저장소에서 이미 두 번 겪은 결함이다(간호 영상 조회 · PACS 워크리스트).
  //    아래 EP 들이 그 경로를 서버로 끌어온다. **본인 검사 스코프는 서버가 강제**하고,
  //    실패는 실패로 알린다(빈 응답·플레이스홀더로 바꾸지 않는다).

  /** 업로드 상한 — FE 안내(최대 500MB)와 같은 값. 넘으면 413 으로 자른 사실을 말한다. */
  private static readonly MAX_IMAGING_UPLOAD_BYTES = 500 * 1024 * 1024;

  /** PACS 기본 주소 — 서버에서만 부른다(브라우저에 노출하지 않는다). */
  private pacsBase(): string {
    return pacsApiBase();
  }

  /**
   * 🔴 본인 검사 소유 검증 — **fail-closed**.
   *
   * PACS 조회가 실패하면 '남의 것이 아니다'가 아니라 '확인할 수 없다'이므로 통과시키지 않는다.
   * (판독 PDF 에서 조회 실패 시 소유권 확인 없이 임의 studyUID 를 내주던 IDOR 이 있었다.)
   */
  private async assertOwnsStudy(patientId: string, studyUid: string): Promise<void> {
    // 정본 `pacs-study-ownership.ts` — 선택 내보내기와 같은 함수(r1 #15-2 · 소유 확인 정본 하나)
    await assertPatientOwnsStudies({
      mrn: await this.svc.getPatientMrn(patientId),
      studyUids: [studyUid],
      headers: await this.pacsProxy.serviceAuthHeaders(),
      forbiddenMessage: '본인의 검사가 아닙니다.',
    });
  }

  /**
   * 대표 영상 JPEG — 시리즈 → 인스턴스 → 렌더링. 영상 자체가 없으면 404 응답 모양을 돌려준다.
   * 연결 실패·응답 모양이 다르면 null — 호출부가 503("불러오지 못했다")으로 말한다(없음으로 접지 않는다).
   */
  private async fetchRepresentativeJpeg(studyUid: string): Promise<Response | null> {
    const headers = await this.pacsProxy.serviceAuthHeaders();
    const get = (path: string) => fetch(`${this.pacsBase()}${path}`, { headers, signal: AbortSignal.timeout(10000) });
    const notFound = () => new Response(null, { status: 404 });
    const base = `/api/v1/dicomweb/studies/${encodeURIComponent(studyUid)}`;
    try {
      const sr = await get(`${base}/series`);
      if (sr.status === 404) return notFound();
      if (!sr.ok) return sr;
      const series = ((await sr.json()) as { series?: Array<{ series_instance_uid?: string; instance_count?: number }> }).series;
      if (!Array.isArray(series)) return null;
      const first = series.find((x) => x.series_instance_uid && (x.instance_count ?? 1) > 0);
      if (!first) return notFound();
      const ir = await get(`${base}/series/${encodeURIComponent(first.series_instance_uid!)}/instances`);
      if (ir.status === 404) return notFound();
      if (!ir.ok) return ir;
      const inst = ((await ir.json()) as { instances?: Array<{ orthanc_id?: string }> }).instances;
      if (!Array.isArray(inst)) return null;
      const id = inst.find((x) => x.orthanc_id)?.orthanc_id;
      if (!id) return notFound();
      return await get(`/api/v1/export/instance/${encodeURIComponent(id)}/jpeg`);
    } catch {
      return null;
    }
  }

  @Get('imaging/study/:studyUid/thumbnail')
  @ApiBearerAuth()
  @ApiOperation({ summary: '영상 썸네일 (PACS 바이너리 중계) — 본인 검사만' })
  async getImagingThumbnail(
    @Param('studyUid') studyUid: string,
    @Req() req: PortalRequest,
    @Res() res: ExpressResponse,
  ) {
    await this.assertOwnsStudy(req.portalPatientId, studyUid);

    // 🔴 (2026-10-19) 종전엔 OpenPACS `my-patients/study/:uid/thumbnail` 을 불렀는데, 그 EP 는 **이미지가 아니라 URL JSON** 을 주고
    //    "의뢰한 의사"에게만 열린다 — 포털에서는 늘 실패였다(계약 불일치). 대표 영상(첫 시리즈 첫 인스턴스)을 JPEG 로 받는다.
    //    본인 검사인지는 위 assertOwnsStudy 가 이미 확인했다.
    const upstream = await this.fetchRepresentativeJpeg(studyUid);

    // 404 = "썸네일이 없다"(사실) / 그 외 실패 = "불러오지 못했다"(다른 사실) — 둘을 섞지 않는다.
    if (upstream && upstream.status === 404) {
      throw new NotFoundException({ error: 'THUMBNAIL_NOT_FOUND', message: '이 검사에는 썸네일이 없습니다.' });
    }
    if (!upstream || !upstream.ok) {
      throw new ServiceUnavailableException({
        error: 'PACS_UNAVAILABLE',
        message: '영상 보관 시스템에서 썸네일을 불러오지 못했습니다. 영상이 없는 것이 아닙니다.',
      });
    }

    // PACS 가 이미지 아닌 것(오류 페이지·HTML)을 200 으로 주면 그대로 흘리지 않는다(저장형 XSS 경로).
    const contentType = upstream.headers.get('content-type') ?? '';
    if (!contentType.startsWith('image/')) {
      throw new BadGatewayException({
        error: 'PACS_BAD_RESPONSE',
        message: '영상 보관 시스템이 이미지가 아닌 응답을 보냈습니다.',
      });
    }

    const buf = Buffer.from(await upstream.arrayBuffer());
    res.set({
      'Content-Type': contentType,
      'Content-Length': String(buf.length),
      'Cache-Control': 'private, max-age=300',
    });
    res.send(buf);
  }

  @Post('imaging/upload')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiBearerAuth()
  @ApiOperation({ summary: '외부 영상(DICOM) 업로드 — PACS 멀티파트 중계' })
  async uploadImaging(@Req() req: PortalRequest) {
    const contentType = String(req.headers['content-type'] ?? '');
    if (!contentType.startsWith('multipart/form-data')) {
      throw new BadRequestException({
        error: 'INVALID_CONTENT_TYPE',
        message: '영상 업로드는 multipart/form-data 로만 받습니다.',
      });
    }
    const declared = Number(req.headers['content-length'] ?? 0);
    if (Number.isFinite(declared) && declared > PortalController.MAX_IMAGING_UPLOAD_BYTES) {
      throw new PayloadTooLargeException({
        error: 'FILE_TOO_LARGE',
        message: `업로드 용량 상한(${PortalController.MAX_IMAGING_UPLOAD_BYTES / (1024 * 1024)}MB)을 넘었습니다.`,
      });
    }

    // 🔴 대상 환자는 **서버가 정한다** — 종전 화면은 브라우저가 patientId 를 URL 에 넣어 보냈다.
    //    (남의 번호를 적어 보낼 수 있는 자리였고, 실제로는 HIS 의 patientId 를 넣어 PACS 의
    //     MRN 규약과도 어긋나 있었다.)
    const mrn = await this.svc.getPatientMrn(req.portalPatientId);

    // 멀티파트 본문은 재조립하지 않고 그대로 흘린다(경계·필드 보존 + 대용량 메모리 적재 회피).
    const relayInit = {
      method: 'POST',
      headers: { 'content-type': contentType, ...(await this.pacsProxy.serviceAuthHeaders('upload')) },
      body: req,              // Node Readable — undici 가 그대로 흘려보낸다
      duplex: 'half',         // 요청 본문 스트리밍에 필수(Node 18+)
      signal: AbortSignal.timeout(300000),
    } as unknown as RequestInit;
    const upstream = await fetch(`${this.pacsBase()}/api/v1/patients/${encodeURIComponent(mrn)}/upload`, relayInit)
      .catch(() => null);

    if (!upstream) {
      throw new ServiceUnavailableException({
        error: 'PACS_UNAVAILABLE',
        message: '영상 보관 시스템에 연결하지 못했습니다. 업로드는 완료되지 않았습니다.',
      });
    }

    const text = await upstream.text().catch(() => '');
    let body: Record<string, unknown> | null = null;
    try { body = text ? (JSON.parse(text) as Record<string, unknown>) : null; } catch { /* 비 JSON 응답 */ }

    // 🔴 실패를 성공으로 바꾸지 않는다 — 종전 PACS 프록시가 실패를 null 로 삼켜
    //    "등록 성공" 로그를 남기던 사고가 있었다. 성공 로그는 증거가 아니다.
    if (!upstream.ok) {
      throw new HttpException(
        {
          error: 'PACS_UPLOAD_FAILED',
          message: String(body?.detail ?? `영상 업로드에 실패했습니다 (PACS ${upstream.status}).`),
        },
        upstream.status >= 500 ? HttpStatus.BAD_GATEWAY : HttpStatus.BAD_REQUEST,
      );
    }
    return { data: body ?? {} };
  }

  // ── Portal v2: Health Dashboard (Phase 1) ──

  /**
   * 🔴 W9(2026-08-14) 보호자 범위 우회 봉합.
   *
   * 가드의 SECTION_MAP 은 URL 하나 → 영역 하나로만 가를 수 있는데, 이 응답에는
   * 검사(recentLabs)·예약(nextAppointment) 등 **여러 영역이 한꺼번에** 들어 있다.
   * 그래서 `labs:false` 로 위임받은 보호자가 `/portal/lab-results` 에서는 403 을 받고도
   * 여기서는 같은 검사 수치를 그대로 읽어갔다. 응답 조립 후 영역별로 덜어낸다.
   * (본인 세션에는 영향 없음 — isGuardianAccess 일 때만 동작)
   */
  private stripOutOfScope(req: PortalRequest, dash: Record<string, unknown> | null) {
    if (!dash || !req.isGuardianAccess) return dash;
    const scope = req.guardianScope ?? {};
    const out = { ...dash };
    if (scope.labs === false) out.recentLabs = [];
    if (scope.appointments === false) out.nextAppointment = null;
    return out;
  }

  @Get('health-dashboard')
  @ApiBearerAuth()
  @ApiOperation({ summary: '건강 대시보드 (바이탈/처방/문제/예약/알레르기/검사)' })
  async getHealthDashboard(@Req() req: PortalRequest) {
    const patientId = req.portalPatientId;
    return { data: this.stripOutOfScope(req, await this.svc.getHealthDashboard(patientId) as Record<string, unknown>) };
  }

  // ── Portal v2: Medication Schedule + Check (Phase 2) ──

  @Get('medication-schedule')
  @ApiBearerAuth()
  @ApiOperation({ summary: '오늘의 복약 스케줄' })
  async getMedicationSchedule(@Req() req: PortalRequest) {
    const patientId = req.portalPatientId;
    return { data: await this.svc.getMedicationSchedule(patientId) };
  }

  @Post('medication-check')
  @ApiBearerAuth()
  @ApiOperation({ summary: '복약 체크 (복용 완료 기록)' })
  async checkMedication(@Req() req: PortalRequest, @Body() dto: MedicationCheckDto) {
    const patientId = req.portalPatientId;
    return { data: await this.svc.checkMedication(patientId, dto) };
  }

  // ── Portal v2: Annual Billing Summary (Phase 3) ──

  @Get('billing/annual-summary')
  @ApiBearerAuth()
  @ApiOperation({ summary: '연간 수납 요약 (월별 통계)' })
  async getAnnualBillingSummary(@Req() req: PortalRequest, @Query('year') year?: string) {
    const patientId = req.portalPatientId;
    const y = year ? parseInt(year) : new Date().getFullYear();
    return { data: await this.svc.getAnnualBillingSummary(patientId, y) };
  }

  // ── Portal v2: Family Account Switch (Phase 3) ──

  @Post('family/switch')
  @ApiBearerAuth()
  @ApiOperation({ summary: '가족 계정 전환' })
  async switchFamily(@Req() req: PortalRequest, @Body() dto: SwitchFamilyDto) {
    const patientId = req.portalPatientId;
    return { data: await this.svc.switchFamily(patientId, dto.linkedPatientId) };
  }

  // ── Portal v2: Message Reply (Phase 4) ──

  @Post('messages/reply')
  @ApiBearerAuth()
  @ApiOperation({ summary: '메시지 답장 (양방향)' })
  async replyToMessage(@Req() req: PortalRequest, @Body() dto: ReplyMessageDto) {
    const patientId = req.portalPatientId;
    return { data: await this.svc.replyToMessage(patientId, dto.messageId, dto.content) };
  }

  // ── Portal v2: Patient Certificate (Phase 5) ──

  @Post('cert/request')
  @ApiBearerAuth()
  @ApiOperation({ summary: '블록체인 인증서 발급 요청' })
  async requestCertificate(@Req() req: PortalRequest, @Body() dto: RequestCertificateDto) {
    const patientId = req.portalPatientId;
    return { data: await this.svc.requestCertificate(patientId, dto) };
  }

  @Get('cert/my')
  @ApiBearerAuth()
  @ApiOperation({ summary: '내 블록체인 인증서 목록' })
  async getMyCertificates(@Req() req: PortalRequest) {
    const patientId = req.portalPatientId;
    return { data: await this.svc.getPatientCertificates(patientId) };
  }

  // ── Portal v2: Audit Log (Phase 6) ──

  @Get('audit-log')
  @ApiBearerAuth()
  @ApiOperation({ summary: '내 의무기록 접근 로그 (BTG 포함)' })
  async getAuditLog(@Req() req: PortalRequest, @Query('page') page?: string, @Query('limit') limit?: string) {
    const patientId = req.portalPatientId;
    return { data: await this.svc.getPatientAuditLog(patientId, page ? parseInt(page) : 1, limit ? parseInt(limit) : 30) };
  }

  // ── 대기현황 SSE 실시간 스트림 ──

  @Sse('waiting-status/stream')
  @ApiOperation({ summary: '대기현황 SSE 실시간 스트림 (30초 간격)' })
  waitingStatusStream(@Req() req: PortalRequest): Observable<MessageEvent> {
    const patientId = req.portalPatientId;
    let lastHash = '';

    return interval(30000).pipe(
      switchMap(() =>
        from(
          (async (): Promise<MessageEvent> => {
            try {
              const status = await this.svc.getWaitingStatus(patientId);
              const currentHash = JSON.stringify(status);

              if (currentHash !== lastHash) {
                lastHash = currentHash;
                return {
                  data: { eventType: 'STATUS_CHANGED', waitingStatus: status, timestamp: new Date().toISOString() },
                } as MessageEvent;
              }

              return {
                data: { eventType: 'HEARTBEAT', waitingStatus: status, timestamp: new Date().toISOString() },
              } as MessageEvent;
            } catch {
              return {
                data: { eventType: 'HEARTBEAT', timestamp: new Date().toISOString() },
              } as MessageEvent;
            }
          })(),
        ),
      ),
    );
  }

  @Get('imaging/report/:studyUid/pdf')
  @ApiBearerAuth()
  @ApiOperation({ summary: '판독 리포트 PDF (PACS 프록시)' })
  async getImagingReportPdf(@Param('studyUid') studyUid: string, @Req() req: PortalRequest, @Headers('authorization') auth: string) {
    // 소유권 검증은 fail-closed — 조회가 실패하면 '검증 불가'이므로 PDF 를 주지 않는다.
    // (종전엔 if(studiesRes.ok) 안에서만 검증해, PACS 조회 실패 시 소유권 확인 없이 임의 studyUid 의
    //  판독 PDF 를 반환하던 IDOR. 2026-07 권한 경계 전수)
    // 🔴 2026-08-18: 종전에는 **연결 실패까지 'FORBIDDEN'** 이라 말했다 — '남의 것'과 '확인 불가'는
    //    다른 사실이다. assertOwnsStudy 가 둘을 갈라 말한다(403 / 503).
    await this.assertOwnsStudy(req.portalPatientId, studyUid);

    const pdfRes = await fetch(
      `${this.pacsBase()}/api/v1/my-patients/report/${encodeURIComponent(studyUid)}/pdf`,
      { headers: await this.pacsProxy.serviceAuthHeaders(), signal: AbortSignal.timeout(15000) },
    ).catch(() => null);
    if (pdfRes && pdfRes.status === 404) {
      throw new NotFoundException({ error: 'NOT_FOUND', message: '리포트를 찾을 수 없습니다.' });
    }
    if (!pdfRes || !pdfRes.ok) {
      throw new ServiceUnavailableException({
        error: 'PACS_UNAVAILABLE',
        message: '영상 보관 시스템에서 판독지를 불러오지 못했습니다. 판독지가 없는 것이 아닙니다.',
      });
    }
    const html = await pdfRes.text();
    return { data: { html, contentType: 'text/html' } };
  }

  // ── 영상/판독 내보내기 (PACS Export) ──

  @Post('imaging/export/request')
  @ApiBearerAuth()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({ summary: '영상/판독 내보내기 요청 (PACS 암호화 패키지)' })
  async requestImagingExport(@Body() dto: ImagingExportRequestDto, @Req() req: PortalRequest) {
    const patientId = req.portalPatientId;
    return { data: await this.pacsExport.requestExport(patientId, dto.purpose, dto.studyUids) };
  }

  @Get('imaging/export/:requestId')
  @ApiBearerAuth()
  @ApiOperation({ summary: '내보내기 진행상태 폴링' })
  async pollImagingExport(@Param('requestId') requestId: string, @Req() req: PortalRequest) {
    const patientId = req.portalPatientId;
    return { data: await this.pacsExport.pollStatus(patientId, requestId) };
  }

  @Get('imaging/export/:requestId/download')
  @ApiBearerAuth()
  @ApiOperation({ summary: '내보내기 패키지 다운로드 (복호 ZIP 스트림)' })
  async downloadImagingExport(@Param('requestId') requestId: string, @Req() req: PortalRequest, @Res() res: any) {
    const patientId = req.portalPatientId;
    const { buffer, filename } = await this.pacsExport.download(patientId, requestId);
    res.set({
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(buffer.length),
    });
    res.send(buffer);
  }

  // ── 초진 동의서 (Registration Consent) ──

  @Get('registration-consents')
  @ApiBearerAuth()
  @ApiOperation({ summary: '내 접수 동의서 현황 (10종)' })
  async getRegistrationConsents(@Req() req: PortalRequest) {
    const patientId = req.portalPatientId;
    if (!patientId) return { data: { consents: [], requiredComplete: false } };
    return { data: await this.regConsentSvc.getConsents(patientId) };
  }

  @Put('registration-consents/:type/sign')
  @ApiBearerAuth()
  @ApiOperation({ summary: '접수 동의서 전자서명' })
  async signRegistrationConsent(
    @Req() req: PortalRequest,
    @Param('type') type: string,
    @Body() body: PortalSignRegistrationConsentDto,
  ) {
    const patientId = req.portalPatientId;
    if (!patientId) throw new UnauthorizedException({ code: 'NO_PATIENT', message: '환자 계정이 아닙니다' });
    // 🔴 (2026-09-15 B6) 종전 `{ ...body }` — 본문의 `ipAddress`(서명 증빙)까지 서비스로 흘러갔다. 명시 필드만 넘긴다.
    // 🔴 (2026-09-15 T2) 서명 방식은 **서버가 정한다** — 화면이 인증서만 있으면 `BLOCKCHAIN` 을 보냈지만
    //   환자용 블록체인 서명·앵커링 경로는 없다(blockchain-cert 에 서명 EP 0 · 화면이 보낸 `signatureValue` 는
    //   `base64(이름-유형-시각)` 로 만든 문자열이었다). 이 경로에서 실제로 일어나는 일은 포털 로그인 + 이름 입력이다.
    //   IP 증빙도 DTO 주석은 "서버가 남긴다" 였으나 넘기지 않아 늘 null 이었다.
    const consent = await this.regConsentSvc.updateConsent(patientId, type, {
      agreed: true, signedBy: body.signedBy, signMethod: PORTAL_CONSENT_SIGN_METHOD, signatureData: body.signatureData,
      ipAddress: (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip,
    });
    return { data: { ...consent, evidence: portalConsentEvidence(consent) } };
  }

  @Put('registration-consents/:type/revoke')
  @ApiBearerAuth()
  @ApiOperation({ summary: '선택 동의 철회' })
  async revokeRegistrationConsent(
    @Req() req: PortalRequest,
    @Param('type') type: string,
    @Body() body: PortalRevokeRegistrationConsentDto,
  ) {
    const patientId = req.portalPatientId;
    if (!patientId) throw new UnauthorizedException({ code: 'NO_PATIENT', message: '환자 계정이 아닙니다' });
    return { data: await this.regConsentSvc.revokeConsent(patientId, type, body.reason) };
  }
}

// 관리자 서류 처리 (별도 컨트롤러)
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserRole } from '@prisma/client';
import { UpdateDocumentStatusDto } from './dto/portal.dto';
import { PORTAL_CONSENT_SIGN_METHOD, portalConsentEvidence } from '../registration-consent/consent-sign-evidence';

@ApiTags('Document Admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/admin/documents')
export class DocumentAdminController {
  constructor(private readonly svc: PortalService) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.NURSE)
  @ApiOperation({ summary: '서류 신청 목록 (관리자)' })
  async list(@Query('status') status?: string) {
    return { data: await this.svc.getDocumentRequestsAdmin(status) };
  }

  @Put(':id/status')
  @Roles(UserRole.ADMIN, UserRole.NURSE)
  @ApiOperation({ summary: '서류 상태 변경 (관리자)' })
  async updateStatus(@Param('id') id: string, @Body() dto: UpdateDocumentStatusDto, @CurrentUser('id') userId: string) {
    return { data: await this.svc.updateDocumentStatus(id, dto, userId) };
  }
}

// ═══════════════════════════════════════════════════════════════
// 검진 결과 조회 (Portal — 수검자용)
// ═══════════════════════════════════════════════════════════════

@ApiTags('Patient Portal — 검진')
@UseGuards(PortalOrPatientGuard)
@Controller('api/v1/portal')
export class PortalCheckupController {
  constructor(
    private readonly svc: PortalService,
    private readonly remoteConsult: RemoteConsultationService,
  ) {}

  @Get('checkup-visits')
  @ApiOperation({ summary: '내 검진 이력 목록' })
  async getCheckupVisits(@Req() req: PortalRequest) {
    const patientId = req.portalPatientId;
    return { data: await this.svc.getCheckupVisits(patientId) };
  }

  @Get('checkup-visits/:id')
  @ApiOperation({ summary: '검진 결과 상세 (결과+소견+추적)' })
  async getCheckupVisitDetail(@Param('id') id: string, @Req() req: PortalRequest) {
    const patientId = req.portalPatientId;
    return { data: await this.svc.getCheckupVisitDetail(id, patientId) };
  }

  @Get('checkup-visits/:id/summary')
  @ApiOperation({ summary: '종합소견 조회' })
  async getCheckupSummary(@Param('id') id: string, @Req() req: PortalRequest) {
    const patientId = req.portalPatientId;
    return { data: await this.svc.getCheckupSummary(id, patientId) };
  }

  @Get('checkup-capacity')
  @ApiOperation({ summary: '검진 날짜별 잔여 용량' })
  async getCheckupCapacity(@Query('from') from: string, @Query('to') to: string) {
    return { data: await this.svc.getCheckupCapacity(from, to) };
  }

  @Get('checkup-programs')
  @ApiOperation({ summary: '검진 프로그램 목록 (공개)' })
  async getCheckupPrograms() {
    return { data: await this.svc.getPublicCheckupPrograms() };
  }

  @Post('checkup-reserve')
  @ApiOperation({ summary: '검진 자가 예약' })
  async reserveCheckup(@Req() req: PortalRequest, @Body() body: CheckupReserveDto) {
    const patientId = req.portalPatientId;
    return { data: await this.svc.reserveCheckup(patientId, body) };
  }

  @Delete('checkup-visits/:id')
  @ApiOperation({ summary: '검진 예약 취소' })
  async cancelCheckupVisit(@Param('id') id: string, @Req() req: PortalRequest) {
    const patientId = req.portalPatientId;
    return { data: await this.svc.cancelCheckupVisit(id, patientId) };
  }

  @Get('checkup-visits/:id/questionnaire')
  @ApiOperation({ summary: '문진 템플릿 + 내 응답' })
  async getCheckupQuestionnaire(@Param('id') id: string, @Req() req: PortalRequest) {
    const patientId = req.portalPatientId;
    return { data: await this.svc.getCheckupQuestionnaire(id, patientId) };
  }

  @Post('checkup-visits/:id/questionnaire')
  @ApiOperation({ summary: '문진 응답 저장' })
  async saveCheckupQuestionnaire(
    @Param('id') id: string,
    @Req() req: PortalRequest,
    @Body() body: PortalCheckupQuestionnaireDto,
  ) {
    const patientId = req.portalPatientId;
    return { data: await this.svc.saveCheckupQuestionnaire(id, patientId, body) };
  }

  @Get('checkup-visits/:id/result-pdf')
  @ApiOperation({ summary: '검진 결과서 PDF 다운로드' })
  async getCheckupResultPdf(@Param('id') id: string, @Req() req: PortalRequest, @Res() res: any) {
    const patientId = req.portalPatientId;
    // 본인 확인
    const visit = await this.svc.getCheckupVisitDetail(id, patientId);
    if (!visit) return res.status(404).json({ error: '검진 결과를 찾을 수 없습니다' });
    const pdfService = (this.svc as any).pdfService ?? (this.svc as any).prisma?.constructor;
    // Portal에서는 PdfGenerationService 직접 접근 — Module에서 주입 필요
    // 여기서는 HTML 반환 (브라우저 인쇄용)
    const html = await this.svc.getCheckupResultHtml(id, patientId);
    res.set({ 'Content-Type': 'text/html; charset=utf-8' });
    res.send(html);
  }

  @Get('checkup-comparison')
  @ApiOperation({ summary: '검진 결과 비교 (최근 5회 추이)' })
  async getCheckupComparison(@Req() req: PortalRequest) {
    const patientId = req.portalPatientId;
    return { data: await this.svc.getCheckupComparison(patientId) };
  }

  // ── 원격진료 ──

  @Get('telehealth')
  @ApiBearerAuth()
  @ApiOperation({ summary: '내 원격진료 목록' })
  async getTelehealthSessions(@Req() req: PortalRequest) {
    const patientId = req.portalPatientId;
    return { data: await this.svc.getTelehealthSessions(patientId) };
  }

  @Get('telehealth/:id')
  @ApiBearerAuth()
  @ApiOperation({ summary: '원격진료 상세' })
  async getTelehealthSession(@Param('id') id: string, @Req() req: PortalRequest) {
    const patientId = req.portalPatientId;
    return { data: await this.svc.getTelehealthSession(id, patientId) };
  }

  /**
   * 🔴 환자용 화상 토큰 — **포털 토큰으로 부를 수 있는 자리**(2026-09-02 실측).
   *    화면은 직원 가드가 걸린 `/api/v1/telehealth/sessions/:id/patient-token` 을 불러
   *    환자 토큰으로 **항상 401** 이었고, `catch` 가 그 실패를 삼켜 **JWT 없이** 방을 열었다.
   *    세션↔환자 결속을 여기서 확인한다(fail-closed) — 원본 서비스는 sessionId 만 받는다.
   */
  @Get('telehealth/:id/patient-token')
  @ApiBearerAuth()
  @ApiOperation({ summary: '화상 진료 입장 토큰(본인 세션만)' })
  async getTelehealthPatientToken(@Param('id') id: string, @Req() req: PortalRequest) {
    return { data: { token: await this.svc.getTelehealthPatientToken(id, req.portalPatientId) } };
  }

  @Patch('telehealth/:id/join')
  @ApiBearerAuth()
  @ApiOperation({ summary: '대기실 입장' })
  async joinTelehealth(@Param('id') id: string, @Req() req: PortalRequest) {
    const patientId = req.portalPatientId;
    return { data: await this.svc.joinTelehealth(id, patientId) };
  }

  @Post('telehealth/:id/message')
  @ApiBearerAuth()
  @ApiOperation({ summary: '비동기 진료 메시지 전송' })
  async sendTelehealthMessage(@Param('id') id: string, @Req() req: PortalRequest, @Body() body: PortalTelehealthMessageDto) {
    const patientId = req.portalPatientId;
    return { data: await this.svc.sendTelehealthMessage(id, patientId, body.message) };
  }

  @Post('telehealth/:id/rate')
  @ApiBearerAuth()
  @ApiOperation({ summary: '원격진료 평가' })
  async rateTelehealth(@Param('id') id: string, @Req() req: PortalRequest, @Body() body: PortalTelehealthRateDto) {
    const patientId = req.portalPatientId;
    return { data: await this.svc.rateTelehealth(id, patientId, body.rating, body.feedback) };
  }

  @Get('telehealth-departments')
  @ApiBearerAuth()
  @ApiOperation({ summary: '원격진료 가능 진료과' })
  async getTelehealthDepartments() {
    return { data: await this.svc.getTelehealthDepartments() };
  }

  @Get('telehealth-doctors')
  @ApiBearerAuth()
  @ApiOperation({ summary: '진료과별 의사 목록' })
  async getTelehealthDoctors(@Query('department') department: string) {
    return { data: await this.svc.getTelehealthDoctors(department) };
  }

  @Get('telehealth-slots')
  @ApiBearerAuth()
  @ApiOperation({ summary: '의사별 가용 시간 슬롯' })
  async getTelehealthSlots(@Query('doctorId') doctorId: string, @Query('date') date: string) {
    return { data: await this.svc.getTelehealthSlots(doctorId, date) };
  }

  @Post('telehealth-book')
  @ApiBearerAuth()
  @ApiOperation({ summary: '원격진료 예약' })
  async bookTelehealth(@Req() req: PortalRequest, @Body() body: PortalTelehealthBookDto) {
    const patientId = req.portalPatientId;
    return { data: await this.svc.bookTelehealth(patientId, body) };
  }

  @Patch('telehealth/:id/cancel')
  @ApiBearerAuth()
  @ApiOperation({ summary: '원격진료 취소' })
  async cancelTelehealth(@Param('id') id: string, @Req() req: PortalRequest) {
    const patientId = req.portalPatientId;
    return { data: await this.svc.cancelTelehealth(id, patientId) };
  }

  @Get('health-score')
  @ApiOperation({ summary: 'AI 건강 스코어' })
  async getHealthScore(@Req() req: PortalRequest) {
    const patientId = req.portalPatientId;
    return { data: await this.svc.getHealthScore(patientId) };
  }

  @Get('followup-recommendation')
  @ApiOperation({ summary: 'AI 재진 권고' })
  async getFollowupRecommendation(@Req() req: PortalRequest) {
    const patientId = req.portalPatientId;
    return { data: await this.svc.getFollowupRecommendation(patientId) };
  }

  // ══════════════════════════════════════════════════════════════
  //  AI 도우미 (환자용)
  // ══════════════════════════════════════════════════════════════

  @Post('ai/ask')
  @ApiOperation({ summary: '환자 AI 도우미 — 자유 질문' })
  async aiAsk(@Req() req: PortalRequest, @Body() body: PortalAiAskDto) {
    const patientId = req.portalPatientId;
    return { data: await this.svc.aiAsk(patientId, body.question) };
  }

  // ══════════════════════════════════════════════════════════════
  //  비대면 진료 (환자용)
  // ══════════════════════════════════════════════════════════════

  @Get('remote-consult')
  @ApiOperation({ summary: '내 비대면 진료 목록' })
  async getRemoteConsultations(@Req() req: PortalRequest) {
    return { data: await this.remoteConsult.getConsultations(req.portalPatientId) };
  }

  @Get('remote-consult/doctors')
  @ApiOperation({ summary: '비대면 진료 가능 의사 목록' })
  async getRemoteConsultDoctors(@Req() req: PortalRequest) {
    return { data: await this.remoteConsult.getAvailableDoctors(req.portalPatientId) };
  }

  @Get('remote-consult/consent-status')
  @ApiOperation({ summary: '비대면 진료 첫 이용 동의 상태' })
  async getRemoteConsentStatus(@Req() req: PortalRequest) {
    return { data: await this.remoteConsult.getConsentStatus(req.portalPatientId) };
  }

  @Post('remote-consult/consent')
  @ApiOperation({ summary: '비대면 진료 첫 이용 동의 제출 (4단계)' })
  async submitRemoteConsent(@Req() req: PortalRequest, @Body() body: RemoteConsentDto) {
    return { data: await this.remoteConsult.submitConsent(req.portalPatientId, { ...body, ipAddress: (req as any).ip }) };
  }

  @Post('remote-consult')
  @ApiOperation({ summary: '비대면 진료 요청' })
  async createRemoteConsult(@Req() req: PortalRequest, @Body() body: CreateRemoteConsultDto) {
    return { data: await this.remoteConsult.createConsultation(req.portalPatientId, body) };
  }

  @Get('remote-consult/:id')
  @ApiOperation({ summary: '비대면 진료 상세' })
  async getRemoteConsultDetail(@Param('id') id: string, @Req() req: PortalRequest) {
    return { data: await this.remoteConsult.getConsultationDetail(id, req.portalPatientId) };
  }

  @Post('remote-consult/:id/messages')
  @ApiOperation({ summary: '비대면 진료 메시지 전송' })
  async sendRemoteConsultMessage(@Param('id') id: string, @Req() req: PortalRequest, @Body() body: RemoteConsultMessageDto) {
    return { data: await this.remoteConsult.sendMessage(id, req.portalPatientId, body) };
  }

  @Get('remote-consult/:id/prescriptions')
  @ApiOperation({ summary: '비대면 진료 처방전 조회' })
  async getRemoteConsultPrescriptions(@Param('id') id: string, @Req() req: PortalRequest) {
    return { data: await this.remoteConsult.getPrescriptions(id, { patientId: req.portalPatientId }) };
  }

  @Post('remote-consult/:id/pay')
  @ApiOperation({ summary: '비대면 진료 결제' })
  async payRemoteConsult(@Param('id') id: string, @Req() req: PortalRequest, @Body() body: PayConsultDto) {
    return { data: await this.remoteConsult.payConsultation(id, req.portalPatientId, body) };
  }

  @Post('remote-consult/:id/cancel')
  @ApiOperation({ summary: '비대면 진료 취소 (답변 전 환불)' })
  async cancelRemoteConsult(@Param('id') id: string, @Req() req: PortalRequest, @Body() body: CancelConsultDto) {
    return { data: await this.remoteConsult.cancelConsultation(id, req.portalPatientId, body?.reason) };
  }

  @Post('remote-consult/:id/rate')
  @ApiOperation({ summary: '비대면 진료 만족도 평가' })
  async rateRemoteConsult(@Param('id') id: string, @Req() req: PortalRequest, @Body() body: RateConsultDto) {
    return { data: await this.remoteConsult.rateConsultation(id, req.portalPatientId, body) };
  }

  @Post('remote-consult/:id/video/request')
  @ApiOperation({ summary: '화상 전환 요청 (환자)' })
  async requestRemoteVideo(@Param('id') id: string, @Req() req: PortalRequest, @Body() body: VideoEscalationDto) {
    return { data: await this.remoteConsult.requestVideoEscalation(id, 'PATIENT', req.portalPatientId, body?.scheduledAt) };
  }

  @Post('remote-consult/:id/video/accept')
  @ApiOperation({ summary: '화상 전환 수락 (환자)' })
  async acceptRemoteVideo(@Param('id') id: string, @Req() req: PortalRequest) {
    return { data: await this.remoteConsult.acceptVideoEscalation(id, req.portalPatientId, 'PATIENT') };
  }

  @Get('remote-consult/:id/video/token')
  @ApiOperation({ summary: '화상 진료 Jitsi 토큰 (환자)' })
  async getRemoteVideoToken(@Param('id') id: string, @Req() req: PortalRequest) {
    return { data: await this.remoteConsult.getVideoToken(id, req.portalPatientId, 'PATIENT') };
  }

  // ══════════════════════════════════════════════════════════════
  //  보호자 위임 (Guardian Proxy Access)
  // ══════════════════════════════════════════════════════════════

  @Get('guardians')
  @ApiOperation({ summary: '내 보호자/피부양자 목록' })
  async getGuardians(@Req() req: PortalRequest) {
    return { data: await this.svc.getGuardianRelations(req.portalPatientId) };
  }

  @Post('guardians/request')
  @ApiOperation({ summary: '보호자 등록 요청 (피부양자 MRN)' })
  async requestGuardian(@Req() req: PortalRequest, @Body() body: GuardianRequestDto) {
    return { data: await this.svc.requestGuardian(req.portalPatientId, body) };
  }

  @Post('guardians/switch/:guardianshipId')
  @ApiOperation({ summary: '피부양자로 전환 (보호자 JWT 발급)' })
  async switchGuardian(@Param('guardianshipId') guardianshipId: string, @Req() req: PortalRequest) {
    return { data: await this.svc.switchToGuardian(req.portalPatientId, guardianshipId) };
  }

  @Post('guardians/break-the-glass')
  @Throttle({ default: { limit: 3, ttl: 3600000 } }) // 긴급 열람 남용 방지: 시간당 3회
  @ApiOperation({ summary: '긴급 열람 (Break-the-Glass) — 24h 임시 접근 + 관리자 알림' })
  async breakTheGlass(@Req() req: PortalRequest, @Body() body: BreakTheGlassDto) {
    return { data: await this.svc.breakTheGlass(req.portalPatientId, body) };
  }

  @Get('guardians/audit-log')
  @ApiOperation({ summary: '내 정보에 대한 보호자 열람 이력' })
  async guardianAuditLog(@Req() req: PortalRequest) {
    return { data: await this.svc.getGuardianAuditLog(req.portalPatientId) };
  }

  @Delete('guardians/:id')
  @ApiOperation({ summary: '보호자 관계 해제' })
  async removeGuardian(@Param('id') id: string, @Req() req: PortalRequest) {
    return { data: await this.svc.removeGuardian(req.portalPatientId, id) };
  }

  // ══════════════════════════════════════════════════════════════
  //  환자 여정 통합 API (Journey Hub)
  // ══════════════════════════════════════════════════════════════

  @Get('journey/status')
  @ApiOperation({ summary: '환자 여정 현재 상태 (외래대기/진료중/입원/퇴원후/일반)' })
  async getJourneyStatus(@Req() req: PortalRequest) {
    const patientId = req.portalPatientId;
    const status = await this.svc.getJourneyStatus(patientId) as Record<string, unknown>;
    // 🔴 W9: 여정 응답은 healthDashboard(검사 포함)를 통째로 품는다 — 위임 범위 밖 영역을 덜어낸다.
    //    (PortalCheckupController 는 PortalController 와 별도 클래스라 헬퍼를 인라인)
    if (status && req.isGuardianAccess) {
      const scope = req.guardianScope ?? {};
      const dash = status.healthDashboard as Record<string, unknown> | undefined;
      if (dash) {
        status.healthDashboard = {
          ...dash,
          ...(scope.labs === false ? { recentLabs: [] } : {}),
          ...(scope.appointments === false ? { nextAppointment: null } : {}),
        };
      }
      if (scope.labs === false) status.recentLabResults = [];
    }
    return { data: status };
  }

  @Get('journey/timeline')
  @ApiOperation({ summary: '환자 여정 타임라인 (이벤트 로그)' })
  async getJourneyTimeline(
    @Req() req: PortalRequest,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
  ) {
    const patientId = req.portalPatientId;
    // (2026-10-01 여정 P3) 상한(≤100)에서 잘렸는지를 meta 로 말한다 — data 는 종전과 같은 배열
    const { items, truncated } = await this.svc.getJourneyTimeline(patientId, from, to, limit ? parseInt(limit, 10) : 50, { withMeta: true });
    return { data: items, meta: { truncated } };
  }

  @Get('journey/inpatient')
  @ApiOperation({ summary: '입원 상세 정보 (환자용)' })
  async getInpatientDetail(@Req() req: PortalRequest) {
    const patientId = req.portalPatientId;
    return { data: await this.svc.getInpatientDetail(patientId) };
  }

  // ── F-3 입원 생활 (config portal.inpatientLife — OFF면 404) ──

  @Get('inpatient/meals')
  @ApiBearerAuth()
  @ApiOperation({ summary: '입원 식이 정보 — 오늘·내일 끼니(식이 종류·배송 상태)·활성 식이 처방(본인)' })
  async getInpatientMeals(@Req() req: PortalRequest) {
    return { data: await this.svc.getInpatientMeals(req.portalPatientId) };
  }

  @Get('inpatient/interim-bill')
  @ApiBearerAuth()
  @ApiOperation({ summary: '입원비 중간정산(ERP interim·확정액 아님) — chartNo 서버 주입(파라미터 없음)' })
  async getInpatientInterimBill(@Req() req: PortalRequest) {
    return { data: await this.svc.getInpatientInterimBill(req.portalPatientId) };
  }

  @Get('questionnaire/active')
  @ApiOperation({ summary: '활성 문진표 조회' })
  async getActiveQuestionnaires(@Req() req: PortalRequest) {
    const patientId = req.portalPatientId;
    return { data: await this.svc.getActiveQuestionnaires(patientId) };
  }

  @Post('questionnaire/submit')
  @ApiOperation({ summary: '문진표 제출' })
  async submitQuestionnaire(@Req() req: PortalRequest, @Body() body: PortalSubmitQuestionnaireDto) {
    const patientId = req.portalPatientId;
    return { data: await this.svc.submitQuestionnaire(patientId, body) };
  }
}

/** 가드가 이미 검증한 Bearer 토큰의 만료 시각(서명 재검증 없이 exp 만 읽는다) — 모르면 null */
function tokenExpiresAt(authorization: unknown): string | null {
  if (typeof authorization !== 'string' || !authorization.startsWith('Bearer ')) return null;
  try {
    const payload = JSON.parse(Buffer.from(authorization.slice(7).split('.')[1] ?? '', 'base64url').toString('utf8')) as { exp?: unknown };
    return typeof payload.exp === 'number' ? new Date(payload.exp * 1000).toISOString() : null;
  } catch {
    return null;
  }
}
