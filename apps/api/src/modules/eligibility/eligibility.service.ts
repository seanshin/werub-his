import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ConfigRuntimeService } from '../config/config-runtime.service';
import { SimulationEligibilityProvider } from './simulation.provider';
import { NhisEligibilityProvider } from './nhis.provider';
import { InsuranceType } from '@prisma/client';
import { EligibilityResult, CopayCategory, EligibilityProvider } from './eligibility.types';
import { decryptLegacyPid } from '../../common/crypto/legacy-pid-crypto';
import { identityVerdict, identityReasonForStore, IDENTITY_PROBLEM_CODE, IDENTITY_PROBLEM_MESSAGE } from '../../common/identity-check-verdict';
import { INSTITUTION_GRADES, NHI_OUTPATIENT_BY_GRADE_KEY, nhiOutpatientRatePct, type InstitutionGrade } from '@hospital-run/shared';

function err(code: string, message: string, status: HttpStatus): HttpException {
  return new HttpException({ error: code, message }, status);
}

/**
 * 자격조회 부재 시 보험유형별 정적 폴백 본인부담률. 실제 청구(billing.createFromEncounter)와
 * 같은 키(InsuranceType enum)·같은 값. 🔴 자격 무관 `0.3` 하드코딩(telehealth 등)이 의료급여·
 * 산재·자보(전부 0%) 환자를 30% 과다청구하던 것을 이 정본으로 대체한다.
 */
const COPAY_RATES_FALLBACK: Record<InsuranceType, number> = {
  NHI: 0.3, MEDICAID: 0.0, INDUSTRIAL: 0.0, AUTO: 0.0, SELF_PAY: 1.0,
};

/** copayCategory → 본인부담률(소수). config billing.copay.* 기반. visitType별 차등. */
const RATE_KEY: Record<CopayCategory, { out: string; in: string } | { fixed: number }> = {
  NHI: { out: 'billing.copay.nhi.outpatient', in: 'billing.copay.nhi.inpatient' },
  MA_TYPE1: { out: 'billing.copay.ma1.outpatient', in: 'billing.copay.ma1.inpatient' },
  MA_TYPE2: { out: 'billing.copay.ma2.outpatient', in: 'billing.copay.ma2.inpatient' },
  NEAR_POOR: { out: 'billing.copay.nearpoor.outpatient', in: 'billing.copay.nearpoor.outpatient' },
  SPECIAL_EXEMPTION: { out: 'billing.copay.exemption.rate', in: 'billing.copay.exemption.rate' },
  PATRIOT: { fixed: 0 }, // 보훈 국비부담(기본 0% 본인부담) — 감면등급 세분화는 운영 시 보훈처 연계
  INDUSTRIAL: { fixed: 0 },
  AUTO: { fixed: 0 },
  SELF_PAY: { fixed: 1 },
};

/**
 * 🔴 **감면 자격** — 코드별 본인부담 특례보다 **우선한다**.
 *
 * 왜 필요한가(2026-08-27 실측): 청구가 행위 코드의 `copayRate` 오버라이드를
 * **자격보다 먼저** 적용하고 있었다. 그래서 산정특례 환자가 10%가 아니라 **30%**,
 * 차상위가 14%가 아니라 **30%** 로 청구됐다(운영 시드에서 4건 실재).
 * 산재·보훈·자보는 본인부담이 **0**인데 코드에 율이 박혀 있으면 그들에게도 청구된다.
 *
 * 🔴 반대로 **일반 건보(NHI)** 에는 코드 특례가 이겨야 한다 —
 *    MRI 80% 같은 고시 특례가 30%로 깎이면 그것도 틀린 청구다.
 *    그래서 "낮은 쪽을 고른다" 같은 수치 비교가 아니라 **자격의 성격**으로 가른다.
 */
export const REDUCED_COPAY_CATEGORIES = new Set([
  'MA_TYPE1', 'MA_TYPE2', 'MEDICAID', 'NEAR_POOR', 'SPECIAL_EXEMPTION',
  'PATRIOT', 'INDUSTRIAL', 'AUTO',
]);

/** 감면 자격인가 — 이 경우 코드별 특례율을 적용하지 않는다(자격이 이긴다) */
export function isReducedCopay(copayCategory: string | null | undefined): boolean {
  return !!copayCategory && REDUCED_COPAY_CATEGORIES.has(copayCategory);
}

/**
 * 🔴 (2026-10-14 결함 발굴 수납 P1-4) 자격조회 **실패**(ERROR) 기록은 자격이 아니다.
 *    종전엔 실패를 `{status:'ERROR', copayCategory:'NHI'}` 로 저장했고, 그 행이 최신이 되어 어제 VERIFIED 산정특례(10%)·
 *    의료급여 행을 덮어 30% 가 청구됐다(일반 건보 자격을 확인한 것과 같은 행이 됐다). 기록은 남기되(감사·화면) 읽을 때 건너뛴다.
 */
export const USABLE_ELIGIBILITY_WHERE = { status: { not: 'ERROR' } } as const;
export const isUsableEligibility = (e: { status: string }) => e.status !== 'ERROR';

@Injectable()
export class EligibilityService {
  private readonly logger = new Logger(EligibilityService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configRuntime: ConfigRuntimeService,
    private readonly simulation: SimulationEligibilityProvider,
    private readonly nhis: NhisEligibilityProvider,
  ) {}

  /** 모드별 자격조회 공급자 — SIMULATION(기본) / NHIS(운영 프록시). 토글 `eligibility.mode`. */
  private async provider(): Promise<EligibilityProvider> {
    const mode = String((await this.configRuntime.get('eligibility.mode')) ?? 'SIMULATION').toUpperCase();
    return mode === 'NHIS' ? this.nhis : this.simulation;
  }

  private async enabled(): Promise<boolean> {
    return (await this.configRuntime.get('eligibility.enabled')) !== false;
  }

  /**
   * copayCategory + visitType → 본인부담률(0~1). config 기반.
   * 🔴 (2026-10-20) 건보 외래는 종별 차등 설정(`billing.copay.nhi.outpatient.byGrade`)이 있으면 **우리 기관 종별**(명시 설정)의 율 —
   *    없거나 종별 미설정이면 종전 단일 율. `grade` 는 종별 계산기가 다른 종별로 셀 때만 넘긴다(청구는 넘기지 않는다).
   */
  async copayRateFor(copayCategory: string, visitType?: 'OUTPATIENT' | 'INPATIENT', grade?: InstitutionGrade): Promise<number> {
    const spec = RATE_KEY[copayCategory as CopayCategory];
    if (!spec) return 0.3;
    if ('fixed' in spec) return spec.fixed;
    const key = visitType === 'INPATIENT' ? spec.in : spec.out;
    const pct = Number((await this.configRuntime.get(key)) ?? 30);
    if (copayCategory === 'NHI' && visitType !== 'INPATIENT') {
      const byGrade = await this.configRuntime.get(NHI_OUTPATIENT_BY_GRADE_KEY);
      if (byGrade != null) {
        const g = grade ?? (await this.explicitInstitutionGrade());
        return nhiOutpatientRatePct(byGrade, g, pct).pct / 100;
      }
    }
    return pct / 100;
  }

  /** 명시 설정된 종별(설정 행이 있을 때만 · 카탈로그 기본값은 설정이 아니다) — 모르면 null */
  private async explicitInstitutionGrade(): Promise<InstitutionGrade | null> {
    const row = await this.prisma.systemConfig.findUnique({ where: { key: 'billing.institution.grade' }, select: { value: true } });
    const v = typeof row?.value === 'string' ? row.value.toUpperCase() : null;
    return v && (INSTITUTION_GRADES as readonly string[]).includes(v) ? (v as InstitutionGrade) : null;
  }

  /**
   * 환자 본인부담률 정본 해소 — 자격조회(copayCategory) 우선, 없으면 보험유형 정적 폴백.
   * billing.createFromEncounter 와 동일 우선순위(자격 > 폴백)·동일 값. 간이 청구 경로
   * (telehealth·견적)가 `0.3` 을 하드코딩하는 대신 이 메서드를 써 자격을 반영한다.
   * (billing.service 의 private resolveCopay 와 달리 encounter 자격 고정 부작용은 없다 — 순수 조회.)
   */
  async resolveCopayRate(
    patientId: string,
    insuranceType: InsuranceType,
    visitType: 'OUTPATIENT' | 'INPATIENT',
    encounterId?: string,
  ): Promise<{ rate: number; copayCategory: string }> {
    let elig = null as Awaited<ReturnType<typeof this.prisma.eligibilityCheck.findFirst>> | null;
    if (encounterId) {
      // 🔴 `.catch(() => null)` 을 쓰지 않는다 — 쓰면 **조회 실패가 "자격 없음"으로 번역**되어
      //    산정특례(10%)·차상위(14%) 환자가 폴백 30% 로 청구된다(2026-08-27 v4.10.0 에서 고친 것과
      //    같은 피해, 다른 진입). 게다가 반환 copayCategory 가 'NHI' 라 `isReducedCopay()` 가 false 가 되어
      //    **코드별 특례까지 자격을 이긴다.** 기록 부재(null)는 정상 상황이라 그대로 폴백으로 흐른다.
      const enc = await this.prisma.encounter.findUnique({ where: { id: encounterId }, select: { eligibilityCheckId: true } });
      if (enc?.eligibilityCheckId) {
        elig = await this.prisma.eligibilityCheck.findUnique({ where: { id: enc.eligibilityCheckId } });
        if (elig && !isUsableEligibility(elig)) elig = null; // 조회 실패 기록은 자격이 아니다(아래)
      }
    }
    if (!elig) {
      elig = await this.prisma.eligibilityCheck.findFirst({ where: { patientId, ...USABLE_ELIGIBILITY_WHERE }, orderBy: { queriedAt: 'desc' } });
    }
    if (!elig) {
      // 🔴 (2026-10-20) 자격조회 없는 건보 **외래**도 설정 율(종별 차등 포함)을 쓴다 — 종전 정적 0.3 은 설정을 바꿔도 따라가지 않았다.
      //    입원은 건드리지 않는다(정적 0.3 ↔ 설정 20% 차이는 별개 판단 — 이번 범위 밖)
      if (insuranceType === 'NHI' && visitType === 'OUTPATIENT') return { rate: await this.copayRateFor('NHI', 'OUTPATIENT'), copayCategory: insuranceType };
      return { rate: COPAY_RATES_FALLBACK[insuranceType] ?? 0.3, copayCategory: insuranceType };
    }
    if (elig.status === 'EXPIRED' || elig.status === 'NOT_FOUND') {
      return { rate: 1.0, copayCategory: elig.copayCategory }; // 자격상실 = 전액본인부담
    }
    return { rate: await this.copayRateFor(elig.copayCategory, visitType), copayCategory: elig.copayCategory };
  }

  /** FR-1 자격조회 — 영속화 + 대기열 갱신. */
  async check(patientId: string, opts: { visitType?: 'OUTPATIENT' | 'INPATIENT'; queueId?: string; userId?: string } = {}) {
    if (!(await this.enabled())) {
      throw err('ELIGIBILITY_DISABLED', '수진자 자격조회 기능이 비활성화되어 있습니다.', HttpStatus.SERVICE_UNAVAILABLE);
    }
    const patient = await this.prisma.patient.findUnique({
      where: { id: patientId },
      select: { id: true, insuranceType: true, insuranceNumber: true, dateOfBirth: true },
    });
    if (!patient) throw err('PATIENT_NOT_FOUND', '환자를 찾을 수 없습니다.', HttpStatus.NOT_FOUND);

    // 모드별 공급자 — SIMULATION(기본) / NHIS(운영 프록시 어댑터). config `eligibility.mode`.
    const provider = await this.provider();
    let result: EligibilityResult;
    try {
      result = await provider.check({
        patientId: patient.id,
        insuranceType: patient.insuranceType,
        insuranceNumber: decryptLegacyPid(patient.insuranceNumber),
        dateOfBirth: patient.dateOfBirth,
        visitType: opts.visitType,
      });
    } catch (e) {
      this.logger.warn(`자격조회 실패: ${(e as Error).message}`);
      result = { status: 'ERROR', copayCategory: 'NHI', source: 'SIMULATION', message: '자격조회 오류' };
    }

    const saved = await this.prisma.eligibilityCheck.create({
      data: {
        patientId: patient.id,
        insuranceType: patient.insuranceType,
        status: result.status,
        copayCategory: result.copayCategory,
        coverageStartDate: result.coverageStartDate ? new Date(result.coverageStartDate) : null,
        coverageEndDate: result.coverageEndDate ? new Date(result.coverageEndDate) : null,
        specialExemption: result.specialExemption ?? null,
        exemptionExpiry: result.exemptionExpiry ? new Date(result.exemptionExpiry) : null,
        source: result.source,
        visitType: opts.visitType ?? null,
        message: result.message ?? null,
        rawResponse: (result.raw ?? result) as object,
        checkedById: opts.userId ?? null,
      },
    });

    if (opts.queueId) {
      // 🔴 (2026-09-17 L2) 자격 조회 결과는 이미 확정 저장됐다(`saved`) — 대기열 반영 실패로 그것을 되돌리지 않는다.
      //    다만 **조용히** 놓치지 않는다: 이 쓰기가 실패하면 원장에는 자격이 확인됐는데 접수 화면은 옛 상태로 남아,
      //    직원이 같은 조회를 다시 돌리거나 "미확인"으로 읽는다.
      // 🔴 호출을 **한 줄로 유지한다** — `this.prisma.X` 다음 줄에 `.update(` 를 두면 트랜잭션 경계·상태 쓰기
      //    스캐너가 이 쓰기를 못 본다(K4 실측 · 내 첫 판이 실제로 그렇게 기준선을 −2 시켰다).
      await this.prisma.waitingQueue.update({ where: { id: opts.queueId }, data: { eligibilityStatus: result.status, eligibilityCheckId: saved.id } })
        .catch((e) => this.logger.error(`자격 결과의 대기열 반영 실패 — 조회는 저장됐으나 접수 화면은 옛 상태로 남는다(queue=${opts.queueId} check=${saved.id}): ${e instanceof Error ? e.message : String(e)}`));
    }
    this.audit(opts.userId, 'READ', saved.id, `status=${result.status}; category=${result.copayCategory}; source=${result.source}`);
    return saved;
  }

  /** 최신 자격(캐시 유효 시 재사용). */
  async latest(patientId: string) {
    const ttlH = Number((await this.configRuntime.get('eligibility.cacheTtlHours')) ?? 24);
    const row = await this.prisma.eligibilityCheck.findFirst({ where: { patientId }, orderBy: { queriedAt: 'desc' } });
    if (!row) return { found: false, fresh: false, data: null };
    const fresh = Date.now() - row.queriedAt.getTime() < ttlH * 3600_000;
    return { found: true, fresh, data: row };
  }

  /**
   * FR-5 본인확인 의무화 기록(PatientIdentificationCheck 재사용).
   *
   * 🔴 2026-08-18 봉합 — 이 기록은 **실패를 남길 수 없었다**(P16·P17):
   *   ① `result: exception ? 'PASS' : 'PASS'` — 삼항 양쪽이 같아 **어떤 경우에도 PASS**.
   *      환자안전 화면(IPSG.1)의 "식별 오류율"은 `result === 'FAIL'` 로 세므로 **영구 0%** 였다.
   *      = 실제로 불일치가 있어도 화면은 "식별 오류 없음"이라고 안심시킨다.
   *   ② FE 가 `verifiedItems` 를 보내지 않는데 서버가 `{name: true, dob: true}` 를 **무조건 박았다**
   *      — 아무도 확인하지 않은 두 항목이 "성명·생년월일 대조 완료"로 법정기록에 남았다.
   *
   * 🔴 2026-09-15 봉합 — 명시 `result:'PASS'` 는 위 400 을 우회해 `verifiedItems: {}` PASS 를 남겼다.
   *   판정은 이제 `common/identity-check-verdict.ts` 정본 하나(patient-safety 식별 체크와 공유).
   *
   * 정본 규칙(모르는 것을 아는 것처럼 기록하지 않는다):
   *   · 판정은 **호출자가 실제로 대조한 항목**(`verifiedItems`)에서 유도한다.
   *     하나라도 `false` → `FAIL`. 전부 `true` → `PASS`. 명시 `result: 'FAIL'` 이 있으면 그것이 우선.
   *   · 대조 항목(불리언)이 없으면 **기록하지 않고 400** — `result:'PASS'` 선언이 있어도 마찬가지.
   *     무엇을 확인했는지 모르는 채로 PASS 를 만들어내지 않는다(기본값 주입 금지). 불일치 신고(명시 FAIL)만 예외.
   *   · `FAIL` 은 사유를 요구한다. `FAIL` 이면 대기열 `identityVerifiedAt` 을 **찍지 않는다**
   *     (확인 실패인데 "확인 완료 시각"이 남던 것).
   *   · 예외(신분증 미지참 구두확인)는 오류가 아니다 — `FAIL` 로 세지 않는다(거짓 경보 금지).
   *     대신 사유를 남기고 `[예외]` 로 표식한다.
   */
  async verifyIdentity(
    patientId: string,
    body: {
      method: string;
      verifiedItems?: Record<string, boolean>;
      result?: string;
      exceptionReason?: string;
      failureReason?: string;
      queueId?: string;
    },
    userId: string,
  ) {
    // 판정 정본 — 호출자가 선언한 result:'PASS' 는 근거가 아니다(대조 항목에서 서버가 유도한다)
    const outcome = identityVerdict(body, { method: body.method });
    if (outcome.problem) {
      throw err(IDENTITY_PROBLEM_CODE[outcome.problem], IDENTITY_PROBLEM_MESSAGE[outcome.problem], HttpStatus.BAD_REQUEST);
    }
    const result = outcome.verdict;
    const exception = outcome.exception;

    const rec = await this.prisma.patientIdentificationCheck.create({
      data: {
        patientId,
        checkType: 'RECEPTION_IDENTITY',
        method: body.method,
        // 🔴 호출자가 대조한 그대로만 저장(기본값 주입 금지·불리언만). 항목 없는 기록은 불일치 신고(FAIL)뿐.
        verifiedItems: outcome.items as object,
        verifiedBy: userId,
        verifiedAt: new Date(),
        result,
        failureReason: identityReasonForStore(outcome),
      },
    });

    // 확인에 실패했으면 "본인확인 완료" 시각을 대기열에 찍지 않는다.
    // 🔴 (2026-09-17 L2) 반대로 **확인은 통과했는데 배지 쓰기가 실패**한 것도 조용히 넘기지 않는다 —
    //    원장(IdentityCheck)에는 PASS 가 남았는데 접수 화면은 "미확인"으로 보여, 직원이 같은 환자에게
    //    본인확인을 다시 요구하게 된다(실제보다 덜 안전하게 말하는 것도 사실이 아니다 · §화면점검).
    if (body.queueId && result === 'PASS') {
      await this.prisma.waitingQueue.update({ where: { id: body.queueId }, data: { identityVerifiedAt: new Date() } })
        .catch((e) => this.logger.error(`본인확인 배지 반영 실패 — 원장은 PASS 인데 대기열은 미확인으로 남는다(queue=${body.queueId} check=${rec.id}): ${e instanceof Error ? e.message : String(e)}`));
    }
    this.audit(userId, 'CREATE', rec.id, `identity method=${body.method} result=${result}${exception ? ' (예외)' : ''}`);
    return rec;
  }

  private audit(userId: string | undefined, action: 'READ' | 'CREATE', resourceId: string, detail: string) {
    void this.prisma.auditLog.create({
      data: { userId: userId ?? resourceId, action, resourceType: 'ELIGIBILITY', resourceId, changes: { detail } as object },
    }).catch(() => undefined);
  }
}