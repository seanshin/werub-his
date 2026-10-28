import { Controller, Get, Param, Query, UseGuards, NotFoundException, Sse, MessageEvent } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { Observable } from 'rxjs';
import { FloorService } from './floor.service';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';

/**
 * 🔴 (2026-09-16 E3) 14 핸들러 전부 역할 없이 전 직원에게 열려 있었다 — 동선·체류 이력·이슈·SLA 는
 *    사람의 이동 기록이다. 소비 화면은 `/simulator`(nav `ADMIN_ONLY`) 하나뿐이고 다른 소비처는 0이라,
 *    화면 역할을 그대로 클래스 기본값으로 둔다(핸들러 `@Roles` 는 클래스를 덮는다 — 개별 선언 없음).
 */
@ApiTags('Floor (병원 동선 모니터링)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('api/floor')
export class FloorController {
  constructor(private readonly service: FloorService) {}

  // #1 층 목록
  @Get('plans')
  @ApiOperation({ summary: '층 목록' })
  async getPlans() {
    return { ok: true, data: await this.service.getFloorPlans(), timestamp: new Date().toISOString() };
  }

  // #2 층 평면도 데이터
  @Get('plans/:floorId')
  @ApiOperation({ summary: '층 평면도 데이터' })
  async getPlan(@Param('floorId') floorId: string) {
    const data = await this.service.getFloorPlan(floorId);
    if (!data) throw new NotFoundException('Floor not found');
    return { ok: true, data, timestamp: new Date().toISOString() };
  }

  // #3 구역 목록
  @Get('zones/:floorId')
  @ApiOperation({ summary: '구역 목록' })
  async getZones(@Param('floorId') floorId: string) {
    return { ok: true, data: await this.service.getZones(floorId), timestamp: new Date().toISOString() };
  }

  // #4 현재 환자/의료진 위치
  @Get('entities/:floorId')
  @ApiOperation({ summary: '현재 환자/의료진 위치' })
  async getEntities(@Param('floorId') floorId: string, @Query('type') type?: string) {
    return { ok: true, data: await this.service.getEntities(floorId, type), timestamp: new Date().toISOString() };
  }

  // #6 구역별 실시간 통계
  @Get('stats/:floorId')
  @ApiOperation({ summary: '구역별 실시간 통계' })
  async getStats(@Param('floorId') floorId: string) {
    return { ok: true, data: await this.service.getStats(floorId), timestamp: new Date().toISOString() };
  }

  // #7 층 전체 요약 (위젯용)
  @Get('stats/:floorId/summary')
  @ApiOperation({ summary: '층 전체 요약 (위젯용)' })
  async getSummary(@Param('floorId') floorId: string) {
    const data = await this.service.getFloorSummary(floorId);
    if (!data) throw new NotFoundException('Floor not found');
    return { ok: true, data, timestamp: new Date().toISOString() };
  }

  // #9 환자 이동 이력
  @Get('history/:entityId')
  @ApiOperation({ summary: '특정 환자/의료진 이동 이력' })
  async getHistory(@Param('entityId') entityId: string, @Query('date') date?: string) {
    const data = await this.service.getEntityHistory(entityId, date);
    if (!data) throw new NotFoundException('Entity not found');
    return { ok: true, data, timestamp: new Date().toISOString() };
  }

  // [clinic-floor P2] #1 존간 전이 집계 (OD Matrix) — 흐름선/Sankey
  @Get('flows/:floorId')
  @ApiOperation({ summary: '존간 전이 집계 (OD Matrix)' })
  async getFlows(
    @Param('floorId') floorId: string,
    @Query('window') window?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const win = window ? Math.max(1, Math.min(1440, parseInt(window, 10) || 60)) : 60;
    return { ok: true, data: await this.service.getFlows(floorId, win, from, to), timestamp: new Date().toISOString() };
  }

  // [clinic-floor P2] #4 층 단위 이력 일괄 (리플레이/OD)
  // ⚠️ 스펙은 history/{floorId}이나 기존 history/:entityId와 충돌 → floor-history/:floorId 로 제공
  @Get('floor-history/:floorId')
  @ApiOperation({ summary: '층 단위 이동 이력 일괄 (clinic-floor #4)' })
  async getFloorHistory(
    @Param('floorId') floorId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('types') types?: string,
    @Query('cursor') cursor?: string,
  ) {
    return { ok: true, data: await this.service.getFloorHistory(floorId, from, to, types, cursor), timestamp: new Date().toISOString() };
  }

  // [clinic-floor P3] #3 존 토폴로지 (인접·경로)
  @Get('topology/:floorId')
  @ApiOperation({ summary: '존 토폴로지 (인접·경로)' })
  async getTopology(@Param('floorId') floorId: string) {
    return { ok: true, data: await this.service.getTopology(floorId), timestamp: new Date().toISOString() };
  }

  // [clinic-floor P3] #5 존별 SLA/기대치
  @Get('sla/:floorId')
  @ApiOperation({ summary: '존별 SLA/기대치' })
  async getSla(@Param('floorId') floorId: string) {
    return { ok: true, data: await this.service.getSla(floorId), timestamp: new Date().toISOString() };
  }

  // [clinic-floor P4] #8 예약/예정 동선 (Scheduled Flow)
  @Get('schedule/:floorId')
  @ApiOperation({ summary: '예약/예정 동선 (다음 행선지)' })
  async getSchedule(@Param('floorId') floorId: string) {
    return { ok: true, data: await this.service.getSchedule(floorId), timestamp: new Date().toISOString() };
  }

  // [clinic-floor 선택] #6 흐름 차단/이슈 컨텍스트
  @Get('issues/:floorId')
  @ApiOperation({ summary: '흐름 차단/이슈 컨텍스트' })
  async getIssues(@Param('floorId') floorId: string) {
    return { ok: true, data: await this.service.getIssues(floorId), timestamp: new Date().toISOString() };
  }

  // [clinic-floor P3] #2 실시간 이동 이벤트 (SSE)
  @Sse('events/:floorId')
  @ApiOperation({ summary: '실시간 이동 이벤트 (SSE)' })
  streamEvents(@Param('floorId') floorId: string): Observable<MessageEvent> {
    return this.service.getEventStream(floorId);
  }
}
