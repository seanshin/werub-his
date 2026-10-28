import { BadRequestException, Body, Controller, Get, Headers, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { WifiPositioningService } from './wifi-positioning.service';
import { WifiRegistryService } from './wifi-registry.service';
import {
  BindWifiDeviceDto, CreateWifiApDto, CreateWifiCollectorDto, CreateWifiSurveyDto, SetWifiCollectorActiveDto, UnbindWifiDeviceDto, UpdateWifiApDto,
  VoidWifiSurveyDto, WifiIngestDto, ImportWifiApCsvDto, UnbindWifiBulkDto,
} from './dto/wifi-location.dto';

/**
 * 무선 AP 기반 원내 위치(wifi-location.v1).
 *  · 수집 — 수집기 키(X-Collector-Key) 인증 · 직원 JWT 아님 · 설정이 꺼져 있으면 503
 *  · 지금 위치·궤적 — 환자 위치 화면과 같은 역할(관리자·의사·간호사) · 궤적은 query.patientId 라 열람 감사 대상
 *  · 등록부 — AP·수집기는 관리자 · 단말 연결은 태그를 건네는 직군(원무·간호)과 관리자
 */
@ApiTags('Wifi Location (무선 AP 위치)')
@Controller('api/v1/location/wifi')
export class WifiLocationController {
  constructor(private readonly positioning: WifiPositioningService, private readonly registry: WifiRegistryService) {}

  @Post('ingest')
  @SkipThrottle()
  @ApiHeader({ name: 'X-Collector-Key' })
  @ApiOperation({ summary: '무선 위치 수집(wifi-location.v1) — 수집기 → 측위 → 위치 원장' })
  async ingest(@Headers('x-collector-key') key: string, @Body() dto: WifiIngestDto) {
    return { data: await this.positioning.ingest(key, dto) };
  }

  @Get('live')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  @ApiBearerAuth()
  @ApiOperation({ summary: '최근 N분 단말별 마지막 측위(좌표·오차 반경·출처)' })
  async live(@Query('minutes') minutes?: string) {
    const r = await this.positioning.live(minutes ? Number(minutes) || undefined : undefined);
    return { data: r.items, meta: r.meta };
  }

  @Get('trail')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  @ApiBearerAuth()
  @ApiOperation({ summary: '한 환자의 하루(KST) 측위 궤적' })
  async trail(@Query('patientId', ParseUUIDPipe) patientId: string, @Query('date') date: string) {
    const r = await this.positioning.trail(patientId, date);
    return { data: r.items, meta: r.meta };
  }

  @Get('access-points')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'AP 등록부(층 좌표·교정 여부)' })
  async listAps() {
    return { data: await this.registry.listAccessPoints() };
  }

  @Post('access-points')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'AP 등록(확정 도면의 층·좌표)' })
  async createAp(@CurrentUser() user: { id: string }, @Body() dto: CreateWifiApDto) {
    return { data: await this.registry.createAccessPoint(dto, user.id) };
  }

  @Post('access-points/import')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'AP 등록부 CSV 가져오기 — create-only · 한 줄이라도 틀리면 넣지 않음 · dryRun 미리보기' })
  async importAps(@CurrentUser() user: { id: string }, @Body() dto: ImportWifiApCsvDto) {
    return { data: await this.registry.importAccessPoints(dto.csv, dto.dryRun ?? false, user.id) };
  }

  @Patch('access-points/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'AP 좌표·교정·활성 변경' })
  async updateAp(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateWifiApDto) {
    return { data: await this.registry.updateAccessPoint(id, dto) };
  }

  @Get('collectors')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: '수집기 목록(마지막 수신·마지막 배치 결과)' })
  async listCollectors() {
    return { data: await this.registry.listCollectors() };
  }

  @Post('collectors')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: '수집기 발급 — 키는 이 응답에서 한 번만' })
  async createCollector(@CurrentUser() user: { id: string }, @Body() dto: CreateWifiCollectorDto) {
    return { data: await this.registry.createCollector(dto, user.id) };
  }

  @Post('collectors/:id/rotate-key')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: '수집기 키 교체 — 새 키 원문 한 번 · 이전 키 즉시 무효' })
  async rotateKey(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.registry.rotateCollectorKey(id) };
  }

  @Patch('collectors/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: '수집기 활성/비활성' })
  async setCollectorActive(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetWifiCollectorActiveDto) {
    return { data: await this.registry.setCollectorActive(id, dto.isActive) };
  }

  @Get('bindings')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.NURSE, UserRole.RECEPTIONIST)
  @ApiBearerAuth()
  @ApiOperation({ summary: '단말 ↔ 환자 연결 목록(동의 근거·해제 이력)' })
  async listBindings(@Query('patientId') patientId?: string, @Query('activeOnly') activeOnly?: string, @Query('state') state?: string) {
    // 환자 상태 거르기(열린 연결만) — 어휘 밖 값은 400(조용히 전체를 주지 않는다)
    if (state && !['DECEASED', 'NOT_ADMITTED', 'ADMITTED'].includes(state)) throw new BadRequestException({ code: 'BINDING_STATE_INVALID', message: '상태는 DECEASED·NOT_ADMITTED·ADMITTED 중 하나입니다.' });
    const r = await this.registry.listBindings({ patientId: patientId || undefined, activeOnly: activeOnly === 'true', state: (state || undefined) as 'DECEASED' | 'NOT_ADMITTED' | 'ADMITTED' | undefined });
    return { data: r.items, meta: r.meta };
  }

  @Post('bindings')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.NURSE, UserRole.RECEPTIONIST)
  @ApiBearerAuth()
  @ApiOperation({ summary: '단말(태그) ↔ 환자 연결 — 동의 근거 필수' })
  async bind(@CurrentUser() user: { id: string }, @Body() dto: BindWifiDeviceDto) {
    return { data: await this.registry.bind(dto, user.id) };
  }

  @Post('bindings/unbind-bulk')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.NURSE, UserRole.RECEPTIONIST)
  @ApiBearerAuth()
  @ApiOperation({ summary: '연결 일괄 해제(사람이 고른 것만 · 사유 하나 · 상한 100 · 이미 해제는 건너뜀)' })
  async unbindBulk(@CurrentUser() user: { id: string }, @Body() dto: UnbindWifiBulkDto) {
    return { data: await this.registry.unbindMany(dto.ids, dto.reason, user.id) };
  }

  @Post('bindings/:id/unbind')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.NURSE, UserRole.RECEPTIONIST)
  @ApiBearerAuth()
  @ApiOperation({ summary: '연결 해제(사유 필수 · 지우지 않음)' })
  async unbind(@CurrentUser() user: { id: string }, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UnbindWifiDeviceDto) {
    return { data: await this.registry.unbind(id, dto.reason, user.id) };
  }

  @Get('survey')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: '현장 측정 표본 — 목록(상한 300·전체 수)·층별 유효 표본·신호 지도 측위 켜짐 여부' })
  async listSurvey(@Query('floorKey') floorKey?: string) {
    const r = await this.registry.listSurvey({ floorKey: floorKey || undefined });
    return { data: r.items, meta: r.meta };
  }

  @Post('survey')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: '현장 측정 표본 기록 — 위치를 아는 지점의 신호(측정 시각 필수)' })
  async createSurvey(@CurrentUser() user: { id: string }, @Body() dto: CreateWifiSurveyDto) {
    return { data: await this.registry.createSurvey(dto, user.id) };
  }

  @Post('survey/:id/void')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: '측정 표본 무효(사유 필수 · 지우지 않음)' })
  async voidSurvey(@CurrentUser() user: { id: string }, @Param('id', ParseUUIDPipe) id: string, @Body() dto: VoidWifiSurveyDto) {
    return { data: await this.registry.voidSurvey(id, dto.reason, user.id) };
  }

  @Get('calibration-suggestions')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'AP 교정 제안 — 측정 표본으로 맞춘 1m 세기·감쇠 지수(제안만 · 적용은 AP 교정값으로)' })
  async calibrationSuggestions() {
    return { data: await this.registry.calibrationSuggestions() };
  }

  @Get('status')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: '무선 위치 현황 — 수집 설정·AP·수집기·최근 측위·시뮬레이션 적중률' })
  async status() {
    return { data: await this.registry.status() };
  }
}
