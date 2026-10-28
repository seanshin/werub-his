import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Permission } from '../auth/rbac/permission.types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PatientDaysService } from './patient-days.service';
import { MonthCloseService } from './month-close.service';
import { QiReportService } from './qi-report.service';
import { QiAgendaService } from './qi-agenda.service';
import { DeviceDaysService } from './device-days.service';
import { AccreditationService } from './accreditation.service';
import { QiFlowSettingsService } from './qi-flow-settings.service';
import { DeviceLineService } from './device-line.service';
import {
  AccreditationAssessDto, CreateAccreditationStandardDto, DateRangeDto, DeviceDayDto, DeviceLineQueryDto, DeviceLineRecordDto, DeviceLineRemoveDto, DeviceLineVoidDto, NoteDto,
  PeriodDto, PeriodQueryDto, SpcQueryDto, TargetAgendaDto,
} from './quality-flow.dto';

/**
 * 의료질관리 흐름(QI-FLOW-001 · 2026-10-08) — 측정 → 분석 → 판정 → 경보 → 개선 → 보고 고리를 잇는 EP.
 * 읽기 = 질 지표 화면 역할(관리자·의사·간호사) · 원장을 쓰는 일은 관리자(측정 입력 권한) · 안건 제안은 화면 사용자.
 */
@ApiTags('Quality Flow (질관리 흐름)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/quality-flow')
export class QualityFlowController {
  constructor(
    private readonly patientDays: PatientDaysService,
    private readonly monthClose: MonthCloseService,
    private readonly reports: QiReportService,
    private readonly agendas: QiAgendaService,
    private readonly deviceDays: DeviceDaysService,
    private readonly accreditation: AccreditationService,
    private readonly settings: QiFlowSettingsService,
    private readonly deviceLines: DeviceLineService,
  ) {}

  // ── 사람 결정 상태(읽기만) — 화면이 "결정 전이라 닫혀 있다"를 그 자리에서 말하게 ──
  // 🔴 역할을 좁히지 않는다 — 사고 보고는 전 직원이 하고, 보고 폼이 익명·위해 척도 결정을 읽어야 한다(PHI 아님 · 정책 값만)
  @Get('settings')
  @ApiOperation({ summary: 'QI 흐름 사람 결정이 바인딩된 설정 현황(값·출처 SET/DEFAULT·결정 키) — 바꾸는 길은 위원회 의결' })
  async flowSettings() {
    return { data: await this.settings.read() };
  }

  // ── 분모: 재원일수 ──
  @Get('patient-days')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  @ApiOperation({ summary: '재원일수 스냅샷 요약(기간 · 날짜별·병동별 · 덮은 날 수)' })
  async patientDaysSummary(@Query() q: DateRangeDto) {
    return { data: await this.patientDays.summary(q.from, q.to) };
  }

  @Post('patient-days/rebuild')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '재원일수 스냅샷 기간 재계산(최대 400일 · 끝난 날만)' })
  async rebuildPatientDays(@Body() dto: DateRangeDto) {
    return { data: await this.patientDays.rebuild(dto.from, dto.to) };
  }

  // ── 측정: 공급원 미리보기 · 월 마감 ──
  @Get('indicators/:id/preview')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  @ApiOperation({ summary: '지표 한 달 자동 산출 미리보기(쓰지 않음) — 공급원 결과·산출 불가 이유·그 달 원장 행' })
  async preview(@Param('id', ParseUUIDPipe) id: string, @Query() q: PeriodDto) {
    return { data: await this.monthClose.preview(id, q.period) };
  }

  @Post('month-close')
  @Roles(UserRole.ADMIN)
  @RequirePermission(Permission.QI_MEASURE_WRITE)
  @ApiOperation({ summary: '월 마감 — 공급원 지표 자동 기록(수기 행은 덮지 않음)·CPOE 기록·판정·미달/미입력 알림' })
  async closeMonth(@Body() dto: PeriodDto, @CurrentUser('id') userId: string) {
    return { data: await this.monthClose.closeMonth(dto.period, { trigger: 'MANUAL', actorId: userId }) };
  }

  // ── 분석: 관리도 ──
  @Get('indicators/:id/spc')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  @ApiOperation({ summary: '지표 관리도(p·u — 지표 종류대로) · 병원 전체 정본 행' })
  async spc(@Param('id', ParseUUIDPipe) id: string, @Query() q: SpcQueryDto) {
    return { data: await this.monthClose.spc(id, q.months ?? 24) };
  }

  // ── 목표: 위원회 안건 ──
  @Post('indicators/:id/agenda')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  @ApiOperation({ summary: '질 지표 목표를 위원회(QPS) 안건으로 — 후보 1~3 + 정하지 않음 · 의결되면 엔진이 반영(화면은 바꾸지 않음)' })
  async targetAgenda(@Param('id', ParseUUIDPipe) id: string, @Body() dto: TargetAgendaDto, @CurrentUser('id') userId: string) {
    return { data: await this.agendas.proposeTarget(id, dto, userId) };
  }

  @Post('incidents/:id/agenda')
  @RequirePermission(Permission.SAFETY_INCIDENT_REVIEW)
  @ApiOperation({ summary: '환자안전사고를 위원회(SAFE) 검토 안건으로 — 식별정보·서술 본문 없이' })
  async incidentAgenda(@Param('id', ParseUUIDPipe) id: string, @Body() dto: NoteDto, @CurrentUser('id') userId: string) {
    return { data: await this.agendas.proposeIncidentReview(id, dto.note, userId) };
  }

  // ── 보고: 보고서 원장 ──
  @Get('reports')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  @ApiOperation({ summary: 'QI 보고서 목록' })
  async listReports(@Query() q: PeriodQueryDto) {
    return { data: await this.reports.list(q.period) };
  }

  @Get('reports/:id')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  @ApiOperation({ summary: 'QI 보고서 한 판(본문·읽은 측정 행 id·sha256)' })
  async getReport(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.reports.get(id) };
  }

  @Post('reports')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'QI 보고서 만들기(끝난 달) — 본문·측정 행 id 보존' })
  async createReport(@Body() dto: PeriodDto, @CurrentUser('id') userId: string) {
    return { data: await this.reports.create(dto.period, userId) };
  }

  @Post('reports/:id/submit')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'QI 보고서를 위원회(QPS) 안건으로' })
  async submitReport(@Param('id', ParseUUIDPipe) id: string, @Body() dto: NoteDto, @CurrentUser('id') userId: string) {
    return { data: await this.reports.submit(id, userId, dto.note) };
  }

  // ── 분모: 기구일수 ──
  @Get('device-days')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  @ApiOperation({ summary: '기구일수 월 입력 목록 · 입력 열림 여부(결정 qi.deviceDays.source)' })
  async listDeviceDays(@Query() q: PeriodDto) {
    return { data: await this.deviceDays.list(q.period) };
  }

  @Put('device-days')
  @Roles(UserRole.ADMIN, UserRole.NURSE)
  @ApiOperation({ summary: '기구일수 입력(병동×월×기구 · MANUAL 결정일 때만)' })
  async putDeviceDays(@Body() dto: DeviceDayDto, @CurrentUser('id') userId: string) {
    return { data: await this.deviceDays.upsert(dto, userId) };
  }

  // ── 분모: 기구 삽입·제거 원장(결정 qi.deviceDays.source = DEVICE_LEDGER 의 원천 · 기록은 결정과 무관한 임상 사실) ──
  @Get('device-lines')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  @ApiOperation({ summary: '기구 원장 — 환자·입원별(무효 제외 · includeVoided=true 로 포함)' })
  async listDeviceLines(@Query() q: DeviceLineQueryDto) {
    return { data: await this.deviceLines.list({ patientId: q.patientId, admissionId: q.admissionId, includeVoided: q.includeVoided === 'true' }) };
  }

  @Post('device-lines')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  @ApiOperation({ summary: '기구 삽입 기록(중심정맥관·유치도뇨관·인공호흡기 · 미래 시각 불가)' })
  async recordDeviceLine(@Body() dto: DeviceLineRecordDto, @CurrentUser('id') userId: string) {
    return { data: await this.deviceLines.record(dto, userId) };
  }

  @Patch('device-lines/:id/remove')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  @ApiOperation({ summary: '기구 제거 기록 — 한 번 · 삽입 이후 · 미래 불가' })
  async removeDeviceLine(@Param('id', ParseUUIDPipe) id: string, @Body() dto: DeviceLineRemoveDto, @CurrentUser('id') userId: string) {
    return { data: await this.deviceLines.remove(id, dto, userId) };
  }

  @Post('device-lines/:id/void')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  @ApiOperation({ summary: '잘못 넣은 기구 기록 무효(사유 5자 이상 · 지우지 않음)' })
  async voidDeviceLine(@Param('id', ParseUUIDPipe) id: string, @Body() dto: DeviceLineVoidDto, @CurrentUser('id') userId: string) {
    return { data: await this.deviceLines.void(id, dto.reason, userId) };
  }

  // ── 인증 ──
  @Get('accreditation')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  @ApiOperation({ summary: '인증 기준·최근 평가(자가/확인 구분) · 허용 체계(결정 accreditation.framework)' })
  async accreditationList() {
    return { data: await this.accreditation.list() };
  }

  @Post('accreditation/standards')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '인증 기준 등록(체계가 정해진 뒤 · 원문을 보고 입력)' })
  async createStandard(@Body() dto: CreateAccreditationStandardDto, @CurrentUser('id') userId: string) {
    return { data: await this.accreditation.createStandard(dto, userId) };
  }

  @Get('accreditation/standards/:id')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  @ApiOperation({ summary: '인증 기준 평가 이력(덧붙이기만)' })
  async standardHistory(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.accreditation.history(id) };
  }

  @Post('accreditation/standards/:id/assessments')
  @Roles(UserRole.ADMIN, UserRole.NURSE)
  @ApiOperation({ summary: '자체 평가 기록(덧붙이기 · 부분/미충족은 근거 필수)' })
  async assess(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AccreditationAssessDto, @CurrentUser('id') userId: string) {
    return { data: await this.accreditation.assess(id, dto, userId) };
  }

  @Post('accreditation/assessments/:id/verify')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '자체 평가 확인 — 평가자 본인 불가 · 한 번' })
  async verify(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('id') userId: string) {
    return { data: await this.accreditation.verify(id, userId) };
  }
}
