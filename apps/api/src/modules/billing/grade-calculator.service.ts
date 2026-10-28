/**
 * 요양기관 종별 계산기(2026-10-20 · 사용자 지시 "병원 종별 처리되는 계산기를 만들어서 탑재").
 *
 * 같은 진료(진찰료 + 수가 코드·수량)를 의원·병원·종합병원·상급종합으로 나란히 센다.
 *  · 단가 = 수가 고시 종별 단가(`procedure_fees` · shared `gazetteFeeOf`) — 🔴 고시 0 = 그 종별 미산정(0원 아님) · 없으면 모름
 *  · 진찰료 코드 = 종별 정본(shared `CONSULTATION_FEE_CODES_BY_GRADE`)
 *  · 본인부담 = 실청구와 같은 규칙 — 자격 기본율(EligibilityService.copayRateFor) · 감면 자격 > 코드 특례(수가 마스터 copayRate) ·
 *    비급여 전액 · 의료급여 외래 정액은 종별별(BillingService.patientCopayForGrade)
 *  · 🔴 실청구와 다른 점을 숨기지 않는다 — 줄마다 "지금 설정에서 실청구가 쓰는 단가"(종별 명시 설정이면 고시 종별 단가 · 미설정이면 수가 마스터)를 함께 싣는다
 *  · 건강보험 외래 본인부담률 = 종별 차등 설정이 있으면 그 종별의 율, 없으면 단일 율(실청구와 같은 함수 `copayRateFor(…, grade)` · 법정 율을 지어내지 않는다)
 * 계산만 한다 — 아무것도 저장하지 않는다.
 */
import { Injectable } from '@nestjs/common';
import {
  CONSULTATION_FEE_CODES_BY_GRADE, INSTITUTION_GRADES, gazetteFeeOf,
  type GazetteFeeBasis, type InstitutionGrade,
} from '@hospital-run/shared';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { EligibilityService, isReducedCopay } from '../eligibility/eligibility.service';
import { BillingService } from './billing.service';
import { readInstitutionGrade } from './consultation-code';
import { TierPriceService } from './tier-price.service';
import { NHI_OUTPATIENT_BY_GRADE_KEY, parseGradeRates } from '@hospital-run/shared';
import type { GradeCalculatorDto } from './dto/grade-calculator.dto';

export interface GradeCalcLine {
  code: string;
  name: string | null;
  role: 'CONSULTATION' | 'ITEM';
  quantity: number;
  unitPrice: number | null;
  amount: number | null;
  basis: GazetteFeeBasis | 'NO_GAZETTE_LOADED';
  covered: boolean | null;
  copayRate: number | null;
  /** 지금 설정에서 실청구가 쓰는 단가(종별 명시 설정 → 고시 종별 단가 · 미설정 → 수가 마스터 · 모르면 null) */
  billedUnitPrice: number | null;
}

/**
 * 계산 단서 — NO_GAZETTE(기준일 고시 없음) · GRADE_UNSET(종별 미설정 → 실청구는 의원) · GRADE_UNKNOWN(설정값 표 밖 · value=그 값) ·
 * NHI_SINGLE_RATE(건보 외래 율이 종별 구분 없는 설정 하나 · value=%) · NHI_GRADE_RATES(종별 차등 율 설정됨) ·
 * BILLED_PRICE(청구 단가 = 지금 설정 기준) · NOT_INCLUDED(상한·감면·가산·상급종합 진찰료 전액 본인부담 같은 세부 규칙 미포함)
 */
export interface GradeCalcCaveat { code: 'NO_GAZETTE' | 'GRADE_UNSET' | 'GRADE_UNKNOWN' | 'NHI_SINGLE_RATE' | 'NHI_GRADE_RATES' | 'BILLED_PRICE' | 'NOT_INCLUDED'; value?: string }

@Injectable()
export class GradeCalculatorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eligibility: EligibilityService,
    private readonly billing: BillingService,
    private readonly tierPrice: TierPriceService,
  ) {}

  private async readByGrade(): Promise<unknown> {
    const row = await this.prisma.systemConfig.findUnique({ where: { key: NHI_OUTPATIENT_BY_GRADE_KEY }, select: { value: true } });
    return row?.value ?? null;
  }

  async calculate(dto: GradeCalculatorDto) {
    const at = dto.onDate ? new Date(`${dto.onDate}T00:00:00.000Z`) : new Date();
    const grades = (dto.grades?.length ? INSTITUTION_GRADES.filter((g) => dto.grades!.includes(g)) : [...INSTITUTION_GRADES]) as InstitutionGrade[];
    const configuredRaw = await readInstitutionGrade(this.prisma);
    const configuredGrade = typeof configuredRaw === 'string' && (INSTITUTION_GRADES as readonly string[]).includes(configuredRaw.toUpperCase())
      ? (configuredRaw.toUpperCase() as InstitutionGrade) : null;

    const itemCodes = [...new Set(dto.items.map((i) => i.code.trim().toUpperCase()))];
    const consultCodes = dto.visitKind === 'NONE' ? [] : grades.map((g) => CONSULTATION_FEE_CODES_BY_GRADE[g][dto.visitKind === 'INITIAL' ? 'initial' : 'followUp']);
    const allCodes = [...new Set([...itemCodes, ...consultCodes])];

    const covering = await this.prisma.procedureFee.findFirst({
      where: { validFrom: { lte: at }, OR: [{ validTo: null }, { validTo: { gte: at } }] },
      orderBy: { validFrom: 'desc' },
      select: { validFrom: true },
    });
    const [fees, masters] = await Promise.all([
      covering && allCodes.length
        ? this.prisma.procedureFee.findMany({ where: { code: { in: allCodes }, validFrom: covering.validFrom }, select: { code: true, nameKo: true, priceClinic: true, priceHospital: true, benefitType: true } })
        : Promise.resolve([]),
      allCodes.length
        ? this.prisma.procedureCode.findMany({
            where: { code: { in: allCodes }, validFrom: { lte: at }, OR: [{ validTo: null }, { validTo: { gte: at } }] },
            orderBy: { validFrom: 'desc' },
            select: { code: true, nameKo: true, unitPrice: true, copayRate: true, insuranceCovered: true },
          })
        : Promise.resolve([]),
    ]);
    const feeBy = new Map(fees.map((f) => [f.code, f]));
    const masterBy = new Map<string, (typeof masters)[number]>();
    for (const m of masters) if (!masterBy.has(m.code)) masterBy.set(m.code, m); // 시점 최신 하나
    // 지금 설정에서 실청구가 쓰는 단가 — 실청구와 같은 서비스로(종별 명시 설정이면 고시 종별 단가 · 미설정이면 마스터 그대로)
    const billed = [...masterBy.values()].map((m) => ({ code: m.code, unitPrice: m.unitPrice }));
    await this.tierPrice.apply(billed, { at, grade: configuredGrade });
    const billedBy = new Map(billed.map((b) => [b.code, b.unitPrice]));

    const reduced = isReducedCopay(dto.copayCategory);
    const gradeRatesSet = dto.copayCategory === 'NHI' && parseGradeRates(await this.readByGrade()) != null;
    const rateBy = new Map<InstitutionGrade, number>();
    for (const g of grades) rateBy.set(g, await this.eligibility.copayRateFor(dto.copayCategory, 'OUTPATIENT', g));

    const lineOf = (code: string, quantity: number, role: GradeCalcLine['role'], grade: InstitutionGrade): GradeCalcLine => {
      const baseRate = rateBy.get(grade)!;
      const fee = feeBy.get(code);
      const master = masterBy.get(code);
      const g = covering ? gazetteFeeOf(fee, grade) : { price: null, basis: 'NO_GAZETTE_LOADED' as const };
      // 급여 여부: 수가 마스터가 정본(실청구와 같다) · 마스터에 없으면 고시 급여 구분 · 둘 다 모르면 null
      const covered = master ? master.insuranceCovered : fee?.benefitType ? fee.benefitType === '급여' : null;
      const codeRate = master?.copayRate != null ? Number(master.copayRate) : null;
      // 우선순위 정본: 비급여 > 감면 자격 > 코드별 특례 > 자격 기본율(CLAUDE.md §본인부담)
      const copayRate = covered === null ? null : !covered ? 1 : reduced ? baseRate : (codeRate ?? baseRate);
      return {
        code, role, quantity,
        name: fee?.nameKo ?? master?.nameKo ?? null,
        unitPrice: g.price,
        amount: g.price != null ? g.price * quantity : null,
        basis: g.basis,
        covered,
        copayRate,
        billedUnitPrice: master ? (billedBy.get(code) ?? null) : null,
      };
    };

    const results = [];
    for (const grade of grades) {
      const lines: GradeCalcLine[] = [];
      if (dto.visitKind !== 'NONE') lines.push(lineOf(CONSULTATION_FEE_CODES_BY_GRADE[grade][dto.visitKind === 'INITIAL' ? 'initial' : 'followUp'], 1, 'CONSULTATION', grade));
      for (const it of dto.items) lines.push(lineOf(it.code.trim().toUpperCase(), it.quantity, 'ITEM', grade));
      const known = lines.filter((l) => l.amount != null && l.copayRate != null);
      const totalAmount = known.reduce((s, l) => s + l.amount!, 0);
      const patientCopay = known.length
        ? await this.billing.patientCopayForGrade(known.map((l) => ({ amount: l.amount!, copayRate: l.copayRate! })), dto.copayCategory, totalAmount, grade)
        : null;
      results.push({
        grade,
        isConfigured: configuredGrade === grade,
        /** 이 종별의 자격 기본 본인부담률(건보 외래는 종별 차등 설정이 있으면 그 율) */
        baseCopayRate: rateBy.get(grade)!,
        lines,
        totalAmount: known.length ? totalAmount : null,
        patientCopay,
        insurerAmount: patientCopay != null ? totalAmount - patientCopay : null,
        /** 금액을 모르는 줄(미산정·미등재·급여 여부 모름) — 합계에서 뺐다 */
        excludedLines: lines.length - known.length,
        /** 이 종별 고시 단가와 지금 실청구 단가가 다른 줄 */
        billedMismatchLines: lines.filter((l) => l.unitPrice != null && l.billedUnitPrice != null && l.unitPrice !== l.billedUnitPrice).length,
      });
    }

    // 단서는 코드(+값)로만 내려보낸다 — 문장은 화면이 조립한다(서버 조립 한국어 문장 가드)
    const caveats: GradeCalcCaveat[] = [];
    if (!covering) caveats.push({ code: 'NO_GAZETTE' });
    if (!configuredGrade) caveats.push(configuredRaw == null ? { code: 'GRADE_UNSET' } : { code: 'GRADE_UNKNOWN', value: String(configuredRaw) });
    if (dto.copayCategory === 'NHI') {
      caveats.push(gradeRatesSet ? { code: 'NHI_GRADE_RATES' } : { code: 'NHI_SINGLE_RATE', value: String(Math.round(rateBy.get(grades[0])! * 100)) });
    }
    caveats.push({ code: 'BILLED_PRICE' });
    caveats.push({ code: 'NOT_INCLUDED' });

    return {
      onDate: at.toISOString().slice(0, 10),
      gazetteEffectiveDate: covering ? covering.validFrom.toISOString().slice(0, 10) : null,
      configuredGrade,
      copayCategory: dto.copayCategory,
      results,
      caveats,
    };
  }
}
