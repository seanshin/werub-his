import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { ChemoService } from './chemo.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import {
  CreateCourseDto,
  CreateRegimenDto,
  DelayCycleDto,
  StartCycleDto,
  UpdateCourseDto,
  UpdateCycleDto,
  UpdateRegimenDto,
} from './dto/chemo.dto';

@ApiTags('Chemo (항암 사이클 엔진)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/chemo')
export class ChemoController {
  constructor(private readonly service: ChemoService) {}

  // ── 레지멘 정본 ──

  @Get('regimens')
  @Roles(UserRole.DOCTOR, UserRole.PHARMACIST, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '레지멘 목록' })
  async listRegimens(@Query('status') status?: string) {
    return { data: await this.service.listRegimens(status) };
  }

  @Post('regimens')
  @Roles(UserRole.DOCTOR, UserRole.PHARMACIST, UserRole.ADMIN)
  @ApiOperation({ summary: '레지멘 생성(day-based 약물 구성)' })
  async createRegimen(@Body() dto: CreateRegimenDto, @CurrentUser('id') userId: string) {
    return { data: await this.service.createRegimen(dto, userId) };
  }

  @Patch('regimens/:id')
  @Roles(UserRole.DOCTOR, UserRole.PHARMACIST, UserRole.ADMIN)
  @ApiOperation({ summary: '레지멘 수정(drugs 전달 시 전량 교체)' })
  async updateRegimen(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateRegimenDto, @CurrentUser('id') userId: string) {
    return { data: await this.service.updateRegimen(id, dto, userId) };
  }

  // ── 코스 ──

  @Post('courses')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '항암 코스 시작(BSA 스냅샷·사이클 자동 생성·치료일정 전개)' })
  async createCourse(@Body() dto: CreateCourseDto, @CurrentUser('id') userId: string) {
    return { data: await this.service.createCourse(dto, userId) };
  }

  @Get('courses')
  @Roles(UserRole.DOCTOR, UserRole.PHARMACIST, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '코스 목록(환자·상태 필터)' })
  async listCourses(@Query('patientId') patientId?: string, @Query('status') status?: string) {
    return { data: await this.service.listCourses(patientId, status) };
  }

  @Get('courses/:id')
  @Roles(UserRole.DOCTOR, UserRole.PHARMACIST, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '코스 상세(사이클 타임라인)' })
  async getCourse(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.service.getCourse(id) };
  }

  @Patch('courses/:id')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '코스 감량률 조정·중단' })
  async updateCourse(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCourseDto, @CurrentUser('id') userId: string) {
    return { data: await this.service.updateCourse(id, dto, userId) };
  }

  // ── 사이클 ──

  @Get('gate-overrides')
  @Roles(UserRole.DOCTOR, UserRole.PHARMACIST, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '점검 우회 이력 — nadir 게이트 미통과로 시작된 사이클(누가·언제·사유 · 상한+전체 수)' })
  async gateOverrides(@Query('from') from?: string, @Query('to') to?: string, @Query('patientId', new ParseUUIDPipe({ optional: true })) patientId?: string) {
    return { data: await this.service.gateOverrides({ from, to, patientId }) };
  }

  @Get('cycles/:id/gate')
  @Roles(UserRole.DOCTOR, UserRole.PHARMACIST, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: 'nadir 랩 게이트 사전 점검(ANC·혈소판)' })
  async checkGate(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.service.checkCycleGate(id) };
  }

  @Post('cycles/:id/start')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '사이클 시작 — 게이트 검증 후 CHEMO 무균조제 자동 지시' })
  async startCycle(@Param('id', ParseUUIDPipe) id: string, @Body() dto: StartCycleDto, @CurrentUser('id') userId: string) {
    return { data: await this.service.startCycle(id, userId, dto) };
  }

  @Post('cycles/:id/delay')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '사이클 지연(이후 사이클 연쇄 이동)' })
  async delayCycle(@Param('id', ParseUUIDPipe) id: string, @Body() dto: DelayCycleDto, @CurrentUser('id') userId: string) {
    return { data: await this.service.delayCycle(id, dto.days, dto.reason, userId) };
  }

  @Patch('cycles/:id')
  @Roles(UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '사이클 감량률 오버라이드(시작 전)' })
  async updateCycle(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCycleDto, @CurrentUser('id') userId: string) {
    return { data: await this.service.updateCycle(id, dto, userId) };
  }

  @Post('cycles/:id/complete')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '사이클 완료(전 사이클 완료 시 코스 종결·암등록 요약)' })
  async completeCycle(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('id') userId: string) {
    return { data: await this.service.completeCycle(id, userId) };
  }
}
