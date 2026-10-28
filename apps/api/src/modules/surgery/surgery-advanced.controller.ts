import { Controller, Get, Post, Patch, Param, Body, Query, UseGuards, ParseUUIDPipe, ParseEnumPipe, Put } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { SurgeryAdvancedService } from './surgery-advanced.service';
import { SurgeryMonitorService } from './surgery-monitor.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import {
  CreateOperatingRoomDto, AssignRoomDto,
  CreateAnesthesiaRecordDto, UpdateAnesthesiaRecordDto,
  UpdateSurgicalChecklistDto, UpsertPreAnesthesiaDto, ChecklistProgressQueryDto,
} from './dto/surgery-advanced.dto';

@ApiTags('Surgery Advanced (수술실 관리)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/surgery')
export class SurgeryAdvancedController {
  constructor(
    private readonly service: SurgeryAdvancedService,
    private readonly monitor: SurgeryMonitorService,
  ) {}

  // ── Operating Room ──

  @Get('rooms')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN, UserRole.READ)
  @ApiOperation({ summary: '수술실 목록' })
  async getRooms() {
    return { data: await this.service.getRooms() };
  }

  @Post('rooms')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '수술실 등록' })
  async createRoom(@Body() body: CreateOperatingRoomDto) {
    return { data: await this.service.createRoom(body) };
  }

  @Get('rooms/:roomId/schedule')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '수술실 일일 스케줄' })
  async getRoomSchedule(
    @Param('roomId', ParseUUIDPipe) roomId: string,
    @Query('date') date: string,
  ) {
    return { data: await this.service.getRoomSchedule(roomId, date) };
  }

  @Post('rooms/assign')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '수술실 배정' })
  async assignRoom(@Body() body: AssignRoomDto) {
    return { data: await this.service.assignRoom(body) };
  }

  @Get('or-board')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: 'OR Board (전체 수술실 현황)' })
  async getOrBoard(@Query('date') date?: string) {
    return { data: await this.service.getOrBoard(date) };
  }

  /**
   * 수술실 실시간 모니터(2026-10-05) — 방별 진행 단계(기록된 시각)·경과/예상·수술 중 활력·안전 체크·회복실.
   * 🔴 정적 경로 — `:surgeryId/...` 보다 먼저.
   */
  @Get('live-board')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '수술실 실시간 모니터 — 단계·경과·예상 대비·수술 중 활력·안전 체크(수술 원장 기준)' })
  async getLiveBoard(@Query('date') date?: string) {
    return { data: await this.monitor.getLiveBoard(date) };
  }

  @Get('quality')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '수술실 운영·기록 질 지표 — 첫 수술 시작 지연·회전 시간·예상 대비·기록 완결·회복실(분자/분모 · 표본 0 = null)' })
  async getQuality(@Query('from') from?: string, @Query('to') to?: string) {
    return { data: await this.monitor.getQuality(from, to) };
  }

  // ── Anesthesia ──

  @Post(':surgeryId/anesthesia')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '마취 기록 생성' })
  async createAnesthesiaRecord(
    @Param('surgeryId', ParseUUIDPipe) surgeryId: string,
    @Body() body: CreateAnesthesiaRecordDto,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.service.createAnesthesiaRecord(surgeryId, body, userId) };
  }

  @Patch(':surgeryId/anesthesia')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '마취 기록 업데이트 (바이탈/약물/I&O)' })
  async updateAnesthesiaRecord(
    @Param('surgeryId', ParseUUIDPipe) surgeryId: string,
    @Body() body: UpdateAnesthesiaRecordDto,
  ) {
    return { data: await this.service.updateAnesthesiaRecord(surgeryId, body) };
  }

  // ── PACU ──

  // 🔴 (2026-09-30) PACU 쓰기 EP 2개(`POST :surgeryId/pacu`·`PATCH pacu/:id`)를 걷었다 — 호출하는 화면이 없었고,
  //    퇴실 게이트·세부점수 검증·중복 입실 검사를 **우회**했다(Aldrete 범위 검사 없이 12 를 넣고 퇴실 · 활력 배열 통째 덮어쓰기).
  //    PACU 기록 쓰기의 정본은 `/api/v1/pacu/*` 하나다. 조회(GET :surgeryId/pacu)는 수술 화면이 쓰므로 남긴다.

  // ── Surgical Safety Checklist ──

  // ── 마취전평가 (R2-2) ──
  @Get(':surgeryId/pre-anesthesia')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '마취전평가 조회' })
  async getPreAnesthesia(@Param('surgeryId', ParseUUIDPipe) surgeryId: string) {
    return { data: await this.service.getPreAnesthesia(surgeryId) };
  }

  @Get(':surgeryId/anesthesia')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '마취 기록 조회(수술 단위)' })
  async getAnesthesiaRecord(@Param('surgeryId', ParseUUIDPipe) surgeryId: string) {
    return { data: await this.service.getAnesthesiaRecord(surgeryId) };
  }

  @Get(':surgeryId/pacu')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: 'PACU 기록 조회(수술 단위) — 퇴실은 게이트 API(/pacu/:id/discharge)로만' })
  async getPacuRecord(@Param('surgeryId', ParseUUIDPipe) surgeryId: string) {
    return { data: await this.service.getPacuRecord(surgeryId) };
  }

  @Put(':surgeryId/pre-anesthesia')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '마취전평가 작성/수정 (완료 전까지)' })
  async upsertPreAnesthesia(
    @Param('surgeryId', ParseUUIDPipe) surgeryId: string,
    // 🔴 종전 `Record<string, unknown>` — 파이프를 타지 않아 ASA·기도등급·RCRI 가 무검증이었다.
    @Body() dto: UpsertPreAnesthesiaDto,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.service.upsertPreAnesthesia(surgeryId, dto, userId) };
  }

  @Post(':surgeryId/pre-anesthesia/complete')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '마취전평가 완료 — 필수 6요소 검증(ASA·기도·NPO·검사리뷰·동의·계획)' })
  async completePreAnesthesia(@Param('surgeryId', ParseUUIDPipe) surgeryId: string, @CurrentUser('id') userId: string) {
    return { data: await this.service.completePreAnesthesia(surgeryId, userId) };
  }

  // 🔴 정적 경로 — `:surgeryId/...` 보다 **먼저** 선언한다(선언 순서가 매칭 순서다).
  @Get('checklist-progress')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN, UserRole.READ)
  @ApiOperation({ summary: '수술안전 체크리스트 진행도 일괄 조회 (목록 화면용)' })
  async getChecklistProgress(@Query() q: ChecklistProgressQueryDto) {
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const ids = q.surgeryIds.split(',').map((s) => s.trim()).filter((s) => UUID_RE.test(s)).slice(0, 200);
    return { data: await this.service.getChecklistProgressBatch(ids) };
  }

  @Get(':surgeryId/checklist')
  // 🔴 (2026-09-16 D4) 이 컨트롤러에서 **혼자만 역할이 빠져** 있었다(형제 18EP 는 전부 선언) — 쓰기와 같은 집합으로 맞춘다
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '수술안전 체크리스트 조회 + 완료 현황' })
  async getChecklist(@Param('surgeryId', ParseUUIDPipe) surgeryId: string) {
    return { data: await this.service.getChecklist(surgeryId) };
  }

  @Post(':surgeryId/checklist')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '수술안전 체크리스트 생성 (WHO)' })
  async createChecklist(@Param('surgeryId', ParseUUIDPipe) surgeryId: string) {
    return { data: await this.service.createChecklist(surgeryId) };
  }

  @Patch(':surgeryId/checklist/:phase')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '체크리스트 단계별 완료 (signIn/timeOut/signOut)' })
  async updateChecklist(
    @Param('surgeryId', ParseUUIDPipe) surgeryId: string,
    // 🔴 phase 도 무검증이었다 — 오타 phase 는 `CHECKLIST_ITEMS[phase]` 가 undefined 라 500 이 났고
    //    `${phase}CompletedAt` 이라는 존재하지 않는 컬럼을 갱신하려 들었다. 400 으로 되돌린다.
    @Param('phase', new ParseEnumPipe({ signIn: 'signIn', timeOut: 'timeOut', signOut: 'signOut' }))
    phase: 'signIn' | 'timeOut' | 'signOut',
    @Body() body: UpdateSurgicalChecklistDto,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.service.updateChecklist(surgeryId, phase, body, userId) };
  }
}
