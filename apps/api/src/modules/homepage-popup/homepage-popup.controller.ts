import { Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { HomepagePopupService } from './homepage-popup.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('Homepage Popup')
@Controller('api/v1')
export class HomepagePopupController {
  constructor(private readonly service: HomepagePopupService) {}

  // ── 공개 API (인증 불필요) ──

  @Get('public/popups/active')
  @ApiOperation({ summary: '활성 팝업 목록 (공개)' })
  async getActivePopups(@Query('page') page?: string) {
    return { data: await this.service.findActive(page) };
  }

  // ── 관리자 API ──

  @Get('homepage/popups')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '팝업 전체 목록 (관리자)' })
  async findAll() {
    return { data: await this.service.findAll() };
  }

  @Post('homepage/popups')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '팝업 생성' })
  async create(@CurrentUser() user: any, @Body() dto: any) {
    return { data: await this.service.create(dto, (user.id ?? user.sub)!) };
  }

  @Patch('homepage/popups/:id')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '팝업 수정' })
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: any) {
    return { data: await this.service.update(id, dto) };
  }

  @Patch('homepage/popups/:id/toggle')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '팝업 활성/비활성 토글' })
  async toggle(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.service.toggleActive(id) };
  }

  @Delete('homepage/popups/:id')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '팝업 삭제' })
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    await this.service.remove(id);
    return { data: { success: true } };
  }

  @Post('homepage/popups/:id/clone')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '팝업 복제' })
  async clone(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: { id?: string; sub?: string }) {
    return { data: await this.service.clone(id, (user.id ?? user.sub)!) };
  }

  @Get('homepage/popup-templates')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '팝업 템플릿 목록' })
  async getTemplates() {
    return { data: this.service.getTemplates() };
  }

  @Get('homepage/cliparts')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '클립아트 목록' })
  async getCliparts() {
    return { data: this.service.getCliparts() };
  }
}
