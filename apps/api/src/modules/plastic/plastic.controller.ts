import { Controller, Get, Post, Param, Body, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { PlasticService } from './plastic.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CreatePlasticExamDto } from './dto/plastic.dto';
import { specialtyPatientResponse } from '../../common/specialty-board';

@ApiTags('Plastic Surgery (성형외과)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.DOCTOR, UserRole.ADMIN)
@Controller('api/v1/plastic')
export class PlasticController {
  constructor(private readonly service: PlasticService) {}

  @Get('patients')
  @ApiOperation({ summary: '성형외과 환자 목록' })
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
    @Body() body: CreatePlasticExamDto,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.service.createExam({ ...body, examinedBy: userId }) };
  }

  @Get('today')
  @ApiOperation({ summary: '오늘 성형외과 일정' })
  async getToday() {
    return { data: await this.service.getToday() };
  }

  @Get('stats')
  @ApiOperation({ summary: '성형외과 통계' })
  async getStats() {
    return { data: await this.service.getStats() };
  }
}
