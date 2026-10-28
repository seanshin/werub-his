import { Controller, Get, Post, Patch, Param, Body, Query, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Permission } from '../auth/rbac/permission.types';
import { PermissionService } from '../auth/rbac/permission.service';
import { PatientSafetyService, type IncidentViewer } from './patient-safety.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ReportIncidentDto, AssessFallRiskDto, UpdateIncidentStatusDto, CreateRestraintDto, RestraintMonitoringDto, RenewRestraintDto, EwsCalculateDto, KopsManualReportDto } from './dto/patient-safety.dto';
import { UpsertRcaDto } from './dto/rca.dto';
import { AssessMorseFallDto, CreateIdentificationCheckDto } from './dto/id-check-morse.dto';

/**
 * 🔴 환자안전사고 보고는 **모든 직군의 일**이다(환자안전법 §14).
 *    종전 클래스 `@Roles(DOCTOR, NURSE, ADMIN)` 하나가 보고까지 막아, 투약오류(운영 12건)를
 *    다루는 약사와 검체라벨 오류(10건)를 다루는 검사기사가 **자기 직군 사고를 신고할 수 없었다.**
 *    실제로 운영 75건의 보고자는 전건 NURSE 였다 — 남이 대신 적어준 기록이라는 뜻이다.
 *    READ 는 사람이 아니라 외부 연동 서비스계정이라 제외한다(permission.types.ts 와 동일 판단).
 */
const REPORTING_ROLES = [
  UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE, UserRole.PHARMACIST, UserRole.LAB_TECH,
  UserRole.RECEPTIONIST, UserRole.NUTRITION, UserRole.ADMIN_STAFF, UserRole.MEDICAL_RECORDS,
  UserRole.CHECKUP, UserRole.CRM_MANAGER, UserRole.CRM_STAFF, UserRole.EXECUTIVE,
] as const;

@ApiTags('Patient Safety (IPSG)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
@Controller('api/v1/safety')
export class PatientSafetyController {
  constructor(
    private readonly service: PatientSafetyService,
    private readonly permissions: PermissionService,
  ) {}

  /**
   * 보는 사람의 열람 범위 — `safety:incident:review` 가 없으면 **본인 보고 건만**.
   * 🔴 역할이 아니라 권한으로 판정한다: 병원이 /admin/rbac 에서 전담인력 직군만 남길 수 있어야 한다.
   */
  private viewerOf(user: { id: string; role: UserRole }): IncidentViewer {
    return {
      userId: user.id,
      canReviewAll: this.permissions.hasPermission(
        { userId: user.id, userRole: user.role },
        Permission.SAFETY_INCIDENT_REVIEW,
      ),
    };
  }

  @Post('incidents')
  @Roles(...REPORTING_ROLES)
  @RequirePermission(Permission.SAFETY_INCIDENT_REPORT)
  @ApiOperation({ summary: '안전 사고 보고 — 전 직군(환자안전법 §14)' })
  async report(@Body() dto: ReportIncidentDto, @CurrentUser('id') userId: string) { return { data: await this.service.reportIncident({ ...dto, reporterId: userId }) }; }

  /** KOPS 직접 보고 기록(2026-10-09) — 송신 채널이 없는 동안 사람이 KOPS 웹에 보고한 접수번호·시각 · 한 번 */
  @Post('incidents/:id/kops-manual')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @RequirePermission(Permission.SAFETY_INCIDENT_REVIEW)
  @ApiOperation({ summary: 'KOPS 직접 보고 기록(접수번호·보고 시각 · 기관 접수는 시스템이 확인하지 않음)' })
  async recordKopsManual(@Param('id', ParseUUIDPipe) id: string, @Body() dto: KopsManualReportDto, @CurrentUser('id') userId: string) {
    return { data: await this.service.recordKopsManual(id, dto, userId) };
  }

  // ── 근본원인분석(RCA·P2-G) ──
  @Get('rca')
  @RequirePermission(Permission.SAFETY_INCIDENT_REVIEW)
  @ApiOperation({ summary: 'RCA 목록(status 필터)' })
  async listRca(@Query('status') status?: string) { return { data: await this.service.listRca(status) }; }

  // 🔴 `@Body() body: Record<string, unknown>` → DTO. 인라인 Object 는 ValidationPipe 가 스킵한다.
  @Post('incidents/:id/rca')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @RequirePermission(Permission.SAFETY_INCIDENT_REVIEW)
  @ApiOperation({ summary: '적신호사건 RCA 작성/갱신(upsert)' })
  async createRca(@Param('id', ParseUUIDPipe) id: string, @Body() body: UpsertRcaDto, @CurrentUser('id') userId: string) {
    return { data: await this.service.createRca(id, body, userId) };
  }

  @Patch('incidents/:id/rca')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @RequirePermission(Permission.SAFETY_INCIDENT_REVIEW)
  @ApiOperation({ summary: 'RCA 갱신(findings·기여요인·개선계획·status)' })
  async updateRca(@Param('id', ParseUUIDPipe) id: string, @Body() body: UpsertRcaDto) {
    return { data: await this.service.updateRca(id, body) };
  }

  @Post('incidents/:id/rca/approve')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @RequirePermission(Permission.SAFETY_INCIDENT_REVIEW)
  @ApiOperation({ summary: 'RCA 승인(완료) — rcaCompleted 연동' })
  async approveRca(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('id') userId: string) {
    return { data: await this.service.approveRca(id, userId) };
  }

  @Get('incidents/:id/rca')
  @RequirePermission(Permission.SAFETY_INCIDENT_REVIEW)
  @ApiOperation({ summary: 'RCA 조회' })
  async getRca(@Param('id', ParseUUIDPipe) id: string) { return { data: await this.service.getRca(id) }; }

  /**
   * 사고 목록 — 🔴 **열람 범위는 권한이 정한다.**
   * `safety:incident:review` 보유자는 전건, 나머지(보고만 가능한 직군)는 **본인이 보고한 건만**.
   * 어느 경우에도 `reporterId` 는 응답에 실리지 않는다(patient-safety.select.ts).
   */
  @Get('incidents')
  @Roles(...REPORTING_ROLES)
  @RequirePermission(Permission.SAFETY_INCIDENT_REPORT, Permission.SAFETY_INCIDENT_REVIEW)
  @ApiOperation({ summary: '사고 목록(전담인력=전건 · 그 외=본인 보고 건)' })
  async getIncidents(
    @CurrentUser() user: { id: string; role: UserRole },
    @Query('type') type?: string,
    @Query('severity') severity?: string,
    @Query('status') status?: string,
  ) { return { data: await this.service.getIncidents({ type, severity, status }, this.viewerOf(user)) }; }

  @Patch('incidents/:id/status')
  @RequirePermission(Permission.SAFETY_INCIDENT_REVIEW)
  @ApiOperation({ summary: '사고 상태 변경(조사) — 전담인력' })
  async updateStatus(@Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateIncidentStatusDto, @CurrentUser('id') userId: string) { return { data: await this.service.updateIncidentStatus(id, body.status, body.actionTaken, userId) }; }

  @Post('fall-risk')
  @ApiOperation({ summary: '낙상 위험 평가' })
  async assessFall(@Body() dto: AssessFallRiskDto, @CurrentUser('id') userId: string) { return { data: await this.service.assessFallRisk({ ...dto, assessorId: userId }) }; }

  @Get('fall-risk/:patientId')
  @ApiOperation({ summary: '환자 낙상 위험 이력' })
  async getFallRisk(@Param('patientId', ParseUUIDPipe) patientId: string) { return { data: await this.service.getPatientFallRisk(patientId) }; }

  @Get('isolation/:patientId')
  @ApiOperation({ summary: '환자 활성 격리 신호 (MDRO·감염감시 병합) — 차트 안전배지' })
  async getIsolation(@Param('patientId', ParseUUIDPipe) patientId: string) { return { data: await this.service.getPatientIsolation(patientId) }; }

  @Get('incidents/stats')
  @ApiOperation({ summary: '안전 사고 통계' })
  async getStats() { return { data: await this.service.getIncidentStats() }; }

  @Get('ipsg-summary')
  @ApiOperation({ summary: 'IPSG 통합 요약 — 위기값·감염·손위생·낙상(국제환자안전목표)' })
  async getIpsgSummary() { return await this.service.getIpsgSummary(); }

  @Get('incidents/:id')
  @Roles(...REPORTING_ROLES)
  @RequirePermission(Permission.SAFETY_INCIDENT_REPORT, Permission.SAFETY_INCIDENT_REVIEW)
  @ApiOperation({ summary: '사고 상세(전담인력=전건 · 그 외=본인 보고 건)' })
  async getIncidentById(@CurrentUser() user: { id: string; role: UserRole }, @Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.service.getIncidentById(id, this.viewerOf(user)) };
  }

  // ── NEWS2 조기경보점수 ──

  @Post('ews/calculate')
  @ApiOperation({ summary: 'NEWS2 계산 + 저장' })
  async calculateEws(
    @Body() body: EwsCalculateDto,
    @CurrentUser('id') nurseId: string,
  ) { return { data: await this.service.calculateAndSaveEws(body.patientId, nurseId, body) }; }

  @Get('ews/patient/:patientId')
  @ApiOperation({ summary: '환자별 EWS 추이' })
  async getPatientEws(@Param('patientId', ParseUUIDPipe) patientId: string) { return { data: await this.service.getPatientEws(patientId) }; }

  @Get('ews/high-risk')
  @ApiOperation({ summary: '고위험 EWS 환자 목록' })
  async getHighRiskEws() { return { data: await this.service.getHighRiskEws() }; }

  // ── 환자 식별 체크 ──

  @Post('identification-check')
  @ApiOperation({ summary: '환자 식별 체크' })
  async createIdCheck(@Body() body: CreateIdentificationCheckDto, @CurrentUser('id') userId: string) {
    return { data: await this.service.createIdCheck({ ...body, verifiedBy: userId }) };
  }

  @Get('identification-check/stats')
  @ApiOperation({ summary: '환자 식별 통계 (IPSG.1 오류율)' })
  async getIdCheckStats(@Query('dateFrom') dateFrom?: string, @Query('dateTo') dateTo?: string) {
    return { data: await this.service.getIdCheckStats({ dateFrom, dateTo }) };
  }

  @Get('identification-check/patient/:patientId')
  @ApiOperation({ summary: '환자 식별 체크 이력' })
  async getPatientIdChecks(@Param('patientId', ParseUUIDPipe) patientId: string) {
    return { data: await this.service.getPatientIdChecks(patientId) };
  }

  // ── Read-back 확인 ──

  /**
   * 🔴 이 목록이 없어서 확인 EP 는 호출부가 0이었다 — **부를 화면이 없었기 때문**이다(F3·2026-08-26).
   *    막지 않고(구두처방은 막으면 환자가 방치된다) **줄어드는 목록**으로 가시화한다.
   */
  @Get('read-back/pending')
  @ApiOperation({ summary: '구두·전화 처방 복창(read-back) 미확인 목록 — 줄어드는 워크리스트' })
  async pendingReadBacks(@Query('limit') limit?: string) {
    const n = Number(limit);
    return { data: await this.service.getPendingReadBacks(Number.isFinite(n) && n > 0 ? n : 100) };
  }

  @Patch('read-back/:prescriptionId')
  @ApiOperation({ summary: '구두/전화 처방 Read-back 확인' })
  async confirmReadBack(@Param('prescriptionId', ParseUUIDPipe) id: string, @CurrentUser('id') userId: string) {
    return { data: await this.service.confirmReadBack(id, userId) };
  }

  // ── Morse Fall Scale ──

  @Post('morse-fall-scale')
  @ApiOperation({ summary: 'Morse Fall Scale 자동 계산 + 저장' })
  async assessMorseFall(@Body() body: AssessMorseFallDto, @CurrentUser('id') userId: string) {
    return { data: await this.service.assessMorseFallRisk({ ...body, assessorId: userId }) };
  }

  // ── 신체보호대 (Restraint) ──

  @Post('restraints')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN) // 신체보호대는 의사 오더(법적 의료행위 지시) — 간호사 단독 처방 차단
  @ApiOperation({ summary: '신체보호대 처방 (의사 오더)' })
  async createRestraint(@Body() body: CreateRestraintDto, @CurrentUser('id') userId: string) {
    return { data: await this.service.createRestraintOrder(userId, body) };
  }

  @Post('restraints/:id/renew')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN) // 갱신도 의사 재오더
  @ApiOperation({ summary: '신체보호대 갱신 (기존 해제 + 신규 의사 오더)' })
  async renewRestraint(@Param('id', ParseUUIDPipe) id: string, @Body() body: RenewRestraintDto, @CurrentUser('id') userId: string) {
    return { data: await this.service.renewRestraintOrder(userId, id, body) };
  }

  @Get('restraints/active')
  @ApiOperation({ summary: '적용 중 신체보호대 목록 (점검 경과 포함)' })
  async getActiveRestraints() {
    return { data: await this.service.getActiveRestraints() };
  }

  @Get('restraints/:id')
  @ApiOperation({ summary: '신체보호대 상세 + 점검 이력' })
  async getRestraintDetail(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.service.getRestraintDetail(id) };
  }

  @Post('restraints/:id/monitoring')
  @ApiOperation({ summary: '신체보호대 모니터링 점검 기록' })
  async recordRestraintMonitoring(@Param('id', ParseUUIDPipe) id: string, @Body() body: RestraintMonitoringDto, @CurrentUser('id') userId: string) {
    return { data: await this.service.recordRestraintMonitoring(id, userId, body) };
  }

  @Patch('restraints/:id/discontinue')
  @ApiOperation({ summary: '신체보호대 해제' })
  async discontinueRestraint(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('id') userId: string) {
    return { data: await this.service.discontinueRestraint(id, userId) };
  }
}
