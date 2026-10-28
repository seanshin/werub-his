import { Controller, Get, Post, Body, Param, Query, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { ChronicService } from './chronic.service';
import { CreateChronicObservationDto } from './dto/create-chronic-observation.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';

@ApiTags('만성질환 추이')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
@Controller('api/v1/patients/:patientId/chronic-observations')
export class ChronicController {
  constructor(private readonly svc: ChronicService) {}

  @Post()
  @ApiOperation({ summary: '만성질환 측정값 기록(혈압·체중·혈당 등) — 정상범위·flag 자동 산정' })
  async create(
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @Body() dto: CreateChronicObservationDto,
  ) {
    return { data: await this.svc.create(patientId, dto) };
  }

  @Get('problems')
  @ApiOperation({ summary: '문제중심 뷰 — 활성 만성 진단별 지표·목표·달성(CDSS, 서버 가이드라인)' })
  async problems(@Param('patientId', ParseUUIDPipe) patientId: string) {
    return { data: await this.svc.getProblemView(patientId) };
  }

  @Get()
  @ApiOperation({ summary: '만성질환 시계열 추이(codes·기간·limit 필터) + 최신/Δ 요약' })
  async trend(
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @Query('codes') codes?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
    @Query('includeAcute') includeAcute?: string,
  ) {
    return {
      data: await this.svc.getTrend(patientId, {
        codes: codes ? codes.split(',').map((c) => c.trim()).filter(Boolean) : undefined,
        from: from ? new Date(from) : undefined,
        to: to ? new Date(to) : undefined,
        limit: limit ? Number(limit) : undefined,
        includeAcute: includeAcute === 'true',
      }),
    };
  }
}
