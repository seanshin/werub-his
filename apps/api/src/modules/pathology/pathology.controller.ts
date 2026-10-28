import { Controller, Get, Post, Patch, Param, Body, Query, UseGuards, ParseUUIDPipe, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { PathologyService } from './pathology.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import {
  CreatePathologySpecimenDto, UpsertPathologyReportDto, AddPathologyAddendumDto,
  UpdateProcessingStepDto, SignPathologyReportDto,
} from './dto/pathology.dto';
import { AddPathologyReportImageDto, AddPathologySlideDto } from './dto/pathology-slide-image.dto';

@ApiTags('Pathology (병리과)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.DOCTOR, UserRole.ADMIN, UserRole.LAB_TECH)
@Controller('api/v1/pathology')
export class PathologyController {
  constructor(private readonly pathologyService: PathologyService) {}

  @Get('specimens')
  @ApiOperation({ summary: '검체 목록 조회' })
  async getSpecimens(
    @Query('status') status?: string,
    @Query('patientId') patientId?: string,
    @Query('priority') priority?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return {
      data: await this.pathologyService.getSpecimens({
        status,
        patientId,
        priority,
        page: page ? parseInt(page, 10) : 1,
        limit: limit ? parseInt(limit, 10) : 20,
      }),
    };
  }

  @Get('specimens/:id')
  @ApiOperation({ summary: '검체 상세 조회' })
  async getSpecimenById(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.pathologyService.getSpecimenById(id) };
  }

  @Post('specimens')
  @ApiOperation({ summary: '검체 등록' })
  async createSpecimen(@Body() data: CreatePathologySpecimenDto, @CurrentUser('id') userId: string) {
    return { data: await this.pathologyService.createSpecimen({ ...data, collectorId: data.collectorId ?? userId }) };
  }

  @Patch('specimens/:id/receive')
  @ApiOperation({ summary: '검체 접수 (수령 확인)' })
  async receiveSpecimen(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.pathologyService.receiveSpecimen(id) };
  }

  @Get('reports/:specimenId')
  @ApiOperation({ summary: '병리 보고서 조회' })
  async getReport(@Param('specimenId', ParseUUIDPipe) specimenId: string) {
    return { data: await this.pathologyService.getReport(specimenId) };
  }

  @Post('reports')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN) // 병리 진단 리포트 작성은 병리의 업무(검사기사 제외)
  @ApiOperation({ summary: '병리 보고서 생성' })
  async createReport(@Body() data: UpsertPathologyReportDto) {
    // 생성에는 specimenId 가 필수다 — DTO 는 수정 경로와 공유하므로 여기서 확인한다.
    if (!data.specimenId) throw new BadRequestException('specimenId 는 필수입니다');
    return { data: await this.pathologyService.createReport(data as unknown as Record<string, unknown>) };
  }

  @Patch('reports/:id')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '병리 보고서 수정' })
  async updateReport(@Param('id', ParseUUIDPipe) id: string, @Body() data: UpsertPathologyReportDto) {
    return { data: await this.pathologyService.updateReport(id, data as unknown as Record<string, unknown>) };
  }

  @Post('reports/:id/sign')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN) // 최종 진단 서명은 병리의만(검사기사 서명 금지)
  @ApiOperation({ summary: '병리 보고서 서명' })
  async signReport(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') userId: string,
    @Body() body?: SignPathologyReportDto,
  ) {
    return { data: await this.pathologyService.signReport(id, userId, body?.blockchainSignature) };
  }

  @Post('reports/:id/addendum')
  @ApiOperation({ summary: '보고서 추가 소견 (Addendum)' })
  async addAddendum(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AddPathologyAddendumDto) {
    return { data: await this.pathologyService.addAddendum(id, dto.addendum) };
  }

  @Patch('specimens/:id/process')
  @ApiOperation({ summary: '검체 처리 단계 업데이트 (FIXATION/EMBEDDING/SECTIONING/STAINING/MOUNTING)' })
  async updateProcessingStep(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateProcessingStepDto,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.pathologyService.updateProcessingStep(id, body.step, body.notes, userId) };
  }

  @Get('specimens/:id/processing-steps')
  @ApiOperation({ summary: '검체 처리단계 이력' })
  async getProcessingSteps(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.pathologyService.getProcessingSteps(id) };
  }

  @Post('specimens/:id/slides')
  @ApiOperation({ summary: '슬라이드 추가 (Phase 5)' })
  async addSlide(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: AddPathologySlideDto,
  ) {
    // 🔴 (2026-09-15 N4) 서비스가 본문을 clinicalInfo JSON 에 펼쳐 저장한다 — 선언 필드만 넘긴다
    return { data: await this.pathologyService.addSlide(id, { blockNo: body.blockNo, slideNo: body.slideNo, stainType: body.stainType }) };
  }

  @Get('specimens/:id/slides')
  @ApiOperation({ summary: '슬라이드 목록 조회 (Phase 5)' })
  async getSlides(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.pathologyService.getSlides(id) };
  }

  @Post('reports/:id/images')
  @ApiOperation({ summary: '보고서 이미지 메타데이터 등록 — 저장 모델 없음: 저장하지 않고 recorded:false·NOT_PERSISTED 를 돌려준다' })
  async addReportImage(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: AddPathologyReportImageDto,
  ) {
    return { data: await this.pathologyService.addReportImage(id, body) };
  }

  @Get('stats/qc')
  @ApiOperation({ summary: 'QC 통계 (Phase 7 — 수정률/재검률 30일)' })
  async getQcStats() {
    return { data: await this.pathologyService.getQcStats() };
  }

  @Get('stats/tat')
  @ApiOperation({ summary: '처리 소요시간(TAT) 통계' })
  async getTatStats() {
    return { data: await this.pathologyService.getTatStats() };
  }

  @Get('stats/by-department')
  @ApiOperation({ summary: '부서별 검체 통계 (최근 30일)' })
  async getStatsByDepartment() {
    return { data: await this.pathologyService.getStatsByDepartment() };
  }

  @Get('stats/by-diagnosis')
  @ApiOperation({ summary: '진단 분포 통계 (양성/악성/전암성)' })
  async getStatsByDiagnosis() {
    return { data: await this.pathologyService.getStatsByDiagnosis() };
  }

  @Get('stats')
  @ApiOperation({ summary: '병리과 통계' })
  async getStats() {
    return { data: await this.pathologyService.getStats() };
  }

  @Get('patients')
  @ApiOperation({ summary: '검체 보유 환자 목록' })
  async getPatients() {
    return { data: await this.pathologyService.getPatients() };
  }
}
