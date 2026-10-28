import { Controller, Get, Post, Patch, Param, Body, Query, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { CancerRegistryService } from './cancer-registry.service';
import { GenerateKccrReportDto } from './dto/kccr-report.dto';
import {
  AddCancerFollowUpDto, AddCancerTreatmentDto, CreateCancerRegistryDto, UpdateCancerRegistryDto, UpdateCancerTreatmentDto,
} from './dto/cancer-registry-write.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('Cancer Registry (암등록)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
/**
 * 🔴 (2026-09-16 D4) 쓰기만 `@Roles(ADMIN, DOCTOR)` 이고 **읽기 8EP 에는 역할이 없었다** —
 *    `RolesGuard` 는 역할 미지정을 "인증된 전 직원 통과"로 읽으므로 READ·CRM·영양·검진 직군까지
 *    환자 암등록 원부(진단·병기·생존상태)·KCCR 보고 미리보기를 열람할 수 있었다.
 *    화면(`/cancer-registry`) 의 nav 역할도 ADMIN·DOCTOR 하나뿐이라 **클래스 기본값으로 못박는다**
 *    (핸들러 `@Roles` 는 클래스를 덮는다 — 기존 쓰기 선언은 그대로 유효).
 */
@Roles(UserRole.ADMIN, UserRole.DOCTOR)
@Controller('api/v1/cancer-registry')
export class CancerRegistryController {
  constructor(private readonly service: CancerRegistryService) {}

  @Get()
  @ApiOperation({ summary: '암등록 목록 조회' })
  async findAll(
    @Query('primarySite') primarySite?: string,
    @Query('ajccStage') ajccStage?: string,
    @Query('status') status?: string,
    // 🔴 화면이 보내던 vitalStatus / reportedToKccr 를 서버가 받지 않아 필터가 무효였다
    @Query('vitalStatus') vitalStatus?: string,
    @Query('reportedToKccr') reportedToKccr?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return {
      data: await this.service.findAll({
        primarySite,
        ajccStage,
        status,
        vitalStatus,
        reportedToKccr:
          reportedToKccr === undefined || reportedToKccr === ''
            ? undefined
            : reportedToKccr === 'true',
        page: page ? parseInt(page, 10) : 1,
        limit: limit ? parseInt(limit, 10) : 20,
      }),
    };
  }

  @Post()
  @Roles(UserRole.ADMIN, UserRole.DOCTOR)
  @ApiOperation({ summary: '암등록 생성' })
  async create(
    @Body() data: CreateCancerRegistryDto,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.service.create({ ...data }, userId) };
  }

  @Get('stats')
  @ApiOperation({ summary: '암등록 통계 (부위별/병기별/생존상태별)' })
  async getStats(@Query('primarySite') primarySite?: string) {
    return { data: await this.service.getStats(primarySite) };
  }

  @Get('stats/survival')
  @ApiOperation({ summary: '생존분석 데이터' })
  async getSurvivalData(@Query('primarySite') primarySite?: string) {
    return { data: await this.service.getSurvivalData(primarySite) };
  }

  @Get('overdue-followups')
  @ApiOperation({ summary: '추적관찰 지연 환자 목록' })
  async getOverdueFollowUps() {
    return { data: await this.service.getOverdueFollowUps() };
  }

  @Get('patient/:patientId')
  @ApiOperation({ summary: '환자별 암등록 이력' })
  async getPatientHistory(@Param('patientId', ParseUUIDPipe) patientId: string) {
    return { data: await this.service.getPatientHistory(patientId) };
  }

  @Get('report/kccr/preview')
  @ApiOperation({ summary: 'KCCR 제출 자료 미리보기 (단일 건 · 조회 전용)' })
  async previewKccrReport(@Query('id', ParseUUIDPipe) id: string) {
    return { data: await this.service.previewKccrReport(id) };
  }

  @Post('report/kccr')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR)
  @ApiOperation({
    summary: 'KCCR 제출 자료 생성 (전송 아님 · ids 필수)',
    description:
      '🔴 ids 가 비면 400 으로 거부한다(전건 확대 금지). confirm=true 인 경우에만 ' +
      "대상 건을 '보고 대상 확정(미전송)' 으로 표시하며, 중앙암등록본부 전송은 일어나지 않는다.",
  })
  async generateKccrReport(@Body() body: GenerateKccrReportDto) {
    return {
      data: await this.service.generateKccrReport(body.ids, { confirm: body.confirm === true }),
    };
  }

  @Get(':id')
  @ApiOperation({ summary: '암등록 상세 조회' })
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.service.findOne(id) };
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR)
  @ApiOperation({ summary: '암등록 수정' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() data: UpdateCancerRegistryDto,
  ) {
    return { data: await this.service.update(id, { ...data }) };
  }

  @Post(':id/verify')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR)
  @ApiOperation({ summary: '암등록 확인 (REGISTERED → VERIFIED)' })
  async verify(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('id') userId: string) {
    return { data: await this.service.verify(id, userId) };
  }

  @Post(':id/treatments')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR)
  @ApiOperation({ summary: '치료 기록 추가' })
  async addTreatment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() data: AddCancerTreatmentDto,
  ) {
    return { data: await this.service.addTreatment(id, { ...data }) };
  }

  @Patch('treatments/:id')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR)
  @ApiOperation({ summary: '치료 기록 수정' })
  async updateTreatment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() data: UpdateCancerTreatmentDto,
  ) {
    return { data: await this.service.updateTreatment(id, { ...data }) };
  }

  @Post(':id/follow-ups')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR)
  @ApiOperation({ summary: '추적관찰 기록 추가' })
  async addFollowUp(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() data: AddCancerFollowUpDto,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.service.addFollowUp(id, { ...data }, userId) };
  }

  @Get(':id/timeline')
  @ApiOperation({ summary: '타임라인 (진단→치료→추적관찰 통합)' })
  async getTimeline(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.service.getTimeline(id) };
  }

  @Post(':id/auto-stage')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR)
  @ApiOperation({ summary: 'AI TNM 병기 자동 추정' })
  async autoStage(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.service.autoStage(id) };
  }
}
