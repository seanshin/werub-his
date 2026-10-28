import {
  Controller,
  Get,
  Post,
  Put,
  Param,
  ParseUUIDPipe,
  Body,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Permission } from '../auth/rbac/permission.types';
import { PermissionService } from '../auth/rbac/permission.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { InfectionControlService } from './infection-control.service';
import { ContactCandidatesService } from './contact-candidates.service';
import {
  CreateInfectionReportDto,
  UpdateInfectionStatusDto,
  ContactTracingDto,
  BulkContactTracingDto,
  IsolationType,
  CreateHaiCaseDto,
  CreateMdroDto,
  CreateNotifiableDto,
  ResolveHaiCaseDto,
  UpsertIsolationProtocolDto,
  RecordStaffExposureDto,
  UpdateStaffExposureFollowUpDto,
} from './dto/infection-control.dto';
import { AssignIsolationDto, CreateResistanceSurveillanceDto } from './dto/resistance-isolation.dto';
import { KonisReportDto } from './dto/konis-report.dto';
import { RecordHandHygieneDto, ReleaseIsolationDto } from './dto/hand-hygiene-release.dto';

@ApiTags('Infection Control')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/infection-control')
export class InfectionControlController {
  constructor(
    private readonly service: InfectionControlService,
    private readonly permissions: PermissionService,
    private readonly contacts: ContactCandidatesService,
  ) {}

  /**
   * 위치 겹침 접촉자 **후보**(P5) — 관리자만 · 설정 기본 OFF(`enabled:false` 로 답한다) · 쓰기 없음.
   * `?patientId=` 가 있어 환자 지목 열람으로 감사된다(audit-routes ②). 🔴 후보 환자들의 신원도 응답에 실리지만 감사 행은 지표 환자 하나다.
   */
  @Get('contact-candidates')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '위치 겹침 접촉자 후보(관리자·설정 기본 OFF·후보만)' })
  async contactCandidates(
    @Query('patientId', new ParseUUIDPipe()) patientId: string,
    @Query('days') days?: string,
    @Query('includeInferred') includeInferred?: string,
  ) {
    return { data: await this.contacts.candidates(patientId, days, includeInferred === 'true') };
  }

  @Get()
  @RequirePermission(Permission.PATIENT_VIEW)
  @ApiOperation({ summary: '감염 감시 목록' })
  async findAll() {
    return { data: await this.service.findAll() };
  }

  @Get('stats')
  @RequirePermission(Permission.PATIENT_VIEW)
  @ApiOperation({ summary: '감염 통계' })
  async getStats() {
    return { data: await this.service.getStats() };
  }

  // ── 손위생 모니터링 (IPSG.5) ──

  @Post('hand-hygiene')
  @RequirePermission(Permission.ENCOUNTER_EDIT)
  @ApiOperation({ summary: '손위생 관찰 기록 (WHO 5 Moments)' })
  async recordHandHygiene(
    @CurrentUser('id') userId: string,
    @Body() body: RecordHandHygieneDto,
  ) {
    return { data: await this.service.recordHandHygiene(userId, body) };
  }

  @Get('hand-hygiene/compliance')
  @RequirePermission(Permission.PATIENT_VIEW)
  @ApiOperation({ summary: '손위생 준수율 통계' })
  async getHandHygieneCompliance(
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('department') department?: string,
  ) {
    return { data: await this.service.getHandHygieneCompliance({ dateFrom, dateTo, department }) };
  }

  @Post('reports')
  @RequirePermission(Permission.ENCOUNTER_EDIT)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '감염 보고서 생성' })
  @ApiResponse({ status: 201, description: '보고서 생성 완료' })
  async createInfectionReport(@Body() dto: CreateInfectionReportDto) {
    const report = await this.service.createInfectionReport(dto);
    return { data: report, meta: { status: 'created' } };
  }

  @Get('queue')
  @RequirePermission(Permission.PATIENT_VIEW)
  @ApiOperation({ summary: '격리 대상자 대기열' })
  @ApiResponse({ status: 200, description: '대기열 반환' })
  async getInfectionQueue() {
    const queue = await this.service.getInfectionQueue();
    return { data: queue, meta: { count: queue.length } };
  }

  @Put('reports/:id/status')
  @RequirePermission(Permission.ENCOUNTER_EDIT)
  @ApiOperation({ summary: '감염 상태 업데이트' })
  @ApiResponse({ status: 200, description: '상태 업데이트 완료' })
  async updateInfectionStatus(
    @Param('id') id: string,
    @Body() dto: UpdateInfectionStatusDto,
  ) {
    const updated = await this.service.updateInfectionStatus(id, dto);
    return { data: updated };
  }

  @Post('contact-traces')
  @RequirePermission(Permission.ENCOUNTER_EDIT)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '접촉자 추적 추가' })
  @ApiResponse({ status: 201, description: '접촉자 추가 완료' })
  async addContactTrace(@Body() dto: ContactTracingDto) {
    const trace = await this.service.addContactTrace(dto);
    return { data: trace, meta: { status: 'created' } };
  }

  @Post('contact-traces/bulk')
  @RequirePermission(Permission.ENCOUNTER_EDIT)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '접촉자 일괄 추적' })
  @ApiResponse({ status: 201, description: '일괄 처리 완료' })
  async addBulkContactTraces(@Body() dto: BulkContactTracingDto) {
    const result = await this.service.addBulkContactTraces(dto);
    return { data: result, meta: { status: 'created' } };
  }

  @Get('analytics')
  @RequirePermission(Permission.AUDIT_VIEW)
  @ApiOperation({ summary: '감염 통계 및 분석' })
  @ApiResponse({ status: 200, description: '분석 데이터 반환' })
  async getInfectionAnalytics(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const stats = await this.service.getInfectionAnalytics(
      startDate ? new Date(startDate) : undefined,
      endDate ? new Date(endDate) : undefined,
    );
    return { data: stats };
  }

  @Get('alerts')
  @RequirePermission(Permission.AUDIT_VIEW)
  @ApiOperation({ summary: '감염 알림 체크' })
  @ApiResponse({ status: 200, description: '알림 데이터 반환' })
  async checkAlerts() {
    const alert = await this.service.detectOutbreakAlert();
    return { data: alert, meta: { hasAlert: alert !== null } };
  }

  @Get('protocols/:isolationType')
  @RequirePermission(Permission.PATIENT_VIEW)
  @ApiOperation({ summary: '격리 프로토콜 조회' })
  @ApiResponse({ status: 200, description: '프로토콜 정보 반환' })
  async getIsolationProtocol(@Param('isolationType') isolationType: IsolationType) {
    const protocol = await this.service.getIsolationProtocol(isolationType);
    return { data: protocol };
  }

  @Put('protocols/:isolationType')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '격리 프로토콜 개정(감염관리위 표면) — source 에 의결번호 기입' })
  async upsertIsolationProtocol(
    @Param('isolationType') isolationType: string,
    @Body() dto: UpsertIsolationProtocolDto,
  ) {
    return { data: await this.service.upsertIsolationProtocol(isolationType, dto) };
  }

  // ─── C3. 감염 관리 고도화 (10 endpoints) ───────────────────────────

  // 🔴 meta.status 는 '전송 결과'다 — 종전 'submitted' 는 나가지도 저장되지도 않은
  //    보고를 접수된 것으로 말했다(W7③).
  @Post('konis/report')
  @RequirePermission(Permission.ENCOUNTER_EDIT)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'KONIS HAI 감시 보고(현재 연동 미구축 — 미전송·미저장으로 응답)' })
  @ApiResponse({ status: 201, description: '보고 작성 결과(전송 여부 포함)' })
  async reportKonis(@Body() data: KonisReportDto) {
    const report = await this.service.reportKonis(data);
    return {
      data: report,
      meta: { status: report.transmitted ? 'submitted' : 'not_transmitted', persisted: report.persisted },
    };
  }

  @Get('konis/stats')
  @RequirePermission(Permission.AUDIT_VIEW)
  @ApiOperation({ summary: 'KONIS 통계 조회' })
  @ApiResponse({ status: 200, description: 'KONIS 통계 반환' })
  async getKonisStats(@Query('period') period?: string) {
    return { data: await this.service.getKonisStats(period) };
  }

  @Get('resistance/patterns')
  @RequirePermission(Permission.PATIENT_VIEW)
  @ApiOperation({ summary: '항균제 내성 패턴 조회' })
  @ApiResponse({ status: 200, description: '내성 패턴 반환' })
  async getResistancePatterns(@Query('organism') organism?: string) {
    return { data: await this.service.getResistancePatterns(organism) };
  }

  @Post('resistance/surveillance')
  @RequirePermission(Permission.ENCOUNTER_EDIT)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '내성 감시 케이스 등록(MDRO 레지스트리에 영속)' })
  @ApiResponse({ status: 201, description: '내성 케이스 등록 완료' })
  async createResistanceSurveillance(@Body() data: CreateResistanceSurveillanceDto, @CurrentUser('id') userId: string) {
    const result = await this.service.createResistanceSurveillance({ ...data }, userId);
    return { data: result, meta: { status: 'created', persisted: result.persisted } };
  }

  @Post('isolation/assign')
  @RequirePermission(Permission.ENCOUNTER_EDIT)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '격리 오더 발행(영속)' })
  @ApiResponse({ status: 201, description: '격리 오더 발행 완료' })
  async assignIsolationRoom(@Body() data: AssignIsolationDto, @CurrentUser('id') userId: string) {
    const assignment = await this.service.assignIsolationRoom({ ...data }, userId);
    return { data: assignment, meta: { status: 'assigned' } };
  }

  @Put('isolation/:id/release')
  @RequirePermission(Permission.ENCOUNTER_EDIT)
  @ApiOperation({ summary: '격리 해제' })
  @ApiResponse({ status: 200, description: '격리 해제 완료' })
  async releaseIsolation(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') userId: string,
    @Body() body?: ReleaseIsolationDto,
  ) {
    const result = await this.service.releaseIsolation(id, userId, body?.reason);
    return { data: result };
  }

  @Get('isolation/list')
  @RequirePermission(Permission.PATIENT_VIEW)
  @ApiOperation({ summary: '현재 격리 환자 목록' })
  @ApiResponse({ status: 200, description: '격리 환자 목록 반환' })
  async getIsolationList() {
    return { data: await this.service.getIsolationList() };
  }

  @Get('isolation/patient/:patientId')
  @RequirePermission(Permission.PATIENT_VIEW)
  @ApiOperation({ summary: '환자 격리 상태(배너·차트) — 활성 격리+PPE 프로토콜' })
  async getPatientIsolationStatus(@Param('patientId', ParseUUIDPipe) patientId: string) {
    return { data: await this.service.getPatientIsolationStatus(patientId) };
  }

  /* ── 직원 혈액·체액 노출 사고(니들스틱) ──────────────────────────────────────
   * 🔴 권한 재검토 2026-08-18 — 종전 접수=`PATIENT_EDIT` · 열람=`AUDIT_VIEW`.
   *    둘 다 **다른 업무의 권한**이라 실제 필요와 어긋나 있었다:
   *     - `PATIENT_EDIT` 보유자는 ADMIN·NURSE·RECEPTIONIST 뿐이다. 예리물을 가장 많이
   *       다루는 **의사·약사·검사기사가 자기 니들스틱을 신고할 수 없었고**, 반대로 예리물을
   *       다루지 않는 원무 접수는 열려 있었다. 신고를 막으면 사고는 사라지는 게 아니라
   *       **기록되지 않을 뿐**이다(산업안전보건법·감염관리 법정기록).
   *     - `AUDIT_VIEW` 에는 CRM_MANAGER 가 포함돼, 마케팅 담당이 동료의 HIV 노출 이력을
   *       전건 열람할 수 있었다.
   *  → 신고·본인 이력 = `STAFF_EXPOSURE_REPORT`(READ 서비스계정 제외 전 직군)
   *     타인 이력·추적관찰/PEP 갱신 = `STAFF_EXPOSURE_MANAGE`(ADMIN·DOCTOR·NURSE)
   */

  @Post('staff-exposure')
  @RequirePermission(Permission.STAFF_EXPOSURE_REPORT)
  @HttpCode(HttpStatus.CREATED)
  // 🔴 2026-08-18: 전용 모델 `StaffExposureIncident` 로 **영속**된다(종전=프로세스 메모리·배포마다 소실).
  @ApiOperation({ summary: '직원 혈액·체액 노출 사고 접수(영속 기록)' })
  @ApiResponse({ status: 201, description: '노출 사고 접수' })
  async recordStaffExposure(@Body() dto: RecordStaffExposureDto, @CurrentUser('id') userId: string) {
    const exposure = await this.service.recordStaffExposure(dto, userId);
    return { data: exposure, meta: { persisted: true, followUpStatus: exposure.followUpStatus } };
  }

  /**
   * 본인 노출 이력 — 🔴 `:id` 보다 **먼저** 선언한다(라우트 선언 순서가 매칭 순서다).
   * 신고한 사람이 자기 추적관찰 상태를 확인하는 경로라 REPORT 권한만으로 열린다.
   */
  @Get('staff-exposure/mine')
  @RequirePermission(Permission.STAFF_EXPOSURE_REPORT)
  @ApiOperation({ summary: '본인 직원 노출 이력(self-scope · 0=본인 접수 기록 없음)' })
  async getMyStaffExposures(@CurrentUser('id') userId: string) {
    return { data: await this.service.getMyStaffExposures(userId) };
  }

  @Get('staff-exposure')
  @RequirePermission(Permission.STAFF_EXPOSURE_MANAGE)
  @ApiOperation({ summary: '전 직원 노출 이력 조회(감염관리 · 0=접수된 기록 없음)' })
  @ApiResponse({ status: 200, description: '노출 이력 반환' })
  async getStaffExposures(
    @Query('staffId') staffId?: string,
    @Query('followUpStatus') followUpStatus?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return { data: await this.service.getStaffExposures({ staffId, followUpStatus, from, to }) };
  }

  /** 상세 — 본인 기록이면 REPORT 로, 타인 기록이면 MANAGE 가 있어야 열린다(서비스에서 판정) */
  @Get('staff-exposure/:id')
  @RequirePermission(Permission.STAFF_EXPOSURE_REPORT)
  @ApiOperation({ summary: '직원 노출 사고 상세(본인 기록 또는 감염관리 권한)' })
  async getStaffExposureDetail(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: { id: string; role: UserRole },
  ) {
    const canManage = this.permissions.hasPermission(
      { userId: user.id, userRole: user.role },
      Permission.STAFF_EXPOSURE_MANAGE,
    );
    return { data: await this.service.getStaffExposureDetail(id, { userId: user.id, canManage }) };
  }

  @Put('staff-exposure/:id/follow-up')
  @RequirePermission(Permission.STAFF_EXPOSURE_MANAGE)
  @ApiOperation({ summary: '직원 노출 사고 추적관찰 갱신(종결 시에만 closedAt 기록)' })
  async updateStaffExposureFollowUp(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStaffExposureFollowUpDto,
  ) {
    return { data: await this.service.updateStaffExposureFollowUp(id, dto) };
  }

  @Get('dashboard')
  @RequirePermission(Permission.AUDIT_VIEW)
  @ApiOperation({ summary: '종합 감염 대시보드' })
  @ApiResponse({ status: 200, description: '대시보드 데이터 반환' })
  async getInfectionDashboard() {
    return { data: await this.service.getInfectionDashboard() };
  }

  // ── 보강(P1~P3): HAI·MDRO·법정감염병 ──

  @Post('hai-cases')
  @RequirePermission(Permission.ENCOUNTER_EDIT)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'HAI 케이스 등록(CLABSI/CAUTI/VAP/SSI)' })
  async createHaiCase(@Body() dto: CreateHaiCaseDto, @CurrentUser('id') userId: string) {
    return { data: await this.service.createHaiCase(dto, userId) };
  }

  @Get('hai-cases')
  @RequirePermission(Permission.PATIENT_VIEW)
  @ApiOperation({ summary: 'HAI 케이스 목록' })
  async listHaiCases(@Query('status') status?: string, @Query('haiType') haiType?: string) {
    return { data: await this.service.listHaiCases(status, haiType) };
  }

  @Get('hai-cases/stats')
  @RequirePermission(Permission.PATIENT_VIEW)
  @ApiOperation({ summary: 'HAI 통계(유형별·KONIS 미보고)' })
  async haiStats() {
    return { data: await this.service.haiStats() };
  }

  @Put('hai-cases/:id/resolve')
  @RequirePermission(Permission.ENCOUNTER_EDIT)
  @ApiOperation({ summary: 'HAI 케이스 종결(+KONIS 보고 — 수기 근거번호 있을 때만 보고완료)' })
  async resolveHaiCase(
    @Param('id') id: string,
    @Body() body: ResolveHaiCaseDto,
    @CurrentUser('id') userId: string,
  ) {
    const result = await this.service.resolveHaiCase(id, body, userId);
    return { data: result, meta: { konis: result.konis } };
  }

  @Post('mdro')
  @RequirePermission(Permission.ENCOUNTER_EDIT)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'MDRO 레지스트리 등록' })
  async addMdro(@Body() dto: CreateMdroDto, @CurrentUser('id') userId: string) {
    return { data: await this.service.addMdro(dto, userId) };
  }

  @Get('mdro')
  @RequirePermission(Permission.PATIENT_VIEW)
  @ApiOperation({ summary: 'MDRO 목록(활성)' })
  async listMdro(@Query('all') all?: string) {
    return { data: await this.service.listMdro(all !== 'true') };
  }

  @Get('mdro/stats')
  @RequirePermission(Permission.PATIENT_VIEW)
  @ApiOperation({ summary: 'MDRO 통계(유형별)' })
  async mdroStats() {
    return { data: await this.service.mdroStats() };
  }

  @Put('mdro/:id/clear')
  @RequirePermission(Permission.ENCOUNTER_EDIT)
  @ApiOperation({ summary: 'MDRO 해제(음전)' })
  async clearMdro(@Param('id') id: string) {
    return { data: await this.service.clearMdro(id) };
  }

  @Post('notifiable')
  @RequirePermission(Permission.ENCOUNTER_EDIT)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '법정감염병 신고 작성' })
  async createNotifiable(@Body() dto: CreateNotifiableDto, @CurrentUser('id') userId: string) {
    return { data: await this.service.createNotifiable(dto, userId) };
  }

  @Get('notifiable')
  @RequirePermission(Permission.PATIENT_VIEW)
  @ApiOperation({ summary: '법정감염병 신고 목록' })
  async listNotifiable(@Query('status') status?: string) {
    return { data: await this.service.listNotifiable(status) };
  }

  // 🔴 '제출'은 전송 결과대로만 기록된다 — 질병관리청 연동이 없으면 원내 접수(미전송)다.
  @Put('notifiable/:id/submit')
  @RequirePermission(Permission.ENCOUNTER_EDIT)
  @ApiOperation({ summary: '법정감염병 신고 제출(질병관리청 전송 결과대로 기록 — 미전송 시 재제출 가능)' })
  async submitNotifiable(@Param('id') id: string, @CurrentUser('id') userId: string) {
    const result = await this.service.submitNotifiable(id, userId);
    return { data: result, meta: { transmission: result.transmission } };
  }

}
