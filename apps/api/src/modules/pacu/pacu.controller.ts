import { Controller, Get, Post, Patch, Param, Body, Query, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { PacuService } from './pacu.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AdmitPacuDto, RecordVitalsDto, UpdateAldreteDto, DischargeDto, UpdatePonvDto, UpdatePadssDto, AddComplicationDto, AddPainDto, AddInterventionDto, AddPacuIoDto, AddPacuNoteDto, SetPacuDelayDto, SetPacuBayDto } from './dto/pacu.dto';

@ApiTags('PACU (회복실)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
@Controller('api/v1/pacu')
export class PacuController {
  constructor(private readonly pacuService: PacuService) {}

  @Post('admit')
  @ApiOperation({ summary: 'PACU 입실' })
  async admit(@Body() data: AdmitPacuDto, @CurrentUser('id') userId: string) {
    return { data: await this.pacuService.admit(data, userId) };
  }

  @Get()
  @ApiOperation({ summary: 'PACU 기록 목록' })
  async getRecords(@Query('date') date?: string, @Query('status') status?: string) {
    return { data: await this.pacuService.getRecords({ date, status }) };
  }

  @Get('active')
  @ApiOperation({ summary: 'PACU 현재 재실 환자' })
  async getActivePatients() {
    return { data: await this.pacuService.getActivePatients() };
  }

  @Get('pending-admissions')
  @ApiOperation({ summary: '수술 완료 → PACU 입실 대기 목록' })
  async pendingAdmissions() {
    return { data: await this.pacuService.pendingAdmissions() };
  }

  @Get('stats')
  @ApiOperation({ summary: 'PACU 통계' })
  async getStats() {
    return { data: await this.pacuService.getStats() };
  }

  @Get('settings')
  @ApiOperation({ summary: 'PACU 감시 설정(활력 재측정 주기·재실 초과·저체온 임계·척도 만점) — 화면이 임계·만점을 자기 파일에 적지 않게 하는 정본' })
  async getSettings() {
    return { data: await this.pacuService.getMonitoringSettings() };
  }

  @Get(':id')
  @ApiOperation({ summary: 'PACU 기록 상세' })
  async getRecordById(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.pacuService.getRecordById(id) };
  }

  /** 퇴실 목적지 선택지 — 원 병상·재원 중 ICU 입실·비어 있는 병상(2026-09-30) */
  @Get(':id/destination-options')
  @ApiOperation({ summary: 'PACU 퇴실 목적지 선택지(원 병상·ICU·가용 병상)' })
  async getDestinationOptions(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.pacuService.getDestinationOptions(id) };
  }

  @Get(':id/vitals')
  @ApiOperation({ summary: 'PACU 활력징후 이력(최신순·이상플래그 포함)' })
  async getVitals(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.pacuService.getVitals(id) };
  }

  @Post(':id/vitals')
  @ApiOperation({ summary: 'PACU 활력징후 기록(이상치 자동 판정)' })
  async recordVitals(@Param('id', ParseUUIDPipe) id: string, @Body() vitals: RecordVitalsDto, @CurrentUser('id') userId: string) {
    return { data: await this.pacuService.recordVitals(id, vitals, userId) };
  }

  @Patch(':id/aldrete')
  @ApiOperation({ summary: 'Aldrete 점수 업데이트(세부 6항목·퇴실 기준 안내)' })
  async updateAldrete(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateAldreteDto, @CurrentUser('id') userId: string) {
    return { data: await this.pacuService.updateAldrete(id, dto, userId) };
  }

  @Patch(':id/ponv')
  @ApiOperation({ summary: 'PONV(수술후 오심·구토) 평가' })
  async updatePonv(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePonvDto, @CurrentUser('id') userId: string) {
    return { data: await this.pacuService.updatePonv(id, dto, userId) };
  }

  @Patch(':id/padss')
  @ApiOperation({ summary: 'PADSS 귀가 척도(HOME 퇴실 기준 ≥9)' })
  async updatePadss(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePadssDto, @CurrentUser('id') userId: string) {
    return { data: await this.pacuService.updatePadss(id, dto, userId) };
  }

  @Post(':id/complication')
  @ApiOperation({ summary: 'PACU 합병증 기록(구조화·SEVERE 알림)' })
  async addComplication(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AddComplicationDto, @CurrentUser('id') userId: string) {
    return { data: await this.pacuService.addComplication(id, dto, userId) };
  }

  @Post(':id/intervention')
  @ApiOperation({ summary: 'PACU 중재(처치) 기록 — 산소·가온·약물·기도유지' })
  async addIntervention(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') userId: string,
    @Body() dto: AddInterventionDto,
  ) {
    return { data: await this.pacuService.addIntervention(id, dto, userId) };
  }

  @Post(':id/pain')
  @ApiOperation({ summary: 'PACU 통증 재평가(추이)' })
  async addPain(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AddPainDto, @CurrentUser('id') userId: string) {
    return { data: await this.pacuService.addPainAssessment(id, dto, userId) };
  }

  // ── 2026-10-07 회복실 상세화 ──
  @Get(':id/handoff-context')
  @ApiOperation({ summary: '수술실→회복실 마취 인계 맥락 — 마취기록·수술 중 기록 요약(읽기만 · 없으면 null)' })
  async handoffContext(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.pacuService.getHandoffContext(id) };
  }

  @Post(':id/io')
  @ApiOperation({ summary: '회복실 섭취·배설 기록(덧붙이기)' })
  async addIo(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AddPacuIoDto, @CurrentUser('id') userId: string) {
    return { data: await this.pacuService.addIo(id, dto, userId) };
  }

  @Post(':id/note')
  @ApiOperation({ summary: '회복실 간호기록 한 줄(덧붙이기)' })
  async addNote(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AddPacuNoteDto, @CurrentUser('id') userId: string) {
    return { data: await this.pacuService.addNote(id, dto, userId) };
  }

  @Post(':id/sign-off')
  @ApiOperation({ summary: '마취과 퇴실 확인 — 의사만 · 한 번' })
  async signOff(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('id') userId: string, @CurrentUser('role') role: string) {
    return { data: await this.pacuService.signOff(id, userId, role) };
  }

  @Patch(':id/delay')
  @ApiOperation({ summary: '퇴실 지연 사유(shared 어휘 · null=해제)' })
  async setDelay(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetPacuDelayDto) {
    return { data: await this.pacuService.setDelay(id, dto) };
  }

  @Patch(':id/bay')
  @ApiOperation({ summary: '회복실 자리(베이) — 빈 값=해제' })
  async setBay(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetPacuBayDto) {
    return { data: await this.pacuService.setBay(id, dto) };
  }

  @Post(':id/discharge')
  @ApiOperation({ summary: 'PACU 퇴실 — WARD/ICU: Aldrete≥9, HOME: PADSS≥9 게이트(미달 시 사유 필수)' })
  async discharge(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') userRole: string,
    @Body() dto: DischargeDto,
  ) {
    return { data: await this.pacuService.discharge(id, userId, dto.disposition, dto.overrideReason, dto.dischargeHandoff, userRole,
      { targetBedId: dto.targetBedId, icuBedId: dto.icuBedId, icuAdmitReason: dto.icuAdmitReason }) };
  }
}
