import { Controller, Get, Post, Patch, Param, Body, Query, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { DentalService } from './dental.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import {
  CreateDentalChartDto, CreateDentalPlanDto, UpdateDentalPlanStatusDto,
  CreateDentalRecordDto, CreateDentalLabOrderDto, UpdateDentalLabOrderStatusDto,
  CreatePerioDto, CreateRecallDto,
} from './dto/dental.dto';
import { specialtyPatientResponse } from '../../common/specialty-board';

@ApiTags('Dental (치과)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.DOCTOR, UserRole.ADMIN)
@Controller('api/v1/dental')
export class DentalController {
  constructor(private readonly service: DentalService) {}

  @Get('patients')
  @ApiOperation({ summary: '치과 환자 목록' })
  async getPatients() {
    // 최근 기록 순 상한 — 전체 수·잘림은 meta(2026-10-10)
    return specialtyPatientResponse(await this.service.getPatients());
  }

  @Get('chart/:patientId')
  @ApiOperation({ summary: '치아차트 조회' })
  async getChart(@Param('patientId', ParseUUIDPipe) patientId: string) {
    return { data: await this.service.getChart(patientId) };
  }

  @Post('chart')
  @ApiOperation({ summary: '치아차트 기록/업데이트' })
  async createChart(
    @Body() body: CreateDentalChartDto,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.service.createChart({ ...body, chartedBy: userId }) };
  }

  @Post('plans')
  @ApiOperation({ summary: '치료 계획 생성' })
  async createPlan(
    @Body() body: CreateDentalPlanDto,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.service.createPlan({ ...body, plannedBy: userId }) };
  }

  @Get('plans/:patientId')
  @ApiOperation({ summary: '환자 치료 계획' })
  async getPlans(@Param('patientId', ParseUUIDPipe) patientId: string) {
    return { data: await this.service.getPlans(patientId) };
  }

  @Patch('plans/:id/status')
  @ApiOperation({ summary: '계획 상태 변경' })
  async updatePlanStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateDentalPlanStatusDto,
  ) {
    return { data: await this.service.updatePlanStatus(id, body.status) };
  }

  @Post('records')
  @ApiOperation({ summary: '치료 기록' })
  async createRecord(
    @Body() body: CreateDentalRecordDto,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.service.createRecord({ ...body, treatedBy: userId }) };
  }

  @Get('records/:patientId')
  @ApiOperation({ summary: '치료 이력' })
  async getRecords(@Param('patientId', ParseUUIDPipe) patientId: string) {
    return { data: await this.service.getRecords(patientId) };
  }

  @Get('today')
  @ApiOperation({ summary: '오늘 치과 일정' })
  async getToday() {
    return { data: await this.service.getToday() };
  }

  @Post('lab-orders')
  @ApiOperation({ summary: '기공의뢰 생성' })
  async createLabOrder(
    @Body() body: CreateDentalLabOrderDto,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.service.createLabOrder({ ...body, orderedBy: userId }) };
  }

  @Get('lab-orders')
  @ApiOperation({ summary: '기공의뢰 목록' })
  async getDentalLabOrders(@Query('patientId') patientId?: string) {
    return { data: await this.service.getDentalLabOrders(patientId) };
  }

  @Patch('lab-orders/:id/status')
  @ApiOperation({ summary: '기공의뢰 상태 변경' })
  async updateLabOrderStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateDentalLabOrderStatusDto,
  ) {
    return { data: await this.service.updateLabOrderStatus(id, body.status) };
  }

  @Get('stats')
  @ApiOperation({ summary: '치과 통계' })
  async getStats() {
    return { data: await this.service.getStats() };
  }

  @Get('perio/:patientId')
  @ApiOperation({ summary: '치주차트' })
  async getPerio(@Param('patientId', ParseUUIDPipe) patientId: string) {
    return { data: await this.service.getPerio(patientId) };
  }

  @Post('perio')
  @ApiOperation({ summary: '치주검사 기록' })
  async createPerio(
    @Body() body: CreatePerioDto,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.service.createPerio({ ...body, chartedBy: userId }) };
  }

  /* ───── Recalls (Phase 2) ───── */

  @Post('recalls')
  @ApiOperation({ summary: '리콜 스케줄 생성' })
  async createRecall(
    @Body() body: CreateRecallDto,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.service.createRecall({ ...body, createdBy: userId }) };
  }

  @Get('recalls')
  @ApiOperation({ summary: '리콜 스케줄 목록' })
  async getRecalls(@Query('patientId') patientId?: string) {
    return { data: await this.service.getRecalls(patientId) };
  }

  @Patch('recalls/:id/complete')
  @ApiOperation({ summary: '리콜 완료 처리' })
  async completeRecall(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.service.completeRecall(id) };
  }
}
