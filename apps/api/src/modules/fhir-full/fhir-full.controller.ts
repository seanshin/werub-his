import { Controller, Get, Param, UseGuards, NotFoundException } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { FhirFullService } from './fhir-full.service';
import { FhirDualAuthGuard } from '../smart-auth/smart-auth.guard';

@ApiTags('FHIR R4 (Full)')
@ApiBearerAuth()
/**
 * 🔴 (2026-09-16 D4) 이 컨트롤러만 `JwtAuthGuard` 단독이라 **역할 판정이 없었다** —
 *    환자 흡연상태·바이탈 Observation 이 인증된 전 직원(READ·CRM 포함)에게 열려 있었다.
 *    2026-08-27 에 `/fhir/R4/Patient` 가 같은 이유로 급양·원무 계정에 873명을 돌려준 그 결함이다.
 *    정본 가드(`FhirDualAuthGuard`)로 수렴한다 — 직원 JWT 는 설정 `security.fhir.staffRoles` 로 판정하고,
 *    SMART 토큰은 `@FhirScope` 가 없는 이 라우트에서 거부된다(사고성 노출 차단).
 *    🔴 `@Roles` 를 붙이는 대신 가드를 바꾼 이유: 이 컨트롤러엔 `RolesGuard` 가 없어 `@Roles` 가 **무력**하다.
 */
@UseGuards(FhirDualAuthGuard)
@Controller('fhir/R4')
export class FhirFullController {
  constructor(private readonly fhirFullService: FhirFullService) {}

  // Encounter and MedicationRequest read endpoints moved to main FhirController

  @Get('Observation/smoking-status/:patientId')
  @ApiOperation({ summary: '#7 흡연상태 FHIR Observation (LOINC 72166-2) — CVD 위험엔진 입력' })
  async getSmokingStatus(@Param('patientId') patientId: string) {
    const res = await this.fhirFullService.getSmokingStatusObservation(patientId);
    if (!res) throw new NotFoundException('Patient not found');
    return res;
  }

  @Get('Observation/:formSubmissionId')
  @ApiOperation({ summary: 'FHIR Observation (바이탈 등 폼 데이터)' })
  async getObservation(@Param('formSubmissionId') id: string) {
    const res = await this.fhirFullService.getObservation(id);
    if (!res) throw new NotFoundException('Observation not found');
    return res;
  }
}
