import { Controller, Get, Post, Put, Patch, Delete, Param, Body, Query, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { ConsentTemplateService } from './consent-template.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CreateConsentTemplateDto, UpdateConsentTemplateDto, ImportConsentTemplateDto } from './dto/consent-template.dto';

@ApiTags('Consent Templates')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/consent-templates')
export class ConsentTemplateController {
  constructor(private readonly service: ConsentTemplateService) {}

  @Post()
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '동의서 템플릿 생성' })
  async create(@Body() dto: CreateConsentTemplateDto, @CurrentUser('id') userId: string) {
    return { data: await this.service.create({ ...dto, lastEditedBy: userId }) };
  }

  @Get()
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '동의서 템플릿 목록 (검색, 사용건수 포함)' })
  async findAll(
    @Query('type') type?: string,
    @Query('search') search?: string,
    @Query('includeInactive') includeInactive?: string,
    @Query('language') language?: string,
  ) {
    return { data: await this.service.findAll(type, search, includeInactive === 'true', language) };
  }

  @Get(':id')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '동의서 템플릿 상세' })
  async findById(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.service.findById(id) };
  }

  @Put(':id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '동의서 템플릿 수정 (새 버전 자동 생성)' })
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateConsentTemplateDto, @CurrentUser('id') userId: string) {
    return { data: await this.service.update(id, { ...dto, lastEditedBy: userId }) };
  }

  @Post(':id/clone')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '동의서 템플릿 복제 — body.language=언어판·body.aiDraft=true면 AI 번역 초안(비활성 생성·백그라운드 번역·검토 후 활성화)' })
  async clone(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body?: { language?: string; aiDraft?: boolean },
    @CurrentUser('id') userId?: string,
  ) {
    if (body?.aiDraft && body?.language) {
      return { data: await this.service.cloneWithTranslation(id, body.language, userId) };
    }
    return { data: await this.service.clone(id, body?.language) };
  }

  @Post('bulk-translate')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '언어판 일괄 AI 초안 생성 — 대상 언어판 없는 활성 한국어 템플릿 전체(백그라운드·비활성 생성)' })
  async bulkTranslate(@Body() body: { language: string }, @CurrentUser('id') userId: string) {
    return { data: await this.service.bulkCloneLanguage(body?.language, userId) };
  }

  @Get(':id/versions')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '버전 이력 조회' })
  async getVersions(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.service.getVersionHistory(id) };
  }

  @Post(':id/restore')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '이전 버전 복원' })
  async restore(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.service.restoreVersion(id) };
  }

  @Patch(':id/toggle')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '활성/비활성 토글' })
  async toggle(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.service.toggleActive(id) };
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '동의서 템플릿 삭제 (비활성화)' })
  async delete(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.service.softDelete(id) };
  }

  @Get(':id/export')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '템플릿 JSON 내보내기' })
  async exportTemplate(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.service.exportTemplate(id) };
  }

  @Post('import')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '템플릿 JSON 가져오기' })
  async importTemplate(@Body() dto: ImportConsentTemplateDto) {
    return { data: await this.service.importTemplate(dto as unknown as Record<string, unknown>) };
  }
}
