import { Injectable, Logger, Optional } from '@nestjs/common';
import { ageOf } from '@hospital-run/shared';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { DurService, DurWarning } from '../prescription/dur/dur.service';
import { DurRulesRepo } from '../prescription/dur/dur-rules.repo';
import { CLINICAL_CODE_RULES } from '@hospital-run/shared';
import { buildMedicationHay, hayMatchesTerm } from '../prescription/dur/ingredient-terms';

export interface CdssCheck {
  category: string;
  level: 'PASS' | 'INFO' | 'WARNING' | 'ERROR';
  title: string;
  message: string;
  recommendation?: string;
  conflictWith?: { name: string; prescriptionId?: string };
  patientData?: Record<string, unknown>;
  guideline?: string;
  suggestedOrderSet?: string;
  /** 이 검사를 낸 DUR 룰(테이블 행 id) — 판정 기록(CdssLog.alerts)에 남는다 · 코드 규칙은 없음 */
  ruleId?: string;
}

export interface CdssResult {
  level: 'PASS' | 'INFO' | 'WARNING' | 'ERROR';
  passedChecks: number;
  totalChecks: number;
  checks: CdssCheck[];
}

/** 판정에 쓰이는 코드 규칙(편집 불가) — 화면 목록용 · `check()` 의 검사 순서와 같다 */
export const CDSS_CODE_RULES = CLINICAL_CODE_RULES.filter((r) => r.engine === 'CDSS').map((r) => r.emits); // 정본 shared clinical-code-rules

@Injectable()
export class CdssService {
  private readonly logger = new Logger(CdssService.name);

  constructor(
    private readonly prisma: PrismaService,
    // 🔴 룰 저장소는 **필수 주입**이다 — @Optional 로 두면 배선이 빠졌을 때 부팅은 성공하고
    //    "룰 0건 = 위반 없음"으로 조용히 통과한다(v4.4.0 DUR 43룰이 그렇게 죽어 있었다).
    private readonly rulesRepo: DurRulesRepo,
    @Optional() private readonly durService?: DurService,
  ) {}

  async check(params: {
    patientId: string;
    medicationCodeId?: string;
    procedureCodeId?: string;
    dosage?: string;
    frequency?: string;
    duration?: number;
    route?: string;
    encounterId?: string;
    /** CPOE 게이트 경유 시 true — DUR은 처방 경로에서 이미 별도 차단되어 중복 실행하지 않음 */
    skipDur?: boolean;
    /** override 감사 컨텍스트 — 경고를 무시하고 강제 진행한 주체·사유(CdssLog에 영속) */
    override?: { reason?: string; acknowledgerId?: string };
    /**
     * 기록 전용 진료 id(2026-10-21) — 판정 범위는 바꾸지 않고(DUR·진단·가이드라인 검사를 켜지 않는다) 판정 기록만 이 진료에 남긴다.
     * 진료 작성 화면 보완 배너는 DUR 패널과 겹치지 않으려고 `encounterId` 를 일부러 보내지 않는다 —
     * 그래서 주 처방 경로의 판정이 `CdssLog`(안전 게이트 관제 통계 원천)에 한 건도 남지 않았다(운영 0건).
     */
    logEncounterId?: string;
  }): Promise<CdssResult> {
    const checks: CdssCheck[] = [];
    /** DUR(상호작용·중복) 검사를 실제로 했는가 — 하지 않은 검사를 통과로 말하지 않는다 */
    let durRan = false;

    // 환자 정보 로드
    const patient = await this.prisma.patient.findUnique({
      where: { id: params.patientId },
      select: { id: true, dateOfBirth: true, gender: true, familyName: true, givenName: true },
    });

    const age = patient?.dateOfBirth
      ? ageOf(patient.dateOfBirth)
      : null;

    // 약물 처방인 경우
    if (params.medicationCodeId) {
      const med = await this.prisma.medicationCode.findUnique({
        where: { id: params.medicationCodeId },
      });

      if (med) {
        // 1. DUR 검증 (기존 서비스 활용)
        if (this.durService && params.encounterId && !params.skipDur) {
          durRan = true;
          const durWarnings = await this.durService.checkInteractions(
            params.encounterId, params.medicationCodeId, params.patientId,
          );
          if (durWarnings.length > 0) {
            for (const w of durWarnings) {
              checks.push({
                category: w.type === 'INTERACTION' ? 'INTERACTION' : w.type === 'DUPLICATE' ? 'DUPLICATE' : w.type === 'AGE_CONTRAINDICATION' ? 'AGE' : w.type === 'DOSE_EXCEEDED' ? 'DOSE' : w.type === 'ALLERGY' ? 'ALLERGY' : 'OTHER',
                level: w.severity === 'ERROR' ? 'ERROR' : 'WARNING',
                title: this.getCategoryTitle(w.type),
                message: w.message,
                conflictWith: w.drugB ? { name: w.drugB } : undefined,
                ...(w.ruleId ? { ruleId: w.ruleId } : {}),
              });
            }
          } else {
            checks.push({ category: 'INTERACTION', level: 'PASS', title: '약물 상호작용', message: '병용금기/상호작용 해당 없음' });
          }
        }

        // 2. 알레르기 검증
        const allergies = await this.prisma.allergy.findMany({
          where: { patientId: params.patientId, isActive: true },
          select: { allergen: true, type: true, severity: true },
        });
        // 🔴 판정 표면 = DUR 정본과 동일한 3원(ingredient+nameKo+nameEn) 소문자.
        //    종전엔 ingredient 단일 필드였고 룰어는 한글이라 영문 성분(amoxicillin)에 닿지 않았다.
        const medHay = buildMedicationHay(med);
        const allergyMatch = allergies.find((a) => {
          const allergen = (a.allergen ?? '').trim().toLowerCase();
          // 빈 알레르겐은 includes('')=true 로 전 약물 오발동 — 거짓 경보 차단
          return a.type === 'DRUG' && !!allergen && medHay.includes(allergen);
        });
        if (allergyMatch) {
          checks.push({
            category: 'ALLERGY', level: 'ERROR',
            title: '알레르기 경고',
            message: `환자 알레르기: ${allergyMatch.allergen} (${allergyMatch.severity})`,
            recommendation: '대체 약물 사용 권고',
          });
        } else {
          checks.push({ category: 'ALLERGY', level: 'PASS', title: '알레르기 검증', message: '해당 알레르기 없음' });
        }

        // 3. 신기능 기반 용량 (최근 Creatinine/eGFR)
        const renalCheck = await this.checkRenalDosing(params.patientId, med.nameKo, medHay);
        checks.push(renalCheck);

        // 4. 연령 적합성
        if (age !== null) {
          const ageIssue = this.checkAgeAppropriateness(medHay, age);
          checks.push(ageIssue);
        }

        // 5. 중복 처방 (DUR에서 이미 처리되었으면 스킵)
        // 🔴 DUR 를 돌리지 않았으면(진료 맥락 없음·CPOE 게이트 경유) 중복을 본 적이 없다 — "없음(PASS)"을 지어내지 않는다(2026-10-21)
        if (durRan && !checks.some(c => c.category === 'DUPLICATE')) {
          checks.push({ category: 'DUPLICATE', level: 'PASS', title: '중복 처방', message: '동일/유사 약물 활성 처방 없음' });
        }
      }
    }

    // 6. 진단-처방 적합성
    if (params.encounterId) {
      const diagCheck = await this.checkDiagnosisAppropriateness(params.encounterId, params.medicationCodeId);
      checks.push(diagCheck);
    }

    // 7. 가이드라인 권고
    if (params.encounterId) {
      const guidelineCheck = await this.getGuidelineRecommendation(params.encounterId);
      if (guidelineCheck) checks.push(guidelineCheck);
    }

    // 전체 레벨 결정
    const hasError = checks.some(c => c.level === 'ERROR');
    const hasWarning = checks.some(c => c.level === 'WARNING');
    const overallLevel = hasError ? 'ERROR' : hasWarning ? 'WARNING' : checks.some(c => c.level === 'INFO') ? 'INFO' : 'PASS';

    const result: CdssResult = {
      level: overallLevel as CdssResult['level'],
      passedChecks: checks.filter(c => c.level === 'PASS').length,
      totalChecks: checks.length,
      checks,
    };

    // 검증 이력 저장 (비동기, 실패해도 검증 결과에 영향 없음)
    const logEncounterId = params.encounterId ?? params.logEncounterId;
    if (logEncounterId && params.patientId) {
      // 🔴 (K4) CdssLog 는 /admin/safety-gates 의 **통계 소스**다(safety-gate.service statsSource) —
      //    저장 실패를 삼키면 그 게이트의 위반 통계가 조용히 낮아진다. 검증 결과는 그대로 돌려주되 유실은 남긴다.
      this.saveCdssLog({ ...params, encounterId: logEncounterId }, result).catch((e) => {
        this.logger.error(`CDSS 검증 이력 저장 실패(관제 통계에서 누락됨) encounter=${logEncounterId}: ${(e as Error).message}`);
      });
    }

    return result;
  }

  /**
   * 처방세트(템플릿) 검증 — **환자에 매이지 않는 검사만** 한다.
   *
   * 🔴 처방세트 편집기의 "CDSS 검증" 버튼은 개통 이래 한 번도 결과를 받은 적이 없다.
   *    화면은 `{medications:[…]}` 를, 서버는 `patientId` 필수의 단일 약물 본문을 기대했다 —
   *    전역 whitelist 가 `medications` 를 지우고 `patientId` 부재로 **항상 400** 이었다.
   *
   * 여기서 할 수 있는 것 / 없는 것을 결과가 스스로 말한다:
   *  · 할 수 있다 — 세트 **안에서의** 병용금기(DUR interaction 룰)·동일 성분 중복
   *  · 할 수 없다 — 알레르기·신기능·연령·임부금기(전부 환자 1명이 정해져야 판정된다)
   *  🔴 못 한 검사를 "통과"로 그리지 않는다. 통과 배지 하나가 안 한 검사를 한 것처럼 보이게 한다.
   *  🔴 코드 미해석 항목(medicationCodeId 없음)은 **판정 대상에서 빠졌다는 사실**을 항목명과 함께 낸다.
   */
  async checkOrderSet(medications: { medicationCodeId?: string; name?: string }[]): Promise<CdssResult> {
    const checks: CdssCheck[] = [];

    const unresolved = medications.filter((m) => !m.medicationCodeId);
    const ids = Array.from(new Set(medications.map((m) => m.medicationCodeId).filter((v): v is string => !!v)));

    if (unresolved.length > 0) {
      checks.push({
        category: 'COVERAGE',
        level: 'WARNING',
        title: '판정 대상에서 빠진 항목',
        message: `약품 코드가 연결되지 않아 검증하지 못한 항목 ${unresolved.length}건: ${unresolved.map((m) => m.name?.trim() || '(이름 없음)').join(', ')}`,
        recommendation: '약품을 마스터에서 선택하면 병용금기·중복 검증 대상이 됩니다.',
      });
    }

    const meds = ids.length
      ? await this.prisma.medicationCode.findMany({
          where: { id: { in: ids } },
          select: { id: true, nameKo: true, nameEn: true, ingredient: true, ingredientCode: true },
        })
      : [];

    // 코드는 붙어 있는데 마스터에서 사라진 항목 — 조용히 빼면 분모가 거짓이 된다
    const missing = ids.length - meds.length;
    if (missing > 0) {
      checks.push({
        category: 'COVERAGE', level: 'WARNING', title: '약품 마스터 조회 실패',
        message: `연결된 약품 ${missing}건을 마스터에서 찾지 못했습니다 — 그만큼은 검증되지 않았습니다.`,
      });
    }

    if (meds.length < 2) {
      // 짝이 없으면 상호작용·중복은 "이상 없음"이 아니라 **잴 것이 없음**이다
      checks.push({
        category: 'INTERACTION', level: 'INFO', title: '병용 검증',
        message: meds.length === 0
          ? '검증 가능한 약물이 없습니다(마스터에 연결된 약물 0건).'
          : '검증 가능한 약물이 1건이라 병용금기·중복은 판정할 수 없습니다.',
      });
    } else {
      const hays = meds.map((m) => ({ med: m, hay: buildMedicationHay(m) }));
      const rules = await this.rulesRepo.getRuleSet();

      let interactionHits = 0;
      for (const rule of rules.interaction) {
        for (let i = 0; i < hays.length; i++) {
          for (let j = i + 1; j < hays.length; j++) {
            const a = hays[i], b = hays[j];
            const hit =
              (hayMatchesTerm(a.hay, rule.drugA) && hayMatchesTerm(b.hay, rule.drugB)) ||
              (hayMatchesTerm(a.hay, rule.drugB) && hayMatchesTerm(b.hay, rule.drugA));
            if (hit) {
              interactionHits++;
              checks.push({
                category: 'INTERACTION',
                level: rule.severity === 'ERROR' ? 'ERROR' : 'WARNING',
                title: '병용금기/상호작용',
                message: `${a.med.nameKo} + ${b.med.nameKo}: ${rule.message}`,
                conflictWith: { name: b.med.nameKo },
              });
            }
          }
        }
      }
      if (interactionHits === 0) {
        checks.push({ category: 'INTERACTION', level: 'PASS', title: '병용금기/상호작용', message: `세트 내 ${meds.length}건 조합에서 해당 룰 없음` });
      }

      // 동일 성분 중복 — 성분코드 우선(브랜드·염 변형에 견고), 코드가 없을 때만 성분명 정확일치
      let dupHits = 0;
      for (let i = 0; i < meds.length; i++) {
        for (let j = i + 1; j < meds.length; j++) {
          const a = meds[i], b = meds[j];
          const codeMatch = !!a.ingredientCode && !!b.ingredientCode && a.ingredientCode === b.ingredientCode;
          const nameMatch = !a.ingredientCode && !b.ingredientCode && !!a.ingredient && a.ingredient === b.ingredient;
          if (codeMatch || nameMatch) {
            dupHits++;
            checks.push({
              category: 'DUPLICATE', level: 'WARNING', title: '동일 성분 중복',
              message: `${a.nameKo} + ${b.nameKo}: 동일 성분(${a.ingredient || a.ingredientCode})이 세트에 두 번 있습니다.`,
              conflictWith: { name: b.nameKo },
            });
          }
        }
      }
      if (dupHits === 0) {
        checks.push({ category: 'DUPLICATE', level: 'PASS', title: '동일 성분 중복', message: '세트 내 동일 성분 중복 없음' });
      }
    }

    // 🔴 환자 의존 검사를 안 했다는 사실을 결과에 남긴다 — 초록만 보고 "다 봤다"고 읽지 않게.
    checks.push({
      category: 'SCOPE', level: 'INFO', title: '이 검증의 범위',
      message: '처방세트는 환자가 정해지지 않은 템플릿이라 알레르기·신기능·연령·임부금기는 판정하지 않았습니다. 환자별 검증은 처방 시점에 이뤄집니다.',
    });

    const passedChecks = checks.filter((c) => c.level === 'PASS').length;
    const level: CdssResult['level'] =
      checks.some((c) => c.level === 'ERROR') ? 'ERROR'
      : checks.some((c) => c.level === 'WARNING') ? 'WARNING'
      : checks.some((c) => c.level === 'PASS') ? 'PASS'
      : 'INFO';

    return { level, passedChecks, totalChecks: checks.length, checks };
  }

  private async saveCdssLog(
    params: { patientId: string; encounterId?: string; medicationCodeId?: string; override?: { reason?: string; acknowledgerId?: string } },
    result: CdssResult,
  ) {
    if (!params.encounterId) return;
    const encounter = await this.prisma.encounter.findUnique({
      where: { id: params.encounterId },
      select: { doctorId: true },
    });
    if (!encounter) return;

    // override 감사 — 경고(ERROR/WARNING)가 있는 상태에서 강제 진행한 경우만 overridden 기록
    const overridden = !!params.override && (result.level === 'ERROR' || result.level === 'WARNING');

    await this.prisma.cdssLog.create({
      data: {
        encounterId: params.encounterId,
        patientId: params.patientId,
        doctorId: encounter.doctorId,
        medicationCode: params.medicationCodeId,
        overallLevel: result.level,
        totalChecks: result.totalChecks,
        passedChecks: result.passedChecks,
        alerts: result.checks.filter(c => c.level !== 'PASS') as unknown as Prisma.InputJsonValue,
        overridden,
        overrideReason: overridden ? (params.override?.reason ?? '(사유 미입력)') : null,
        acknowledgerId: overridden ? (params.override?.acknowledgerId ?? null) : null,
      },
    });
  }

  // 진단 기반 처방세트 추천
  async suggestOrderSet(diagnosisCode: string, patientId: string) {
    const orderSets = await this.prisma.orderSet.findMany({
      where: { diagnosisCode, isActive: true },
      orderBy: { createdAt: 'desc' },
    });

    // 환자 맥락
    const [encounters, allergies] = await Promise.all([
      this.prisma.encounter.findMany({
        where: { patientId },
        select: { id: true },
        take: 1,
      }),
      this.prisma.allergy.findMany({
        where: { patientId, isActive: true },
        select: { allergen: true },
      }),
    ]);

    const isFirstVisit = encounters.length === 0;

    return {
      diagnosisCode,
      suggestedOrderSets: orderSets.map(os => ({
        code: os.name.match(/\[([^\]]+)\]/)?.[1] ?? '',
        name: os.name.replace(/\[[^\]]+\]\s*/, ''),
        matchScore: os.diagnosisCode === diagnosisCode ? 95 : 70,
        reason: `${diagnosisCode} 진단 매칭`,
        itemCount: Array.isArray(os.items) ? (os.items as any[]).length : 0,
      })),
      patientContext: {
        isFirstVisit,
        allergies: allergies.map(a => a.allergen),
      },
    };
  }

  // ── 내부 검증 메서드 ──

  /** @param medHay 약품 매칭 표면(ingredient+nameKo+nameEn 소문자) — buildMedicationHay 산출 */
  private async checkRenalDosing(patientId: string, drugName: string, medHay: string): Promise<CdssCheck> {
    // 최근 Creatinine 검사 결과 조회
    const recentLab = await this.prisma.labResultItem.findFirst({
      where: {
        labResult: { patientId },
        testName: { contains: 'Creatinine', mode: 'insensitive' },
      },
      orderBy: { labResult: { completedAt: 'desc' } },
      select: { value: true },
    });

    if (!recentLab) {
      return { category: 'RENAL', level: 'INFO', title: '신기능 기반 용량', message: '최근 Creatinine 검사 없음 — 신기능 확인 권고' };
    }

    const cr = parseFloat(recentLab.value);
    if (isNaN(cr)) {
      return { category: 'RENAL', level: 'PASS', title: '신기능 기반 용량', message: '신기능 데이터 확인 불가' };
    }

    // 간이 eGFR 계산 (CKD-EPI 간소화)
    const eGFR = Math.round(186 * Math.pow(cr, -1.154) * 0.742); // 간소화

    const renalDrugs = ['메트포르민', '가바펜틴', '에녹사파린', '시프로플록사신', '아목시실린'];
    const needsAdjust = renalDrugs.some((d) => hayMatchesTerm(medHay, d)) && eGFR < 60;

    if (needsAdjust) {
      return {
        category: 'RENAL', level: 'WARNING',
        title: '신기능 기반 용량 조절',
        message: `eGFR ${eGFR} mL/min — ${drugName} 용량 감량 필요`,
        recommendation: 'eGFR < 60: 용량 50% 감량 또는 투여 간격 연장',
        patientData: { eGFR, creatinine: cr },
      };
    }

    return {
      category: 'RENAL', level: 'PASS',
      title: '신기능 기반 용량',
      message: `eGFR ${eGFR} mL/min — 용량 조절 불필요`,
      patientData: { eGFR, creatinine: cr },
    };
  }

  /** @param medHay 약품 매칭 표면(buildMedicationHay 산출) */
  private checkAgeAppropriateness(medHay: string, age: number): CdssCheck {
    const rules = [
      { drug: '아스피린', maxAge: 18, msg: '18세 이하 아스피린 금기 (Reye 증후군)' },
      { drug: '테트라사이클린', maxAge: 8, msg: '8세 이하 금기 (치아 변색)' },
      { drug: '시프로플록사신', maxAge: 18, msg: '18세 이하 퀴놀론 주의 (연골 독성)' },
      { drug: '졸피뎀', minAge: 65, msg: '65세 이상 수면제 감량 필요' },
      { drug: '트라마돌', maxAge: 12, msg: '12세 이하 트라마돌 금기' },
    ];

    for (const rule of rules) {
      if (!hayMatchesTerm(medHay, rule.drug)) continue;
      if (rule.maxAge && age <= rule.maxAge) {
        return { category: 'AGE', level: 'ERROR', title: '연령 금기', message: rule.msg };
      }
      if (rule.minAge && age >= rule.minAge) {
        return { category: 'AGE', level: 'WARNING', title: '연령 주의', message: rule.msg };
      }
    }

    return { category: 'AGE', level: 'PASS', title: '연령 적합성', message: `${age}세 — 사용 가능` };
  }

  private async checkDiagnosisAppropriateness(encounterId: string, medicationCodeId?: string): Promise<CdssCheck> {
    const encounter = await this.prisma.encounter.findUnique({
      where: { id: encounterId },
      include: { diagnoses: { include: { diagnosisCode: { select: { code: true, nameKo: true } } } } },
    });

    if (!encounter?.diagnoses?.length) {
      return { category: 'DIAGNOSIS', level: 'INFO', title: '진단-처방 적합성', message: '진단 미입력 — 진단 입력 후 검증 가능' };
    }

    const diagCodes = encounter.diagnoses.map(d => d.diagnosisCode.code);
    const diagNames = encounter.diagnoses.map(d => d.diagnosisCode.nameKo).join(', ');

    // 간단한 진단-약물 적합성 (확장 가능)
    const matchingCP = await this.prisma.orderSet.findFirst({
      where: { diagnosisCode: { in: diagCodes }, isActive: true },
    });

    if (matchingCP) {
      return {
        category: 'DIAGNOSIS', level: 'INFO',
        title: '진단-처방 적합성',
        message: `${diagNames} — 표준 처방세트 있음`,
        suggestedOrderSet: matchingCP.name.match(/\[([^\]]+)\]/)?.[1] ?? undefined,
      };
    }

    return { category: 'DIAGNOSIS', level: 'PASS', title: '진단-처방 적합성', message: `${diagNames}` };
  }

  private async getGuidelineRecommendation(encounterId: string): Promise<CdssCheck | null> {
    const encounter = await this.prisma.encounter.findUnique({
      where: { id: encounterId },
      include: { diagnoses: { include: { diagnosisCode: { select: { code: true } } } } },
    });

    if (!encounter?.diagnoses?.length) return null;

    const diagCodes = encounter.diagnoses.map(d => d.diagnosisCode.code);
    const matchingCPs = await this.prisma.orderSet.findMany({
      where: { diagnosisCode: { in: diagCodes }, isActive: true },
      take: 3,
    });

    if (matchingCPs.length > 0) {
      const cpNames = matchingCPs.map(cp => cp.name.match(/\[([^\]]+)\]/)?.[1] ?? cp.name).join(', ');
      return {
        category: 'GUIDELINE', level: 'INFO',
        title: '임상 가이드라인',
        message: `관련 약속처방: ${cpNames}`,
        suggestedOrderSet: matchingCPs[0].name.match(/\[([^\]]+)\]/)?.[1] ?? undefined,
      };
    }

    return null;
  }

  private getCategoryTitle(type: string): string {
    const map: Record<string, string> = {
      INTERACTION: '약물 상호작용', DUPLICATE: '중복 처방',
      AGE_CONTRAINDICATION: '연령 금기', DOSE_EXCEEDED: '용량 초과',
      PREGNANCY: '임신 주의', ALLERGY: '알레르기',
    };
    return map[type] ?? type;
  }

  // ── 규칙 CRUD ──

  async getRules(category?: string) {
    const where: Prisma.CdssRuleWhereInput = { isActive: true };
    if (category) where.category = category;
    return this.prisma.cdssRule.findMany({ where, orderBy: [{ category: 'asc' }, { hitCount: 'desc' }] });
  }

  async createRule(data: Prisma.CdssRuleCreateInput) {
    return this.prisma.cdssRule.create({ data });
  }

  async updateRule(id: string, data: Partial<Prisma.CdssRuleUncheckedUpdateInput> & { id?: string; createdAt?: unknown; updatedAt?: unknown }) {
    const { id: _, createdAt, updatedAt, ...updateData } = data;
    return this.prisma.cdssRule.update({ where: { id }, data: updateData });
  }

  async deleteRule(id: string) {
    return this.prisma.cdssRule.update({ where: { id }, data: { isActive: false } });
  }

  async getRuleStats() {
    const rules = await this.prisma.cdssRule.findMany({ where: { isActive: true } });
    const byCategory = rules.reduce((acc, r) => { acc[r.category] = (acc[r.category] || 0) + 1; return acc; }, {} as Record<string, number>);
    const topHits = rules.sort((a, b) => b.hitCount - a.hitCount).slice(0, 20).map(r => ({
      id: r.id, name: r.name, category: r.category, level: r.level, hitCount: r.hitCount,
    }));
    // 🔴 (2026-10-21 임상 규칙 교차검증 R1) 이 표(CdssRule)는 판정(`check`)이 읽지 않는다 — 판정은 코드 규칙 + DUR 룰.
    //    화면이 그 사실을 말하도록 엔진 사실을 함께 낸다 · 적중 수는 올리는 코드가 없어 계측되지 않는다(0 이 아니다).
    const durRules = await this.prisma.durRule.count({ where: { isActive: true } }).catch(() => null);
    return {
      totalRules: rules.length, byCategory, topHits,
      engine: { readsThisTable: false as const, hitsMeasured: false as const, durRulesActive: durRules, codeRules: CDSS_CODE_RULES },
    };
  }

  // ── 검증 이력 ──

  async getLogs(patientId?: string, level?: string) {
    const where: Record<string, unknown> = {};
    if (patientId) where.patientId = patientId;
    if (level) where.overallLevel = level;

    return this.prisma.cdssLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async getLogsByEncounter(encounterId: string) {
    return this.prisma.cdssLog.findMany({
      where: { encounterId },
      orderBy: { createdAt: 'desc' },
    });
  }
}
