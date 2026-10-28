import { Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { DoctorCodeService } from './doctor-code.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import {
  AddDoctorCodeDto, UpdateDoctorCodeDto, AddCatalogItemDto, UpdateCatalogItemDto,
  CreatePrescriptionSetDto, UpdatePrescriptionSetDto, ImportDoctorCodeCatalogDto,
} from './dto/doctor-code.dto';

@ApiTags('Doctor Code & Department Catalog')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1')
export class DoctorCodeController {
  constructor(private readonly service: DoctorCodeService) {}

  // ── 의사 개인 코드 목록 ──

  @Get('my-codes')
  @Roles(UserRole.DOCTOR)
  @ApiOperation({ summary: '내 코드 목록' })
  async getMyCodes(@CurrentUser('id') userId: string, @Query('category') category?: string) {
    return { data: await this.service.getMyCodes(userId, category) };
  }

  @Get('my-codes/stats')
  @Roles(UserRole.DOCTOR)
  @ApiOperation({ summary: '내 처방 통계' })
  async getStats(@CurrentUser('id') userId: string) {
    return { data: await this.service.getStats(userId) };
  }

  @Get('my-codes/sets')
  @Roles(UserRole.DOCTOR)
  @ApiOperation({ summary: '내 처방 세트 목록' })
  async getMySets(@CurrentUser('id') userId: string) {
    return { data: await this.service.getMySets(userId) };
  }

  @Post('my-codes')
  @Roles(UserRole.DOCTOR)
  @ApiOperation({ summary: '내 코드 추가' })
  async addCode(@Body() dto: AddDoctorCodeDto, @CurrentUser('id') userId: string) {
    return this.service.addCode(userId, dto);
  }

  @Post('my-codes/sets')
  @Roles(UserRole.DOCTOR)
  @ApiOperation({ summary: '처방 세트 생성' })
  async createSet(@CurrentUser('id') userId: string, @Body() body: CreatePrescriptionSetDto) {
    return { data: await this.service.createSet(userId, body) };
  }

  @Post('my-codes/import-catalog')
  @Roles(UserRole.DOCTOR)
  @ApiOperation({ summary: '과 카탈로그에서 내 목록으로 가져오기' })
  async importFromCatalog(@CurrentUser('id') userId: string, @Body() body: ImportDoctorCodeCatalogDto) {
    return { data: await this.service.importFromCatalog(userId, body.department, body.codeIds) };
  }

  @Patch('my-codes/sets/:id')
  @Roles(UserRole.DOCTOR)
  @ApiOperation({ summary: '처방 세트 수정' })
  async updateSet(@CurrentUser('id') userId: string, @Param('id', ParseUUIDPipe) id: string, @Body() body: UpdatePrescriptionSetDto) {
    return { data: await this.service.updateSet(userId, id, body) };
  }

  @Delete('my-codes/sets/:id')
  @Roles(UserRole.DOCTOR)
  @ApiOperation({ summary: '처방 세트 삭제' })
  async deleteSet(@CurrentUser('id') userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.service.deleteSet(userId, id) };
  }

  @Post('my-codes/sets/:id/use')
  @Roles(UserRole.DOCTOR)
  @ApiOperation({ summary: '처방 세트 사용 횟수 증가' })
  async useSet(@CurrentUser('id') userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.service.useSet(userId, id) };
  }

  @Patch('my-codes/:id')
  @Roles(UserRole.DOCTOR)
  @ApiOperation({ summary: '내 코드 수정' })
  async updateCode(@CurrentUser('id') userId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateDoctorCodeDto) {
    return this.service.updateCode(userId, id, dto);
  }

  @Delete('my-codes/:id')
  @Roles(UserRole.DOCTOR)
  @ApiOperation({ summary: '내 코드 제거' })
  async removeCode(@CurrentUser('id') userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.service.removeCode(userId, id) };
  }

  @Post('my-codes/:id/use')
  @Roles(UserRole.DOCTOR)
  @ApiOperation({ summary: '코드 사용 횟수 증가' })
  async useCode(@CurrentUser('id') userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.service.useCode(userId, id) };
  }

  // ── 진료과 코드 카탈로그 ──

  @Get('dept-catalog')
  @ApiOperation({ summary: '진료과 코드 카탈로그' })
  async getCatalog(
    @Query('department') department: string,
    @Query('subcategory') subcategory?: string,
    @Query('codeType') codeType?: string,
  ) {
    return { data: await this.service.getCatalog(department, subcategory, codeType) };
  }

  @Post('dept-catalog')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '카탈로그 코드 추가' })
  async addCatalogItem(@Body() dto: AddCatalogItemDto, @CurrentUser('id') userId: string) {
    return this.service.addCatalogItem({ ...dto, createdBy: userId });
  }

  @Patch('dept-catalog/:id')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '카탈로그 코드 수정' })
  async updateCatalogItem(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCatalogItemDto) {
    return this.service.updateCatalogItem(id, dto);
  }

  @Delete('dept-catalog/:id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '카탈로그 코드 제거' })
  async removeCatalogItem(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.service.removeCatalogItem(id) };
  }

  // ── 통합 코드 검색 (우선순위 적용) ──

  @Get('code-search')
  @Roles(UserRole.DOCTOR)
  @ApiOperation({ summary: '처방 코드 검색 (내 목록 > 과 카탈로그 > 전체)' })
  async searchCodes(
    @CurrentUser('id') userId: string,
    @CurrentUser('department') department: string,
    @Query('q') query: string,
    @Query('type') type: 'MEDICATION' | 'LAB' | 'IMAGING' | 'DIET',
  ) {
    return { data: await this.service.searchCodes(userId, department ?? '내과', query, type) };
  }
}
