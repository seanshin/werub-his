import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { VitalsService } from './vitals.service';

/**
 * 지금 적용되는 활력 이상 판정 임계(2026-10-01) — 화면이 임계 숫자를 따로 적지 않게 병합본을 준다.
 * 임상 정보가 아니라 병원 단위 판정 기준이라 **로그인한 모든 직원**이 읽는다(환자 차트를 보는 역할이 다양하다).
 * 🔴 VitalsController 는 클래스 @Roles(DOCTOR·NURSE·ADMIN)이고 클래스 @Roles 가 핸들러를 덮으므로 별도 컨트롤러로 둔다.
 */
@ApiTags('Vitals (활력징후)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('api/v1/vitals-thresholds')
export class VitalsThresholdsController {
  constructor(private readonly service: VitalsService) {}

  @Get()
  @ApiOperation({ summary: '적용 중인 활력 이상 임계(코드 기본 + 환자안전위 개정 병합 · 출처·버려진 개정 키)' })
  async get() {
    return { data: await this.service.effectiveThresholds() };
  }
}
