import { Controller, Get, Post, Put, Patch, Param, Body, Query, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { EquipmentService } from './equipment.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import {
  CreateEquipmentDto, UpdateEquipmentDto,
  CreateMaintenanceLogDto, UpdateMaintenanceLogDto,
  CreatePartDto, UpdatePartDto,
  CreateUsageLogDto, CreateInspectionLogDto,
  UpdateEquipmentStatusDto,
} from './dto/equipment.dto';

@ApiTags('Equipment (의료장비)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.ADMIN_STAFF)
@Controller('api/v1/equipment')
export class EquipmentController {
  constructor(private readonly equipmentService: EquipmentService) {}

  @Get()
  // 🔴 경영진 관제(/admin/analytics)가 '장비 현황' 카드를 이 EP 로 그린다 — EXECUTIVE 는 상시 오류였다.
  //    목록 조회만 연다(등록·수정·폐기는 자재·시설 업무 그대로).
  @Roles(UserRole.ADMIN, UserRole.READ, UserRole.ADMIN_STAFF, UserRole.EXECUTIVE)
  @ApiOperation({ summary: '장비 목록' })
  async findAll(@Query('category') category?: string, @Query('status') status?: string) {
    return { data: await this.equipmentService.findAll({ category, status }) };
  }

  @Post()
  @ApiOperation({ summary: '장비 등록' })
  async create(@Body() dto: CreateEquipmentDto) {
    return { data: await this.equipmentService.create(dto) };
  }

  @Get('stats')
  @Roles(UserRole.ADMIN, UserRole.READ, UserRole.ADMIN_STAFF)
  @ApiOperation({ summary: '장비 현황 통계' })
  async getStats() {
    return { data: await this.equipmentService.getStats() };
  }

  @Get('depreciation-summary')
  @Roles(UserRole.ADMIN, UserRole.READ, UserRole.ADMIN_STAFF)
  @ApiOperation({ summary: '자산 감가상각 요약(전체 장부가·카테고리별)' })
  async getDepreciationSummary() {
    return { data: await this.equipmentService.getDepreciationSummary() };
  }

  @Get(':id/depreciation')
  @Roles(UserRole.ADMIN, UserRole.READ, UserRole.ADMIN_STAFF)
  @ApiOperation({ summary: '장비 감가상각 스케줄(정액법)' })
  async getDepreciation(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.equipmentService.getDepreciationSchedule(id) };
  }

  @Get('inspections-due')
  @Roles(UserRole.ADMIN, UserRole.READ, UserRole.ADMIN_STAFF)
  @ApiOperation({ summary: '점검 예정 장비' })
  async getDue() {
    return { data: await this.equipmentService.getDueInspections() };
  }

  @Get('maintenance-logs')
  @Roles(UserRole.ADMIN, UserRole.READ, UserRole.ADMIN_STAFF)
  @ApiOperation({ summary: '전체 정비/A/S 이력 (최근)' })
  async getAllLogs(@Query('type') type?: string, @Query('status') status?: string) {
    return { data: await this.equipmentService.getAllMaintenanceLogs({ type, status }) };
  }

  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.READ, UserRole.ADMIN_STAFF)
  @ApiOperation({ summary: '장비 상세 (정비이력 포함)' })
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.equipmentService.findById(id) };
  }

  @Put(':id')
  @ApiOperation({ summary: '장비 정보 수정' })
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateEquipmentDto) {
    return { data: await this.equipmentService.update(id, dto) };
  }

  @Post(':id/maintenance')
  @ApiOperation({ summary: '정비/점검/A/S 기록 추가' })
  async addLog(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateMaintenanceLogDto) {
    return { data: await this.equipmentService.addMaintenanceLog(id, dto) };
  }

  @Patch(':id/status')
  @ApiOperation({ summary: '장비 상태 변경' })
  async updateStatus(@Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateEquipmentStatusDto) {
    return { data: await this.equipmentService.updateStatus(id, body.status, body.nextInspection) };
  }

  @Patch('maintenance/:logId')
  @ApiOperation({ summary: '정비 기록 상태 업데이트' })
  async updateLog(@Param('logId', ParseUUIDPipe) logId: string, @Body() dto: UpdateMaintenanceLogDto) {
    return { data: await this.equipmentService.updateMaintenanceLog(logId, dto) };
  }

  // ── 부품 재고 ──

  @Get(':id/parts')
  @Roles(UserRole.ADMIN, UserRole.READ, UserRole.ADMIN_STAFF)
  @ApiOperation({ summary: '장비 부품 재고 목록' })
  async getParts(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.equipmentService.getPartsForEquipment(id) };
  }

  @Post(':id/parts')
  @ApiOperation({ summary: '부품 등록' })
  async addPart(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CreatePartDto) {
    return { data: await this.equipmentService.addPart(id, dto) };
  }

  @Patch('parts/:partId')
  @ApiOperation({ summary: '부품 재고 수정' })
  async updatePart(@Param('partId', ParseUUIDPipe) partId: string, @Body() dto: UpdatePartDto) {
    return { data: await this.equipmentService.updatePart(partId, dto) };
  }

  @Get('parts/low-stock')
  @ApiOperation({ summary: '부족 부품 목록' })
  async getLowStock() {
    return { data: await this.equipmentService.getLowStockParts() };
  }

  // ── 사용일지 ──

  @Get('usage-logs/all')
  @ApiOperation({ summary: '전체 사용일지' })
  async getAllUsageLogs(@Query('equipmentId') equipmentId?: string, @Query('startDate') startDate?: string, @Query('endDate') endDate?: string) {
    return { data: await this.equipmentService.getAllUsageLogs({ equipmentId, startDate, endDate }) };
  }

  @Get(':id/usage-logs')
  @ApiOperation({ summary: '장비별 사용일지' })
  async getUsageLogs(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.equipmentService.getUsageLogs(id) };
  }

  @Post(':id/usage-logs')
  @ApiOperation({ summary: '사용일지 작성' })
  async addUsageLog(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateUsageLogDto) {
    return { data: await this.equipmentService.addUsageLog(id, dto) };
  }

  // ── 점검일지 ──

  @Get('inspection-logs/all')
  @ApiOperation({ summary: '전체 점검일지' })
  async getAllInspectionLogs(@Query('type') type?: string, @Query('result') result?: string) {
    return { data: await this.equipmentService.getAllInspectionLogs({ type, result }) };
  }

  @Get(':id/inspection-logs')
  @ApiOperation({ summary: '장비별 점검일지' })
  async getInspectionLogs(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.equipmentService.getInspectionLogs(id) };
  }

  @Post(':id/inspection-logs')
  @ApiOperation({ summary: '점검일지 작성' })
  async addInspectionLog(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateInspectionLogDto) {
    return { data: await this.equipmentService.addInspectionLog(id, dto) };
  }
}
