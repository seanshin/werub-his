import { Controller, Get, Post, Put, Delete, Param, Body, Query, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { ChartTemplateService } from './chart-template.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import {
  CreateChartTemplateDto, UpdateChartTemplateDto,
  CreateFromPresetDto, SetDefaultTemplateDto, ToggleFavoriteDto, PersonalizeTemplateDto, SetBoardLayoutDto,
} from './dto/chart-template.dto';

@ApiTags('Chart Templates (차트 에디터)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/chart-templates')
export class ChartTemplateController {
  constructor(private readonly svc: ChartTemplateService) {}

  @Get()
  @ApiOperation({ summary: '차트 템플릿 목록 (공용)' })
  async findAll(@Query('department') department?: string, @Query('role') role?: string, @Query('category') category?: string) {
    return { data: await this.svc.findAll({ department, role, category }) };
  }

  @Post()
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '차트 템플릿 생성' })
  async create(@Body() dto: CreateChartTemplateDto, @CurrentUser('id') userId: string) {
    return { data: await this.svc.create(dto, userId) };
  }

  @Get('presets')
  @ApiOperation({ summary: '프리셋 목록' })
  async getPresets() {
    return { data: this.svc.getPresets() };
  }

  @Get('recommend')
  @ApiOperation({ summary: 'AI 추천: 진단코드 기반 템플릿 추천' })
  async recommend(@Query('codes') codes: string) {
    const diagnosisCodes = codes ? codes.split(',').map((c) => c.trim()).filter(Boolean) : [];
    return { data: await this.svc.recommendByDiagnosis(diagnosisCodes) };
  }

  @Post('from-preset')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '프리셋에서 템플릿 생성' })
  async createFromPreset(@Body() dto: CreateFromPresetDto, @CurrentUser('id') userId: string) {
    return { data: await this.svc.createFromPreset(dto.presetKey, userId, dto) };
  }

  @Get('for-me')
  @ApiOperation({ summary: '내 역할/과에 맞는 템플릿 + 개인 설정' })
  async getForMe(@CurrentUser() user: any) {
    return { data: await this.svc.getForMe(user.id, user.role, user.department) };
  }

  @Get('my-settings')
  @ApiOperation({ summary: '내 차트 설정 (기본템플릿, 즐겨찾기, 최근)' })
  async getMySettings(@CurrentUser('id') userId: string) {
    return { data: await this.svc.getMySettings(userId) };
  }

  @Post('my-settings/default')
  @ApiOperation({ summary: '기본 템플릿 설정' })
  async setDefaultTemplate(@Body() dto: SetDefaultTemplateDto, @CurrentUser('id') userId: string) {
    return { data: await this.svc.setDefaultTemplate(userId, dto.templateId) };
  }

  @Post('my-settings/favorite')
  @ApiOperation({ summary: '즐겨찾기 토글' })
  async toggleFavorite(@Body() dto: ToggleFavoriteDto, @CurrentUser('id') userId: string) {
    return { data: await this.svc.toggleFavorite(userId, dto.templateId) };
  }

  @Get('my-settings/board-layout')
  @ApiOperation({ summary: '큰 화면 보기 개인 레이아웃 조회 (로밍 동기화)' })
  async getBoardLayout(@CurrentUser('id') userId: string) {
    return { data: await this.svc.getBoardLayout(userId) };
  }

  @Put('my-settings/board-layout')
  @ApiOperation({ summary: '큰 화면 보기 개인 레이아웃 저장' })
  async setBoardLayout(@Body() dto: SetBoardLayoutDto, @CurrentUser('id') userId: string) {
    // pinned 생략(undefined)=기존 핀 보존 — 레이아웃 편집기 등 panels만 보내는 기존 호출 호환
    return { data: await this.svc.setBoardLayout(userId, dto.panels ?? null, dto.pinned) };
  }

  @Get('my-personal')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '내 개인 템플릿 목록' })
  async findMyPersonal(@CurrentUser('id') userId: string) {
    return { data: await this.svc.findMyPersonal(userId) };
  }

  @Get(':id')
  @ApiOperation({ summary: '차트 템플릿 상세' })
  async findById(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('id') userId: string) {
    // 남의 개인 템플릿은 '없는 것'과 똑같이 404 (rollback IDOR 봉합과 한 벌)
    return { data: await this.svc.findById(id, userId) };
  }

  @Get(':id/versions')
  @ApiOperation({ summary: '버전 히스토리 (최신 20개)' })
  async getVersionHistory(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('id') userId: string) {
    return { data: await this.svc.getVersionHistory(id, userId) };
  }

  @Get(':id/versions/:versionId')
  @ApiOperation({ summary: '특정 버전 상세' })
  async getVersion(@Param('id', ParseUUIDPipe) id: string, @Param('versionId', ParseUUIDPipe) versionId: string, @CurrentUser('id') userId: string) {
    return { data: await this.svc.getVersion(id, versionId, userId) };
  }

  @Post(':id/rollback/:versionId')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '이전 버전으로 롤백' })
  async rollback(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('versionId', ParseUUIDPipe) versionId: string,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.svc.rollbackToVersion(id, versionId, userId) };
  }

  @Put(':id')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '차트 템플릿 수정' })
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateChartTemplateDto, @CurrentUser('id') userId: string) {
    return { data: await this.svc.update(id, dto, userId) };
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '차트 템플릿 삭제' })
  async delete(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.svc.delete(id) };
  }

  @Post(':id/clone')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '차트 템플릿 복제' })
  async clone(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('id') userId: string) {
    return { data: await this.svc.clone(id, userId) };
  }

  @Post(':id/personalize')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '공용 템플릿 → 개인 복제 (커스터마이징)' })
  async personalize(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PersonalizeTemplateDto,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.svc.createPersonal(id, userId, dto) };
  }

  @Post(':id/use')
  @ApiOperation({ summary: '사용 기록 (카운트 증가 + 최근 사용)' })
  async recordUsage(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('id') userId: string) {
    return { data: await this.svc.recordUsage(id, userId) };
  }
}
