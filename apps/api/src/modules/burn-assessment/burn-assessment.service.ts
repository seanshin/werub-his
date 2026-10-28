import { Injectable, BadRequestException } from '@nestjs/common';
import { specialtyRecordPatients } from '../../common/specialty-board';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

// Rule of Nines 부위별 최대 면적(%) — 성인/소아. FE BurnsChart REGIONS와 동기.
// 각 부위 화상은 해당 부위 표면적을 초과할 수 없다(예: 성인 두부 최대 9%).
const REGION_MAX: Record<string, { adult: number; child: number }> = {
  HEAD: { adult: 9, child: 18 },
  CHEST: { adult: 9, child: 9 },
  ABDOMEN: { adult: 9, child: 9 },
  BACK_UPPER: { adult: 9, child: 9 },
  BACK_LOWER: { adult: 9, child: 9 },
  LEFT_UPPER_ARM: { adult: 4.5, child: 4.5 },
  RIGHT_UPPER_ARM: { adult: 4.5, child: 4.5 },
  LEFT_FOREARM: { adult: 4.5, child: 4.5 },
  RIGHT_FOREARM: { adult: 4.5, child: 4.5 },
  LEFT_THIGH: { adult: 9, child: 6.75 },
  RIGHT_THIGH: { adult: 9, child: 6.75 },
  LEFT_LOWER_LEG: { adult: 9, child: 6.75 },
  RIGHT_LOWER_LEG: { adult: 9, child: 6.75 },
  PERINEUM: { adult: 1, child: 1 },
};

@Injectable()
export class BurnAssessmentService {
  constructor(private readonly prisma: PrismaService) {}

  /* ───── Patients ───── */

  /** 기록이 있는 환자 — 최근 평가 순 상한 + 전체 수·잘림(정본 specialtyRecordPatients · 2026-10-10) · 마지막 TBSA 는 보인 환자만 */
  async getPatients() {
    const page = await specialtyRecordPatients(this.prisma, (a) => this.prisma.burnAssessment.groupBy(a as never), 'assessedAt');
    const latest = page.items.length
      ? await this.prisma.burnAssessment.findMany({
          where: { patientId: { in: page.items.map((p) => p.patientId) } },
          distinct: ['patientId'],
          orderBy: { assessedAt: 'desc' },
          select: { patientId: true, tbsa: true },
        })
      : [];
    const tbsa = new Map(latest.map((r) => [r.patientId, r.tbsa]));
    return { ...page, items: page.items.map((p) => ({ ...p, lastTbsa: tbsa.get(p.patientId) ?? null })) };
  }

  /* ───── Assessments ───── */

  async getAssessments(patientId: string) {
    return this.prisma.burnAssessment.findMany({
      where: { patientId },
      include: { assessor: { select: { familyName: true, givenName: true } } },
      orderBy: { assessedAt: 'desc' },
    });
  }

  async createAssessment(data: {
    patientId: string;
    encounterId?: string;
    tbsa?: number;
    regions: { region: string; percentage: number; depth: string }[];
    mechanism?: string;
    isChild?: boolean;
    weightKg?: number;
    notes?: string;
    assessedBy: string;
  }) {
    const isChild = data.isChild ?? false;
    // TBSA는 부위 합에서 서버가 재산정(정본). 부위 경계·총합≤100 검증도 여기서 수행.
    const { tbsa } = this.calculateTbsa(data.regions ?? [], isChild);
    // 자가입력 tbsa가 있으면 부위 합과의 큰 괴리(±2%p)만 경고성 거부 — 오기입 방어.
    if (typeof data.tbsa === 'number' && Math.abs(data.tbsa - tbsa) > 2) {
      throw new BadRequestException({
        code: 'BURN_TBSA_MISMATCH',
        message: `입력 TBSA(${data.tbsa}%)가 부위 합(${tbsa}%)과 일치하지 않습니다.`,
      });
    }
    return this.prisma.burnAssessment.create({
      data: {
        patientId: data.patientId,
        encounterId: data.encounterId,
        tbsa,
        regions: data.regions as never,
        mechanism: data.mechanism,
        isChild,
        weightKg: data.weightKg ?? null,
        notes: data.notes,
        assessedBy: data.assessedBy,
      },
      include: { patient: { select: { familyName: true, givenName: true, mrn: true } } },
    });
  }

  /* ───── Parkland 수액소생 ───── */

  /**
   * Parkland 공식: 24h 총량 = 4mL × 체중(kg) × TBSA(%) — 전반 8h(수상시점 기준) 절반·후반 16h 절반.
   * 체중 미입력 시 최근 PreVisitVitals.weight 자동 조회. 소변량 목표(성인 0.5mL/kg/h) 동봉.
   */
  async calculateParkland(dto: { patientId?: string; weightKg?: number; tbsa: number; isChild?: boolean; hoursSinceBurn?: number }) {
    if (!(dto.tbsa > 0) || dto.tbsa > 100) {
      throw new BadRequestException({ code: 'BURN_TBSA_INVALID', message: 'TBSA는 0 초과 100 이하이어야 합니다.' });
    }
    let weight = dto.weightKg;
    let weightSource: 'INPUT' | 'PRE_VISIT_VITALS' = 'INPUT';
    if ((weight == null || weight <= 0) && dto.patientId) {
      const v = await this.prisma.preVisitVitals.findFirst({
        where: { patientId: dto.patientId, weight: { not: null } },
        orderBy: { measuredAt: 'desc' },
        select: { weight: true, measuredAt: true },
      });
      if (v?.weight) { weight = Number(v.weight); weightSource = 'PRE_VISIT_VITALS'; }
    }
    if (weight == null || weight <= 0) {
      throw new BadRequestException({
        code: 'BURN_WEIGHT_REQUIRED',
        message: '체중이 필요합니다 — weightKg 입력 또는 활력징후(체중) 측정 후 재시도하세요.',
      });
    }

    const totalMl24h = Math.round(4 * weight * dto.tbsa);
    const first8hMl = Math.round(totalMl24h / 2);
    const next16hMl = totalMl24h - first8hMl;
    const hours = Math.max(0, Math.min(dto.hoursSinceBurn ?? 0, 24));
    // 수상 후 경과 시간 반영 — 전반 8h분은 '수상 시점부터 8h'이므로 지연 도착 시 남은 시간에 압축 투여
    const remainingFirstPhaseMl = hours >= 8 ? 0 : Math.round(first8hMl * (1 - hours / 8));
    const firstPhaseHoursLeft = Math.max(0, 8 - hours);
    const isChild = dto.isChild ?? false;
    const resuscitationIndicated = dto.tbsa >= (isChild ? 10 : 15);

    return {
      weightKg: weight,
      weightSource,
      tbsa: dto.tbsa,
      resuscitationIndicated, // 수액소생 적응(성인 TBSA≥15%·소아≥10%)
      totalMl24h,
      first8hMl,
      next16hMl,
      hoursSinceBurn: hours,
      remainingFirstPhaseMl,
      firstPhaseRateMlHr: firstPhaseHoursLeft > 0 ? Math.round(remainingFirstPhaseMl / firstPhaseHoursLeft) : 0,
      secondPhaseRateMlHr: Math.round(next16hMl / 16),
      urineOutputTargetMlHr: Math.round(weight * (isChild ? 1.0 : 0.5)), // 소아 1.0·성인 0.5 mL/kg/h
      note: '링거액(LR) 기준 Parkland 공식 산출값 — 소변량·활력징후 기반 적정(titration)이 우선하며 계산값은 시작점입니다.',
    };
  }

  /* ───── TBSA Calculator ───── */

  calculateTbsa(
    regions: { region: string; percentage: number; depth: string }[],
    isChild: boolean,
  ): { tbsa: number; byDepth: Record<string, number> } {
    let tbsa = 0;
    const byDepth: Record<string, number> = {};
    const byRegion: Record<string, number> = {}; // 부위별 누적 합(항목별이 아닌 부위 총합 기준 캡 검증)

    for (const r of regions) {
      const pct = r.percentage;
      if (typeof pct !== 'number' || Number.isNaN(pct) || pct < 0 || pct > 100) {
        throw new BadRequestException({
          code: 'BURN_REGION_INVALID',
          message: `부위 '${r.region}' 면적(${pct}%)이 유효 범위(0–100%)를 벗어났습니다.`,
        });
      }
      // 부위 키 정규화(케이스 드리프트가 캡을 우회하지 못하도록) — 정의된 부위만 캡 대상.
      const key = typeof r.region === 'string' ? r.region.trim().toUpperCase() : '';
      byRegion[key] = (byRegion[key] || 0) + pct;
      tbsa += pct;
      const depth = r.depth || 'UNSPECIFIED';
      byDepth[depth] = (byDepth[depth] || 0) + pct;
    }

    // 소아/성인 Rule of Nines 부위별 최대 면적 초과 검증 — 같은 부위 다중 항목의 '합'을 캡과 비교(항목별 우회 차단).
    // 정의되지 않은 부위(성긴 분류)는 Rule-of-Nines 값이 없어 개별 캡 없이 총합≤100 규칙으로만 방어.
    for (const [key, sum] of Object.entries(byRegion)) {
      const max = REGION_MAX[key];
      if (!max) continue;
      const cap = isChild ? max.child : max.adult;
      if (sum > cap + 1e-6) {
        throw new BadRequestException({
          code: 'BURN_REGION_OVER_MAX',
          message: `부위 '${key}' 합계 면적(${Math.round(sum * 100) / 100}%)이 ${isChild ? '소아' : '성인'} 최대(${cap}%)를 초과했습니다.`,
        });
      }
    }

    // Round to 2 decimal places
    tbsa = Math.round(tbsa * 100) / 100;
    for (const key of Object.keys(byDepth)) {
      byDepth[key] = Math.round(byDepth[key] * 100) / 100;
    }

    if (tbsa > 100) {
      throw new BadRequestException({
        code: 'BURN_TBSA_OVER_100',
        message: `총 화상 면적(${tbsa}%)이 100%를 초과할 수 없습니다.`,
      });
    }

    return { tbsa, byDepth };
  }
}
