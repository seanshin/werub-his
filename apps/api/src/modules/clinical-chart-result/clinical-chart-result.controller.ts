import { Controller, Get, Post, Body, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { ClinicalChartResultService } from './clinical-chart-result.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CreateClinicalChartResultDto } from './dto/clinical-chart-result.dto';

interface ReqUser { id: string; familyName?: string; givenName?: string }

@ApiTags('Clinical Chart Results (임상도구 결과)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/clinical-chart-results')
export class ClinicalChartResultController {
  constructor(private readonly svc: ClinicalChartResultService) {}

  @Post()
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '임상도구 결과 저장(환자 차트)' })
  async create(@Body() dto: CreateClinicalChartResultDto, @CurrentUser() user: ReqUser) {
    return { data: await this.svc.create(dto, user) };
  }

  @Get()
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN) // 환자 PHI 조회 — READ(원무/코더 등 저권한) 제외, 타 임상 EP 규범 정합
  @ApiOperation({ summary: '환자 임상도구 결과 목록' })
  async findByPatient(@Query('patientId') patientId: string, @Query('chartId') chartId?: string) {
    return { data: await this.svc.findByPatient(patientId, chartId) };
  }
}
