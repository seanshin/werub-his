import { BadRequestException, Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { isUUID } from 'class-validator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { VisitComparisonService } from './visit-comparison.service';

/**
 * 이번 방문 ↔ 직전 방문 대비(patient-chart-refinement C7).
 * 역할은 차트 화면 정본 `CHART_ACCESS_ROLES`(ADMIN·DOCTOR·NURSE·MEDICAL_RECORDS)와 같게 — 화면을 연 사람이 403 을 받지 않게.
 * 경로가 `/api/v1/patients/:uuid` 로 시작해 환자 지목 열람 감사(`audit-routes.ts` PHI_READ_PATTERNS)에 자동으로 걸린다.
 */
@ApiTags('Patients')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/patients')
export class VisitComparisonController {
  constructor(private readonly service: VisitComparisonService) {}

  @Get(':id/visit-comparison')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE, UserRole.MEDICAL_RECORDS)
  @ApiOperation({ summary: 'Visit comparison — current vs previous signed visit (values side by side, no judgment)' })
  async compare(@Param('id', ParseUUIDPipe) id: string, @Query('encounterId') encounterId?: string) {
    if (encounterId !== undefined && !isUUID(encounterId)) throw new BadRequestException('encounterId must be a UUID');
    return { data: await this.service.compare(id, encounterId) };
  }
}
