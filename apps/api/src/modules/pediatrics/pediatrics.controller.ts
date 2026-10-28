import { Controller, Get, Post, Param, Body, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { PediatricsService } from './pediatrics.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CreateGrowthDto, CreateImmunizationDto, CreateDevelopmentalDto } from './dto/pediatrics.dto';
import { specialtyPatientResponse } from '../../common/specialty-board';

@ApiTags('Pediatrics (소아청소년과)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN) // 계측·예방접종 기록은 간호 업무
@Controller('api/v1/pediatrics')
export class PediatricsController {
  constructor(private readonly service: PediatricsService) {}

  @Get('patients')
  @ApiOperation({ summary: '소아청소년과 환자 목록' })
  async getPatients() {
    // 최근 기록 순 상한 — 전체 수·잘림은 meta(2026-10-10)
    return specialtyPatientResponse(await this.service.getPatients());
  }

  /* ───── Growth ───── */

  @Get('growth/:patientId')
  @ApiOperation({ summary: '성장 기록 조회' })
  async getGrowth(@Param('patientId', ParseUUIDPipe) patientId: string) {
    return { data: await this.service.getGrowth(patientId) };
  }

  @Post('growth')
  @ApiOperation({ summary: '성장 기록 생성' })
  async createGrowth(
    @Body() dto: CreateGrowthDto,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.service.createGrowth({ ...dto, measuredBy: userId }) };
  }

  /* ───── Immunizations ───── */

  @Get('immunizations/:patientId')
  @ApiOperation({ summary: '예방접종 기록 조회' })
  async getImmunizations(@Param('patientId', ParseUUIDPipe) patientId: string) {
    return { data: await this.service.getImmunizations(patientId) };
  }

  @Post('immunizations')
  @ApiOperation({ summary: '예방접종 기록 생성' })
  async createImmunization(
    @Body() dto: CreateImmunizationDto,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.service.createImmunization({ ...dto, givenBy: userId }) };
  }

  /* ───── Developmental Assessments ───── */

  @Get('developmental/:patientId')
  @ApiOperation({ summary: '발달 평가 조회' })
  async getDevelopmental(@Param('patientId', ParseUUIDPipe) patientId: string) {
    return { data: await this.service.getDevelopmental(patientId) };
  }

  @Post('developmental')
  @ApiOperation({ summary: '발달 평가 생성' })
  async createDevelopmental(
    @Body() dto: CreateDevelopmentalDto,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.service.createDevelopmental({ ...dto, assessedBy: userId }) };
  }

  /* ───── Today / Stats ───── */

  @Get('today')
  @ApiOperation({ summary: '오늘 소아청소년과 일정' })
  async getToday() {
    return { data: await this.service.getToday() };
  }

  @Get('stats')
  @ApiOperation({ summary: '소아청소년과 통계' })
  async getStats() {
    return { data: await this.service.getStats() };
  }
}
