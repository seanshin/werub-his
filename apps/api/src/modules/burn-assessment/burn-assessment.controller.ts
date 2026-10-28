import { Controller, Get, Post, Param, Body, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { BurnAssessmentService } from './burn-assessment.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CreateBurnAssessmentDto, CalculateTbsaDto, CalculateParklandDto } from './dto/burn-assessment.dto';
import { specialtyPatientResponse } from '../../common/specialty-board';

@ApiTags('Burn Assessment (화상 평가)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
@Controller('api/v1/burn-assessment')
export class BurnAssessmentController {
  constructor(private readonly service: BurnAssessmentService) {}

  @Get('patients')
  @ApiOperation({ summary: '화상 환자 목록' })
  async getPatients() {
    // 최근 기록 순 상한 — 전체 수·잘림은 meta(2026-10-10)
    return specialtyPatientResponse(await this.service.getPatients());
  }

  @Get(':patientId')
  @ApiOperation({ summary: '환자 화상 평가 이력' })
  async getAssessments(@Param('patientId', ParseUUIDPipe) patientId: string) {
    return { data: await this.service.getAssessments(patientId) };
  }

  @Post()
  @ApiOperation({ summary: '화상 평가 생성' })
  async createAssessment(
    @Body() body: CreateBurnAssessmentDto,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.service.createAssessment({ ...body, assessedBy: userId }) };
  }

  @Post('calculate-tbsa')
  @ApiOperation({ summary: 'TBSA 계산' })
  async calculateTbsa(
    @Body() body: CalculateTbsaDto,
  ) {
    return { data: this.service.calculateTbsa(body.regions, body.isChild) };
  }

  @Post('calculate-parkland')
  @ApiOperation({ summary: 'Parkland 수액소생 계산 — 4mL×kg×TBSA(전반8h 절반·후반16h 절반)·체중 자동조회·소변량 목표' })
  async calculateParkland(@Body() body: CalculateParklandDto) {
    return { data: await this.service.calculateParkland(body) };
  }
}
