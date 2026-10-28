import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ApiBearerAuth, ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Permission } from '../auth/rbac/permission.types';
import { EmergencyService } from './emergency.service';
import { ErBedService } from './er-bed.service';
import { CreatePrenotificationDto } from './dto/prenotification.dto';
import { CheckoutEmergencyDto } from './dto/checkout.dto';
import {
  ActivateMciDto, CloseMciDto, EmergencyCodeAlertDto, EmergencyTreatmentNoteDto, PrenotificationArriveDto, PrenotificationCancelDto,
} from './dto/emergency-action.dto';
import { AssignErBedDto, MoveErBedDto, ReleaseErBedDto, ErBedStatusDto, CreateErBedDto, RenameErBedDto } from './dto/er-bed.dto';
import { AuditAiRead } from '../audit/no-audit.decorator';
import {
  CreateTriageDto,
  UpdateEmergencyStatusDto,
  RecordVitalSignsDto,
  TransferToAdmissionDto,
  UpdateVisitStatusDto,
  ReassessEmergencyDto,
  MakeDispositionDto,
  DischargeFromEmergencyDto,
  CreateEmergencyNursingAssessmentDto,
} from './dto/emergency.dto';

@ApiTags('Emergency')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
@Controller('api/v1/emergency')
export class EmergencyController {
  constructor(
    private readonly service: EmergencyService,
    private readonly erBeds: ErBedService,
  ) {}

  // ── ER 베드 보드(P0·2026-08-05) ──

  @Get('beds')
  /**
   * 🔴 접수 화면의 **응급 도착 배너**(`ErArrivalBanner`)가 이 EP 를 부른다 —
   *    클래스 `@Roles` 에 `RECEPTIONIST` 가 없어 **접수원에게 상시 403** 이었다(2026-08-29 실측).
   * 🔴 **여는 것이 답인 성격**: 미배정 도착 건수를 접수 데스크가 보는 것은 접수 업무다.
   *    (임상 상세가 아니라 배정 현황이다)
   */
  @Roles(UserRole.RECEPTIONIST, UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  @ApiOperation({ summary: 'ER 베드 보드 — 구역 베드+현재 배정+미배정 재실 (1폴링 1콜)' })
  async erBedBoard() { return { data: await this.erBeds.getBoard() }; }

  @Post('beds/assign')
  @ApiOperation({ summary: 'ER 베드 배정 — 동시 경합은 409' })
  async erBedAssign(@Body() dto: AssignErBedDto, @CurrentUser('id') userId: string) {
    return { data: await this.erBeds.assign(dto.visitId, dto.bedId, userId) };
  }

  @Post('beds/move')
  @ApiOperation({ summary: 'ER 베드 이동 — 원 베드는 CLEANING' })
  async erBedMove(@Body() dto: MoveErBedDto, @CurrentUser('id') userId: string) {
    return { data: await this.erBeds.move(dto.visitId, dto.toBedId, userId) };
  }

  @Post('beds/release')
  @ApiOperation({ summary: 'ER 베드 해제 — 베드는 CLEANING' })
  async erBedRelease(@Body() dto: ReleaseErBedDto, @CurrentUser('id') userId: string) {
    return { data: await this.erBeds.release(dto.visitId, userId, dto.reason ?? 'MANUAL') };
  }

  @Patch('beds/:bedId/status')
  @ApiOperation({ summary: 'ER 베드 상태 전환(청소완료·정비·격리·예약) — 점유 중 거부·OCCUPIED 지정 불가' })
  async erBedStatus(@Param('bedId') bedId: string, @Body() dto: ErBedStatusDto) {
    return { data: await this.erBeds.setBedStatus(bedId, dto.status) };
  }

  @Get('beds/stats')
  @ApiOperation({ summary: 'ER 베드 운영 리포트(P3) — 구역별 배정·평균 점유·해제 사유(?days=7)' })
  async erBedStats(@Query('days') days?: string) {
    return { data: await this.erBeds.getStats(days ? Number(days) : 7) };
  }

  @Get('beds/:bedId/display')
  @ApiOperation({ summary: 'ER 베드사이드 디스플레이(P2) — 서버 조립·마스킹/표시 필드 config 적용' })
  async erBedDisplay(@Param('bedId') bedId: string) {
    return { data: await this.erBeds.getBedDisplay(bedId) };
  }

  @Post('beds/create')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'ER 베드 추가(관리·§4.4) — 삭제 없음(비활성=MAINTENANCE)' })
  async erBedCreate(@Body() dto: CreateErBedDto) {
    return { data: await this.erBeds.createBed(dto.zone.toUpperCase(), dto.bedNumber) };
  }

  @Patch('beds/:bedId/rename')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'ER 베드 구역/번호 변경(관리) — 점유 중 거부' })
  async erBedRename(@Param('bedId') bedId: string, @Body() dto: RenameErBedDto) {
    return { data: await this.erBeds.renameBed(bedId, dto.zone.toUpperCase(), dto.bedNumber) };
  }

  /**
   * 🔴 임상 기록에 `PATIENT_EDIT`(인적정보 수정) 를 요구하는 것은 어휘 오류였다(2026-08-30 운영 실측).
   *    DOCTOR 에서 PATIENT_EDIT 를 걷어낸 정당한 조치가 이 어휘를 쓰던 임상 EP 들을 함께 막아 —
   *    **의사가 트리아지·응급 활력·입원 전환·입퇴원·법정감염병 신고에서 403**, 거꾸로
   *    **접수원(PATIENT_EDIT 보유)은 퇴원 처리·격리 배정까지 통과**하고 있었다(권한 역전 ·
   *    emergency 4 + admission 5 + infection 15 + checkup 8 = 32곳).
   *    같은 원인을 예리물 신고 자리(2026-08-18)에서 그 핸들러만 고친 기록이 있다 — 층이 틀렸던 것.
   *    임상 기록의 어휘는 `ENCOUNTER_EDIT`(ADMIN·DOCTOR·NURSE) 다. 접수원 화면 소비처 0 을 확인하고 좁혔다.
   */
  @Post('triage')
  @RequirePermission(Permission.ENCOUNTER_EDIT)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Triage 생성 (응급실 분류)' })
  @ApiResponse({ status: 201, description: 'Triage 생성 완료' })
  async createTriage(@Body() dto: CreateTriageDto, @CurrentUser('id') userId: string) {
    // 🔴 분류자(triageNurseId)는 법정 기록이다 — 서버가 아는 주체를 원장에 남긴다
    const triage = await this.service.createTriage(dto, userId);
    return { data: triage, meta: { status: 'created' } };
  }

  @Post('vitals/:visitId')
  @RequirePermission(Permission.ENCOUNTER_EDIT)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '생체신호 기록' })
  @ApiResponse({ status: 201, description: '생체신호 기록 완료' })
  async recordVitalSigns(
    @Param('visitId') visitId: string,
    @Body() dto: RecordVitalSignsDto,
    @CurrentUser('id') userId: string,
  ) {
    const updated = await this.service.recordVitalSigns(visitId, dto, userId);
    return { data: updated, meta: { status: 'recorded' } };
  }

  @Get()
  @RequirePermission(Permission.PATIENT_VIEW)
  @ApiOperation({ summary: '응급실 환자 목록' })
  async getAll() {
    const visits = await this.service.getAllVisits();
    return { data: visits };
  }

  @Get('stats')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE, UserRole.READ)
  @RequirePermission(Permission.PATIENT_VIEW)
  @ApiOperation({ summary: '응급실 현황 통계' })
  async getStats() {
    const stats = await this.service.getStats();
    return { data: stats };
  }

  @Get('board')
  @RequirePermission(Permission.PATIENT_VIEW)
  @ApiOperation({ summary: '응급실(ED) 보드 — 재실 KTAS 분포·체류시간·입원대기(boarding)' })
  async getBoard() {
    return { data: await this.service.getBoard() };
  }

  @Get('queue')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE, UserRole.READ)
  @RequirePermission(Permission.PATIENT_VIEW)
  @ApiOperation({ summary: '응급실 대기열 조회' })
  @ApiResponse({ status: 200, description: '대기열 반환' })
  async getEmergencyQueue() {
    const queue = await this.service.getEmergencyQueue();
    return { data: queue, meta: { count: queue.length } };
  }

  @Put('visits/:id/status')
  @RequirePermission(Permission.ENCOUNTER_EDIT)
  @ApiOperation({ summary: '[구형] 응급 처분 변경 — 정본은 POST /visits/:visitId/disposition (내부적으로 정본에 위임·원장 기록)', deprecated: true })
  @ApiResponse({ status: 200, description: '상태 업데이트 완료' })
  async updateEmergencyStatus(
    @Param('id') id: string,
    @Body() dto: UpdateEmergencyStatusDto,
    @CurrentUser('id') userId: string,
  ) {
    const updated = await this.service.updateEmergencyStatus(id, userId, dto);
    return { data: updated };
  }

  @Get('visits/:id')
  @RequirePermission(Permission.PATIENT_VIEW)
  @ApiOperation({ summary: '응급실 환자 상세 조회' })
  @ApiResponse({ status: 200, description: '상세 정보 반환' })
  async getEmergencyDetail(@Param('id') id: string) {
    const detail = await this.service.getEmergencyDetail(id);
    return { data: detail };
  }

  @Get('analytics')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE, UserRole.READ)
  @RequirePermission(Permission.DASHBOARD_VIEW)
  @ApiOperation({ summary: '응급실 통계 분석' })
  @ApiResponse({ status: 200, description: '통계 데이터 반환' })
  async getEmergencyAnalytics(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const stats = await this.service.getEmergencyAnalytics(
      startDate ? new Date(startDate) : undefined,
      endDate ? new Date(endDate) : undefined,
    );
    return { data: stats };
  }

  @Post('visits/:id/admit')
  @RequirePermission(Permission.ENCOUNTER_EDIT)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '응급실 → 입원 전환' })
  @ApiResponse({ status: 201, description: '입원 생성 완료' })
  async transferToAdmission(
    @Param('id') visitId: string,
    @Body() dto: TransferToAdmissionDto,
    @CurrentUser('id') userId: string,
  ) {
    const admission = await this.service.transferToAdmission(visitId, dto.bedId, dto.admittingDoctorId, userId);
    return { data: admission, meta: { status: 'admitted' } };
  }

  @AuditAiRead('AiEmergencyTriage')

  @Get('visits/:visitId/ai-triage')
  @ApiOperation({ summary: 'AI 트리아지 재평가' })
  async aiTriageReassessment(@Param('visitId') visitId: string) {
    return { data: await this.service.aiTriageReassessment(visitId) };
  }

  @Put('visits/:visitId/visit-status')
  @ApiOperation({ summary: '응급 환자 상태 전환 (세분화)' })
  async updateVisitStatus(@Param('visitId') visitId: string, @Body() dto: UpdateVisitStatusDto) {
    // 🔴 `@Body('status') status: string` 는 파이프를 타지 않아 오타 상태가 VarChar(25) 에 그대로 저장됐다.
    return { data: await this.service.updateVisitStatus(visitId, dto.status) };
  }

  @Post('visits/:visitId/reassess')
  @ApiOperation({ summary: 'KTAS 재분류' })
  async reassess(@Param('visitId') visitId: string, @Body() body: ReassessEmergencyDto, @CurrentUser('id') userId: string) {
    return { data: await this.service.reassess(visitId, userId, body) };
  }

  @Post('visits/:visitId/disposition')
  @ApiOperation({ summary: '처분 결정·변경 (퇴원/입원/전원/관찰) — 재호출 시 meta.outcome=CREATED|REVISED|UNCHANGED' })
  async makeDisposition(@Param('visitId') visitId: string, @Body() body: MakeDispositionDto, @CurrentUser('id') userId: string) {
    const record = await this.service.makeDisposition(visitId, userId, body);
    return { data: record, meta: { outcome: record.outcome } };
  }

  @Post('visits/:visitId/checkout')
  @ApiOperation({ summary: '퇴실 확정(P1) — 결정≠퇴실. 처분 결정된 방문을 COMPLETED · 퇴실 시각(D9) 기록 · ER 베드 자동 해제(CLEANING)' })
  async checkout(@Param('visitId') visitId: string, @Body() body: CheckoutEmergencyDto, @CurrentUser('id') userId: string) {
    return { data: await this.service.checkout(visitId, userId, body?.departedAt) };
  }

  @Post('visits/:visitId/discharge')
  @ApiOperation({ summary: '응급 퇴원 (귀가지침 + 외래예약)' })
  async dischargeFromEmergency(@Param('visitId') visitId: string, @Body() body: DischargeFromEmergencyDto, @CurrentUser('id') userId: string) {
    return { data: await this.service.dischargeFromEmergency(visitId, userId, body) };
  }

  @Post('visits/:visitId/nursing-assessment')
  // 🔴 §6 회수(2026-08-25): FE 호출부 0·운영 0행. ER 진료 차트가 같은 ABC/GCS 를 `emergency_exams` 로
  //    보낸다 — 그쪽이 실사용 정본이다. 정본이 둘이 되지 않게 deprecated 로 표시(삭제는 사람 확인 후).
  @ApiOperation({ summary: '[구형] 간호 초기평가 (ABC/GCS/통증) — 실사용 정본은 emergency_exams(ER 진료 차트)', deprecated: true })
  async createNursingAssessment(@Param('visitId') visitId: string, @Body() body: CreateEmergencyNursingAssessmentDto, @CurrentUser('id') userId: string) {
    return { data: await this.service.createNursingAssessment(visitId, userId, body) };
  }

  @Post('visits/:visitId/treatment')
  @ApiOperation({ summary: '처치 기록 (치료 노트·상태 IN_TREATMENT 전이)' })
  async recordTreatment(@Param('visitId') visitId: string, @Body() body: EmergencyTreatmentNoteDto, @CurrentUser('id') userId: string) {
    return { data: await this.service.recordTreatment(visitId, userId, body?.note) };
  }

  @Post('code-alert')
  @ApiOperation({ summary: '코드 알림 방송 (Code Blue/Red 등 — 응급 의료진 전체 알림)' })
  async codeAlert(@Body() body: EmergencyCodeAlertDto, @CurrentUser('id') userId: string) {
    return { data: await this.service.broadcastCodeAlert(userId, body?.code, body?.location) };
  }
  /* ══════════ ER 잔여 3종 (2026-07-23) ══════════ */

  @Get('nedocs')
  @ApiOperation({ summary: 'NEDOCS 과밀도 지수 — 표준 산식·6등급(ED병상수=config emergency.edBedCount)' })
  async getNedocs() {
    return { data: await this.service.getNedocs() };
  }

  @Get('prenotifications')
  @ApiOperation({ summary: '119/전원 사전통보 목록(EN_ROUTE·ETA 잔여분 파생)' })
  async listPrenotifications() {
    return { data: await this.service.listPrenotifications() };
  }

  @Post('prenotifications')
  @ApiOperation({ summary: '사전통보 수기 등록(직원 — 전화 접수 등)' })
  async createPrenotification(@Body() body: CreatePrenotificationDto) {
    return { data: await this.service.createPrenotification(body) };
  }

  @Patch('prenotifications/:id/arrive')
  @ApiOperation({ summary: '사전통보 도착 처리(트리아지 visit 연결·멱등)' })
  async arrivePrenotification(@Param('id') id: string, @Body() body: PrenotificationArriveDto) {
    return { data: await this.service.markPrenotificationArrived(id, body?.visitId) };
  }

  @Patch('prenotifications/:id/cancel')
  @ApiOperation({ summary: '사전통보 취소' })
  async cancelPrenotification(@Param('id') id: string, @Body() body: PrenotificationCancelDto) {
    return { data: await this.service.cancelPrenotification(id, body?.reason) };
  }

  @Get('mci/active')
  @ApiOperation({ summary: '활성 MCI + 사상자 현황(KTAS 분포)' })
  async getActiveMci() {
    return { data: await this.service.getActiveMci() };
  }

  @Post('mci/activate')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR)
  @ApiOperation({ summary: 'MCI(다수사상자/재난) 활성화 — 동시 1건' })
  async activateMci(@Body() body: ActivateMciDto, @CurrentUser('id') userId: string) {
    return { data: await this.service.activateMci(userId, body) };
  }

  @Post('mci/tag/:visitId')
  @ApiOperation({ summary: '사상자 태깅 — visit을 활성 MCI에 연결' })
  async tagMciCasualty(@Param('visitId') visitId: string) {
    return { data: await this.service.tagMciCasualty(visitId) };
  }

  @Patch('mci/:id/close')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR)
  @ApiOperation({ summary: 'MCI 해제' })
  async closeMci(@Param('id') id: string, @Body() body: CloseMciDto, @CurrentUser('id') userId: string) {
    return { data: await this.service.closeMci(userId, id, body?.note) };
  }

  @Post('stale-visits/auto-close')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '묵은 미종결 방문 즉시 정리 — config emergency.staleVisitAutoCloseHours 기준(0=OFF·매일 새벽 자동)' })
  async autoCloseStaleVisits() {
    return { data: await this.service.autoCloseStaleVisits() };
  }

}
