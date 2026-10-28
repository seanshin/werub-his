import { Injectable, Logger, Optional, BadRequestException, NotFoundException } from '@nestjs/common';
import { ageOf, RATIO_UNAVAILABLE } from '@hospital-run/shared';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ConfigRuntimeService } from '../config/config-runtime.service';
import { gateMode } from '../../common/gate-mode';
import { mergeTargetMap } from '../../common/qi-targets';
import { ImagingResultStatus } from '@prisma/client';
import { IONIZING_MODALITIES, IONIZING_MODALITY_VALUES } from '../../common/imaging-modality';

export interface ImagingSafetyCheck {
  rule: 'CONTRAST_ALLERGY' | 'CONTRAST_RENAL' | 'PREGNANCY' | 'CUMULATIVE_DOSE';
  level: 'PASS' | 'INFO' | 'WARNING' | 'ERROR';
  message: string;
  data?: Record<string, unknown>;
}

export type ModalitySource = 'EXPLICIT' | 'PROCEDURE_CODE' | 'RECORDED' | 'UNKNOWN';

export interface ImagingSafetyResult {
  evaluatedAt: string;
  modality: string;
  /** 🔴 modality 를 **판정하지 못한 것**과 "해당 없음"은 다른 사실이다(`false` 면 화면이 안전측으로 접는다) */
  modalityKnown: boolean;
  modalitySource: ModalitySource;
  usesContrast: boolean;
  ionizing: boolean;
  checks: ImagingSafetyCheck[];
  overridden?: boolean;
  overrideReason?: string;
  overriddenBy?: string;
}

// 전리방사선 modality 정본은 `common/imaging-modality.ts` 하나다(게이트와 품질지표가 함께 읽는다).

/** 조영제 알레르기 매칭 — 알레르기 원장 allergen 자유문자열 대조 */
const CONTRAST_ALLERGEN = /조영|contrast|iodin|요오드|gadolin|가돌리늄/i;

/** DLP(mGy·cm) → 유효선량(mSv) 변환계수 k — ICRP 성인 근사치(부위별) */
const DLP_TO_MSV_K: Record<string, number> = {
  Head: 0.0021, Neck: 0.0059, Chest: 0.014, Abdomen: 0.015,
  Pelvis: 0.015, Spine: 0.01, 'Whole Body': 0.015,
};

/**
 * 영상검사 시행 전 안전게이트 — 조영제(신기능·알레르기)·임신확인·누적 피폭선량.
 * 시행 경로 2곳(imaging.acquire·workstation.acquireImaging)이 공유하는 단일 choke point.
 * 게이트: imaging.contrastEnforce / imaging.pregnancyEnforce (OFF/WARN/BLOCK·기본 OFF).
 * 누적선량 경고는 차단하지 않고 항상 표출(informational).
 */
@Injectable()
export class ImagingSafetyService {
  private readonly logger = new Logger(ImagingSafetyService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly config?: ConfigRuntimeService,
  ) {}

  /** modality 판정 — dto 명시 > ProcedureCode.modality > 코드/명칭 휴리스틱 */
  detectModality(explicit?: string | null, code?: string | null, nameKo?: string | null): string {
    if (explicit?.trim()) return explicit.trim().toUpperCase();
    const c = code ?? '';
    const n = nameKo ?? '';
    if (c.startsWith('HA') || /\bCT\b/i.test(n)) return 'CT';
    if (c.startsWith('HE') || /\bMRI?\b/i.test(n)) return 'MR';
    if (c.startsWith('HC') || n.includes('초음파')) return 'US';
    if (n.includes('유방촬영') || /mammo/i.test(n)) return 'MG';
    if (n.includes('투시')) return 'RF';
    if (n.includes('핵의학') || /\bPET\b/i.test(n)) return 'NM';
    if (c.startsWith('G') || /X-?ray|X선|단순촬영/i.test(n)) return 'CR';
    return 'OT';
  }

  isIonizing(modality: string): boolean {
    return IONIZING_MODALITIES.has(modality.toUpperCase());
  }

  /**
   * modality 판정 정본 — 사전 확인(간호사)과 시행 게이트(방사선사)가 **같은 근거**를 쓴다.
   *
   * 🔴 종전에는 시술코드 하나만 봤다. 그런데 `procedureCodeId` 는 처방 DTO 전 경로에서
   *    **선택**이고, 운영 실측(2026-08-24) 영상 결과 209건 중 시술코드가 달린 건은 **46건(22%)**
   *    뿐이다 — **CT 36건·MG 16건은 전건 0**. 그러면 판정이 'OT'(미상) → `ionizing=false` 가 되어
   *    임신 게이트도 누적선량도 **한 항목도 돌지 않고**, 화면은 그 빈 결과를 보고
   *    "조영·방사선 검사 아님" 이라 말한다. **CT 를 앞둔 환자에게.**
   *
   *    그래서 근거를 하나 더 본다 — **이미 기록된 촬영의 modality**. 이것은 추정이 아니라
   *    그 오더에 대해 실제로 적힌 사실이다. 그래도 모르면 `UNKNOWN` 을 **밝힌다**(지어내지 않는다).
   */
  private async resolveModality(
    orderId: string,
    explicit: string | null | undefined,
    pc: { code?: string | null; nameKo?: string | null; modality?: string | null } | null | undefined,
  ): Promise<{ modality: string; source: ModalitySource }> {
    if (explicit?.trim()) return { modality: explicit.trim().toUpperCase(), source: 'EXPLICIT' };

    const fromCode = this.detectModality(pc?.modality, pc?.code, pc?.nameKo);
    if (fromCode !== 'OT') return { modality: fromCode, source: 'PROCEDURE_CODE' };

    const recorded = await this.prisma.imagingResult.findUnique({
      where: { orderId },
      select: { modality: true },
    });
    const rec = recorded?.modality?.trim().toUpperCase();
    if (rec && rec !== 'OT') return { modality: rec, source: 'RECORDED' };

    return { modality: 'OT', source: 'UNKNOWN' };
  }

  /**
   * **이송 전 사전 확인(읽기 전용)** — 간호사가 환자를 검사실로 데려가기 전에 보는 값.
   *
   * 종전에는 같은 판정이 `assertAcquireGate`(시행 시점·방사선사)에서만 돌아, 정작 준비를 담당하는
   * 간호사는 조영제 알레르기·신기능·임신 여부를 화면에서 확인할 수 없었다. 게이트를 시행하지 않고
   * 판정 결과만 돌려준다(차단·기록 없음).
   */
  async precheck(orderId: string): Promise<{
    modality: string; modalityKnown: boolean; modalitySource: ModalitySource;
    usesContrast: boolean; ionizing: boolean; checks: ImagingSafetyCheck[];
  }> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        prescription: {
          include: {
            procedureCode: { select: { code: true, nameKo: true, modality: true, usesContrast: true } },
            encounter: {
              select: {
                patientId: true,
                pregnancyStatus: true,
                patient: { select: { id: true, gender: true, dateOfBirth: true } },
              },
            },
          },
        },
      },
    });
    if (!order) throw new NotFoundException('Order not found');

    const pc = order.prescription?.procedureCode;
    const enc = order.prescription?.encounter;
    const patient = enc?.patient;
    const { modality, source } = await this.resolveModality(orderId, null, pc);
    const usesContrast = !!pc?.usesContrast || (pc?.nameKo ?? '').includes('조영');
    const ionizing = this.isIonizing(modality);

    const checks: ImagingSafetyCheck[] = [];
    if (usesContrast && patient) {
      checks.push(await this.checkContrastAllergy(patient.id));
      checks.push(await this.checkRenalFunction(patient.id, patient.gender, patient.dateOfBirth));
    }
    if (ionizing && patient) {
      const pregnancyCheck = this.checkPregnancy(patient.gender, patient.dateOfBirth, enc?.pregnancyStatus ?? null, modality);
      if (pregnancyCheck) checks.push(pregnancyCheck);
      const doseCheck = await this.checkCumulativeDose(patient.id);
      if (doseCheck) checks.push(doseCheck);
    }
    return { modality, modalityKnown: source !== 'UNKNOWN', modalitySource: source, usesContrast, ionizing, checks };
  }

  /**
   * 시행 전 게이트 평가+시행. BLOCK 모드에서 ERROR 발생 시 override 없이는 400.
   * 반환값은 imagingResult.safetyChecks에 영속할 감사 페이로드.
   */
  async assertAcquireGate(
    orderId: string,
    opts?: { modality?: string; bodyPart?: string; override?: boolean; overrideReason?: string; userId?: string },
  ): Promise<ImagingSafetyResult> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        prescription: {
          include: {
            procedureCode: { select: { code: true, nameKo: true, modality: true, usesContrast: true } },
            encounter: {
              select: {
                patientId: true,
                pregnancyStatus: true,
                patient: { select: { id: true, gender: true, dateOfBirth: true } },
              },
            },
          },
        },
      },
    });
    if (!order) throw new NotFoundException('Order not found');

    const pc = order.prescription?.procedureCode;
    const enc = order.prescription?.encounter;
    const patient = enc?.patient;
    // 사전 확인과 **같은 근거**로 판정한다 — 두 화면이 다른 말을 하면 확인할 방법이 없다
    const { modality, source: modalitySource } = await this.resolveModality(orderId, opts?.modality ?? pc?.modality, pc);
    const usesContrast = !!pc?.usesContrast || (pc?.nameKo ?? '').includes('조영');
    const ionizing = this.isIonizing(modality);

    const checks: ImagingSafetyCheck[] = [];

    if (usesContrast && patient) {
      checks.push(await this.checkContrastAllergy(patient.id));
      checks.push(await this.checkRenalFunction(patient.id, patient.gender, patient.dateOfBirth));
    }

    if (ionizing && patient) {
      const pregnancyCheck = this.checkPregnancy(patient.gender, patient.dateOfBirth, enc?.pregnancyStatus ?? null, modality);
      if (pregnancyCheck) checks.push(pregnancyCheck);
      const doseCheck = await this.checkCumulativeDose(patient.id);
      if (doseCheck) checks.push(doseCheck);
    }

    // 위반은 모드 무관 항상 로그(운영 가시성)
    for (const c of checks) {
      if (c.level === 'ERROR' || c.level === 'WARNING') {
        this.logger.warn(`imaging-safety [${c.rule}] ${c.level} order=${orderId} patient=${patient?.id}: ${c.message}`);
      }
    }

    // 규칙군별 게이트 모드 — 조영제(알레르기·신기능) / 임신
    const contrastMode = gateMode(await this.config?.get('imaging.contrastEnforce'), 'OFF');
    const pregnancyMode = gateMode(await this.config?.get('imaging.pregnancyEnforce'), 'OFF');
    const modeOf = (rule: ImagingSafetyCheck['rule']) =>
      rule === 'PREGNANCY' ? pregnancyMode : rule === 'CUMULATIVE_DOSE' ? 'WARN' : contrastMode;

    const blocked = checks.filter((c) => c.level === 'ERROR' && modeOf(c.rule) === 'BLOCK');
    if (blocked.length > 0 && !opts?.override) {
      throw new BadRequestException({
        code: 'IMAGING_SAFETY_BLOCKED',
        message: `영상검사 안전게이트 차단: ${blocked.map((c) => c.message).join(' / ')} — 임상적 정당화 사유와 함께 overrideSafety: true로 강제 시행할 수 있습니다.`,
        checks: checks.filter((c) => c.level !== 'PASS'),
      });
    }

    const overridden = blocked.length > 0 && !!opts?.override;
    return {
      evaluatedAt: new Date().toISOString(),
      modality,
      modalityKnown: modalitySource !== 'UNKNOWN',
      modalitySource,
      usesContrast,
      ionizing,
      checks,
      ...(overridden
        ? {
            overridden: true,
            overrideReason: opts?.overrideReason ?? '(사유 미입력)',
            overriddenBy: opts?.userId,
          }
        : {}),
    };
  }

  private async checkContrastAllergy(patientId: string): Promise<ImagingSafetyCheck> {
    const allergies = await this.prisma.allergy.findMany({
      where: { patientId, isActive: true },
      select: { allergen: true, severity: true },
    });
    const hit = allergies.find((a) => CONTRAST_ALLERGEN.test(a.allergen));
    if (hit) {
      return {
        rule: 'CONTRAST_ALLERGY', level: 'ERROR',
        message: `조영제 알레르기 이력: ${hit.allergen} (${hit.severity})`,
        data: { allergen: hit.allergen, severity: hit.severity },
      };
    }
    return { rule: 'CONTRAST_ALLERGY', level: 'PASS', message: '조영제 알레르기 이력 없음' };
  }

  private async checkRenalFunction(patientId: string, gender: string, dateOfBirth: Date | null): Promise<ImagingSafetyCheck> {
    const recentLab = await this.prisma.labResultItem.findFirst({
      where: {
        labResult: { patientId },
        testName: { contains: 'Creatinine', mode: 'insensitive' },
      },
      orderBy: { labResult: { completedAt: 'desc' } },
      select: { value: true },
    });
    if (!recentLab) {
      return { rule: 'CONTRAST_RENAL', level: 'WARNING', message: '최근 Creatinine 검사 없음 — 조영제 투여 전 신기능 확인 필요' };
    }
    const cr = parseFloat(recentLab.value);
    if (isNaN(cr) || cr <= 0) {
      return { rule: 'CONTRAST_RENAL', level: 'WARNING', message: '신기능 데이터 해석 불가 — 조영제 투여 전 재확인 필요' };
    }
    const age = ageOf(dateOfBirth) ?? 50;
    // MDRD 간이식 — 성별·연령 반영. 계수는 표준(불변)·판정 경계만 config imaging.contrastEgfr(§7 P1)
    const eGFR = Math.round(186 * Math.pow(cr, -1.154) * Math.pow(Math.max(age, 18), -0.203) * (gender === 'FEMALE' ? 0.742 : 1));
    const bounds = mergeTargetMap({ blockBelow: 30, warnBelow: 45 }, await this.config?.get('imaging.contrastEgfr').catch(() => null));
    if (eGFR < bounds.blockBelow) {
      return {
        rule: 'CONTRAST_RENAL', level: 'ERROR',
        message: `eGFR ${eGFR} mL/min — 조영제 신독성 고위험(<${bounds.blockBelow}). 대체검사 또는 신장내과 협진 권고`,
        data: { eGFR, creatinine: cr },
      };
    }
    if (eGFR < bounds.warnBelow) {
      return {
        rule: 'CONTRAST_RENAL', level: 'WARNING',
        message: `eGFR ${eGFR} mL/min — 조영제 주의(${bounds.blockBelow}~${bounds.warnBelow - 1}). 수액 전처치 고려`,
        data: { eGFR, creatinine: cr },
      };
    }
    return { rule: 'CONTRAST_RENAL', level: 'PASS', message: `eGFR ${eGFR} mL/min — 조영제 사용 가능`, data: { eGFR, creatinine: cr } };
  }

  private checkPregnancy(
    gender: string, dateOfBirth: Date | null, pregnancyStatus: string | null, modality: string,
  ): ImagingSafetyCheck | null {
    if (gender !== 'FEMALE' || !dateOfBirth) return null;
    const age = ageOf(dateOfBirth) ?? 0;
    if (age < 10 || age > 55) return null; // 가임기 밖

    if (pregnancyStatus === 'PREGNANT') {
      return {
        rule: 'PREGNANCY', level: 'ERROR',
        message: `임신 중 환자의 ${modality} 검사 — 태아 피폭 위험. 임상적 정당화 필요`,
        data: { pregnancyStatus, age },
      };
    }
    if (!pregnancyStatus || pregnancyStatus === 'UNKNOWN') {
      return {
        rule: 'PREGNANCY', level: 'WARNING',
        message: `가임기(${age}세) 여성 — 임신 여부 미확인 상태로 ${modality} 검사. 시행 전 임신 여부 문진 필요`,
        data: { pregnancyStatus: pregnancyStatus ?? 'NOT_ASSESSED', age },
      };
    }
    return { rule: 'PREGNANCY', level: 'PASS', message: `임신 여부 확인됨(${pregnancyStatus})` };
  }

  private async checkCumulativeDose(patientId: string): Promise<ImagingSafetyCheck | null> {
    const since = new Date(Date.now() - 365 * 86400000);
    const agg = await this.prisma.radiationExposure.aggregate({
      where: { patientId, performedAt: { gte: since } },
      _sum: { effectiveDoseMsv: true },
      _count: true,
    });
    // 🔴 기록이 0건이면 **누적선량을 모르는 것**이지 "0 mSv"도 "문제 없음"도 아니다.
    //    종전에는 여기서 `null` 을 돌려줘 항목 자체가 사라졌고, 이송 전 확인 화면은
    //    남은 checks 가 비면 "확인 항목 없음(조영·방사선 검사 아님)" 이라 단정했다 —
    //    **전리방사선 검사를 앞둔 환자에게 방사선 검사가 아니라고 말한 것이다**(P1).
    //    운영 실측(2026-08-24): `radiation_exposures` **0행** · 전리방사선 촬영 117건 → 전건 침묵.
    if (!agg._count) {
      return {
        rule: 'CUMULATIVE_DOSE', level: 'INFO',
        message: `최근 1년 피폭선량 기록 없음 — 누적선량 ${RATIO_UNAVAILABLE}(기록 0건). 장비 콘솔 판독값을 촬영 시 입력하면 누적됩니다`,
        data: { cumulativeMsv: null, count: 0, unavailableReason: 'NO_RECORD' },
      };
    }
    const sumMsv = Number(agg._sum.effectiveDoseMsv ?? 0);
    const thresholdRaw = await this.config?.get('imaging.doseAlertMsv');
    const threshold = Number(thresholdRaw) > 0 ? Number(thresholdRaw) : 100;
    if (sumMsv >= threshold) {
      return {
        rule: 'CUMULATIVE_DOSE', level: 'WARNING',
        message: `최근 1년 누적 유효선량 ${sumMsv.toFixed(1)} mSv ≥ 경보기준 ${threshold} mSv — 검사 정당성 재확인 권고`,
        data: { cumulativeMsv: sumMsv, threshold, count: agg._count },
      };
    }
    return {
      rule: 'CUMULATIVE_DOSE', level: 'INFO',
      message: `최근 1년 누적 유효선량 ${sumMsv.toFixed(1)} mSv (${agg._count}건)`,
      data: { cumulativeMsv: sumMsv, threshold, count: agg._count },
    };
  }

  // ── 피폭선량 기록 ──

  /** 선량 기록(장비 콘솔 판독값 수기) — 유효선량 미입력+DLP 존재 시 부위별 k계수로 추정 */
  async recordExposure(params: {
    imagingResultId?: string; patientId: string; modality: string; bodyPart?: string | null;
    dlp?: number; ctdiVol?: number; doseAreaProduct?: number; effectiveDoseMsv?: number;
    enteredBy: string;
  }) {
    // 음수/비수치 방어 — 워크스테이션 경유(비-DTO 인라인 body)는 class-validator를 타지 않음
    const nn = (v?: number) => (typeof v === 'number' && isFinite(v) && v >= 0 ? v : undefined);
    const dlp = nn(params.dlp);
    let effective = nn(params.effectiveDoseMsv);
    let estimated = false;
    if (effective == null && dlp != null) {
      const k = DLP_TO_MSV_K[params.bodyPart ?? ''] ?? 0.015;
      effective = Math.round(dlp * k * 1000) / 1000;
      estimated = true;
    }
    const data = {
      patientId: params.patientId,
      modality: params.modality,
      bodyPart: params.bodyPart ?? null,
      dlp: dlp ?? null,
      ctdiVol: nn(params.ctdiVol) ?? null,
      doseAreaProduct: nn(params.doseAreaProduct) ?? null,
      effectiveDoseMsv: effective ?? null,
      estimated,
      enteredBy: params.enteredBy,
    };
    if (params.imagingResultId) {
      return this.prisma.radiationExposure.upsert({
        where: { imagingResultId: params.imagingResultId },
        create: { ...data, imagingResultId: params.imagingResultId },
        update: data,
      });
    }
    return this.prisma.radiationExposure.create({ data });
  }

  /**
   * 환자별 진단 피폭 이력 + 누적 요약 (진단영역 mSv — **방사선치료 Gy 와 다른 개념·다른 단위**).
   *
   * 🔴 2026-08-27 — 종전 이 메서드는 `Number(_sum ?? 0)` 으로 **기록이 하나도 없어도 `0 mSv`** 라
   *    답했다. 같은 개념을 재는 `checkCumulativeDose()` 는 바로 위에서 **`null` + "산출 불가"**
   *    로 답한다 — **같은 사실에 정본이 둘이고 하나가 거짓말을 했다**(P12 + P1).
   *    소비처가 0이라 아무도 못 봤을 뿐이다. 정직한 쪽으로 통일한다.
   *
   * 구분해야 하는 세 가지 (셋 다 다른 사실이다):
   *   · 기록 자체가 없다              → `NO_RECORD`     · 누적 `null`
   *   · 기록은 있는데 선량값이 비었다 → `NO_DOSE_VALUE` · 누적 `null` (합계 0이 **아니다**)
   *   · 선량값이 있다                 → 숫자
   *
   * 🔴 분모를 함께 낸다 — 누적 mSv 만 보면 "적게 쬐었다"로 읽히지만, 실제로는 **선량을 안 적은
   *    촬영이 대부분**일 수 있다. 분모 정의는 품질지표 `imaging.doseUnrecorded` 와 같은 모집단을
   *    쓴다(시행된 전리방사선 촬영). 두 곳이 다른 모집단을 세면 화면과 지표가 갈라진다.
   */
  async getPatientExposure(patientId: string) {
    const since = new Date(Date.now() - 365 * 86400000);
    const ITEM_LIMIT = 100;
    const dosed = { effectiveDoseMsv: { not: null } } as const;
    // 시행된 전리방사선 촬영 = 선량을 잴 수 있었던 모집단(오더만 난 건은 아직 잴 선량이 없다)
    const studyWhere = {
      patientId,
      status: { in: [ImagingResultStatus.ACQUIRED, ImagingResultStatus.REPORTED] },
      modality: { in: IONIZING_MODALITY_VALUES },
    };
    const [items, totalCount, totalAgg, dosedCount, yearCount, yearAgg, yearDosedCount,
           estimatedCount, ionizingStudies, studiesWithDose] = await Promise.all([
      this.prisma.radiationExposure.findMany({
        where: { patientId },
        orderBy: { performedAt: 'desc' },
        take: ITEM_LIMIT,
      }),
      this.prisma.radiationExposure.count({ where: { patientId } }),
      this.prisma.radiationExposure.aggregate({
        where: { patientId }, _sum: { effectiveDoseMsv: true, dlp: true },
      }),
      this.prisma.radiationExposure.count({ where: { patientId, ...dosed } }),
      this.prisma.radiationExposure.count({ where: { patientId, performedAt: { gte: since } } }),
      this.prisma.radiationExposure.aggregate({
        where: { patientId, performedAt: { gte: since } }, _sum: { effectiveDoseMsv: true },
      }),
      this.prisma.radiationExposure.count({ where: { patientId, performedAt: { gte: since }, ...dosed } }),
      this.prisma.radiationExposure.count({ where: { patientId, estimated: true, ...dosed } }),
      this.prisma.imagingResult.count({ where: studyWhere }),
      this.prisma.imagingResult.count({ where: { ...studyWhere, exposure: { isNot: null } } }),
    ]);

    const byModality: Record<string, number> = {};
    for (const it of items) byModality[it.modality] = (byModality[it.modality] ?? 0) + 1;

    // 🔴 "몰라서 없는 것"과 "재서 0인 것"을 뒤바꿔 말하지 않는다.
    const reason = (rows: number, withDose: number) =>
      rows === 0 ? 'NO_RECORD' : withDose === 0 ? 'NO_DOSE_VALUE' : null;
    const totalReason = reason(totalCount, dosedCount);
    const yearReason = reason(yearCount, yearDosedCount);

    return {
      items,
      // 자르면 잘랐다고 말한다 — `items` 만 보고 전체라고 읽지 않게.
      itemsTruncated: totalCount > ITEM_LIMIT,
      itemLimit: ITEM_LIMIT,
      summary: {
        totalCount,
        dosedCount,
        totalEffectiveMsv: totalReason ? null : Number(totalAgg._sum.effectiveDoseMsv),
        totalEffectiveUnavailableReason: totalReason,
        totalDlp: totalAgg._sum.dlp == null ? null : Number(totalAgg._sum.dlp),
        last12moCount: yearCount,
        last12moDosedCount: yearDosedCount,
        last12moEffectiveMsv: yearReason ? null : Number(yearAgg._sum.effectiveDoseMsv),
        last12moEffectiveUnavailableReason: yearReason,
        /** 합계에 DLP×k 변환 **추정치**가 섞였는지 — 섞였으면 화면이 그 사실을 말해야 한다 */
        estimatedCount,
        /** 분모: 시행된 전리방사선 촬영 / 그중 선량이 기록된 건 */
        ionizingStudies,
        studiesWithDose,
        byModality,
      },
    };
  }
}
