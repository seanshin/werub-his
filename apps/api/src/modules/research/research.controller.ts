import { BadRequestException, Controller, Get, Post, Put, Patch, Param, Body, Query, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ResearchService } from './research.service';
import {
  AddIrbAmendmentDto,
  AddResearchDocumentDto,
  AddResearchSubjectDto,
  ApproveResearchStudyDto,
  CreateResearchStudyDto,
  ReviewIrbAmendmentDto,
  SubmitIrbAmendmentDto,
  UpdateResearchStudyDto,
  UpdateResearchSubjectDto,
  WithdrawResearchSubjectDto,
} from './research.dto';

@ApiTags('Research (임상연구/IRB)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/research')
export class ResearchController {
  constructor(private readonly service: ResearchService) {}

  /* ───────── Studies ───────── */

  @Get()
  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  @ApiOperation({ summary: '연구 목록 조회' })
  async findAll(
    @Query('department') department?: string,
    @Query('irbStatus') irbStatus?: string,
    @Query('studyType') studyType?: string,
    @Query('piUserId') piUserId?: string,
  ) {
    const filters: Record<string, unknown> = {};
    if (department) filters.department = department;
    if (irbStatus) filters.irbStatus = irbStatus;
    if (studyType) filters.studyType = studyType;
    if (piUserId) filters.piUserId = piUserId;
    return { data: await this.service.findAll(filters) };
  }

  @Post()
  @Roles(UserRole.ADMIN, UserRole.DOCTOR)
  @ApiOperation({ summary: '연구 등록 (IRB-YYYY-NNN 자동 채번)' })
  async create(
    @Body() body: CreateResearchStudyDto,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.service.create(body, userId) };
  }

  @Get('stats')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR)
  @ApiOperation({ summary: '연구 통계 (유형별/상태별)' })
  async getStats() {
    return { data: await this.service.getStats() };
  }

  @Get('irb-calendar')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR)
  @ApiOperation({ summary: 'IRB 심의 캘린더 (예정 심의)' })
  async getIrbCalendar() {
    return { data: await this.service.getIrbCalendar() };
  }

  @Get('irb/reviews')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR)
  @ApiOperation({ summary: 'IRB 심의 목록(연구별 심의 상태)' })
  async getIrbReviews() {
    return { data: await this.service.getIrbReviews() };
  }

  @Post('irb/amendments')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR)
  @ApiOperation({ summary: 'IRB 변경심의 제출(studyId 포함)' })
  async submitIrbAmendment(@Body() body: SubmitIrbAmendmentDto) {
    // 🔴 `String(undefined)` = 'undefined' 가 그대로 Prisma 로 흘러가 P2023(uuid 파싱 실패) 이 된다.
    const studyId = typeof body?.studyId === 'string' ? body.studyId.trim() : '';
    if (!studyId) throw new BadRequestException('studyId는 필수입니다');
    return { data: await this.service.addAmendment(studyId, body) };
  }

  /* 🔴 `GET /research/cdm/status`·`/research/cdm/tables` 제거(2026-08 화면 실사용 점검 W7).
   *    두 EP 는 person 1250 · measurement 24500 · qualityScore 92.5 같은 **상수 mock** 을 반환했다(P15).
   *    화면에 연결된 적이 없고, 실제 CDM 정본은 omop-cdm 모듈(`/api/v1/cdm/*`)에 이미 있다.
   *    같은 사실에 정본이 둘이면 언젠가 가짜 쪽이 화면에 붙는다(P12). */

  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  @ApiOperation({ summary: '연구 상세 (대상자/문서/변경이력 포함)' })
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.service.findOne(id) };
  }

  @Put(':id')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR)
  @ApiOperation({ summary: '연구 정보 수정' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateResearchStudyDto,
  ) {
    return { data: await this.service.update(id, body) };
  }

  @Patch(':id/approve')
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'IRB 승인 (SUBMITTED/UNDER_REVIEW → APPROVED)',
    description:
      '승인서에 적힌 만료일(irbExpiryDate, YYYY-MM-DD)을 함께 보낼 수 있다. ' +
      '🔴 보내지 않으면 만료일은 비어 있고 화면은 "만료일 미등록"으로 표기한다(시스템이 +1년을 지어내지 않는다).',
  })
  async approve(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body?: ApproveResearchStudyDto,
  ) {
    return { data: await this.service.approve(id, { irbExpiryDate: body?.irbExpiryDate ?? null }) };
  }

  @Patch(':id/close')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR)
  @ApiOperation({ summary: '연구 종료 (endDate 설정 + CLOSED)' })
  async close(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.service.close(id) };
  }

  /* ───────── Subjects ───────── */

  @Get(':id/subjects')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  @ApiOperation({ summary: '연구 대상자 목록' })
  async getSubjects(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.service.getSubjects(id) };
  }

  @Post(':id/subjects')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR)
  @ApiOperation({ summary: '대상자 등록 (subjectNo 자동 채번)' })
  async addSubject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: AddResearchSubjectDto,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.service.addSubject(id, body, userId) };
  }

  @Put('subjects/:subjectId')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR)
  @ApiOperation({ summary: '대상자 정보 수정' })
  async updateSubject(
    @Param('subjectId', ParseUUIDPipe) subjectId: string,
    @Body() body: UpdateResearchSubjectDto,
  ) {
    return { data: await this.service.updateSubject(subjectId, body) };
  }

  @Patch('subjects/:subjectId/withdraw')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR)
  @ApiOperation({ summary: '대상자 중도탈락 처리 (사유 필수)' })
  async withdrawSubject(
    @Param('subjectId', ParseUUIDPipe) subjectId: string,
    @Body() body: WithdrawResearchSubjectDto,
  ) {
    // 🔴 종전엔 `@Body('reason')` 만 받았는데 화면은 `withdrawReason` 으로 보내
    //    사유가 서버에 닿지 않고 withdraw_reason 이 NULL 로 저장됐다(P11 — FE↔서버 계약 불일치).
    //    화면은 `reason` 으로 통일했고, 여기서는 구 키도 받아 유실을 막는다.
    return { data: await this.service.withdrawSubject(subjectId, body?.reason ?? body?.withdrawReason ?? '') };
  }

  /* ───────── Documents ───────── */

  @Get(':id/documents')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  @ApiOperation({ summary: '연구 문서 목록' })
  async getDocuments(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.service.getDocuments(id) };
  }

  @Post(':id/documents')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR)
  @ApiOperation({ summary: '연구 문서 업로드' })
  async addDocument(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: AddResearchDocumentDto,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.service.addDocument(id, body, userId) };
  }

  /* ───────── Amendments ───────── */

  @Get(':id/amendments')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  @ApiOperation({ summary: '연구 변경이력 목록' })
  async getAmendments(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.service.getAmendments(id) };
  }

  @Post(':id/amendments')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR)
  @ApiOperation({ summary: 'IRB 변경 신청' })
  async addAmendment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: AddIrbAmendmentDto,
  ) {
    return { data: await this.service.addAmendment(id, body) };
  }

  @Patch('amendments/:amendmentId')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'IRB 변경 심의 (승인/반려)' })
  async updateAmendment(
    @Param('amendmentId', ParseUUIDPipe) amendmentId: string,
    @Body() body: ReviewIrbAmendmentDto,
  ) {
    return { data: await this.service.updateAmendment(amendmentId, body) };
  }

  /* ───────── Data Extraction / CDM ───────── */

  @Get(':id/extract')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR)
  @ApiOperation({
    summary: '연구 대상자 명부 추출',
    description: '🔴 검사·활력 등 임상 관측치는 포함되지 않는다(clinicalDataIncluded=false). 종전 상수 검사값은 제거됐다.',
  })
  async extractData(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.service.extractData(id) };
  }

  /* ───────── Charts ───────── */

  @Get(':id/enrollment-chart')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR)
  @ApiOperation({ summary: '등록 추이 차트 데이터' })
  async getEnrollmentChart(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.service.getEnrollmentChart(id) };
  }
}
