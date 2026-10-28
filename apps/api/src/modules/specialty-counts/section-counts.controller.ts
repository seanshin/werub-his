import { Controller, Get, Logger, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

/**
 * 차트 탭 배지용 **구간별 건수** — 한 번의 조회로 전부.
 *
 * 🔴 발단(2026-08-26 실측): 차트는 탭 42개를 그리는데 개수를 세는 탭은 **4종**뿐이었다.
 *    표본 환자에서 문제목록·알레르기·영상·수술·간호기록은 전부 0인데, 내용이 있는 탭과
 *    **똑같이 생겼다.** 임상의는 22번 눌러보거나, 누르지 않고 없다고 가정한다 — 둘 다 나쁘다.
 *
 * 🔴 **세지 못한 것은 `0` 으로 내지 않는다.** 조회가 실패한 구간은 키를 빼고 `failed` 에 담는다.
 *    "없음"과 "못 셈"은 다른 사실이고, 화면은 그 둘을 다르게 그려야 한다.
 *
 * 권한: `specialty-counts` 와 같은 집합(진료 이력 목록과 동일) — 넓히지도 좁히지도 않는다.
 */
@ApiTags('Patient Chart Counts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/patients')
export class SectionCountsController {
  private readonly logger = new Logger(SectionCountsController.name);

  constructor(private readonly prisma: PrismaService) {}

  @Get(':id/section-counts')
  @Roles(UserRole.DOCTOR, UserRole.NURSE)
  @ApiOperation({ summary: '차트 탭별 건수 — 빈 탭과 내용 있는 탭을 구분하기 위한 배지' })
  async counts(@Param('id') patientId: string) {
    const p = this.prisma;
    const enc = { encounter: { patientId } };

    /** 탭 key → 세는 방법. 🔴 탭 key 는 화면 정본(`BASE_TABS`)과 같은 문자열을 쓴다 */
    const sections: [string, () => Promise<number>][] = [
      ['problems', () => p.problemList.count({ where: { patientId, status: 'ACTIVE' } })],
      ['allergies', () => p.allergy.count({ where: { patientId } })],
      ['labresults', () => p.labResult.count({ where: { patientId } })],
      ['imaging', () => p.imagingResult.count({ where: { patientId } })],
      ['vitals', () => p.preVisitVitals.count({ where: { patientId } })],
      ['surgeries', () => p.surgery.count({ where: { patientId } })],
      ['admissions', () => p.admission.count({ where: { patientId } })],
      ['referrals', () => p.referralLetter.count({ where: { patientId } })],
      ['questionnaire', () => p.questionnaireToken.count({ where: { patientId } })],
      // 🔴 동의서 탭이 실제로 부르는 정본과 같은 모델을 센다(`/patients/:id/consents` → `ConsentForm`).
      //    `PatientConsent` 는 포털 계정 동의라 다른 축이다 — 탭 배지가 탭 내용과 어긋나면 안 된다.
      ['consent', () => p.consentForm.count({ where: { patientId } })],
      // 간호기록은 입원에 매달린다(외래 간호기록은 이 모델이 아니다 — 세는 범위를 좁게 말한다)
      ['nursing', () => p.nursingNote.count({ where: { admission: { patientId } } })],
      ['family-history', () => p.familyHistory.count({ where: { patientId } })],
      ['checkup', () => p.checkupVisit.count({ where: { patientId } })],
      ['pre-orders', () => p.preOrder.count({ where: { patientId } })],
      ['therapy', () => p.therapyOrder.count({ where: { order: { prescription: { encounter: { patientId } } } } })],
      ['schedule', () => p.patientTreatmentSchedule.count({ where: { patientId } })],
      ['medications', () => p.prescription.count({ where: { status: 'ACTIVE', type: 'MEDICATION', ...enc } })],
      ['billing', () => p.billing.count({ where: { patientId } })],
    ];

    const settled = await Promise.allSettled(sections.map(([, fn]) => fn()));
    const data: Record<string, number> = {};
    const failed: string[] = [];
    settled.forEach((r, i) => {
      const key = sections[i][0];
      if (r.status === 'fulfilled') data[key] = r.value;
      else {
        // 🔴 실패를 0 으로 번역하지 않는다 — 키를 아예 내지 않고 실패 목록에 담는다
        failed.push(key);
        this.logger.error(`구간 건수 산출 실패(${key}): ${(r.reason as Error)?.message}`);
      }
    });

    return { data: { counts: data, failed } };
  }
}
