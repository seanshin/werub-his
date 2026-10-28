import { Controller, Get, Post, Patch, Param, Body, Query, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { NutritionAdvancedService } from './nutrition-advanced.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import {
  CreateNutritionAssessmentDto, CreateDietOrderDto,
  UpdateDietOrderDto, CreateNutritionCounselDto,
  CreateSpecialNutritionDto, UpdateSpecialNutritionDto, RecordMealIntakeDto,
} from './dto/nutrition-advanced.dto';

@ApiTags('Nutrition Advanced (영양 고급)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.NUTRITION, UserRole.NURSE, UserRole.DOCTOR, UserRole.ADMIN) // 영양평가·식이오더·상담 — NUTRITION(영양사)·병동/의사 연계
@Controller('api/v1/nutrition')
export class NutritionAdvancedController {
  constructor(private readonly service: NutritionAdvancedService) {}

  // ── Assessment ──

  @Post('assessments')
  @ApiOperation({ summary: '영양 평가 생성 (BMI/위험도 자동계산)' })
  async createAssessment(
    @Body() dto: CreateNutritionAssessmentDto,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.service.createAssessment(dto, userId) };
  }

  @Get('assessments')
  @ApiOperation({ summary: '환자 영양 평가 이력' })
  async getAssessments(@Query('patientId') patientId: string) {
    return { data: await this.service.getAssessments(patientId) };
  }

  // ── Diet Order ──

  @Post('diet-orders')
  @ApiOperation({ summary: '식이처방 생성' })
  async createDietOrder(
    @Body() dto: CreateDietOrderDto,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.service.createDietOrder(dto, userId) };
  }

  @Get('diet-orders')
  @ApiOperation({ summary: '활성 식이처방 목록' })
  async getDietOrders(@Query('admissionId') admissionId?: string) {
    return { data: await this.service.getDietOrders(admissionId) };
  }

  @Patch('diet-orders/:id')
  @ApiOperation({ summary: '식이처방 수정/종료' })
  async updateDietOrder(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDietOrderDto,
  ) {
    return { data: await this.service.updateDietOrder(id, dto) };
  }

  // ── 특수영양(경장 EN·정맥 TPN) ──
  @Post('special-nutrition')
  @ApiOperation({ summary: '특수영양 처방(경장 EN·정맥 TPN)' })
  async createSpecialNutrition(@CurrentUser('id') userId: string, @Body() dto: CreateSpecialNutritionDto) {
    return { data: await this.service.createSpecialNutrition(dto, userId) };
  }
  @Get('special-nutrition')
  @ApiOperation({ summary: '특수영양 처방 목록(입원별)' })
  async getSpecialNutrition(@Query('admissionId') admissionId: string) {
    return { data: await this.service.getSpecialNutrition(admissionId) };
  }
  @Patch('special-nutrition/:id')
  @ApiOperation({ summary: '특수영양 처방 수정/종료' })
  async updateSpecialNutrition(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateSpecialNutritionDto) {
    return { data: await this.service.updateSpecialNutrition(id, dto) };
  }

  // ── Counsel ──

  @Post('counsels')
  @ApiOperation({ summary: '영양 상담 기록' })
  async createCounsel(
    @Body() dto: CreateNutritionCounselDto,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.service.createCounsel(dto, userId) };
  }

  @Get('counsels')
  @ApiOperation({ summary: '환자 영양 상담 이력' })
  async getCounsels(@Query('patientId') patientId: string) {
    return { data: await this.service.getCounsels(patientId) };
  }

  // ── Meal Intake ──

  @Post('meal-intake')
  @ApiOperation({ summary: '식사 섭취 기록 (섭취율/칼로리 자동계산)' })
  async recordMealIntake(
    @Body() dto: RecordMealIntakeDto,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.service.recordMealIntake(dto, userId) };
  }

  @Get('daily-summary/:admissionId')
  @ApiOperation({ summary: '일일 영양 요약 (칼로리 달성률)' })
  async getDailyNutritionSummary(
    @Param('admissionId') admissionId: string,
    @Query('date') date?: string,
  ) {
    return { data: await this.service.getDailyNutritionSummary(admissionId, date) };
  }

  // ── Dashboard ──

  /**
   * 🔴 급양사 워크리스트 — "오늘 무엇을 해야 하는가".
   *    입력 화면은 다 있었는데 **누구를 평가해야 하는지가 어디에도 없었다**(2026-08-21 실측:
   *    재원 5명 중 영양평가 있는 환자 2명 · 상담 후속일 도래 4건이 아무 화면에도 안 나왔다).
   */
  @Get('worklist')
  @ApiOperation({ summary: '급양사 워크리스트 — 스크리닝 미실시·재평가·상담후속·저섭취·특수영양' })
  async getDietitianWorklist() {
    return { data: await this.service.getDietitianWorklist() };
  }

  @Get('dashboard')
  @ApiOperation({ summary: '영양 대시보드 (식단/알레르기 현황)' })
  async getDashboard() {
    return { data: await this.service.getDashboard() };
  }
}
