import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SpaceModelService } from './space-model.service';
import { CreateSpaceImportDto, RejectSpaceImportDto } from './dto/space-model.dto';

/**
 * 공간 도면 가져오기·기하 — 기획 spatial-flow-vision-3d P1(가져오기·확정)·P2(뷰어 기하).
 * 권한: 가져오기·확정·반려 = 관리자 · 기하 조회 = 전 직원(방 배치·문 위치뿐 — 환자·좌표 외 정보 없음).
 */
@ApiTags('space-model')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/space')
export class SpaceModelController {
  constructor(private readonly svc: SpaceModelService) {}

  @Get('imports')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '도면 가져오기 목록(검증 요약 포함 · payload 제외)' })
  async list() {
    return { data: await this.svc.list() };
  }

  @Post('imports')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '도면 올리기(space-import.v1) — 초안으로 저장·검증 결과 기록 · 합성은 REAL 에서 거부' })
  async create(@Body() body: CreateSpaceImportDto, @CurrentUser('id') userId: string) {
    return { data: await this.svc.create(body.title, body.payload, userId) };
  }

  @Post('imports/:id/confirm')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '확정 — 검증 오류 0 일 때만 · 공간 노드에 좌표·기하 출처를 새긴다' })
  async confirm(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('id') userId: string) {
    return { data: await this.svc.confirm(id, userId) };
  }

  @Post('imports/:id/reject')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '반려(사유 필수)' })
  async reject(@Param('id', ParseUUIDPipe) id: string, @Body() body: RejectSpaceImportDto) {
    return { data: await this.svc.reject(id, body.reason) };
  }

  @Post('imports/:id/withdraw')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '확정 철회 — 좌표 회수 · WITHDRAWN(사유 필수)' })
  async withdraw(@Param('id', ParseUUIDPipe) id: string, @Body() body: RejectSpaceImportDto) {
    return { data: await this.svc.withdraw(id, body.reason) };
  }

  /**
   * 길찾기(직원) — origin: 'entrance:<id>'·SpaceNode id(없으면 주출입구) · dest: SpaceNode id · restricted=true 면 통제 구역 통과 허용.
   * 🔴 `from`/`to` 를 쓰지 않는다 — 전역 DateQueryPipe 가 날짜 키로 예약해 UUID 를 400 으로 막는다(2026-09-28 운영 실측).
   */
  @Get('route')
  @ApiOperation({ summary: '길찾기 — 구조화된 단계·층별 경로 점(직원 · 통제 구역은 요청 시만)' })
  async route(@Query('dest') to?: string, @Query('origin') from?: string, @Query('accessible') accessible?: string, @Query('restricted') restricted?: string) {
    const uuid = /^[0-9a-f-]{36}$/i;
    if (!to || !uuid.test(to)) throw new BadRequestException({ code: 'ROUTE_TO_INVALID', message: '도착 공간이 올바르지 않습니다.' });
    if (from && !uuid.test(from) && !/^entrance:[A-Za-z0-9-]{1,40}$/.test(from))
      throw new BadRequestException({ code: 'ROUTE_FROM_INVALID', message: '출발점이 올바르지 않습니다.' });
    return { data: await this.svc.route({ to, from: from || undefined, accessibleOnly: accessible === 'true', allowRestricted: restricted === 'true' }) };
  }

  @Get('entrances')
  @ApiOperation({ summary: '출입구(길찾기 출발점) — 직원은 통제 출입구 포함' })
  async entrances() {
    return { data: await this.svc.entrances(true) };
  }

  /** 뷰어 기하 — 전 직원(방 배치·문 위치뿐) */
  @Get('geometry')
  @ApiOperation({ summary: '확정 도면 기하(층·방·문) — 없으면 null · 합성이면 notice' })
  async geometry() {
    return { data: await this.svc.geometry() };
  }
}
