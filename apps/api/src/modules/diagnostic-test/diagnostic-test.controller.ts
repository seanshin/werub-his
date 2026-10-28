import { Controller, Get, Post, Put, Patch, Param, Body, Query, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { DiagnosticTestService } from './diagnostic-test.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import {
  CreateDiagnosticTestDto, ReportDiagnosticTestDto, ReviewDiagnosticTestDto, TransitionDto,
  UpdateStationTestTypesDto, SaveMeasurementsDto, PerformDiagnosticTestDto, CreateDiagnosticStationDto,
} from './dto/diagnostic-test.dto';

@ApiTags('DiagnosticTests')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.LAB_TECH, UserRole.ADMIN) // 기본 가드(조회) — @Roles 없던 GET 무가드화 방지. 쓰기는 메서드에서 강화
@Controller('api/v1/diagnostic-tests')
export class DiagnosticTestController {
  constructor(private readonly diagnosticTestService: DiagnosticTestService) {}

  @Post()
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '검사 의뢰' })
  async create(@Body() dto: CreateDiagnosticTestDto, @CurrentUser('id') requestedBy: string) {
    return { data: await this.diagnosticTestService.create({ ...dto, requestedBy }) };
  }

  @Get()
  @ApiOperation({ summary: '검사 목록 (필터: type, status, patientId)' })
  async findAll(@Query('testType') testType?: string, @Query('status') status?: string, @Query('patientId') patientId?: string) {
    return { data: await this.diagnosticTestService.findAll({ testType, status, patientId }) };
  }

  @Get('types')
  @ApiOperation({ summary: '검사 종류 목록' })
  getTypes() { return { data: this.diagnosticTestService.getTypes() }; }

  // ── 자리(스테이션) — 담당 조무사·간호사가 쓰는 경로 ──
  // 🔴 `:id` 보다 **먼저** 선언해야 한다. 뒤에 두면 `stations` 가 ParseUUIDPipe 에 걸려 400 이 된다.

  @Get('stations')
  @Roles(UserRole.NURSE, UserRole.LAB_TECH, UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '기초검사 자리 목록 + 자리별 설정·대기 건수(미설정은 null)' })
  async listStations() {
    const { stations, unassignedTestTypes } = await this.diagnosticTestService.listStations();
    return { data: stations, meta: { unassignedTestTypes } };
  }

  @Post('stations')
  @Roles(UserRole.NURSE, UserRole.LAB_TECH, UserRole.ADMIN)
  @ApiOperation({ summary: '기초검사 자리 신설(diag- 접두 강제)' })
  async createStation(@Body() dto: CreateDiagnosticStationDto) {
    return { data: await this.diagnosticTestService.createStation({
      stationId: dto.stationId, label: dto.label, department: dto.department,
      location: dto.location, testTypes: dto.testTypes,
    }) };
  }

  @Put('stations/:stationId/test-types')
  @Roles(UserRole.NURSE, UserRole.LAB_TECH, UserRole.ADMIN)
  @ApiOperation({ summary: '이 자리에서 시행하는 검사 종류 설정' })
  async setStationTestTypes(@Param('stationId') stationId: string, @Body() dto: UpdateStationTestTypesDto) {
    return { data: await this.diagnosticTestService.setStationTestTypes(stationId, {
      testTypes: dto.testTypes, label: dto.label, location: dto.location,
    }) };
  }

  @Get('stations/:stationId/queue')
  @Roles(UserRole.NURSE, UserRole.LAB_TECH, UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '자리별 대기 환자(설정된 검사 종류만 — 폴백 없음)' })
  async getStationQueue(@Param('stationId') stationId: string, @Query('stat') stat?: string) {
    const { items, meta } = await this.diagnosticTestService.getStationQueue(stationId, { statOnly: stat === 'true' });
    return { data: items, meta };
  }

  @Get(':id')
  @ApiOperation({ summary: '검사 상세 + 결과' })
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.diagnosticTestService.findOne(id) };
  }

  // 🔴 NURSE 추가(2026-08-26 실측) — 기초검사를 실제로 시행·기록하는 직군은 조무사·간호사인데
  //    시행/판독 EP 가 LAB_TECH·DOCTOR·ADMIN 뿐이라 **간호 계정은 개통 이래 403** 이었다.
  //    사이드바는 `/workstation/diagnostic` 을 NURSE 에게 보여주고 있었다(nav 노출 ≠ 권한).
  @Patch(':id/perform')
  @Roles(UserRole.NURSE, UserRole.LAB_TECH, UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '검사 시행' })
  async perform(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PerformDiagnosticTestDto,
    @CurrentUser('id') performedBy: string,
  ) {
    return { data: await this.diagnosticTestService.perform(id, performedBy, dto?.stationId) };
  }

  @Patch(':id/measurements')
  @Roles(UserRole.NURSE, UserRole.LAB_TECH, UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '검사값(측정값) 저장 — 판독·완료는 하지 않는다' })
  async saveMeasurements(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SaveMeasurementsDto,
    @CurrentUser('id') performedBy: string,
  ) {
    return { data: await this.diagnosticTestService.saveMeasurements(id, dto.measurements, performedBy, dto.stationId) };
  }

  @Patch(':id/report')
  @Roles(UserRole.NURSE, UserRole.LAB_TECH, UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '판독 결과 입력 (delta check·위험소견)' })
  async report(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReportDiagnosticTestDto,
    @CurrentUser('id') interpretedBy: string,
  ) {
    return { data: await this.diagnosticTestService.report(id, { ...dto, interpretedBy }) };
  }

  @Patch(':id/review')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '판독 검토(서명·승인/반려) — P2' })
  async review(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReviewDiagnosticTestDto, @CurrentUser('id') reviewedBy: string) {
    return { data: await this.diagnosticTestService.review(id, dto.decision, dto.note, reviewedBy) };
  }

  @Patch(':id/transition')
  @Roles(UserRole.LAB_TECH, UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '상태 전이(취소·보류·보류 해제) — P2 · 전이표는 shared 정본 · 결과 있는 검사 취소는 acknowledgeResult 필요(409) · 오더·청구는 바꾸지 않고 impacts 로 알림' })
  async transition(@Param('id', ParseUUIDPipe) id: string, @Body() dto: TransitionDto, @CurrentUser('id') actorId: string) {
    return { data: await this.diagnosticTestService.transition(id, dto.status, dto.reason, actorId, { acknowledgeResult: dto.acknowledgeResult }) };
  }

  @Get('patient/:patientId/trend')
  @ApiOperation({ summary: '환자별 검사 추이 — P3' })
  async getTrend(@Param('patientId', ParseUUIDPipe) patientId: string, @Query('testType') testType: string, @Query('metric') metric?: string) {
    return { data: await this.diagnosticTestService.getTrend(patientId, testType, metric) };
  }
}
