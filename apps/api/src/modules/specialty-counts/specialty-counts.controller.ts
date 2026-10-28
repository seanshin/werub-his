import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

// 의사 진료과(department) → 전문과 탭 key 매핑 (별칭 포함)
const DEPT_TO_KEY: Record<string, string> = {
  '내과': 'internal-medicine', '혈액종양내과': 'internal-medicine', '가정의학과': 'internal-medicine',
  '치과': 'dental',
  '안과': 'ophthalmology',
  '피부과': 'dermatology',
  '이비인후과': 'ent',
  '정형외과': 'orthopedics',
  '산부인과': 'obgyn',
  '소아청소년과': 'pediatrics',
  '정신건강의학과': 'psychiatry', '정신과': 'psychiatry',
  '신경외과': 'neurosurgery',
  '성형외과': 'plastic',
  '비뇨의학과': 'urology', '비뇨기과': 'urology',
  '재활의학과': 'rehab',
  '방사선종양학과': 'radiation', '치료실(방사선)': 'radiation', '치료실(항암)': 'radiation',
  '투석실': 'dialysis', '치료실(투석)': 'dialysis',
  '혈액은행': 'blood-bank',
};

/**
 * 전문과별 진료기록(진료 이력) 수 집계 — 차트 탭 배지.
 *
 * 🔴 원 결함(W8/A2): 여기에 `RolesGuard` 자체가 없어, 로그인한 **전 14역할**이 임의 환자의
 *    정신건강의학과·비뇨의학과 진료 건수를 조회할 수 있었다. 건수만이라도 **민감 진료과 이용
 *    사실**이 드러난다(그 자체가 PHI 다). 이 저장소 규약: `RolesGuard` 가 빠지면 `@Roles` 는 무의미.
 *
 * 권한 근거: 이 값은 환자 스코프 진료기록 집계다 → 같은 자료를 내려주는
 *    `GET /api/v1/patients/:patientId/encounters`(encounter.controller `PatientEncountersController`)
 *    와 **동일한 역할 집합**으로 맞춘다(의사·간호 / ADMIN 은 RolesGuard 규약상 통과).
 *    넓히지도 좁히지도 않았다 — 원무·검진·의무기록은 원래 진료 이력 목록에서도 403 이었다.
 */
@ApiTags('Specialty Counts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/patients')
export class SpecialtyCountsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get(':id/specialty-counts')
  @Roles(UserRole.DOCTOR, UserRole.NURSE)
  @ApiOperation({ summary: '전문과별 진료기록 수(진료 이력의 의사 진료과 기준, 탭 배지)' })
  async counts(@Param('id') patientId: string) {
    const encounters = await this.prisma.encounter.findMany({
      where: { patientId },
      select: { status: true, subjective: true, objective: true, assessment: true, plan: true, doctor: { select: { department: true } } },
    });
    const data: Record<string, number> = {};
    for (const e of encounters) {
      // 진료 이력 탭과 동일한 visible 기준(DRAFT는 SOAP 내용 있을 때만)
      const visible = e.status !== 'DRAFT' || !!(e.subjective || e.objective || e.assessment || e.plan);
      if (!visible) continue;
      const key = e.doctor?.department ? DEPT_TO_KEY[e.doctor.department] : undefined;
      if (key) data[key] = (data[key] ?? 0) + 1;
    }
    return { data };
  }
}
