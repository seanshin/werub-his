import { Controller, Get, Post, Patch, Delete, Param, Body, Query, Request, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { NutritionService } from './nutrition.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CreateMealOrderDto, GenerateDailyOrdersDto, UpdateMealStatusDto } from './dto/nutrition.dto';
import {
  BulkStaffMenuDto,
  ConfirmStaffMealsDto,
  DeliverMealCheckDto,
  GenerateProductionDto,
  InspectProductionBatchDto,
  RecordHaccpDto,
  RequestStaffMealDto,
  UpdateProductionStatusDto,
  UpsertStaffMenuDto,
} from './dto/nutrition-production.dto';

/**
 * 🔴 **직원 식수는 전 직원의 복리후생이다** — 임상 직군만의 기능이 아니다.
 *    2026-08 지원부서 역할 재편(RECEPTIONIST·ADMIN_STAFF·MEDICAL_RECORDS·CHECKUP·EXECUTIVE 신설)
 *    때 **이 네 EP 가 따라오지 않아**, 그 5개 직군은 nav 에 뜨는 `/staff-meal` 을 열면
 *    식단표도 신청 내역도 전부 403 이었다(운영 실측: CHECKUP 계정으로 `staff-menu`·`staff-meal/my` 403).
 *    급양 마스터 편집(staff-menu 쓰기)·정산·확정은 여기 넣지 않는다 — 그쪽은 급양과 업무다.
 *    집합은 Sidebar 의 `ALL`(전 직원 공통)과 같다.
 */
const STAFF_MEAL_ROLES = [
  UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE, UserRole.PHARMACIST, UserRole.LAB_TECH,
  UserRole.NUTRITION, UserRole.RECEPTIONIST, UserRole.ADMIN_STAFF, UserRole.MEDICAL_RECORDS,
  UserRole.CHECKUP, UserRole.EXECUTIVE,
] as const;

@ApiTags('Nutrition (영양/급식)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.NUTRITION, UserRole.NURSE, UserRole.ADMIN) // 급양 도메인 — NUTRITION(급양 전담)·NURSE(병동 배식 연계)·ADMIN
@Controller('api/v1/nutrition')
export class NutritionController {
  constructor(private readonly nutritionService: NutritionService) {}

  @Get('meals')
  @ApiOperation({ summary: '일별 식단 목록 (환자)' })
  async getMeals(@Query('date') date?: string, @Query('status') status?: string) { return { data: await this.nutritionService.getMealOrders(date, status) }; }

  @Post('meals')
  @ApiOperation({ summary: '급식 주문 생성' })
  async create(@Body() dto: CreateMealOrderDto) { return { data: await this.nutritionService.createMealOrder(dto) }; }

  @Get('meals/census')
  @ApiOperation({ summary: '병동별 식수 집계(병동×식이유형·배식상태·섭취율)' })
  async census(@Query('date') date?: string, @Query('mealType') mealType?: string) {
    return { data: await this.nutritionService.getMealCensus(date, mealType) };
  }

  @Post('production/generate')
  @ApiOperation({ summary: '생산량 산출(식수→끼니×식이유형 조리 배치)' })
  async generateProduction(@Body() body: GenerateProductionDto) {
    return { data: await this.nutritionService.generateProduction(body.date) };
  }
  @Get('production')
  @ApiOperation({ summary: '조리지시서(생산 배치 목록)' })
  async getProduction(@Query('date') date?: string) {
    return { data: await this.nutritionService.getProduction(date) };
  }
  @Patch('production/:id/status')
  @ApiOperation({ summary: '조리 상태/실생산량 변경(PLANNED→COOKING→DONE)' })
  async updateProduction(@Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateProductionStatusDto, @Request() req?: { user: { id: string } }) {
    return { data: await this.nutritionService.updateProductionStatus(id, body, req!.user.id) };
  }

  @Post('meals/generate')
  @ApiOperation({ summary: '당일 급식 일괄 생성 (전 입원환자)' })
  async generate(@Body() body: GenerateDailyOrdersDto) { return { data: await this.nutritionService.generateDailyOrders(body.date) }; }

  @Patch('meals/:id/status')
  @ApiOperation({ summary: '급식 상태 변경 (조리/배식)' })
  async updateStatus(@Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateMealStatusDto) { return { data: await this.nutritionService.updateStatus(id, body.status, body.undeliveredReason) }; }

  @Post('production/:id/inspect')
  @ApiOperation({ summary: '검식(관능·검수) 기록' })
  async inspectBatch(@Param('id', ParseUUIDPipe) id: string, @Body() body: InspectProductionBatchDto, @Request() req?: { user: { id: string } }) {
    return { data: await this.nutritionService.createInspection({ ...body, productionBatchId: id }, req!.user.id) };
  }

  @Post('production/:id/haccp')
  @ApiOperation({ summary: 'HACCP CCP 기록(가열≥75℃·냉장≤5℃·온장≥57℃·시간≤120분·이탈 자동판정)' })
  async recordHaccp(@Param('id', ParseUUIDPipe) id: string, @Body() body: RecordHaccpDto, @Request() req?: { user: { id: string } }) {
    return { data: await this.nutritionService.recordHaccp({ ...body, productionBatchId: id }, req!.user.id) };
  }

  @Get('haccp')
  @ApiOperation({ summary: 'HACCP 일별 기록 조회' })
  async getHaccp(@Query('date') date?: string) { return { data: await this.nutritionService.getHaccp(date) }; }

  @Post('meals/:id/deliver')
  @ApiOperation({ summary: '배식 확인(5-Rights) 기록 + 배식완료' })
  async deliverMeal(@Param('id', ParseUUIDPipe) id: string, @Body() body: DeliverMealCheckDto, @Request() req?: { user: { id: string } }) {
    return { data: await this.nutritionService.recordDeliveryCheck(id, body, req!.user.id) };
  }

  // ══════════════════════════════════════════════
  // 직원 식단표 (Staff Meal Menu)
  // ══════════════════════════════════════════════

  @Get('staff-menu')
  @Roles(...STAFF_MEAL_ROLES)
  @ApiOperation({ summary: '직원 식단표 조회 (일별/주간/월간)' })
  @ApiQuery({ name: 'date', required: false, description: '일별 (YYYY-MM-DD)' })
  @ApiQuery({ name: 'week', required: false, description: '주간 시작일 (YYYY-MM-DD)' })
  @ApiQuery({ name: 'year', required: false })
  @ApiQuery({ name: 'month', required: false })
  async getStaffMenu(
    @Query('date') date?: string,
    @Query('week') week?: string,
    @Query('year') year?: string,
    @Query('month') month?: string,
  ) {
    if (week) return { data: await this.nutritionService.getStaffMenuWeek(week) };
    if (year && month) return { data: await this.nutritionService.getStaffMenuMonth(parseInt(year), parseInt(month)) };
    return { data: await this.nutritionService.getStaffMenuByDate(date ?? new Date().toISOString().slice(0, 10)) };
  }

  @Post('staff-menu')
  @Roles(UserRole.ADMIN, UserRole.NUTRITION)
  @ApiOperation({ summary: '직원 식단 등록/수정 (급양과)' })
  async upsertStaffMenu(
    @Body() body: UpsertStaffMenuDto,
    @Request() req: { user: { id?: string; sub?: string } },
  ) {
    return { data: await this.nutritionService.upsertStaffMenu(body, (req.user.id ?? req.user.sub)!) };
  }

  @Post('staff-menu/bulk')
  @Roles(UserRole.ADMIN, UserRole.NUTRITION)
  @ApiOperation({ summary: '주간 식단 일괄 등록 (급양과)' })
  async bulkCreateStaffMenu(
    @Body() body: BulkStaffMenuDto,
    @Request() req: { user: { id?: string; sub?: string } },
  ) {
    return { data: await this.nutritionService.bulkCreateStaffMenu(body.menus, (req.user.id ?? req.user.sub)!) };
  }

  @Delete('staff-menu/:id')
  @Roles(UserRole.ADMIN, UserRole.NUTRITION)
  @ApiOperation({ summary: '식단 삭제' })
  async deleteStaffMenu(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.nutritionService.deleteStaffMenu(id) };
  }

  // ══════════════════════════════════════════════
  // 직원 식수 신청
  // ══════════════════════════════════════════════

  @Post('staff-meal/request')
  @Roles(...STAFF_MEAL_ROLES)
  @ApiOperation({ summary: '식수 신청 (직원)' })
  async requestStaffMeal(
    @Body() body: RequestStaffMealDto,
    @Request() req: { user: { id?: string; sub?: string } },
  ) {
    return { data: await this.nutritionService.requestStaffMeal((req.user.id ?? req.user.sub)!, body) };
  }

  @Patch('staff-meal/:id/cancel')
  @Roles(...STAFF_MEAL_ROLES)
  @ApiOperation({ summary: '식수 취소' })
  async cancelStaffMeal(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: { user: { id?: string; sub?: string } },
  ) {
    return { data: await this.nutritionService.cancelStaffMeal((req.user.id ?? req.user.sub)!, id) };
  }

  @Get('staff-meal/my')
  @Roles(...STAFF_MEAL_ROLES)
  @ApiOperation({ summary: '내 식수 신청 내역 (주간)' })
  @ApiQuery({ name: 'week', required: false, description: '주간 시작일' })
  async getMyMealRequests(
    @Query('week') week?: string,
    @Request() req?: { user: { id?: string; sub?: string } },
  ) {
    const start = week ?? new Date().toISOString().slice(0, 10);
    return { data: await this.nutritionService.getMyMealRequests((req!.user.id ?? req!.user.sub)!, start) };
  }

  @Get('staff-meal/stats')
  @Roles(UserRole.ADMIN, UserRole.NUTRITION)
  @ApiOperation({ summary: '식수 현황 (급양과 — 일별)' })
  @ApiQuery({ name: 'date', required: false })
  async getStaffMealStats(@Query('date') date?: string) {
    return { data: await this.nutritionService.getStaffMealStats(date ?? new Date().toISOString().slice(0, 10)) };
  }

  @Post('staff-meal/confirm')
  @Roles(UserRole.ADMIN, UserRole.NUTRITION)
  @ApiOperation({ summary: '식수 마감 확정 (REQUESTED→CONFIRMED·발주량 확정)' })
  async confirmStaffMeals(@Body() body: ConfirmStaffMealsDto) {
    return { data: await this.nutritionService.confirmStaffMeals(body.date) };
  }

  @Get('staff-meal/settlement')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '월별 식대 정산 (직원별 식수×가격·급여공제 연계)' })
  @ApiQuery({ name: 'month', required: true })
  async staffMealSettlement(@Query('month') month: string, @Query('userId') userId?: string) {
    return { data: await this.nutritionService.getStaffMealSettlement(month ?? new Date().toISOString().slice(0, 7), userId) };
  }

  @Get('staff-meal/stats/weekly')
  @Roles(UserRole.ADMIN, UserRole.NUTRITION)
  @ApiOperation({ summary: '주간 식수 통계 (급양과)' })
  @ApiQuery({ name: 'week', required: false })
  async getStaffMealWeeklyStats(@Query('week') week?: string) {
    const start = week ?? new Date().toISOString().slice(0, 10);
    return { data: await this.nutritionService.getStaffMealWeeklyStats(start) };
  }
}
