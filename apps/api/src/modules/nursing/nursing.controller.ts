import {
  Controller, Get, Post, Patch, Param, Body, Query,
  UseGuards, ParseUUIDPipe, ParseIntPipe,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { NursingService } from './nursing.service';
import { CreateNursingAssessmentDto } from './dto/create-nursing-assessment.dto';
import { CreateNursingNoteDto } from './dto/create-nursing-note.dto';
import { CreateIntakeOutputDto } from './dto/create-intake-output.dto';
import { CreateFlowSheetEntryDto } from './dto/create-flowsheet-entry.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AdministerMedDto, HoldMedDto, CreateNursingDiagnosisDto } from './dto/nursing-extra.dto';
import { AuditAiRead } from '../audit/no-audit.decorator';
import { AddNursingInterventionDto, AddNursingOutcomeDto } from './dto/care-plan.dto';
import {
  CreateNursingChecklistDto, EvaluateNursingOutcomeDto, ToggleNursingChecklistItemDto, UpdateNursingInterventionStatusDto,
  UpsertNursingChecklistTemplateDto,
} from './dto/nursing-checklist-write.dto';

@ApiTags('Nursing')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/admissions/:admissionId')
export class NursingController {
  constructor(private readonly nursingService: NursingService) {}

  // ── 간호초기평가 ──

  @Post('nursing-assessment')
  @Roles(UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '간호초기평가 작성' })
  async createAssessment(
    @Param('admissionId', ParseUUIDPipe) admissionId: string,
    @Body() dto: CreateNursingAssessmentDto,
    @CurrentUser('id') nurseId: string,
  ) {
    const assessment = await this.nursingService.createAssessment(admissionId, dto, nurseId);
    return { data: assessment };
  }

  @Get('nursing-assessment')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '간호초기평가 조회' })
  async getAssessment(@Param('admissionId', ParseUUIDPipe) admissionId: string) {
    const assessment = await this.nursingService.getAssessment(admissionId);
    return { data: assessment };
  }

  // ── 간호일지 ──

  @Post('nursing-notes')
  @Roles(UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '간호일지 작성 (Focus Charting)' })
  async createNote(
    @Param('admissionId', ParseUUIDPipe) admissionId: string,
    @Body() dto: CreateNursingNoteDto,
    @CurrentUser('id') nurseId: string,
  ) {
    const note = await this.nursingService.createNote(admissionId, dto, nurseId);
    return { data: note };
  }

  @Get('nursing-notes')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '간호일지 목록' })
  async getNotes(
    @Param('admissionId', ParseUUIDPipe) admissionId: string,
    @Query('shiftType') shiftType?: string,
    @Query('date') date?: string,
  ) {
    const [notes, lateEntryRule] = await Promise.all([
      this.nursingService.getNotes(admissionId, { shiftType, date }),
      this.nursingService.lateEntryRule(),
    ]);
    // meta.lateEntryRule — 늦은 기록 표시의 기준(유예 분·원내 규정 설정 여부)
    return { data: notes, meta: { lateEntryRule } };
  }

  @Post('nursing-notes/ai-draft')
  @Roles(UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '간호기록 AI 근거기반 초안(F-1·게이트·DRAFT 미생성·간호사 검토·서명 필수)' })
  async aiDraft(
    @Param('admissionId', ParseUUIDPipe) admissionId: string,
    @Body() body: { noteType?: string },
    @CurrentUser('id') nurseId: string,
  ) {
    // 🔴 초안 생성자는 제안 원장(`AiProposal.createdBy`)의 주체다 — 익명 초안을 만들지 않는다
    return { data: await this.nursingService.generateNursingDraft(admissionId, body?.noteType ?? 'SOAP', nurseId) };
  }

  @Get('nursing-notes/:noteId/qa')
  @Roles(UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '간호기록 품질검사(F-4·룰기반·서명 전 권고·게이트 nursing.aiAssist.enabled)' })
  async noteQa(
    @Param('admissionId', ParseUUIDPipe) admissionId: string,
    @Param('noteId', ParseUUIDPipe) noteId: string,
  ) {
    return { data: await this.nursingService.nursingNoteQa(admissionId, noteId) };
  }

  @Post('nursing-notes/qa-check')
  @Roles(UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: 'F-4 작성 중 품질검사(저장 전·form 콘텐츠·인라인 경고·게이트)' })
  async noteQaCheck(@Body() body: { noteType: string; subjective?: string; objective?: string; assessment?: string; plan?: string; focus?: string; data?: string; action?: string; response?: string; education?: string; content?: string; priority?: string }) {
    return { data: await this.nursingService.nursingNoteQaContent(body) };
  }

  @Post('nursing-notes/:noteId/sign')
  @Roles(UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '간호기록 서명 확정(DRAFT→SIGNED·가)' })
  async signNote(
    @Param('admissionId', ParseUUIDPipe) admissionId: string,
    @Param('noteId', ParseUUIDPipe) noteId: string,
    @CurrentUser('id') nurseId: string,
  ) {
    return { data: await this.nursingService.signNote(admissionId, noteId, nurseId) };
  }

  @Post('nursing-notes/:noteId/amend')
  @Roles(UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '간호기록 정정(원본 AMENDED + 정정문 신규·가)' })
  async amendNote(
    @Param('admissionId', ParseUUIDPipe) admissionId: string,
    @Param('noteId', ParseUUIDPipe) noteId: string,
    @Body() dto: CreateNursingNoteDto,
    @CurrentUser('id') nurseId: string,
  ) {
    return { data: await this.nursingService.amendNote(admissionId, noteId, dto, nurseId) };
  }

  // ── I/O 기록 ──

  @Post('intake-outputs')
  @Roles(UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: 'I/O 기록 입력' })
  async createIntakeOutput(
    @Param('admissionId', ParseUUIDPipe) admissionId: string,
    @Body() dto: CreateIntakeOutputDto,
    @CurrentUser('id') nurseId: string,
  ) {
    const io = await this.nursingService.createIntakeOutput(admissionId, dto, nurseId);
    return { data: io };
  }

  @Get('intake-outputs')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: 'I/O 기록 목록' })
  async getIntakeOutputs(
    @Param('admissionId', ParseUUIDPipe) admissionId: string,
    @Query('date') date?: string,
  ) {
    const records = await this.nursingService.getIntakeOutputs(admissionId, date);
    return { data: records };
  }

  @Get('intake-outputs/summary')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: 'I/O 24시간 집계' })
  async getIntakeOutputSummary(
    @Param('admissionId', ParseUUIDPipe) admissionId: string,
    @Query('date') date: string,
  ) {
    const summary = await this.nursingService.getIntakeOutputSummary(admissionId, date);
    return { data: summary };
  }

  @Get('io-balance')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: 'I/O 수지 — 이번·직전 근무조·최근 24시간(두 원장) · 배설 기록 공백(기준 미설정이면 판정 안 함)' })
  async getIoBalance(@Param('admissionId', ParseUUIDPipe) admissionId: string) {
    return { data: await this.nursingService.getIoBalance(admissionId) };
  }

  @Get('risk-history')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '이 재원의 위험 평가 추이 — NEWS2·낙상·Braden(초기평가) · 재측정 참고(RCP · 원내 규정 아님) · 재평가 예정' })
  async getRiskHistory(@Param('admissionId', ParseUUIDPipe) admissionId: string) {
    return { data: await this.nursingService.getRiskHistory(admissionId) };
  }

  // ── 투약확인 (MAR) ──

  @Get('medication-schedule')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.PHARMACIST, UserRole.ADMIN)
  @ApiOperation({ summary: '투약 스케줄 조회 (MAR)' })
  async getMedicationSchedule(
    @Param('admissionId', ParseUUIDPipe) admissionId: string,
    @Query('date') date?: string,
    @Query('includeOverdue') includeOverdue?: string,
  ) {
    const schedule = await this.nursingService.getMedicationSchedule(admissionId, date, includeOverdue === 'true');
    return { data: schedule };
  }

  // ══════════════════════════════════
  // 타임라인 통합 API
  // ══════════════════════════════════

  @Get('timeline')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '간호 타임라인 (통합 뷰)' })
  async getTimeline(
    @Param('admissionId', ParseUUIDPipe) admissionId: string,
    @Query('shift') shift?: string,
    @Query('date') date?: string,
  ) {
    return { data: await this.nursingService.getTimeline(admissionId, { shift, date }) };
  }

  // ══════════════════════════════════
  // Flow Sheet
  // ══════════════════════════════════

  @Get('flowsheet')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: 'Flow Sheet 조회' })
  async getFlowSheet(
    @Param('admissionId', ParseUUIDPipe) admissionId: string,
    @Query('date') date?: string,
  ) {
    return { data: await this.nursingService.getFlowSheet(admissionId, date) };
  }

  @Post('flowsheet')
  @Roles(UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: 'Flow Sheet 기록 추가' })
  async addFlowSheetEntry(
    @Param('admissionId', ParseUUIDPipe) admissionId: string,
    @CurrentUser('id') nurseId: string,
    @Body() body: CreateFlowSheetEntryDto, // 인라인 Record 는 ValidationPipe 를 스킵 — DTO 필수
  ) {
    return { data: await this.nursingService.addFlowSheetEntry(admissionId, nurseId, body) };
  }

  // ══════════════════════════════════
  // 체크리스트
  // ══════════════════════════════════

  @Get('checklists')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '체크리스트 목록' })
  async getChecklists(
    @Param('admissionId', ParseUUIDPipe) admissionId: string,
    @Query('templateType') templateType?: string,
  ) {
    return { data: await this.nursingService.getChecklists(admissionId, templateType) };
  }

  @Post('checklists')
  @Roles(UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '체크리스트 생성' })
  async createChecklist(
    @Param('admissionId', ParseUUIDPipe) admissionId: string,
    @CurrentUser('id') nurseId: string,
    @Body() body: CreateNursingChecklistDto,
  ) {
    return { data: await this.nursingService.createChecklist(admissionId, nurseId, body) };
  }

  @Patch('checklists/:checklistId/items/:index')
  @Roles(UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '체크리스트 항목 체크/해제' })
  async toggleChecklistItem(
    @Param('admissionId', ParseUUIDPipe) admissionId: string,
    @Param('checklistId', ParseUUIDPipe) checklistId: string,
    @Param('index', ParseIntPipe) index: number,
    @CurrentUser('id') userId: string,
    @Body() body: ToggleNursingChecklistItemDto,
  ) {
    // 🔴 (2026-09-15) 경로의 입원 id 를 버리고 체크리스트 id 만으로 갱신했다 — 다른 입원의 체크리스트를 이 경로로 체크할 수 있었다.
    //    누가 체크했는지도 남지 않았다(항목에 시각만). 행위자는 요청 본문이 아니라 로그인 사용자.
    return { data: await this.nursingService.toggleChecklistItem(admissionId, checklistId, index, body, userId) };
  }
}

@ApiTags('Nursing')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/medication-administrations')
export class MedicationAdministrationController {
  constructor(private readonly nursingService: NursingService) {}

  @Post('generate/:prescriptionId')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '처방 기반 투약 스케줄 자동 생성' })
  async generateSchedule(@Param('prescriptionId', ParseUUIDPipe) prescriptionId: string) {
    const schedule = await this.nursingService.generateSchedule(prescriptionId);
    return { data: schedule };
  }

  @Patch(':id/administer')
  @Roles(UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '투약 확인' })
  async administer(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdministerMedDto,
    @CurrentUser('id') nurseId: string,
  ) {
    const result = await this.nursingService.administerMed(id, dto, nurseId);
    return { data: result };
  }

  @Patch(':id/hold')
  @Roles(UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '투약 보류' })
  async hold(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: HoldMedDto,
    @CurrentUser('id') nurseId: string,
  ) {
    const result = await this.nursingService.holdMed(id, dto.reason, nurseId);
    return { data: result };
  }

  @Patch(':id/refuse')
  @Roles(UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '투약 거부(환자 거부) — HELD(임상 보류)와 구분' })
  async refuse(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: HoldMedDto,
    @CurrentUser('id') nurseId: string,
  ) {
    const result = await this.nursingService.refuseMed(id, dto.reason, nurseId);
    return { data: result };
  }
}

@ApiTags('Nursing')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1')
export class NursingDiagnosisController {
  constructor(private readonly nursingService: NursingService) {}

  @Post('nursing-assessments/:assessmentId/diagnoses')
  @Roles(UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '간호진단 추가' })
  async create(
    @Param('assessmentId', ParseUUIDPipe) assessmentId: string,
    @Body() dto: CreateNursingDiagnosisDto,
    @CurrentUser('id') nurseId: string,
  ) {
    const diagnosis = await this.nursingService.createDiagnosis(assessmentId, dto, nurseId);
    return { data: diagnosis };
  }

  @Get('nursing-assessments/:assessmentId/diagnoses')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '간호진단 목록' })
  async findByAssessment(@Param('assessmentId', ParseUUIDPipe) assessmentId: string) {
    const diagnoses = await this.nursingService.getDiagnoses(assessmentId);
    return { data: diagnoses };
  }

  @Patch('nursing-diagnoses/:id/resolve')
  @Roles(UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '간호진단 해결' })
  async resolve(@Param('id', ParseUUIDPipe) id: string) {
    const diagnosis = await this.nursingService.resolveDiagnosis(id);
    return { data: diagnosis };
  }

  // ── 간호과정 NIC/NOC(다) ──

  @Post('nursing-diagnoses/:id/interventions')
  @Roles(UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '간호중재(NIC) 추가' })
  async addIntervention(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddNursingInterventionDto,
    @CurrentUser('id') nurseId: string,
  ) {
    return { data: await this.nursingService.addIntervention(id, dto, nurseId) };
  }

  @Patch('nursing-interventions/:id')
  @Roles(UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '간호중재 상태 변경 — COMPLETED 는 수행자·수행시각을 함께 기록' })
  async updateIntervention(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateNursingInterventionStatusDto,
    @CurrentUser('id') nurseId: string,
  ) {
    // 🔴 수행자는 본문이 아니라 인증 주체에서 온다 — 본문으로 받으면 남의 이름으로 이행을 적을 수 있다
    return { data: await this.nursingService.updateIntervention(id, body.status, nurseId, body.note) };
  }

  @Post('nursing-diagnoses/:id/outcomes')
  @Roles(UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '간호결과(NOC) 추가' })
  async addOutcome(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddNursingOutcomeDto,
    @CurrentUser('id') nurseId: string,
  ) {
    return { data: await this.nursingService.addOutcome(id, dto, nurseId) };
  }

  @Patch('nursing-outcomes/:id/evaluate')
  @Roles(UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '간호결과 평가(현재 점수→달성도)' })
  async evaluateOutcome(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: EvaluateNursingOutcomeDto,
    @CurrentUser('id') nurseId: string,
  ) {
    return { data: await this.nursingService.evaluateOutcome(id, body.currentScore, nurseId) };
  }

  @Get('admissions/:admissionId/care-plan')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '간호계획서(ADPIE: 사정→진단→중재→결과)' })
  async getCarePlan(@Param('admissionId', ParseUUIDPipe) admissionId: string) {
    return { data: await this.nursingService.getCarePlan(admissionId) };
  }

  @Get('nursing-codes')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: 'NANDA/NIC/NOC 표준코드 마스터 검색(참조·코드 피커)' })
  async searchNursingCodes(@Query('system') system?: string, @Query('q') q?: string, @Query('limit') limit?: string) {
    return await this.nursingService.searchNursingCodes(system, q, Number(limit) || 30);
  }

  @AuditAiRead('AiNursingCarePlan')

  @Get('admissions/:admissionId/ai-care-plan')
  @Roles(UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: 'F-2 간호과정 제안(NANDA-NIC 규칙기반·게이트·간호사 선택·확정)' })
  async suggestCarePlan(@Param('admissionId', ParseUUIDPipe) admissionId: string) {
    return { data: await this.nursingService.suggestCarePlan(admissionId) };
  }

  @AuditAiRead('AiNursingNanda')

  @Get(':admissionId/ai-nanda')
  @Roles(UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: 'AI NANDA 간호진단 추천(레거시·care-plan ai-care-plan 권장)' })
  async suggestNandaDiagnosis(@Param('admissionId', ParseUUIDPipe) admissionId: string) {
    return { data: await this.nursingService.suggestNandaDiagnosis(admissionId) };
  }

  // 'nursing/' 프리픽스 복원 — 종전 ':admissionId/ai-handoff'는 /api/v1 루트 와일드카드로 등록돼
  // FE(workstation/nursing)의 /api/v1/nursing/:id/ai-handoff 호출이 항상 404였음(2026-07-07 검토)
  @AuditAiRead('AiNursingHandoff')
  @Get('nursing/:admissionId/ai-handoff')
  @Roles(UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: 'AI 인수인계 요약(레거시·handoff ai-handoff-sbar 권장)' })
  async summarizeHandoff(@Param('admissionId', ParseUUIDPipe) admissionId: string) {
    return { data: await this.nursingService.summarizeHandoff(admissionId) };
  }

  @AuditAiRead('AiNursingHandoffSbar')

  @Get('admissions/:admissionId/ai-handoff-sbar')
  @Roles(UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: 'F-3 교대 인수인계 SBAR(결정적·근거기반·게이트·읽기 보조)' })
  async handoffSbar(@Param('admissionId', ParseUUIDPipe) admissionId: string) {
    return { data: await this.nursingService.generateHandoffSbar(admissionId) };
  }
}

/** 체크리스트 템플릿 마스터(§7 P2) — 테이블 정본. 개정=ADMIN(거버넌스 MASTER_DATA 바인딩과 같은 정본 경유) */
@ApiTags('Nursing')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/nursing/checklist-templates')
export class NursingChecklistTemplateController {
  constructor(private readonly nursingService: NursingService) {}

  @Get()
  /**
   * 🔴 수혈 체크리스트는 이 마스터가 정본인데, 혈액은행 워크스테이션(검사기사)이 403 이면
   *    화면이 **폴백 상수로 조용히 내려앉아** 마스터를 개정해도 그 화면만 옛 항목을 쓴다.
   *    조회만 연다(개정 `@Patch(:code)` 는 ADMIN 그대로 — 거버넌스 바인딩 정본).
   */
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN, UserRole.LAB_TECH)
  @ApiOperation({ summary: '체크리스트 템플릿 목록(활성) — includeInactive=1 이면 전체' })
  async list(@Query('includeInactive') includeInactive?: string) {
    return { data: await this.nursingService.getChecklistTemplates(includeInactive === '1') };
  }

  @Patch(':code')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '템플릿 개정(name/items/isActive/source) — 신규 생성 체크리스트부터 적용' })
  async upsert(
    @Param('code') code: string,
    @Body() body: UpsertNursingChecklistTemplateDto,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.nursingService.upsertChecklistTemplate(code, body, userId) };
  }
}
