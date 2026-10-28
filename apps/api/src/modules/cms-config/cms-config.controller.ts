import { Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { CmsConfigService, CreateCategoryDto, UpdateCategoryDto, CreateMenuDto, UpdateMenuDto } from './cms-config.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';

@ApiTags('CMS Config')
@Controller('api/v1/cms')
export class CmsConfigController {
  constructor(private readonly service: CmsConfigService) {}

  // ── 카테고리 (관리자) ──

  @Get('categories')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '카테고리 트리 조회' })
  async getCategories() {
    return { data: await this.service.getCategories() };
  }

  @Post('categories')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '카테고리 생성' })
  async createCategory(@Body() dto: CreateCategoryDto) {
    return { data: await this.service.createCategory(dto) };
  }

  // ⚠️ 리터럴 라우트('reorder')는 ':id' 와일드카드보다 **위에** 선언한다.
  // 🔴 W9: 아래에 있어서 PATCH /cms/categories/reorder 가 ':id' 에 먹히고 ParseUUIDPipe 400 이 났다
  //    (hospital-info 컨트롤러가 'seo' 로 이미 겪은 것과 같은 선점 버그).
  @Patch('categories/reorder')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async reorderCategories(@Body() dto: { items: { id: string; sortOrder: number }[] }) {
    return { data: await this.service.reorderCategories(dto.items) };
  }

  @Patch('categories/:id')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '카테고리 수정' })
  async updateCategory(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCategoryDto) {
    return { data: await this.service.updateCategory(id, dto) };
  }

  @Delete('categories/:id')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async deleteCategory(@Param('id', ParseUUIDPipe) id: string) {
    await this.service.deleteCategory(id);
    return { data: { success: true } };
  }

  // ── 메뉴 (관리자) ──

  @Get('menus')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '메뉴 트리 조회 (관리자)' })
  async getMenus(@Query('group') group: string = 'GNB') {
    return { data: await this.service.getMenus(group) };
  }

  @Post('menus')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async createMenu(@Body() dto: CreateMenuDto) {
    return { data: await this.service.createMenu(dto) };
  }

  // ⚠️ 리터럴 라우트 우선(위 카테고리와 동일 — 한 곳만 고치면 갈라진다)
  @Patch('menus/reorder')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async reorderMenus(@Body() dto: { items: { id: string; sortOrder: number }[] }) {
    return { data: await this.service.reorderMenus(dto.items) };
  }

  @Patch('menus/:id')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async updateMenu(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateMenuDto) {
    return { data: await this.service.updateMenu(id, dto) };
  }

  @Delete('menus/:id')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async deleteMenu(@Param('id', ParseUUIDPipe) id: string) {
    await this.service.deleteMenu(id);
    return { data: { success: true } };
  }

  // ── 공개 메뉴 (홈페이지용) ──

  @Get('public/menus')
  @ApiOperation({ summary: '공개 메뉴 (홈페이지)' })
  async getPublicMenus(@Query('group') group: string = 'GNB') {
    return { data: await this.service.getPublicMenus(group) };
  }
}
