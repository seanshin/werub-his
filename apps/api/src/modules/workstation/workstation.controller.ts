import { Body, Controller, Delete, ForbiddenException, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query, Request, UseGuards } from '@nestjs/common';
import { localDateKey } from '../../common/day-range';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CompleteLabResultDto } from './dto/complete-lab-result.dto';
import {
  AcquireImagingDto, CompleteTherapySessionDto, CreateLabTemplateDto, CreateTherapyOrderDto, RecordSpecimenCollectionDto, ReportImagingDto, UpdateLabTemplateDto,
} from './dto/workstation-write.dto';
import { Permission } from '../auth/rbac/permission.types';
import { WorkstationService } from './workstation.service';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';

@ApiTags('워크스테이션')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/workstation')
export class WorkstationController {
  constructor(private readonly svc: WorkstationService) {}

  @Get('smart-patients')
  @RequirePermission(Permission.PATIENT_VIEW)
  @ApiOperation({ summary: '워크스테이션 스마트 환자 검색' })
  @ApiQuery({ name: 'q', required: false, description: '검색어 (search도 호환)' })
  @ApiQuery({ name: 'search', required: false, deprecated: true })
  async getSmartPatients(@Query('q') q?: string, @Query('search') search?: string) {
    return { data: await this.svc.getSmartPatients(q || search) };
  }

  @Get('patient/:patientId/pending-orders')
  @RequirePermission(Permission.ORDER_VIEW)
  @ApiOperation({ summary: '환자 기존 오더 확인' })
  @ApiQuery({ name: 'stationId', required: false })
  async getPatientPendingOrders(
    @Param('patientId') patientId: string,
    @Query('stationId') stationId?: string,
  ) {
    return { data: await this.svc.getPatientPendingOrders(patientId, stationId) };
  }

  @Get('stations')
  @RequirePermission(Permission.ORDER_VIEW)
  @ApiOperation({ summary: '스테이션 목록' })
  @ApiQuery({ name: 'category', required: false })
  async getStations(@Query('category') category?: string) {
    return { data: await this.svc.getStations(category) };
  }

  /**
   * 🔴 **급양은 급양 스테이션만 본다** (2026-08-29 역할별 실로그인 실측).
   *
   *    `/workstation/nutrition` 화면(roles: ADMIN·NURSE·NUTRITION)이 이 EP 를 부르는데
   *    `@RequirePermission(ORDER_VIEW)` 하나라 **급양 계정은 상시 403** 이었다 —
   *    급양 워크스테이션의 **본체 화면이 열리지 않았다.**
   *
   * 🔴 **`ORDER_VIEW` 를 급양에 주지 않는다** — 그러면 검사·영상 큐까지 열린다(너무 넓다).
   *    `stationId === 'nutrition'` 은 임상 오더가 아니라 **`MealOrder` 기반 조리·배식 큐**라
   *    급양 업무 자체다. **그 스테이션에 한해서만** 연다(§규약 5: 성격을 구분한다).
   */
  @Get('station/:stationId/queue')
  /**
   * 🔴 **`RolesGuard` 는 역할과 권한을 AND 로 본다**(2026-08-29 운영 실측으로 확인).
   *    그래서 `@Roles` 에 급양을 넣어도 `@RequirePermission(ORDER_VIEW)` 가 남아 있으면
   *    급양은 여전히 막힌다 — **단위 테스트는 컨트롤러를 직접 불러 가드를 건너뛰므로 통과했다.**
   *    배포하고 눌러보고서야 알았다.
   *
   * 🔴 그래서 **권한 요구를 이 핸들러에서 걷고**, 접근 통제를 아래 본문에서 명시적으로 한다.
   *    `ORDER_VIEW` 를 급양에게 **주지 않는다**(주면 다른 EP 까지 함께 열린다).
   */
  @Roles(UserRole.NUTRITION, UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE, UserRole.LAB_TECH, UserRole.PHARMACIST)
  @ApiOperation({ summary: '스테이션별 대기 환자 (Worklist)' })
  @ApiQuery({ name: 'stat', required: false })
  async getQueue(
    @Param('stationId') stationId: string,
    @CurrentUser('role') role: string,
    @Query('stat') stat?: string,
  ) {
    /**
     * 🔴 **급양은 급양 스테이션 밖으로 못 나간다.**
     *    `@RequirePermission` 을 걷었으므로 이 검사가 **유일한 범위 통제**다 —
     *    지우면 급양이 검사·영상 큐까지 본다(가드가 재주입으로 이것을 막는다).
     */
    if (role === UserRole.NUTRITION && stationId !== 'nutrition' && stationId !== 'nut-kitchen') {
      throw new ForbiddenException('급양 계정은 급양 스테이션 대기열만 조회할 수 있습니다');
    }
    // meta 로 설정 불일치를 알린다 — 화면이 "부서 전체를 보여주는 중"임을 밝혀야 한다
    const [data, meta, surgeryPrep] = await Promise.all([
      this.svc.getQueue(stationId, stat === 'true'),
      this.svc.getStationConfigHealth(stationId),
      // 수술 준비 큐는 기간 창·창 밖 예정 건·상한을 함께 밝힌다(자르면 잘랐다고 말한다)
      stationId === 'surgery-prep' ? this.svc.getSurgeryPrepMeta() : Promise.resolve(undefined),
    ]);
    return { data, meta: surgeryPrep ? { ...meta, surgeryPrep } : meta };
  }

  @Patch('order/:orderId/receive')
  @RequirePermission(Permission.ORDER_EDIT)
  @ApiOperation({ summary: '검체 접수 (ORDERED → RECEIVED)' })
  async receiveOrder(
    @Param('orderId') orderId: string,
    @Request() req: { user: { id?: string; sub?: string } },
  ) {
    return { data: await this.svc.receiveOrder(orderId, (req.user.id ?? req.user.sub)!) };
  }

  /**
   * 검체 채취 기록(2026-10-01) — 검사실 **접수와 다른 사건**. 병동 간호사·채혈실이 채취한 순간에 누른다(지난 시각 입력 가능 · 출처를 남긴다).
   * 미래·발행 전·접수 뒤 시각은 400 · 이미 기록됐으면 409(덮어쓰지 않는다).
   */
  @Patch('order/:orderId/specimen-collection')
  @RequirePermission(Permission.ORDER_EDIT)
  @Roles(UserRole.NURSE, UserRole.LAB_TECH, UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '검체 채취 기록 — 채취 시각·채취자(접수와 별개 · 지난 시각 입력은 출처 ENTERED_LATER)' })
  async recordSpecimenCollection(
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() dto: RecordSpecimenCollectionDto,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.svc.recordSpecimenCollection(orderId, userId, dto) };
  }

  /** 병동 채혈 대기 — 재원 환자의 채취·접수 전 검사 오더(병동 간호사가 채취를 남길 자리) */
  @Get('specimen-collection/pending')
  @RequirePermission(Permission.ORDER_VIEW)
  @Roles(UserRole.NURSE, UserRole.LAB_TECH, UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '병동 채혈 대기 — 재원 환자의 채취 기록 없는 접수 전 검사 오더' })
  @ApiQuery({ name: 'wardId', required: false })
  async getPendingSpecimenCollections(@Query('wardId', new ParseUUIDPipe({ optional: true })) wardId?: string) {
    const r = await this.svc.getPendingSpecimenCollections({ wardId });
    return { data: r.items, meta: { truncated: r.truncated, limit: WorkstationService.PENDING_COLLECTION_LIMIT } };
  }

  @Patch('order/:orderId/start')
  @RequirePermission(Permission.ORDER_EDIT)
  @ApiOperation({ summary: '검사 시작 (RECEIVED → IN_PROGRESS)' })
  async startOrder(
    @Param('orderId') orderId: string,
    @Request() req: { user: { id?: string; sub?: string } },
  ) {
    return { data: await this.svc.startOrder(orderId, (req.user.id ?? req.user.sub)!) };
  }

  @Patch('order/:orderId/complete')
  @RequirePermission(Permission.ORDER_EDIT)
  @ApiOperation({ summary: '오더 완료 (RECEIVED/IN_PROGRESS → COMPLETED) — 범용 워크스테이션' })
  async completeOrder(
    @Param('orderId') orderId: string,
    @Request() req: { user: { id?: string; sub?: string } },
  ) {
    return { data: await this.svc.completeOrder(orderId, (req.user.id ?? req.user.sub)!) };
  }

  // ── 검사실 ──

  @Get('lab/:orderId/template')
  @RequirePermission(Permission.ORDER_VIEW)
  @ApiOperation({ summary: '검사 항목 입력 템플릿' })
  async getLabTemplate(@Param('orderId') orderId: string) {
    // orderId에서 procedureCode 추출
    const order = await this.svc['prisma'].order.findUnique({
      where: { id: orderId },
      include: { prescription: { include: { procedureCode: true } } },
    });
    const code = order?.prescription?.procedureCode?.code;
    if (!code) return { data: null };
    return { data: await this.svc.getLabTemplate(code) };
  }

  @Post('lab/:orderId/results')
  @RequirePermission(Permission.ORDER_EDIT)
  @ApiOperation({ summary: '검사 결과 입력 + 완료' })
  async completeLabResult(
    @Param('orderId') orderId: string,
    @Body() body: CompleteLabResultDto,
    @Request() req: { user: { id?: string; sub?: string } },
  ) {
    return { data: await this.svc.completeLabResult(orderId, body, (req.user.id ?? req.user.sub)!) };
  }

  @Get('lab/:orderId/delta-check')
  @RequirePermission(Permission.ORDER_VIEW)
  @ApiOperation({ summary: '델타 체크 (이전 결과 비교)' })
  async getDeltaCheck(@Param('orderId') orderId: string) {
    return { data: await this.svc.getDeltaCheck(orderId) };
  }

  // ── 영상실 ──

  @Patch('imaging/:orderId/acquired')
  @RequirePermission(Permission.ORDER_EDIT)
  @ApiOperation({ summary: '촬영 완료 (→ ACQUIRED)' })
  async acquireImaging(
    @Param('orderId') orderId: string,
    @Body() body: AcquireImagingDto,
    @Request() req: { user: { id?: string; sub?: string } },
  ) {
    return { data: await this.svc.acquireImaging(orderId, body, (req.user.id ?? req.user.sub)!) };
  }

  @Post('imaging/:orderId/report')
  @RequirePermission(Permission.ENCOUNTER_CREATE)
  @ApiOperation({ summary: '판독 소견 입력 + 완료 (→ REPORTED)' })
  async reportImaging(
    @Param('orderId') orderId: string,
    @Body() body: ReportImagingDto,
    @Request() req: { user: { id?: string; sub?: string } },
  ) {
    return { data: await this.svc.reportImaging(orderId, body, (req.user.id ?? req.user.sub)!) };
  }

  @Get('imaging/reading-queue')
  @RequirePermission(Permission.ORDER_VIEW)
  @ApiOperation({ summary: '판독 대기열' })
  async getReadingQueue() {
    return { data: await this.svc.getReadingQueue() };
  }

  // ── 검사항목 템플릿 관리 ──

  @Get('templates')
  @RequirePermission(Permission.ORDER_VIEW)
  @ApiOperation({ summary: '검사항목 템플릿 목록' })
  @ApiQuery({ name: 'stationId', required: false })
  async getTemplates(@Query('stationId') stationId?: string) {
    return { data: await this.svc.getTemplates(stationId) };
  }

  @Get('templates/:code')
  @RequirePermission(Permission.ORDER_VIEW)
  @ApiOperation({ summary: '검사항목 템플릿 상세' })
  async getTemplate(@Param('code') code: string) {
    return { data: await this.svc.getLabTemplate(code) };
  }

  @Post('templates')
  @RequirePermission(Permission.ORDER_EDIT)
  @ApiOperation({ summary: '검사항목 템플릿 생성' })
  async createTemplate(
    @Body() body: CreateLabTemplateDto,
  ) {
    return { data: await this.svc.createTemplate({ ...body, items: body.items.map((i) => ({ ...i })) }) };
  }

  @Put('templates/:code')
  @RequirePermission(Permission.ORDER_EDIT)
  @ApiOperation({ summary: '검사항목 템플릿 수정' })
  async updateTemplate(
    @Param('code') code: string,
    @Body() body: UpdateLabTemplateDto,
  ) {
    // 코드는 경로가 정본 — 본문 procedureCode(화면이 폼 전체를 보냄)는 쓰지 않는다
    return { data: await this.svc.updateTemplate(code, {
      testName: body.testName, stationId: body.stationId, items: body.items?.map((i) => ({ ...i })),
    }) };
  }

  @Delete('templates/:code')
  @RequirePermission(Permission.ORDER_EDIT)
  @ApiOperation({ summary: '검사항목 템플릿 비활성화' })
  async deleteTemplate(@Param('code') code: string) {
    return { data: await this.svc.deleteTemplate(code) };
  }

  // ── 치료 오더 일정 ──

  @Get('therapy/schedule')
  @RequirePermission(Permission.ORDER_VIEW)
  @ApiOperation({ summary: '치료실 일정 조회' })
  @ApiQuery({ name: 'stationId', required: false })
  @ApiQuery({ name: 'date', required: false })
  @ApiQuery({ name: 'therapistId', required: false })
  async getTherapySchedule(
    @Query('stationId') stationId?: string,
    @Query('date') date?: string,
    @Query('therapistId') therapistId?: string,
  ) {
    return { data: await this.svc.getTherapySchedule({ stationId, date: date ?? localDateKey(new Date()), therapistId }) };
  }

  @Post('therapy/orders')
  @RequirePermission(Permission.ORDER_CREATE)
  @ApiOperation({ summary: '치료 오더 생성 (CPOE)' })
  async createTherapyOrder(
    @Body() body: CreateTherapyOrderDto,
    @Request() req: { user: { id?: string; sub?: string } },
  ) {
    return { data: await this.svc.createTherapyOrder(body, (req.user.id ?? req.user.sub)!) };
  }

  @Patch('therapy/:id/complete')
  @RequirePermission(Permission.ORDER_EDIT)
  @ApiOperation({ summary: '치료 세션 완료' })
  async completeTherapySession(
    @Param('id') id: string,
    @Body() body: CompleteTherapySessionDto,
    @Request() req: { user: { id?: string; sub?: string } },
  ) {
    return { data: await this.svc.completeTherapySession(id, body.resultData, (req.user.id ?? req.user.sub)!) };
  }
}
