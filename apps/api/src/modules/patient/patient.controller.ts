import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  Query,
  Res,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  ParseUUIDPipe,
  BadRequestException,
} from '@nestjs/common';
import type { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const multer = require('multer');
import * as path from 'path';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiConsumes } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { PatientService } from './patient.service';
import { AuditService } from '../audit/audit.service';
import { PermissionService } from '../auth/rbac/permission.service';
import { maskDetail, type ViewerPerms } from './patient-field-mask';
import { resolveListAccess, maskForListAccess, looksLikePhoneQuery, type ListAccess } from './patient-list-access';
import { AccessControlService } from '../access-control/access-control.service';
import { NoAudit } from '../audit/no-audit.decorator';
import { CreatePatientDto } from './dto/create-patient.dto';
import { UpdatePatientDto } from './dto/update-patient.dto';
import { PatientQueryDto } from './dto/patient-query.dto';
import { CreateContactDto } from './dto/create-contact.dto';
import { UpdateContactDto } from './dto/update-contact.dto';
import { CheckDuplicateDto } from './dto/check-duplicate.dto';
import { MarkDeceasedDto } from './dto/mark-deceased.dto';
import { MergePatientsDto, MergePreviewQueryDto } from './dto/merge-patients.dto';
import { CreateRelationDto } from './dto/create-relation.dto';
import { CreateFamilyHistoryDto } from './dto/create-family-history.dto';
import { ImportPatientsDto } from './dto/import-patients.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permission } from '../auth/rbac/permission.types';

@ApiTags('Patients')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/patients')
export class PatientController {
  constructor(
    private readonly patientService: PatientService,
    private readonly audit: AuditService,
    private readonly permissions: PermissionService,
    private readonly accessControl: AccessControlService,
  ) {}

  /** 열람자의 필드 권한 — 응답 경계에서 마스킹할 때 쓴다(화면이 가리는 것에 기대지 않는다) */
  private viewerPerms(user: { id?: string; sub?: string; role: UserRole }): ViewerPerms {
    const ctx = { userId: user.id ?? user.sub ?? '', userRole: user.role };
    return {
      contact: this.permissions.hasPermission(ctx, Permission.PATIENT_VIEW_CONTACT),
      identity: this.permissions.hasPermission(ctx, Permission.PATIENT_VIEW_IDENTITY),
    };
  }

  /**
   * 목록 능력표 — RBAC + 역할 데이터 접근 설정(좁히기만). 목록·스마트 목록 응답과 화면이 같은 값을 쓴다.
   * 🔴 설정 조회가 실패하면 좁히지 못한 채 넓게 열지 않는다 — 연락처를 가린다(안전측).
   */
  private async listAccess(user: { id?: string; sub?: string; role: UserRole | string; department?: string | null }): Promise<ListAccess> {
    const ctx = { userId: user.id ?? user.sub ?? '', userRole: user.role as UserRole };
    const has = (p: Permission) => this.permissions.hasPermission(ctx, p);
    const rbac = {
      contact: has(Permission.PATIENT_VIEW_CONTACT),
      identity: has(Permission.PATIENT_VIEW_IDENTITY),
      create: has(Permission.PATIENT_CREATE),
      import: has(Permission.PATIENT_IMPORT),
      merge: has(Permission.PATIENT_MERGE),
      export: has(Permission.PATIENT_EXPORT),
    };
    let narrow: Awaited<ReturnType<AccessControlService['listNarrowing']>>;
    try {
      narrow = await this.accessControl.listNarrowing(String(user.role), user.department ?? null);
    } catch {
      narrow = { values: { showPhone: false, canRegister: false }, source: 'UNAVAILABLE' };
    }
    return resolveListAccess(rbac, String(user.role), narrow);
  }

  @Get('list-capabilities')
  @RequirePermission(Permission.PATIENT_VIEW)
  @ApiOperation({ summary: '환자 목록 능력표 — 범위·연락처 가림·전화 검색·등록/가져오기/병합/반출 (서버 권한 정본)' })
  async listCapabilities(@CurrentUser() user: { id?: string; sub?: string; role: UserRole; department?: string | null }) {
    return { data: await this.listAccess(user) };
  }

  @Get()
  @RequirePermission(Permission.PATIENT_VIEW)
  @ApiOperation({ summary: '환자 목록 (검색/필터)' })
  async findAll(@Query() query: PatientQueryDto, @CurrentUser() user: { id?: string; sub?: string; role: UserRole; department?: string | null }) {
    const access = await this.listAccess(user);
    const res = await this.patientService.findAll(query, { phoneSearch: access.phoneSearch, allergy: access.allergyStatus, userId: user.id ?? user.sub, staleDrafts: access.staleDrafts });
    return {
      ...res,
      data: res.data.map((p) => maskForListAccess(p as unknown as Record<string, unknown>, access)),
      // 숫자로 찾았는데 전화번호 검색 권한이 없으면 그 사실을 말한다(없는 것과 못 찾은 것을 구분)
      searchNote: !access.phoneSearch && looksLikePhoneQuery(query.q) ? ('PHONE_SEARCH_NOT_ALLOWED' as const) : null,
    };
  }

  @Get('export')
  // 🔴 대량 반출은 별도 권한 — 화면에서 버튼을 감추는 것으로는 막히지 않는다
  @RequirePermission(Permission.PATIENT_EXPORT)
  @NoAudit()                                   // 변이가 아니라 열람 — 아래에서 대량 반출로 명시 기록
  @ApiOperation({ summary: '환자 목록 대량 반출(CSV용·관리자 전용·감사 기록)' })
  async exportPatients(@Query() query: PatientQueryDto, @CurrentUser('id') userId: string) {
    const res = await this.patientService.exportList(query);
    // PHI 가 파일로 나가는 지점 — 무엇을 몇 건 내보냈는지 남긴다(사후 추적의 유일한 근거)
    void this.audit
      ?.log({
        userId,
        action: 'READ' as never,
        resourceType: 'PatientBulkExport',
        resourceId: userId, // 대상이 다수라 행위자에 귀속(개별 환자는 count 로)
        changes: {
          count: { old: null, new: res.count },
          filters: { old: null, new: JSON.stringify({ q: query.q, presence: query.presence, gender: query.gender, insuranceType: query.insuranceType, foreigner: query.foreigner, tags: query.tags }) },
          // 선택 행 반출이면 고른 환자 id 를 그대로 남긴다(누구를 내보냈는지 — 필터 조건만으로는 재현되지 않는다)
          ...(query.ids ? { selectedIds: { old: null, new: query.ids } } : {}),
          truncated: { old: null, new: res.truncated },
        },
      })
      .catch(() => {});
    return { data: res };
  }

  @Get('onsite-summary')
  @RequirePermission(Permission.PATIENT_VIEW)
  @ApiOperation({ summary: '원내 상태별 환자 수 — 필터 칩 건수(재원·대기·진료중·수납/약국 대기·기록 작성중)' })
  async onsiteSummary() {
    return { data: await this.patientService.onsiteSummary() };
  }

  @Get('filter-options')
  @RequirePermission(Permission.PATIENT_VIEW)
  @ApiOperation({ summary: '환자 필터 옵션 — 외국인 국적/언어 분포(실데이터 칩 구성)' })
  async filterOptions() {
    return { data: await this.patientService.getForeignerFilterOptions() };
  }

  @Get('smart-list')
  @RequirePermission(Permission.PATIENT_VIEW)
  @ApiOperation({ summary: '스마트 환자 목록 (역할/맥락 기반 우선순위)' })
  async getSmartList(
    @CurrentUser() user: { id?: string; sub?: string; role: string; department?: string },
    @Query('q') q?: string,
    @Query('context') context?: string,
  ) {
    // 🔴 종전엔 전화번호·보험 유형을 가리지 않고 보냈다(응급 목록은 모든 역할에) — 목록과 같은 능력표로 가린다
    const access = await this.listAccess(user);
    const res = await this.patientService.getSmartList((user.id ?? user.sub)!, user.role, user.department, q, context, { phoneSearch: access.phoneSearch });
    const mask = <T extends Record<string, unknown>>(rows: T[]) => rows.map((r) => maskForListAccess(r, access));
    return {
      data: {
        myPatients: mask(res.myPatients as Record<string, unknown>[]),
        recentPatients: mask(res.recentPatients as Record<string, unknown>[]),
        admittedPatients: mask(res.admittedPatients as Record<string, unknown>[]),
        emergencyPatients: mask(res.emergencyPatients as Record<string, unknown>[]),
        searchResults: mask(res.searchResults as Record<string, unknown>[]),
      },
    };
  }

  @Post()
  @RequirePermission(Permission.PATIENT_CREATE)
  @ApiOperation({ summary: '환자 등록' })
  async create(
    @Body() dto: CreatePatientDto,
    @CurrentUser('id') userId: string,
  ) {
    const patient = await this.patientService.create(dto, userId);
    return { data: patient };
  }

  @Post('check-duplicate')
  @RequirePermission(Permission.PATIENT_VIEW)   // 🔴 무가드였음 — 이름·생년월일로 환자 존재를 캐는 오라클
  @ApiOperation({ summary: '환자 중복 감지' })
  async checkDuplicate(@Body() dto: CheckDuplicateDto) {
    const result = await this.patientService.checkDuplicate(dto);
    return { data: result };
  }

  @Get('merge-preview')
  @RequirePermission(Permission.PATIENT_MERGE)
  @ApiOperation({ summary: '환자 병합 미리보기 — 두 환자·옮겨지는/남는 기록(모델별 건수)·되돌리기 경로 없음' })
  async mergePreview(@Query() q: MergePreviewQueryDto) {
    return { data: await this.patientService.mergePreview(q.sourceId, q.targetId) };
  }

  @Post('merge')
  @RequirePermission(Permission.PATIENT_MERGE)
  @ApiOperation({ summary: '환자 병합 (ADMIN)' })
  async mergePatients(
    @Body() dto: MergePatientsDto,
    @CurrentUser('id') userId: string,
  ) {
    const result = await this.patientService.mergePatients(dto, userId);
    return { data: result };
  }

  @Post('import')
  @RequirePermission(Permission.PATIENT_IMPORT)
  @ApiOperation({ summary: '환자 일괄 등록' })
  async importPatients(
    @Body() dto: ImportPatientsDto,
    @CurrentUser('id') userId: string,
  ) {
    const result = await this.patientService.importPatients(dto, userId);
    return { data: result };
  }

  @Get('quality-dashboard')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '데이터 품질 대시보드' })
  async getQualityDashboard() {
    const result = await this.patientService.getQualityDashboard();
    return { data: result };
  }

  @Get('duplicate-groups')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '중복 의심 그룹 (성명+생년월일 동일·나란히 비교·병합은 사람)' })
  async getDuplicateGroups() {
    return { data: await this.patientService.getDuplicateGroups() };
  }

  @Get(':id/consents/unified')
  @RequirePermission(Permission.PATIENT_VIEW)
  @ApiOperation({ summary: '통합 동의 현황 (A4 — 5원천 읽기 집계·5상태)' })
  async getUnifiedConsents(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.patientService.getUnifiedConsents(id) };
  }

  @Get(':id/summary')
  @RequirePermission(Permission.PATIENT_VIEW)
  @ApiOperation({ summary: '환자 통합 요약 (차트 대시보드용)' })
  async getSummary(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user?: { role?: string }) {
    // 🔴 임상 내용은 차트 권한을 가진 역할에게만 — 세부 EP 가 막는 것을 이 집계 EP 가 주고 있었다.
    const summary = await this.patientService.getSummary(id, user?.role);
    return { data: summary };
  }

  @Get(':id')
  @RequirePermission(Permission.PATIENT_VIEW)   // 🔴 무가드였음(인증만 되면 누구나 상세 열람)
  @ApiOperation({ summary: '환자 상세' })
  async findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: { id?: string; sub?: string; role: UserRole }) {
    const patient = await this.patientService.findById(id);
    return { data: maskDetail(patient as unknown as Record<string, unknown>, this.viewerPerms(user)) };
  }

  @Put(':id')
  @RequirePermission(Permission.PATIENT_EDIT)
  @ApiOperation({ summary: '환자 정보 수정 (bi-temporal)' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePatientDto,
    @CurrentUser('id') userId: string,
  ) {
    const patient = await this.patientService.update(id, dto, userId);
    return { data: patient };
  }

  @Delete(':id')
  @RequirePermission(Permission.PATIENT_DELETE)
  @ApiOperation({ summary: '환자 비활성화 (soft delete)' })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') userId: string,
  ) {
    await this.patientService.softDelete(id, userId);
    return { data: { message: 'Patient deactivated' } };
  }

  @Get(':id/history')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '환자 변경 이력' })
  async getHistory(@Param('id', ParseUUIDPipe) id: string) {
    const history = await this.patientService.getHistory(id);
    return { data: history };
  }

  // ── Contacts ──

  @Get(':id/contacts')
  @RequirePermission(Permission.PATIENT_VIEW_CONTACT) // 🔴 무가드였음 — 보호자 연락처는 접촉 정보(PHI)
  @ApiOperation({ summary: '보호자 목록' })
  async getContacts(@Param('id', ParseUUIDPipe) id: string) {
    const contacts = await this.patientService.getContacts(id);
    return { data: contacts };
  }

  @Post(':id/contacts')
  @RequirePermission(Permission.PATIENT_RELATION_EDIT)
  @ApiOperation({ summary: '보호자 등록' })
  async createContact(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateContactDto,
  ) {
    const contact = await this.patientService.createContact(id, dto);
    return { data: contact };
  }

  @Put(':id/contacts/:cid')
  @RequirePermission(Permission.PATIENT_RELATION_EDIT)
  @ApiOperation({ summary: '보호자 수정' })
  async updateContact(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('cid', ParseUUIDPipe) cid: string,
    @Body() dto: UpdateContactDto,
  ) {
    const contact = await this.patientService.updateContact(id, cid, dto);
    return { data: contact };
  }

  @Delete(':id/contacts/:cid')
  @RequirePermission(Permission.PATIENT_RELATION_EDIT)
  @ApiOperation({ summary: '보호자 삭제' })
  async deleteContact(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('cid', ParseUUIDPipe) cid: string,
  ) {
    await this.patientService.deleteContact(id, cid);
    return { data: { message: 'Contact deleted' } };
  }

  // ── Deceased ──

  @Post(':id/deceased')
  @RequirePermission(Permission.PATIENT_DECEASED)
  @ApiOperation({ summary: '사망 처리' })
  async markDeceased(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MarkDeceasedDto,
    @CurrentUser('id') userId: string,
  ) {
    const patient = await this.patientService.markDeceased(id, dto, userId);
    return { data: patient };
  }

  // ── Photo Upload ──

  @Post(':id/photo')
  @RequirePermission(Permission.PATIENT_EDIT)
  @ApiOperation({ summary: '환자 사진 업로드' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('photo', {
      storage: multer.diskStorage({
        destination: 'uploads/patients',
        filename: (_req: Express.Request, file: Express.Multer.File, cb: (error: Error | null, filename: string) => void) => {
          const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
          cb(null, `temp-${uniqueSuffix}${path.extname(file.originalname)}`);
        },
      }),
      limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
      fileFilter: (_req: Express.Request, file: Express.Multer.File, cb: (error: Error | null, acceptFile: boolean) => void) => {
        const allowed = ['image/jpeg', 'image/png', 'image/jpg'];
        if (allowed.includes(file.mimetype)) {
          cb(null, true);
        } else {
          cb(new BadRequestException('JPEG/PNG 파일만 업로드 가능합니다'), false);
        }
      },
    }),
  )
  async uploadPhoto(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('사진 파일이 필요합니다');
    }
    const result = await this.patientService.uploadPhoto(id, file);
    return { data: result };
  }

  // ── Vitals (통합 타임라인) ──

  @Get(':id/vitals-timeline')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '바이탈 통합 타임라인 (외래 PreVisit·입원 FlowSheet·EWS 소스 병합)' })
  async getVitalsTimeline(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.patientService.getVitalsTimeline(id) };
  }

  @Get(':id/family-history')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '가족력 시계열 (과거 진료 familyHistory 누적)' })
  async getFamilyHistory(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.patientService.getFamilyHistory(id) };
  }

  @Get(':id/family-histories')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '구조화 가족력 목록 (관계·KCD·발병연령)' })
  async getStructuredFamilyHistory(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.patientService.getStructuredFamilyHistory(id) };
  }

  @Post(':id/family-histories')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '구조화 가족력 추가' })
  async createFamilyHistory(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateFamilyHistoryDto, @CurrentUser('id') userId: string) {
    return { data: await this.patientService.createFamilyHistory(id, dto, userId) };
  }

  @Delete(':id/family-histories/:fhId')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '구조화 가족력 삭제' })
  async deleteFamilyHistory(@Param('id', ParseUUIDPipe) id: string, @Param('fhId', ParseUUIDPipe) fhId: string) {
    return { data: await this.patientService.deleteFamilyHistory(id, fhId) };
  }

  // ── Relations (Family) ──

  @Get(':id/relations')
  @RequirePermission(Permission.PATIENT_VIEW_CONTACT) // 🔴 무가드였음 — 가족관계도 접촉 정보
  @ApiOperation({ summary: '가족 관계 목록' })
  async getRelations(@Param('id', ParseUUIDPipe) id: string) {
    const relations = await this.patientService.getRelations(id);
    return { data: relations };
  }

  @Post(':id/relations')
  @RequirePermission(Permission.PATIENT_RELATION_EDIT)
  @ApiOperation({ summary: '가족 관계 연결' })
  async createRelation(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateRelationDto,
  ) {
    const relation = await this.patientService.createRelation(id, dto);
    return { data: relation };
  }

  @Delete(':id/relations/:relationId')
  @RequirePermission(Permission.PATIENT_RELATION_EDIT)
  @ApiOperation({ summary: '가족 관계 해제' })
  async deleteRelation(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('relationId', ParseUUIDPipe) relationId: string,
  ) {
    await this.patientService.deleteRelation(id, relationId);
    return { data: { message: 'Relation removed' } };
  }
}
