import { ageInMonths } from '@hospital-run/shared';
import { calcBmi } from '../vitals/vitals-evaluate';
import { Injectable, BadRequestException, NotFoundException, Optional } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ConfigRuntimeService } from '../config/config-runtime.service';
import { gateMode } from '../../common/gate-mode';
import { specialtyTodayList, specialtyTodayStats, specialtyRecordPatients } from '../../common/specialty-board';
import { addMonths } from '../../common/day-range';

// 표준 예방접종 일정(최소셋) — 차수·권장월령·최소간격. vaccineCode 우선, 없으면 vaccineName 매칭.
const IMMUNIZATION_SCHEDULE: Record<string, { doses: number; monthsByDose: number[]; minIntervalDays?: number }> = {
  BCG: { doses: 1, monthsByDose: [0] },
  HepB: { doses: 3, monthsByDose: [0, 1, 6], minIntervalDays: 28 },
  B형간염: { doses: 3, monthsByDose: [0, 1, 6], minIntervalDays: 28 },
  DTaP: { doses: 5, monthsByDose: [2, 4, 6, 15, 48], minIntervalDays: 28 },
  IPV: { doses: 4, monthsByDose: [2, 4, 6, 48], minIntervalDays: 28 },
  MMR: { doses: 2, monthsByDose: [12, 48], minIntervalDays: 28 },
  VAR: { doses: 1, monthsByDose: [12] },
  수두: { doses: 1, monthsByDose: [12] },
};

@Injectable()
export class PediatricsService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly configRuntime?: ConfigRuntimeService,
  ) {}

  /* ───── Patients ───── */

  /** 기록이 있는 환자 — 최근 기록 순 상한 + 전체 수·잘림(정본 specialtyRecordPatients · 2026-10-10) */
  async getPatients() {
    return specialtyRecordPatients(this.prisma, (a) => this.prisma.pediatricGrowth.groupBy(a as never), 'measuredAt');
  }

  /* ───── Growth ───── */

  async getGrowth(patientId: string) {
    // 🔴 `gender` 를 함께 준다 — 성장곡선의 백분위 참조선은 성별로 다르다.
    //    화면이 `gender="male"` 을 하드코딩하고 있어 **여아도 남아 곡선** 위에 그려졌다(2026-08-26).
    //    성별은 곡선 선택에 필요한 최소 항목이고, PID 등 민감 식별자는 담지 않는다.
    const rows = await this.prisma.pediatricGrowth.findMany({
      where: { patientId },
      include: {
        measurer: { select: { familyName: true, givenName: true } },
        patient: { select: { gender: true } },
      },
      orderBy: { measuredAt: 'desc' },
    });
    // 🔴 (2026-10-10) 저장된 백분위의 근거를 밝힌다 — 서버가 기준표로 계산한 적이 없다(입력·시드 값 그대로).
    //    값이 있으면 UNVERIFIED(기준표 산출 아님) · 없으면 null. 화면은 이 값으로 경보 색을 칠하지 않는다.
    return rows.map((r) => ({
      ...r,
      percentileBasis: growthPercentileBasis(r),
    }));
  }

  async createGrowth(data: {
    patientId: string; ageMonths: number;
    height?: number; weight?: number; headCirc?: number;
    bmi?: number; heightPercentile?: number; weightPercentile?: number;
    bmiPercentile?: number; measuredBy: string;
  }) {
    // 🔴 (2026-10-10) 백분위는 입력받지 않는다 — 종전엔 호출자가 보낸 숫자를 근거 확인 없이 그대로 저장했다.
    //    백분위는 승인된 성장 기준표(LMS)로 서버가 계산해야 하는데, 저장소에 출처가 확인된 기준표가 없다
    //    (화면 곡선의 표는 '근사' 5점 표). 그래서 지금은 산출하지 않는다 — 받은 척 지우지 않고 거부한다.
    const sent = (['weightPercentile', 'heightPercentile', 'bmiPercentile'] as const).filter((k) => data[k] != null);
    if (sent.length) {
      throw new BadRequestException({
        code: 'GROWTH_PERCENTILE_NOT_ACCEPTED',
        message: '백분위는 입력받지 않습니다 — 승인된 성장 기준표로 서버가 계산하며, 기준표가 등록되지 않아 지금은 산출하지 않습니다. 계측값(체중·신장·두위)만 보내세요.',
        details: { fields: sent },
      });
    }
    // 🔴 (2026-10-10) BMI 는 서버가 체중·신장에서 계산한다 — 종전엔 화면이 보낸 값을 그대로 저장해, 신장·체중과 어긋난 BMI 가 남을 수 있었다.
    //    화면이 보낸 값이 계산과 다르면(반올림 차이 0.15 넘게) 거절한다(조용히 덮어쓰지 않는다) · 신장·체중 없이 BMI 만 오면 거절.
    const bmi = calcBmi(data.weight, data.height) ?? null;
    if (data.bmi != null && (bmi == null || Math.abs(bmi - data.bmi) > 0.15)) {
      throw new BadRequestException({
        code: 'GROWTH_BMI_MISMATCH',
        message: 'BMI 는 체중·신장으로 서버가 계산합니다 — 보낸 BMI 가 계측값과 맞지 않습니다.',
        details: { sent: data.bmi, computed: bmi },
      });
    }
    // 월령 — 생년월일이 있으면 그것과 대조(1개월 넘게 다르면 거절 · 성장곡선 x 축이 틀린다). 생년월일이 없으면 입력값 그대로
    const patient = await this.prisma.patient.findUnique({ where: { id: data.patientId }, select: { dateOfBirth: true } });
    if (!patient) throw new NotFoundException('환자를 찾을 수 없습니다.');
    const expected = ageInMonths(patient.dateOfBirth);
    if (expected != null && Math.abs(expected - data.ageMonths) > 1) {
      throw new BadRequestException({
        code: 'GROWTH_AGE_MISMATCH',
        message: '월령이 생년월일과 맞지 않습니다.',
        details: { sent: data.ageMonths, expected },
      });
    }
    return this.prisma.pediatricGrowth.create({
      data: {
        patientId: data.patientId,
        ageMonths: data.ageMonths,
        height: data.height,
        weight: data.weight,
        headCirc: data.headCirc,
        bmi,
        measuredBy: data.measuredBy,
      },
      include: { patient: { select: { familyName: true, givenName: true, mrn: true } } },
    });
  }

  /* ───── Immunizations ───── */

  async getImmunizations(patientId: string) {
    return this.prisma.pediatricImmunization.findMany({
      where: { patientId },
      include: { giver: { select: { familyName: true, givenName: true } } },
      orderBy: { givenAt: 'desc' },
    });
  }

  async createImmunization(data: {
    patientId: string;
    vaccineName: string; vaccineCode?: string;
    doseNumber: number; lotNumber?: string;
    site?: string;
    manufacturer?: string;
    givenAt?: string; nextDueDate?: string; notes?: string;
    givenBy: string;
  }) {
    // 예방접종 검증(P2-H) — 표준일정 대조·중복·간격·차수·lot. config immunization.enforce(기본 OFF·fallback 'OFF').
    const gate = gateMode(await this.configRuntime?.get('immunization.enforce'), 'OFF');
    const key = data.vaccineCode && IMMUNIZATION_SCHEDULE[data.vaccineCode] ? data.vaccineCode : data.vaccineName;
    const sched = IMMUNIZATION_SCHEDULE[key];
    const givenAt = data.givenAt ? new Date(data.givenAt) : new Date();
    const warnings: string[] = [];

    // 중복(동일 백신·차수) — DB unique가 최종 backstop, 사전 친절 차단
    const dup = await this.prisma.pediatricImmunization.findFirst({
      where: { patientId: data.patientId, vaccineName: data.vaccineName, doseNumber: data.doseNumber },
    });
    if (dup) throw new BadRequestException({ code: 'IMMUNIZATION_DUP', message: `이미 등록된 접종입니다(${data.vaccineName} ${data.doseNumber}차).` });

    if (sched) {
      if (data.doseNumber > sched.doses) warnings.push(`${key} 표준 차수(${sched.doses}회) 초과`);
      if (sched.minIntervalDays && data.doseNumber > 1) {
        const prev = await this.prisma.pediatricImmunization.findFirst({
          where: { patientId: data.patientId, vaccineName: data.vaccineName, doseNumber: data.doseNumber - 1 },
          orderBy: { givenAt: 'desc' },
        });
        if (prev) {
          const days = (givenAt.getTime() - prev.givenAt.getTime()) / 86400000;
          if (days < sched.minIntervalDays) warnings.push(`최소 접종간격(${sched.minIntervalDays}일) 미달: ${Math.round(days)}일`);
        }
      }
    }

    // 로트번호 — 리콜 추적. BLOCK 시 필수
    if (!data.lotNumber?.trim()) {
      if (gate === 'BLOCK') throw new BadRequestException({ code: 'IMMUNIZATION_LOT_REQUIRED', message: '백신 로트번호(lotNumber)는 필수입니다 — 리콜 추적.' });
      warnings.push('로트번호 미기재(리콜 추적 저해)');
    }
    if (gate === 'BLOCK' && warnings.length) {
      throw new BadRequestException({ code: 'IMMUNIZATION_RULE', message: `접종 규칙 위반: ${warnings.join(', ')}` });
    }

    // nextDueDate 자동 산출 — 스케줄상 다음 차수 권장월령 반영(수기 미지정 시)
    let nextDueDate = data.nextDueDate ? new Date(data.nextDueDate) : undefined;
    if (!nextDueDate && sched && data.doseNumber < sched.doses) {
      const curM = sched.monthsByDose[data.doseNumber - 1] ?? 0;
      const nextM = sched.monthsByDose[data.doseNumber] ?? curM;
      // 🔴 다음 접종 예정일도 말일에서 굴러가지 않게(정본)
      nextDueDate = addMonths(new Date(givenAt), Math.max(0, nextM - curM));
    }

    const created = await this.prisma.pediatricImmunization.create({
      data: {
        patientId: data.patientId,
        vaccineName: data.vaccineName,
        vaccineCode: data.vaccineCode,
        doseNumber: data.doseNumber,
        lotNumber: data.lotNumber,
        site: data.site,
        manufacturer: data.manufacturer,
        givenAt,
        nextDueDate,
        notes: data.notes,
        givenBy: data.givenBy,
      },
      include: { patient: { select: { familyName: true, givenName: true, mrn: true } } },
    });
    return { ...created, warnings: warnings.length ? warnings : undefined };
  }

  /* ───── Developmental Assessments ───── */

  async getDevelopmental(patientId: string) {
    return this.prisma.developmentalAssessment.findMany({
      where: { patientId },
      include: { assessor: { select: { familyName: true, givenName: true } } },
      orderBy: { assessedAt: 'desc' },
    });
  }

  async createDevelopmental(data: {
    patientId: string; ageMonths: number;
    tool: string;
    grossMotor: string; fineMotor: string;
    language: string; socialPersonal: string;
    overallResult: string;
    details?: unknown;
    assessedBy: string;
  }) {
    return this.prisma.developmentalAssessment.create({
      data: {
        patientId: data.patientId,
        ageMonths: data.ageMonths,
        tool: data.tool,
        grossMotor: data.grossMotor,
        fineMotor: data.fineMotor,
        language: data.language,
        socialPersonal: data.socialPersonal,
        overallResult: data.overallResult,
        details: data.details as never,
        assessedBy: data.assessedBy,
      },
      include: { patient: { select: { familyName: true, givenName: true, mrn: true } } },
    });
  }

  /* ───── Today / Stats ───── */

  async getToday() {
    // 정본 = 오늘 예약(Appointment) — 종전엔 `return []` 리터럴이라 영구 공집합이었다
    return specialtyTodayList(this.prisma, 'pediatrics');
  }

  async getStats() {
    const [totalGrowth, totalImmunizations, totalAssessments] = await Promise.all([
      this.prisma.pediatricGrowth.count(),
      this.prisma.pediatricImmunization.count(),
      this.prisma.developmentalAssessment.count(),
    ]);
    return {
      totalExams: totalGrowth + totalImmunizations + totalAssessments,
      totalGrowth,
      totalImmunizations,
      totalAssessments,
      ...(await specialtyTodayStats(this.prisma, 'pediatrics')),
    };
  }
}

/**
 * 성장 기록 백분위의 근거(2026-10-10).
 *  · `UNVERIFIED` — 백분위가 저장돼 있으나 서버가 기준표로 계산한 값이 아니다(과거 입력·시드). 판정에 쓰지 않는다.
 *  · `null` — 백분위 없음(기준표 미등록으로 산출하지 않음).
 */
export type GrowthPercentileBasis = 'UNVERIFIED' | null;
export function growthPercentileBasis(r: { weightPercentile?: number | null; heightPercentile?: number | null; bmiPercentile?: number | null }): GrowthPercentileBasis {
  return r.weightPercentile != null || r.heightPercentile != null || r.bmiPercentile != null ? 'UNVERIFIED' : null;
}
