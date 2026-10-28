import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { NursingRulesService } from './nursing-rules.service';

@ApiTags('Nursing Rules')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/nursing-rules')
export class NursingRulesController {
  constructor(private readonly svc: NursingRulesService) {}

  /** 간호 원내 규정 현황 — 값·출처(쓰기는 `PUT /config/:key` 관리자) */
  @Get()
  @Roles(UserRole.NURSE, UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '간호 원내 규정 현황 — 보호대 점검 간격·통증 재평가 규정·인계 인수 방식(값과 출처 · 미설정/조회 실패를 그대로)' })
  async overview() {
    return { data: await this.svc.overview() };
  }

  /** 통증 재평가 대기 — 규정 미설정이면 목록 없음(이유) */
  @Get('pain-reassessment')
  @Roles(UserRole.NURSE, UserRole.DOCTOR, UserRole.ADMIN)
  @ApiOperation({ summary: '통증 재평가 대기 — 원내 규정대로 재원 환자의 기준 이상 통증·진통제 투여 뒤 재평가 대기/지연(최근 24시간 · 규정 미설정이면 items=null)' })
  async painReassessment() {
    return { data: await this.svc.painReassessment() };
  }
}
