import { Controller, Get, Post, Put, Patch, Delete, Param, Body, Query, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { ApprovalRecordDto } from '../order-set/dto/order-set.dto';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { TreatmentTemplateService, TemplateItemInput } from './treatment-template.service';
import {
  ApplyTreatmentTemplateDto, CreateTreatmentTemplateDto, UpdateScheduleItemDto, UpdateTreatmentTemplateDto,
} from './dto/treatment-template-write.dto';

@ApiTags('치료일정 템플릿')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/treatment-templates')
export class TreatmentTemplateController {
  constructor(private readonly svc: TreatmentTemplateService) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  @ApiOperation({ summary: '치료일정 템플릿 목록' })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'department', required: false })
  @ApiQuery({ name: 'diagnosisCode', required: false })
  async findAll(
    @Query('status') status?: string,
    @Query('department') department?: string,
    @Query('diagnosisCode') diagnosisCode?: string,
  ) {
    return { data: await this.svc.findAll({ status, department, diagnosisCode }) };
  }

  @Get('recommend')
  @Roles(UserRole.DOCTOR)
  @ApiOperation({ summary: '진단 기반 템플릿 추천 (주상병 가중·prefix — 약속처방 추천 v2와 동일 규칙)' })
  async recommend(@Query('diagnosisCodes') codes: string, @Query('primaryCode') primaryCode?: string) {
    const diagnosisCodes = codes ? codes.split(',').filter(Boolean) : [];
    return { data: await this.svc.recommend(diagnosisCodes, primaryCode || undefined) };
  }

  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  @ApiOperation({ summary: '템플릿 상세 (items·진단 매핑 포함)' })
  async findById(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.svc.findById(id) };
  }

  @Post()
  @Roles(UserRole.ADMIN, UserRole.DOCTOR)
  @ApiOperation({ summary: '템플릿 생성 (DRAFT)' })
  async create(
    @Body() body: CreateTreatmentTemplateDto,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.svc.create({ ...body, items: body.items as TemplateItemInput[] | undefined }, userId) };
  }

  @Put(':id')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR)
  @ApiOperation({ summary: '템플릿 수정 (items replace-all)' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateTreatmentTemplateDto,
    @CurrentUser('id') userId: string,
  ) {
    // 사용 중 템플릿이면 새 판 초안(응답 editMode·newVersionOf) — 2026-10-21 P2
    return { data: await this.svc.update(id, { ...body, department: body.department as string | undefined, description: body.description as string | undefined /* null=비움(서비스가 trim||null) */, items: body.items as TemplateItemInput[] | undefined }, userId) };
  }

  /** 승인 기록 남기기 — 승인 절차 없이 사용 중이 된 템플릿(2026-10-21 P2 · 근거는 감사 기록에) */
  @Post(':id/approval-record')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '사용 중 템플릿 승인 기록(승인자 = 기록하는 관리자 · 근거 필수)' })
  async recordApproval(@Param('id', ParseUUIDPipe) id: string, @Body() _dto: ApprovalRecordDto, @CurrentUser('id') userId: string) {
    return { data: await this.svc.recordApproval(id, userId) };
  }

  @Patch(':id/status')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '상태 전이 (ACTIVE 승격은 코드해석·항목 게이트)' })
  async changeStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('status') status: string,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.svc.changeStatus(id, status, userId) };
  }

  @Patch('schedule-items/:itemId')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '전개 일정 항목 변경관리 — 일자 변경(사유 필수·선택적 이후 일괄이동)·취소 (미결 사전처방 동반 조치)' })
  async updateScheduleItem(
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() body: UpdateScheduleItemDto,
  ) {
    return { data: await this.svc.updateScheduleItem(itemId, body) };
  }

  @Post(':id/apply')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '템플릿 전개 — 환자 일정 인스턴스 생성 (LAB/IMAGING은 PreOrder 초안 연결)' })
  async apply(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ApplyTreatmentTemplateDto,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.svc.apply(id, body, userId) };
  }

  @Get(':id/diagnoses')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  @ApiOperation({ summary: '진단 매핑 조회' })
  async getDiagnoses(@Param('id', ParseUUIDPipe) id: string) {
    return { data: (await this.svc.findById(id)).diagnoses };
  }

  @Put(':id/diagnoses')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR)
  @ApiOperation({ summary: '진단 매핑 일괄 교체' })
  async replaceDiagnoses(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('diagnoses') diagnoses: { diagnosisCode: string; matchType?: string; role?: string; weight?: number }[],
  ) {
    return { data: await this.svc.replaceDiagnoses(id, Array.isArray(diagnoses) ? diagnoses : []) };
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '템플릿 삭제 (soft)' })
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    await this.svc.remove(id);
    return { data: { deleted: true } };
  }
}
