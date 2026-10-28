import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { ASSET_KINDS_EXCLUDED, AssetKind, isAssetKind } from '@hospital-run/shared';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SpaceAssetService } from './space-asset.service';
import { EndPlacementDto, PlaceAssetDto, SetBedLinkDto, SetClinicRoomDto } from './dto/space-asset.dto';
import { SpaceBedLinkService } from './space-bed-link.service';

function kindOrThrow(v: string | undefined, required: true): AssetKind;
function kindOrThrow(v: string | undefined, required: false): AssetKind | undefined;
function kindOrThrow(v: string | undefined, required: boolean): AssetKind | undefined {
  if (!v) {
    if (required) throw new BadRequestException({ code: 'ASSET_KIND_REQUIRED', message: 'kind 가 필요합니다.' });
    return undefined;
  }
  if (!isAssetKind(v)) throw new BadRequestException({ code: 'ASSET_KIND_UNKNOWN', message: '알 수 없는 자산 종류입니다.', details: { kind: v } });
  return v;
}

/**
 * 공간 자산 배치 — 워크스테이션·PC·의료기기·장비·보관 장소의 위치 원장(기획 spatial-flow-vision-3d §5-A).
 *
 * 권한: 관리자만(단말 목록은 보안 자산 목록이다). 임상 직군(장비 찾기)에 읽기를 여는 것은 사람 결정 D9.
 * 감사: 변이는 전역 인터셉터 기본 감사(배치 종료는 경로의 placementId 가 resourceId).
 */
@ApiTags('space-asset')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('api/v1/space-assets')
export class SpaceAssetController {
  constructor(private readonly svc: SpaceAssetService, private readonly beds: SpaceBedLinkService) {}

  @Get('coverage')
  @ApiOperation({ summary: '종류별 배치 현황(분모=활성 자산) + 원장에 넣지 않은 테이블과 이유' })
  async coverage() {
    return { data: await this.svc.coverage(), meta: { excluded: ASSET_KINDS_EXCLUDED } };
  }

  @Get('spaces')
  @ApiOperation({ summary: '배치 대상 공간 트리(층 → 구역) · 구역별 도면 출처' })
  async spaces() {
    return { data: await this.svc.spaces() };
  }

  @Get('placements')
  @ApiOperation({ summary: '배치 목록(활성) — floor(코드/id)·spaceNodeId·kind 로 거름' })
  async placements(@Query('floor') floor?: string, @Query('spaceNodeId') spaceNodeId?: string, @Query('kind') kind?: string) {
    if (spaceNodeId && !/^[0-9a-f-]{36}$/i.test(spaceNodeId))
      throw new BadRequestException({ code: 'SPACE_ID_INVALID', message: 'spaceNodeId 형식이 올바르지 않습니다.' });
    return { data: await this.svc.placements({ floor: floor || undefined, spaceNodeId: spaceNodeId || undefined, kind: kindOrThrow(kind, false) }) };
  }

  @Get('unplaced')
  @ApiOperation({ summary: '미배치 활성 자산 + 기존 텍스트 기반 후보 공간(제안 — 자동 배치 없음)' })
  async unplaced(@Query('kind') kind?: string) {
    return { data: await this.svc.unplaced(kindOrThrow(kind, true)) };
  }

  @Get('history/:kind/:assetId')
  @ApiOperation({ summary: '자산 한 건의 배치 이력' })
  async history(@Param('kind') kind: string, @Param('assetId', ParseUUIDPipe) assetId: string) {
    return { data: await this.svc.history(kindOrThrow(kind, true), assetId) };
  }

  @Post('placements')
  @ApiOperation({ summary: '배치·이동(자산당 활성 하나 · 같은 위치면 변경 없음)' })
  async place(@Body() body: PlaceAssetDto, @CurrentUser('id') userId: string) {
    return { data: await this.svc.place(body, userId) };
  }

  @Get('clinic-rooms')
  @ApiOperation({ summary: '외래 진료실 이름(스케줄 원문) ↔ 공간 연결 상태 + 이름 일치 후보(제안만)' })
  async clinicRooms() {
    return { data: await this.svc.clinicRooms() };
  }

  @Put('clinic-rooms')
  @ApiOperation({ summary: '외래 진료실 ↔ 공간 연결(spaceNodeId=null 해제)' })
  async setClinicRoom(@Body() body: SetClinicRoomDto, @CurrentUser('id') userId: string) {
    return { data: await this.svc.setClinicRoom(body.name, body.spaceNodeId, userId) };
  }

  @Post('clinic-rooms/link-exact')
  @ApiOperation({ summary: '외래 진료실 — 이름 정확 일치 후보 일괄 연결(관리자 실행 · 동명·유사는 잇지 않음)' })
  async linkExactClinicRooms(@CurrentUser('id') userId: string) {
    return { data: await this.svc.linkExactClinicRooms(userId) };
  }

  @Get('bed-links')
  @ApiOperation({ summary: '병상 ↔ 도면 공간 연결 상태 + 제안(층·호실 일치 / 응급실 한 공간 — 제안만)' })
  async bedLinks() {
    return { data: await this.beds.list() };
  }

  @Put('bed-links')
  @ApiOperation({ summary: '병상 ↔ 공간 연결(spaceNodeId=null 해제)' })
  async setBedLinks(@Body() body: SetBedLinkDto) {
    return { data: await this.beds.set(body.bedIds, body.spaceNodeId) };
  }

  @Post('bed-links/link-suggested')
  @ApiOperation({ summary: '병상 — 유일한 제안만 일괄 연결(관리자 실행 · 모호·없음은 남김 · 이미 연결은 안 덮음)' })
  async linkSuggestedBeds() {
    return { data: await this.beds.linkSuggested() };
  }

  @Post('placements/:placementId/end')
  @ApiOperation({ summary: '배치 종료(철거·반출·폐기) — 사유 필수 · 자산 행은 건드리지 않음' })
  async end(@Param('placementId', ParseUUIDPipe) placementId: string, @Body() body: EndPlacementDto, @CurrentUser('id') userId: string) {
    return { data: await this.svc.end(placementId, body.reason, userId) };
  }
}
