import { Controller, Get, Post, Param, Body, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { EntService } from './ent.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CreateEntExamDto, CreateHearingAidDto, CreateSleepStudyDto } from './dto/ent.dto';
import { specialtyPatientResponse } from '../../common/specialty-board';

@ApiTags('ENT (이비인후과)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.DOCTOR, UserRole.ADMIN)
@Controller('api/v1/ent')
export class EntController {
  constructor(private readonly service: EntService) {}

  @Get('patients')
  @ApiOperation({ summary: '이비인후과 환자 목록' })
  async getPatients() {
    // 최근 기록 순 상한 — 전체 수·잘림은 meta(2026-10-10)
    return specialtyPatientResponse(await this.service.getPatients());
  }

  @Post('exam')
  @ApiOperation({ summary: '이비인후과 검사 기록' })
  async createExam(
    @Body() dto: CreateEntExamDto,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.service.createExam({ ...dto, examinedBy: userId }) };
  }

  @Get('exam/:patientId')
  @ApiOperation({ summary: '검사 이력' })
  async getExams(@Param('patientId', ParseUUIDPipe) patientId: string) {
    return { data: await this.service.getExams(patientId) };
  }

  @Get('audiogram/:patientId')
  @ApiOperation({ summary: '청력검사 추이' })
  async getAudiogram(@Param('patientId', ParseUUIDPipe) patientId: string) {
    return { data: await this.service.getAudiogram(patientId) };
  }

  @Post('hearing-aid')
  @ApiOperation({ summary: '보청기 처방 — HearingAid 영속(무저장 스텁 근절 R1b)' })
  async createHearingAid(
    @Body() dto: CreateHearingAidDto,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.service.createHearingAid({ ...dto, prescribedBy: userId }) };
  }

  @Get('hearing-aid/:patientId')
  @ApiOperation({ summary: '환자 보청기 처방 이력' })
  async getHearingAids(@Param('patientId', ParseUUIDPipe) patientId: string) {
    return { data: await this.service.getHearingAids(patientId) };
  }

  @Get('today')
  @ApiOperation({ summary: '오늘 일정' })
  async getToday() {
    return { data: await this.service.getToday() };
  }

  @Get('stats')
  @ApiOperation({ summary: '통계' })
  async getStats() {
    return { data: await this.service.getStats() };
  }

  @Post('sleep-study')
  @ApiOperation({ summary: '수면검사 기록' })
  async createSleepStudy(
    @Body() dto: CreateSleepStudyDto,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.service.createSleepStudy({ ...dto, interpretedBy: userId }) };
  }

  @Get('sleep-study/:patientId')
  @ApiOperation({ summary: '수면검사 이력' })
  async getSleepStudies(@Param('patientId', ParseUUIDPipe) patientId: string) {
    return { data: await this.service.getSleepStudies(patientId) };
  }
}
