import { Controller, Get, Post, Put, Patch, Delete, Param, Body, Query, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { OrderSetService } from './order-set.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CreateOrderSetDto, UpdateOrderSetDto, ChangeStatusDto, RecordUsageDto, CreateFavoriteOrderDto, ApprovalRecordDto } from './dto/order-set.dto';

@ApiTags('Order Sets (약속처방)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1')
export class OrderSetController {
  constructor(private readonly service: OrderSetService) {}

  // ── OrderSet CRUD ──

  // 1. 목록 (카테고리/진료과/상태 필터)
  @Get('order-sets')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  @ApiOperation({ summary: '약속처방 목록' })
  async findAll(
    @Query('category') category?: string,
    @Query('department') department?: string,
    @Query('diagnosisCode') diagnosisCode?: string,
    @Query('status') status?: string,
  ) {
    return { data: await this.service.findAll({ category, department, diagnosisCode, status }) };
  }

  // 8. 약물명/진단코드로 검색 (must be before :id route)
  @Get('order-sets/search')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  @ApiOperation({ summary: '약속처방 검색 (약물명/진단코드)' })
  async search(@Query('q') query: string) {
    return { data: await this.service.searchOrderSets(query ?? '') };
  }

  // 10. 사용 통계
  @Get('order-sets/stats')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'CP 사용 통계' })
  async getStats() {
    return { data: await this.service.getUsageStats() };
  }

  // CP 추천 v2 — 주상병 가중·prefix·useCount 부스팅 (primaryCode/age 미전달 시 하위호환)
  @Get('order-sets/recommend')
  @Roles(UserRole.DOCTOR)
  @ApiOperation({ summary: '진단코드 기반 CP 추천 (주상병 가중·prefix 매칭·matchScore 정렬)' })
  async recommend(
    @Query('diagnosisCodes') codes: string,
    @Query('primaryCode') primaryCode?: string,
    @Query('age') age?: string,
    @Query('patientId') patientId?: string,
  ) {
    const diagnosisCodes = codes ? codes.split(',').filter(Boolean) : [];
    return { data: await this.service.recommend(diagnosisCodes, primaryCode || undefined, age ? Number(age) : undefined, patientId || undefined) };
  }

  // 2. 상세
  @Get('order-sets/:id')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  @ApiOperation({ summary: '약속처방 상세' })
  async findById(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.service.findById(id) };
  }

  // 11. 버전 이력
  @Get('order-sets/:id/history')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  @ApiOperation({ summary: 'CP 버전 이력' })
  async getHistory(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.service.getHistory(id) };
  }

  // 3. CP 생성
  @Post('order-sets')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR)
  @ApiOperation({ summary: '약속처방 생성' })
  async create(@Body() dto: CreateOrderSetDto, @CurrentUser('id') userId: string) {
    return { data: await this.service.create(dto, userId) };
  }

  // 4. CP 수정
  @Put('order-sets/:id')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR)
  @ApiOperation({ summary: '약속처방 수정' })
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateOrderSetDto, @CurrentUser('id') userId: string) {
    // 사용 중 세트면 새 판 초안이 생긴다(응답 editMode·newVersionOf) — 2026-10-21 P2
    return { data: await this.service.update(id, dto as Record<string, unknown>, userId) };
  }

  /** 승인 기록 남기기 — 승인 절차 없이 사용 중이 된 세트(2026-10-21 P2 · 근거는 감사 기록에) */
  @Post('order-sets/:id/approval-record')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '사용 중 세트 승인 기록(승인자 = 기록하는 관리자 · 근거 필수)' })
  async recordApproval(@Param('id', ParseUUIDPipe) id: string, @Body() _dto: ApprovalRecordDto, @CurrentUser('id') userId: string) {
    return { data: await this.service.recordApproval(id, userId) };
  }

  // 5. CP 복제
  @Post('order-sets/:id/clone')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR)
  @ApiOperation({ summary: 'CP 복제 (새 버전)' })
  async clone(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('id') userId: string) {
    return { data: await this.service.cloneOrderSet(id, userId) };
  }

  // 13. 진단 매핑 (다대다 — 추천 엔진 v2 소스)
  @Get('order-sets/:id/diagnoses')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  @ApiOperation({ summary: 'CP 진단 매핑 조회' })
  async getDiagnoses(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.service.getDiagnoses(id) };
  }

  @Put('order-sets/:id/diagnoses')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR)
  @ApiOperation({ summary: 'CP 진단 매핑 일괄 교체 (EXACT/PREFIX·PRIMARY_ONLY·weight)' })
  async replaceDiagnoses(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('diagnoses') diagnoses: { diagnosisCode: string; matchType?: string; role?: string; weight?: number }[],
  ) {
    return { data: await this.service.replaceDiagnoses(id, Array.isArray(diagnoses) ? diagnoses : []) };
  }

  // 12. 미해석 항목 코드 후보 매칭 (확정은 사람이 — PUT items로 반영)
  @Post('order-sets/:id/resolve-items')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR)
  @ApiOperation({ summary: '미해석 항목 자동 후보 매칭 (이름→코드 후보)' })
  async resolveItems(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.service.resolveItems(id) };
  }

  // 6. 상태 변경 (승인 등)
  @Patch('order-sets/:id/status')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'CP 상태 변경' })
  async changeStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChangeStatusDto,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.service.changeStatus(id, dto.status, userId) };
  }

  // 7. CP 폐기
  @Patch('order-sets/:id/deprecate')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'CP 폐기' })
  async deprecate(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.service.deprecateOrderSet(id) };
  }

  // 9. 사용 기록
  @Post('order-sets/:id/use')
  @Roles(UserRole.DOCTOR)
  @ApiOperation({ summary: 'CP 사용 기록' })
  async recordUsage(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RecordUsageDto,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.service.recordUsage(id, dto, userId) };
  }

  // Delete (soft)
  @Delete('order-sets/:id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '약속처방 삭제' })
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    await this.service.remove(id);
    return { data: { deleted: true } };
  }

  // ── Favorite Orders ──

  @Post('favorite-orders')
  @Roles(UserRole.DOCTOR)
  @ApiOperation({ summary: '즐겨찾기 저장' })
  async createFavorite(@Body() dto: CreateFavoriteOrderDto, @CurrentUser('id') userId: string) {
    return { data: await this.service.createFavorite(dto, userId) };
  }

  @Get('favorite-orders')
  @Roles(UserRole.DOCTOR)
  @ApiOperation({ summary: '내 즐겨찾기 목록' })
  async getFavorites(@CurrentUser('id') userId: string) {
    return { data: await this.service.getFavorites(userId) };
  }

  @Post('favorite-orders/:id/use')
  @Roles(UserRole.DOCTOR)
  @ApiOperation({ summary: '즐겨찾기 사용 (useCount 증가)' })
  async useFavorite(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.service.useFavorite(id) };
  }

  @Delete('favorite-orders/:id')
  @Roles(UserRole.DOCTOR)
  @ApiOperation({ summary: '즐겨찾기 삭제' })
  async removeFavorite(@Param('id', ParseUUIDPipe) id: string) {
    await this.service.removeFavorite(id);
    return { data: { deleted: true } };
  }
}
