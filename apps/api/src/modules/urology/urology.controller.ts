import { Controller, Get, Post, Param, Body, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { UrologyService } from './urology.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CreateUrologyExamDto, CreateUrologyProcedureDto } from './dto/urology.dto';
import { specialtyPatientResponse } from '../../common/specialty-board';

@ApiTags('Urology (비뇨의학과)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.DOCTOR, UserRole.ADMIN)
@Controller('api/v1/urology')
export class UrologyController {
  constructor(private readonly service: UrologyService) {}

  @Get('patients')
  @ApiOperation({ summary: '비뇨의학과 환자 목록' })
  async getPatients() {
    // 최근 기록 순 상한 — 전체 수·잘림은 meta(2026-10-10)
    return specialtyPatientResponse(await this.service.getPatients());
  }

  @Get('exams/:patientId')
  @ApiOperation({ summary: '환자 검사 이력' })
  async getExams(@Param('patientId', ParseUUIDPipe) patientId: string) {
    return { data: await this.service.getExams(patientId) };
  }

  @Post('exams')
  @ApiOperation({ summary: '검사 기록 생성' })
  async createExam(
    @Body() body: CreateUrologyExamDto,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.service.createExam({ ...body, examinedBy: userId }) };
  }

  @Post('procedures')
  @ApiOperation({ summary: '시술 기록 생성 (방광경/생검/ESWL 등 — 시술 모듈 신설)' })
  async createProcedure(
    @Body() body: CreateUrologyProcedureDto,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.service.createProcedure({ ...body, performedBy: userId }) };
  }

  @Get('procedures/:patientId')
  @ApiOperation({ summary: '환자 시술 이력' })
  async getProcedures(@Param('patientId', ParseUUIDPipe) patientId: string) {
    return { data: await this.service.getProcedures(patientId) };
  }

  @Get('psa-trend/:patientId')
  @ApiOperation({ summary: 'PSA 수치 추이' })
  async getPsaTrend(@Param('patientId', ParseUUIDPipe) patientId: string) {
    return { data: await this.service.getPsaTrend(patientId) };
  }

  @Get('ipss-trend/:patientId')
  @ApiOperation({ summary: 'IPSS 점수 추이' })
  async getIpssTrend(@Param('patientId', ParseUUIDPipe) patientId: string) {
    return { data: await this.service.getIpssTrend(patientId) };
  }

  @Get('today')
  @ApiOperation({ summary: '오늘 비뇨의학과 일정' })
  async getToday() {
    return { data: await this.service.getToday() };
  }

  @Get('stats')
  @ApiOperation({ summary: '비뇨의학과 통계' })
  async getStats() {
    return { data: await this.service.getStats() };
  }
}
