import { Injectable, Optional, Inject, forwardRef } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AllergyService } from '../../allergy/allergy.service';
import { DurRulesRepo } from './dur-rules.repo';
import { buildMedicationHay, hayMatchesTerm } from './ingredient-terms';
import { ageOf } from '@hospital-run/shared';

export interface DurWarning {
  severity: 'ERROR' | 'WARNING' | 'INFO';
  type: 'INTERACTION' | 'DUPLICATE' | 'THERAPEUTIC_DUPLICATION' | 'AGE_CONTRAINDICATION' | 'DOSE_EXCEEDED' | 'PREGNANCY' | 'ALLERGY' | 'HIGH_ALERT' | 'LASA' | 'MAX_DOSE' | 'BEERS';
  message: string;
  drugA?: string;
  drugB?: string;
  /** 이 경고를 낸 DUR 룰(테이블 행 id) — 처방 원장 `dur_warnings` 에 함께 남아 룰별 적중을 센다(2026-10-21) · 코드 판정·폴백 룰은 없음 */
  ruleId?: string;
}

// 고위험 약물(ISMP High-Alert) 카테고리 한글 라벨
const HIGH_ALERT_LABELS: Record<string, string> = {
  ANTICOAGULANT: '항응고제', INSULIN: '인슐린', OPIOID: '마약성진통제',
  CHEMOTHERAPY: '항암제', NEUROMUSCULAR_BLOCKER: '신경근차단제',
  CONCENTRATED_ELECTROLYTE: '고농도전해질', SEDATIVE: '진정제', THROMBOLYTIC: '혈전용해제',
};

// 효능군 중복 판정에서 제외할 광범위/무의미 분류값 (오탐 방지)
const THERAPEUTIC_DUP_EXCLUDE = new Set(['기타', '일반', '해당없음']);

@Injectable()
export class DurService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rulesRepo: DurRulesRepo,
    @Optional() @Inject(forwardRef(() => AllergyService)) private readonly allergyService?: AllergyService,
  ) {}

  async checkInteractions(
    encounterId: string,
    newMedicationCodeId: string,
    patientId: string,
    // P2: MedicationCode.maxDailyDose(DB) 검사용 용법 컨텍스트 — 미전달 시 해당 검사만 생략(하위호환)
    doseCtx?: { dosage?: string | null; frequency?: string | null; excludePrescriptionIds?: string[] },
  ): Promise<DurWarning[]> {
    const warnings: DurWarning[] = [];

    const [newMed, patient, encounter] = await Promise.all([
      this.prisma.medicationCode.findUnique({ where: { id: newMedicationCodeId } }),
      this.prisma.patient.findUnique({ where: { id: patientId }, select: { dateOfBirth: true, allergies: true } }),
      this.prisma.encounter.findUnique({ where: { id: encounterId }, select: { pregnancyStatus: true } }),
    ]);
    if (!newMed) return warnings;

    // 0. 임부금기(FDA 임부투여 안전성) — 임신 중 환자에 카테고리 X(금기)/D(위험) 약물 경고. 🔴등급 데이터=식약처 공고 선결.
    if (encounter?.pregnancyStatus === 'PREGNANT' && newMed.pregnancyCategory) {
      const cat = newMed.pregnancyCategory.toUpperCase();
      if (cat === 'X') {
        warnings.push({ severity: 'ERROR', type: 'PREGNANCY', message: `임부금기(카테고리 X): ${newMed.nameKo} — 임신부 투여 금기`, drugA: newMed.nameKo });
      } else if (cat === 'D') {
        warnings.push({ severity: 'WARNING', type: 'PREGNANCY', message: `임부주의(카테고리 D): ${newMed.nameKo} — 임신부 위험(유익성 우선 시에만)`, drugA: newMed.nameKo });
      }
    }

    // Calculate patient age
    // 🔴 나이 정본 `ageOf` 를 쓴다. 종전엔 같은 계산을 여기 다시 적었고,
    //    정본이 거르는 **미래 생년월일·150세 초과**를 걸러내지 못했다 —
    //    그 값이 DUR 연령 금기 규칙에 그대로 들어간다(음수 나이·비현실 나이).
    //    정본은 그런 값을 `null`(나이 미상)로 답한다.
    const patientAge: number | null = ageOf(patient?.dateOfBirth ?? null);

    // 1. Get existing prescriptions
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const [currentRx, recentRx] = await Promise.all([
      this.prisma.prescription.findMany({
        // 갱신(2026-09-30)은 이어받을 원처방을 비교 대상에서 뺀다 — 빼지 않으면 같은 약이 '중복 처방'으로 막힌다
        where: { encounterId, type: 'MEDICATION', status: 'ACTIVE', ...(doseCtx?.excludePrescriptionIds?.length ? { id: { notIn: doseCtx.excludePrescriptionIds } } : {}) },
        include: { medicationCode: true },
      }),
      this.prisma.prescription.findMany({
        where: {
          encounter: { patientId },
          encounterId: { not: encounterId },
          type: 'MEDICATION', status: 'ACTIVE',
          createdAt: { gte: thirtyDaysAgo },
        },
        include: { medicationCode: true },
      }),
    ]);

    const allExisting = [...currentRx, ...recentRx];
    const newIngredient = newMed.ingredient ?? '';
    // 🔴 룰 매칭 표면 — ingredient 단일 필드가 아니라 검색 정본과 같은 3원(ingredient+nameKo+nameEn) 소문자.
    //    종전엔 ingredient 만·대소문자 구분이라 한글 룰(와파린)이 영문 성분(warfarin sodium)에 영원히 닿지 않았다.
    //    BEERS 룰만 이 방식을 써서 유일하게 살아 있었다 — 그 방식을 전 룰 타입으로 승격한 것이 ingredient-terms.ts.
    const newHay = buildMedicationHay(newMed);

    // 2. Duplicate check — 🔴주성분코드(ingredientCode) 우선(브랜드/염 변형에 견고), 코드 없을 때만 성분명 fallback.
    const newCode = newMed.ingredientCode ?? null;
    for (const existing of allExisting) {
      if (existing.medicationCodeId === newMedicationCodeId) continue;
      const exCode = existing.medicationCode?.ingredientCode ?? null;
      const codeMatch = !!newCode && !!exCode && newCode === exCode;
      // 새 약에 코드가 없을 때만 이름 정확일치로 보조 판정(오탐 방지: 코드 있으면 코드로만 판단)
      const nameMatch = !newCode && !!newIngredient && existing.medicationCode?.ingredient === newIngredient;
      if (codeMatch || nameMatch) {
        warnings.push({
          severity: 'WARNING', type: 'DUPLICATE',
          message: `동일 성분(${newIngredient || newCode}) 중복 처방: ${existing.medicationCode?.nameKo}`,
          drugA: newMed.nameKo, drugB: existing.medicationCode?.nameKo,
        });
      }
    }

    // 2b. 효능군(약효분류) 중복 — 동일 category 내 다른 성분 병용 (분류 데이터 21,914건 기반).
    //     동일성분 중복(2)과 이중 경고 방지: 성분코드가 다른 경우만.
    if (newMed.category && !THERAPEUTIC_DUP_EXCLUDE.has(newMed.category)) {
      const dupClass = allExisting.find((ex) =>
        ex.medicationCodeId !== newMedicationCodeId &&
        ex.medicationCode?.category === newMed.category &&
        (ex.medicationCode?.ingredientCode ?? ex.medicationCode?.ingredient ?? null) !==
          (newMed.ingredientCode ?? newMed.ingredient ?? null),
      );
      if (dupClass) {
        warnings.push({
          severity: 'WARNING', type: 'THERAPEUTIC_DUPLICATION',
          message: `효능군 중복(${newMed.category}): ${dupClass.medicationCode?.nameKo}와 동일 약효분류 병용`,
          drugA: newMed.nameKo, drugB: dupClass.medicationCode?.nameKo ?? undefined,
        });
      }
    }

    // 룰 정본 로드(테이블·캐시·폴백) — 판정 로직은 불변, 데이터 소스만 교체(P0-a)
    const durRules = await this.rulesRepo.getRuleSet();

    // 3. Drug interaction check
    const existingHays = allExisting.map((p) => buildMedicationHay(p.medicationCode)).filter(Boolean);
    for (const rule of durRules.interaction) {
      const matchA = hayMatchesTerm(newHay, rule.drugA) && existingHays.some((h) => hayMatchesTerm(h, rule.drugB));
      const matchB = hayMatchesTerm(newHay, rule.drugB) && existingHays.some((h) => hayMatchesTerm(h, rule.drugA));
      if (matchA || matchB) {
        warnings.push({ severity: rule.severity, type: 'INTERACTION', message: rule.message, drugA: rule.drugA, drugB: rule.drugB, ...(rule.ruleId ? { ruleId: rule.ruleId } : {}) });
      }
    }

    // 4. Age contraindication check
    if (patientAge !== null) {
      for (const rule of durRules.age) {
        if (!hayMatchesTerm(newHay, rule.ingredient)) continue;
        if (rule.maxAge !== undefined && patientAge <= rule.maxAge) {
          warnings.push({ severity: rule.severity, type: 'AGE_CONTRAINDICATION', message: `${rule.message} (환자 나이: ${patientAge}세)`, ...(rule.ruleId ? { ruleId: rule.ruleId } : {}) });
        }
        if (rule.minAge !== undefined && patientAge >= rule.minAge) {
          warnings.push({ severity: rule.severity, type: 'AGE_CONTRAINDICATION', message: `${rule.message} (환자 나이: ${patientAge}세)`, ...(rule.ruleId ? { ruleId: rule.ruleId } : {}) });
        }
      }
    }

    // 4b. Beers Criteria — 노인(≥65세) 부적절 약물 (성분 영문+한글명 병행 매칭)
    // 한/영 병용 P3(D4): hay 3원(ingredient+nameKo+nameEn) — 설계 의도 복원. 기존 매칭은 불변(추가 필드는 OR 확장만)
    if (patientAge !== null && patientAge >= 65) {
      for (const rule of durRules.beers) {
        if (rule.keywords.some((k) => newHay.includes(k.toLowerCase()))) {
          warnings.push({
            severity: 'WARNING', type: 'BEERS',
            message: `노인주의(Beers): ${rule.message} (환자 ${patientAge}세)`,
            drugA: newMed.nameKo,
            ...(rule.ruleId ? { ruleId: rule.ruleId } : {}),
          });
          break; // 약물당 1건
        }
      }
    }

    // 5. 성분별 일일 상한(룰 정본 DOSE_LIMITS) — **룰이 들고 있는 maxDailyDose 를 실제 처방 용법과 대조**한다.
    //    🔴 종전엔 성분이 일치하기만 하면 무조건 WARNING 을 띄웠다(대조 없음). 매칭이 죽어 있어 실운영에서
    //       뜬 적이 없었는데, 매칭을 살리면 아세트아미노펜 처방 전건(운영 활성 55건)에 상시 경고가 붙는다.
    //       거짓 경보는 진짜 경보를 죽인다 → 판정 가능한 경우 초과만 경고하고, 이내면 안내(INFO)로 낮춘다.
    //    용법을 못 읽으면 종전대로 '용량 확인' WARNING(모르는 것을 안전하다고 말하지 않는다).
    for (const limit of durRules.maxDose) {
      if (!hayMatchesTerm(newHay, limit.ingredient)) continue;
      const unitIsMg = (limit.unit ?? 'mg').toLowerCase() === 'mg';
      const dm = unitIsMg ? doseCtx?.dosage?.match(/(\d+(?:\.\d+)?)\s*mg/i) : null;
      const fm = (doseCtx?.frequency ?? '').match(/(\d+)\s*회/);
      const perDose = dm ? parseFloat(dm[1]) : null;
      const timesPerDay = fm ? parseInt(fm[1], 10) : null;
      const totalDaily = perDose != null && timesPerDay != null && timesPerDay > 0 ? perDose * timesPerDay : null;
      if (totalDaily == null || !(limit.maxDailyDose > 0)) {
        warnings.push({ severity: 'WARNING', type: 'DOSE_EXCEEDED', message: `용량 확인: ${limit.message}`, ...(limit.ruleId ? { ruleId: limit.ruleId } : {}) });
      } else if (totalDaily > limit.maxDailyDose) {
        warnings.push({
          severity: 'ERROR', type: 'MAX_DOSE',
          message: `일일 최대용량 초과: ${limit.ingredient} ${totalDaily}${limit.unit}/일 > 상한 ${limit.maxDailyDose}${limit.unit}/일 — ${limit.message}`,
          drugA: newMed.nameKo,
          ...(limit.ruleId ? { ruleId: limit.ruleId } : {}),
        });
      } else {
        warnings.push({
          severity: 'INFO', type: 'DOSE_EXCEEDED',
          message: `용량 확인: ${limit.ingredient} ${totalDaily}${limit.unit}/일 (상한 ${limit.maxDailyDose}${limit.unit}/일 이내)`,
          ...(limit.ruleId ? { ruleId: limit.ruleId } : {}),
        });
      }
    }

    // 5b. 일일 최대용량 — MedicationCode.maxDailyDose(DB) × 처방 용법 기반.
    //     🔴 등급 데이터는 식약처 공고 임포트 선결(현재 0건 — 데이터 적재 시 자동 활성). 용법 파싱 실패 시 생략.
    if (newMed.maxDailyDose && doseCtx?.dosage) {
      const doseMatch = doseCtx.dosage.match(/(\d+(?:\.\d+)?)\s*mg/i);
      const freqMatch = (doseCtx.frequency ?? '').match(/(\d+)\s*회/);
      const perDose = doseMatch ? parseFloat(doseMatch[1]) : null;
      const timesPerDay = freqMatch ? parseInt(freqMatch[1], 10) : 1;
      if (perDose && timesPerDay > 0) {
        const totalDaily = perDose * timesPerDay;
        const maxDaily = Number(newMed.maxDailyDose);
        if (maxDaily > 0 && totalDaily > maxDaily) {
          warnings.push({
            severity: 'ERROR', type: 'MAX_DOSE',
            message: `일일 최대용량 초과: ${newMed.nameKo} ${totalDaily}mg/일 > 허가 최대 ${maxDaily}mg/일`,
            drugA: newMed.nameKo,
          });
        }
      }
    }

    // 6. Pediatric weight-based dose check (소아 체중기반 용량)
    if (patientAge !== null && patientAge < 18) {
      const patientEncounter = await this.prisma.encounter.findFirst({
        where: { patientId },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      });
      const latestVitals = patientEncounter ? await this.prisma.preVisitVitals.findFirst({
        where: { encounterId: patientEncounter.id },
        orderBy: { measuredAt: 'desc' },
        select: { weight: true },
      }) : null;
      const weight = latestVitals?.weight ? Number(latestVitals.weight) : null;

      for (const rule of durRules.pediatric) {
        if (!hayMatchesTerm(newHay, rule.ingredient)) continue;

        if (weight && weight > 0) {
          const maxDailyForWeight = Math.min(
            rule.maxPerKgDay * weight,
            rule.maxAbsolute ?? Infinity,
          );
          // 실제 처방 용량 대조 — 상한 안내에 그치지 않고 초과 시 차단 승격(소아 과량투약 방지).
          //  단위가 mg인 규칙만 대조(dosage 파싱이 mg 기준). 성분별 규칙 단위 불일치 오판 차단.
          const rxDoseMatch = rule.unit === 'mg' ? doseCtx?.dosage?.match(/(\d+(?:\.\d+)?)\s*mg/i) : null;
          const rxFreqMatch = (doseCtx?.frequency ?? '').match(/(\d+)\s*회/);
          const rxPerDose = rxDoseMatch ? parseFloat(rxDoseMatch[1]) : null;
          const rxTimesPerDay = rxFreqMatch ? parseInt(rxFreqMatch[1], 10) : 1;
          const rxTotalDaily = rxPerDose && rxTimesPerDay > 0 ? rxPerDose * rxTimesPerDay : null;
          if (rxTotalDaily != null && rxTotalDaily > maxDailyForWeight) {
            warnings.push({
              severity: 'ERROR', type: 'DOSE_EXCEEDED',
              message: `소아 체중기반 최대용량 초과: ${rule.ingredient} 처방 ${rxTotalDaily}mg/일 > 이 환자(${weight}kg) 최대 ${Math.round(maxDailyForWeight)}mg/일`,
              drugA: newMed.nameKo,
              ...(rule.ruleId ? { ruleId: rule.ruleId } : {}),
            });
          } else {
            warnings.push({
              severity: 'INFO', type: 'DOSE_EXCEEDED',
              message: `소아 체중기반 용량: ${rule.ingredient} 최대 ${rule.maxPerKgDay}${rule.unit}/kg/일 → 이 환자(${weight}kg) 최대 ${Math.round(maxDailyForWeight)}${rule.unit}/일`,
              ...(rule.ruleId ? { ruleId: rule.ruleId } : {}),
            });
          }
        } else {
          warnings.push({
            severity: 'WARNING', type: 'DOSE_EXCEEDED',
            message: `소아 환자(${patientAge}세) 체중 미기록 — ${rule.ingredient} 체중기반 용량 확인 필요 (${rule.maxPerKgDay}${rule.unit}/kg/일)`,
            ...(rule.ruleId ? { ruleId: rule.ruleId } : {}),
          });
        }
      }
    }

    // 7. Allergy check — 구조화 Allergy 모델 + 레거시 JSON 을 반드시 UNION.
    // ⚠ 등록 UI(POST /patients)는 Patient.allergies JSON에만 기록하고 구조화 Allergy 행을
    // 만들지 않으므로, either/or(폴백)로 두면 등록 시 입력한 알레르기가 DUR에 안 보임(생명직결).
    // 둘 다 확인하고 (성분코드+성분명 매칭) 중복 메시지는 dedup.
    const allergySeen = new Set<string>();
    if (this.allergyService) {
      const allergyWarnings = await this.allergyService.checkDrugAllergy(patientId, newMedicationCodeId);
      for (const w of allergyWarnings) {
        const k = `${w.type}:${w.drugA ?? ''}`;
        if (allergySeen.has(k)) continue;
        allergySeen.add(k);
        warnings.push(w);
      }
    }
    if (patient?.allergies) {
      // 레거시: Patient.allergies JSON 기반 — 등록 UI가 여기에만 쓰므로 항상 병행 확인.
      try {
        const allergies: string[] = typeof patient.allergies === 'string'
          ? JSON.parse(patient.allergies) : (patient.allergies as string[]);
        const ing = (newIngredient ?? '').toLowerCase();
        const nm = (newMed.nameKo ?? '').toLowerCase();
        for (const raw of allergies) {
          const allergy = String(raw ?? '').trim();
          if (!allergy) continue; // 빈 항목이 모든 약물에 매칭되는 것 방지
          const a = allergy.toLowerCase();
          const matched = (ing && ing.includes(a)) || (nm && nm.includes(a)) || (a && ing && a.includes(ing));
          if (!matched) continue;
          const k = `ALLERGY:${allergy}`;
          if (allergySeen.has(k)) continue;
          allergySeen.add(k);
          warnings.push({ severity: 'ERROR', type: 'ALLERGY', message: `환자 알레르기 성분(등록): ${allergy}`, drugA: allergy });
        }
      } catch {}
    }

    // 8. 고위험 약물(High-Alert Medication) — IPSG.3
    if (newMed.highAlertFlag) {
      const cat = newMed.highAlertCategory ? HIGH_ALERT_LABELS[newMed.highAlertCategory] ?? newMed.highAlertCategory : '고위험';
      warnings.push({
        severity: 'WARNING', type: 'HIGH_ALERT',
        message: `⚠ 고위험 약물(${cat}): 투약 전 이중확인(Two-person check) 필요`,
        drugA: newMed.nameKo,
      });
    }

    // 9. 유사명칭/유사외관(LASA) 약물 — IPSG.3
    if (newMed.lasaGroup) {
      const lasaSimilar = await this.prisma.medicationCode.findMany({
        where: { lasaGroup: newMed.lasaGroup, id: { not: newMed.id } },
        select: { nameKo: true }, take: 5,
      });
      if (lasaSimilar.length > 0) {
        warnings.push({
          severity: 'WARNING', type: 'LASA',
          message: `유사명칭(LASA) 약물 주의 — 혼동 가능: ${lasaSimilar.map((s) => s.nameKo).join(', ')}`,
          drugA: newMed.nameKo,
        });
      }
    }

    return warnings;
  }
}
