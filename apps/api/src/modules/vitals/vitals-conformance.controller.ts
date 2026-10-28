import { BadRequestException, Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { VitalsConformanceService } from './vitals-conformance.service';

/**
 * 활력 기록 표준 적합성(2026-10-07) — 관리자 점검 화면(/admin/vitals-standard)이 부른다.
 * 집계와 기록 id 표본만 낸다(환자 이름·차트 내용 없음).
 */
@ApiTags('Vitals (활력징후)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('api/v1/vitals-standard')
export class VitalsConformanceController {
  constructor(private readonly service: VitalsConformanceService) {}

  @Get('conformance')
  @ApiOperation({ summary: '활력 원장 4종의 표시 표준 적합성(기간 안 최근 5000건씩 · 수와 표본 id · 고치지 않음)' })
  async conformance(@Query('days') days?: string) {
    const d = days == null || days === '' ? 30 : Number(days);
    if (!Number.isInteger(d) || d < 1 || d > 365) throw new BadRequestException('days 는 1~365 정수입니다');
    return { data: await this.service.report(d) };
  }
}
