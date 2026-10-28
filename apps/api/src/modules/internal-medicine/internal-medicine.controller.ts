import { Controller, Get, Post, Param, Body, Query, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { InternalMedicineService } from './internal-medicine.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CreateInternalMedicineExamDto } from './dto/internal-medicine.dto';
import { specialtyPatientResponse } from '../../common/specialty-board';

@ApiTags('Internal Medicine (내과)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.DOCTOR, UserRole.ADMIN)
@Controller('api/v1/internal-medicine')
export class InternalMedicineController {
  constructor(private readonly service: InternalMedicineService) {}

  @Get('patients')
  @ApiOperation({ summary: '내과 환자 목록' })
  async getPatients() {
    // 최근 기록 순 상한 — 전체 수·잘림은 meta(2026-10-10)
    return specialtyPatientResponse(await this.service.getPatients());
  }

  @Get('exams/:patientId')
  @ApiOperation({ summary: '환자 검사 이력' })
  async getExams(
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @Query('subspecialty') subspecialty?: string,
  ) {
    return { data: await this.service.getExams(patientId, subspecialty) };
  }

  @Post('exams')
  @ApiOperation({ summary: '내과 검사 기록 생성' })
  async createExam(
    @Body() body: CreateInternalMedicineExamDto,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.service.createExam({ ...body, examinedBy: userId }) };
  }

  @Get('today')
  @ApiOperation({ summary: '오늘 내과 일정' })
  async getToday() {
    return { data: await this.service.getToday() };
  }

  @Get('stats')
  @ApiOperation({ summary: '내과 통계' })
  async getStats() {
    return { data: await this.service.getStats() };
  }

  @Get('score-trend/:patientId')
  @ApiOperation({ summary: '환자 스코어 추이' })
  async getScoreTrend(
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @Query('subspecialty') subspecialty?: string,
  ) {
    return { data: await this.service.getScoreTrend(patientId, subspecialty) };
  }

  @Post('calculate/:scoreName')
  @ApiOperation({ summary: '임상 스코어 계산' })
  async calculate(
    @Param('scoreName') scoreName: string,
    @Body() body: Record<string, unknown>,
  ) {
    return { data: await this.service.calculate(scoreName, body) };
  }
}
