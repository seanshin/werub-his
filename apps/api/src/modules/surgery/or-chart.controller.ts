import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { OrChartService } from './or-chart.service';
import { AddIntraopEventDto, SaveOrChartLayoutDto, SetCirculatingDto, StampIntraopPhaseDto, VoidIntraopEventDto } from './dto/or-chart.dto';

/**
 * 수술방 차트(2026-10-05) — 수술 중 기록 원장·단계 찍기·개인 배치.
 * 쓰기는 수술방 의료진(의사·간호사)·관리자 · 누가 적었는지는 원장이 갖는다.
 */
@ApiTags('Surgery OR Chart (수술방 차트)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
@Controller('api/v1')
export class OrChartController {
  constructor(private readonly service: OrChartService) {}

  @Get('surgery/:surgeryId/intraop')
  @ApiOperation({ summary: '수술방 차트 — 수술·단계 정본 시각·마취 기록 머리·체크리스트 요약·수술 중 기록 원장·내 역할 추정' })
  async getChart(@Param('surgeryId', ParseUUIDPipe) surgeryId: string, @CurrentUser('id') userId: string) {
    return { data: await this.service.getChart(surgeryId, userId) };
  }

  @Post('surgery/:surgeryId/intraop/events')
  @ApiOperation({ summary: '수술 중 기록 덧붙이기(활력·약물·수액·혈액·배출·사건·메모) — 고치지 않는다' })
  async addEvent(@Param('surgeryId', ParseUUIDPipe) surgeryId: string, @Body() dto: AddIntraopEventDto, @CurrentUser('id') userId: string) {
    return { data: await this.service.addEvent(surgeryId, dto, userId) };
  }

  @Post('surgery/:surgeryId/intraop/events/:eventId/void')
  @ApiOperation({ summary: '수술 중 기록 무효 — 사유 필수 · 적은 사람 또는 관리자' })
  async voidEvent(
    @Param('surgeryId', ParseUUIDPipe) surgeryId: string,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body() dto: VoidIntraopEventDto,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: string,
  ) {
    return { data: await this.service.voidEvent(surgeryId, eventId, dto.reason, userId, role) };
  }

  @Post('surgery/:surgeryId/intraop/phase')
  @ApiOperation({ summary: '단계 찍기 — 유도·삽관·발관(마취 기록)·절개·봉합(수술 원장) 정본 칸 · 이미 있으면 409' })
  async stampPhase(
    @Param('surgeryId', ParseUUIDPipe) surgeryId: string,
    @Body() dto: StampIntraopPhaseDto,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: string,
  ) {
    return { data: await this.service.stampPhase(surgeryId, dto.phase, dto.at, userId, role) };
  }

  @Post('surgery/:surgeryId/intraop/circulating')
  @Roles(UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '순회 간호 자리 — 내가 맡기(교대 포함)·내려놓기(본인·관리자)' })
  async setCirculating(
    @Param('surgeryId', ParseUUIDPipe) surgeryId: string,
    @Body() dto: SetCirculatingDto,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: string,
  ) {
    return { data: await this.service.setCirculating(surgeryId, dto.action, userId, role) };
  }

  @Post('surgery/:surgeryId/intraop/ai-narrative')
  @Roles(UserRole.DOCTOR, UserRole.NURSE)
  @ApiOperation({ summary: '수술 경과 요약 AI 초안 — 요청할 때만 · 저장하지 않음 · 원장에서 센 사실만 보냄(비식별) · 출처 AI/UNAVAILABLE' })
  async aiNarrative(@Param('surgeryId', ParseUUIDPipe) surgeryId: string, @CurrentUser('id') userId: string) {
    return { data: await this.service.aiNarrative(surgeryId, userId) };
  }

  @Get('or-chart/layouts')
  @ApiOperation({ summary: '내 수술방 차트 배치(기기 구성×역할) — 저장본이 없으면 기본(source)' })
  async getLayout(@Query('profile') profile: string, @Query('role') role: string, @CurrentUser('id') userId: string) {
    return { data: await this.service.getLayout(userId, profile, role) };
  }

  @Put('or-chart/layouts')
  @ApiOperation({ summary: '내 수술방 차트 배치 저장 — 정본으로 정규화(모르는 패널 버림·화면 수는 기기 구성에 맞춤)' })
  async saveLayout(@Body() dto: SaveOrChartLayoutDto, @CurrentUser('id') userId: string) {
    return { data: await this.service.saveLayout(userId, dto) };
  }

  @Delete('or-chart/layouts')
  @ApiOperation({ summary: '내 수술방 차트 배치 기본으로 되돌리기' })
  async resetLayout(@Query('profile') profile: string, @Query('role') role: string, @CurrentUser('id') userId: string) {
    return { data: await this.service.resetLayout(userId, profile, role) };
  }
}
