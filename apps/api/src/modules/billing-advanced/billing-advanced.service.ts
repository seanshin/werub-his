import { Injectable, Optional } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { InsuranceType } from '@prisma/client';
import { EligibilityService, isReducedCopay } from '../eligibility/eligibility.service';
import { consultationCodeFor, readInstitutionGrade } from '../billing/consultation-code';
import { TierPriceService } from '../billing/tier-price.service';

// 수가 계산 방식
type FeeSystem = 'FFS' | 'DRG'; // Fee-For-Service (행위별), Diagnosis Related Group (포괄)

@Injectable()
export class BillingAdvancedService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eligibility: EligibilityService,
    /** 청구 단가 = 고시 종별 단가(종별 명시 설정 때만 · 2026-10-20) — 미주입이면 수가 마스터 */
    @Optional() private readonly tierPrice?: TierPriceService,
  ) {}

  /**
   * 행위별 수가 계산 (FFS — Fee For Service)
   * 각 행위/약제/재료의 개별 수가를 합산
   */
  async calculateFFS(encounterId: string) {
    const encounter = await this.prisma.encounter.findUnique({
      where: { id: encounterId },
      include: {
        prescriptions: { where: { status: 'ACTIVE' }, include: { medicationCode: true, procedureCode: true } },
        patient: { select: { id: true, insuranceType: true } },
        appointment: { select: { type: true } },
      },
    });
    if (!encounter) return null;
    await this.tierPrice?.apply(encounter.prescriptions.map((rx) => rx.procedureCode)); // 실청구와 같은 종별 단가

    const items: { code: string; name: string; category: string; unitPrice: number; quantity: number; days: number; amount: number; copayRate: number }[] = [];

    // 🔴 본인부담률 정본 — 자격(의료급여·산재·자보 등)을 반영한다. 종전엔 flat 0.3/코드율만 써서
    //    비-건보 환자에게 30% 견적을 보여줬다(정본 우회). 우선순위: 감면자격 > 코드특례(고시) > 자격기본.
    const elig = await this.eligibility.resolveCopayRate(
      encounter.patient.id, (encounter.patient.insuranceType ?? 'NHI') as InsuranceType, 'OUTPATIENT',
    );
    const reduced = isReducedCopay(elig.copayCategory);
    // 감면 자격이면 자격율이 코드특례를 이긴다(MRI 80% 도 의료급여 앞에선 감면율). 아니면 코드특례 우선.
    const rateFor = (codeRate: number | null | undefined) => reduced ? elig.rate : (codeRate ?? elig.rate);

    // 진찰료
    // 🔴 (2026-10-20) 종별 정본(`billing.institution.grade`)을 따른다 — 종전 상급종합 코드 고정
    const consultCode = consultationCodeFor(await readInstitutionGrade(this.prisma), encounter.appointment?.type === 'INITIAL');
    const asOf = new Date();
    const consult = consultCode == null ? null : await this.prisma.procedureCode.findFirst({
      where: { code: consultCode, validFrom: { lte: asOf }, OR: [{ validTo: null }, { validTo: { gte: asOf } }] },
      orderBy: { validFrom: 'desc' },
    });
    await this.tierPrice?.apply([consult]);
    if (consult) items.push({ code: consult.code, name: consult.nameKo, category: '진찰료', unitPrice: consult.unitPrice ?? 0, quantity: 1, days: 1, amount: consult.unitPrice ?? 0, copayRate: rateFor(consult.copayRate != null ? Number(consult.copayRate) : null) });

    // 처방별
    for (const rx of encounter.prescriptions) {
      if (rx.medicationCode) {
        const qty = rx.quantity ?? 1;
        const days = rx.duration ?? 1;
        const amount = (rx.medicationCode.unitPrice ?? 0) * qty;
        items.push({ code: rx.medicationCode.code, name: rx.medicationCode.nameKo, category: '약제비', unitPrice: rx.medicationCode.unitPrice ?? 0, quantity: qty, days, amount, copayRate: rateFor(null) }); // 약제는 코드특례 없음 → 자격율
      }
      if (rx.procedureCode) {
        const amount = rx.procedureCode.unitPrice ?? 0;
        items.push({ code: rx.procedureCode.code, name: rx.procedureCode.nameKo, category: rx.type === 'LAB' ? '검사료' : '영상료', unitPrice: amount, quantity: 1, days: 1, amount, copayRate: rateFor(rx.procedureCode.copayRate != null ? Number(rx.procedureCode.copayRate) : null) });
      }
    }

    const totalAmount = items.reduce((s, i) => s + i.amount, 0);
    const patientCopay = items.reduce((s, i) => s + Math.round(i.amount * i.copayRate), 0);

    return { feeSystem: 'FFS' as FeeSystem, items, totalAmount, insuranceCovered: totalAmount - patientCopay, patientCopay };
  }

  /**
   * DRG 포괄수가 계산 (간이 — 실제로는 복잡한 분류체계 필요)
   */
  async calculateDRG(encounterId: string, drgCode: string) {
    // DRG 포괄수가표에서 금액 조회 (MVP: 하드코딩 예시)
    const DRG_TABLE: Record<string, number> = {
      'G01': 500000,  // 단순 위장질환
      'G02': 800000,  // 복잡 위장질환
      'H01': 1200000, // 단순 호흡기
      'I01': 3000000, // 단순 수술
    };
    const amount = DRG_TABLE[drgCode] ?? 0;
    // 🔴 DRG 포괄수가 본인부담도 자격 반영(종전 flat 30% — 의료급여/산재/자보 과다 견적).
    const enc = await this.prisma.encounter.findUnique({ where: { id: encounterId }, select: { patientId: true, patient: { select: { insuranceType: true } } } });
    const rate = enc
      ? (await this.eligibility.resolveCopayRate(enc.patientId, (enc.patient?.insuranceType ?? 'NHI') as InsuranceType, 'INPATIENT')).rate
      : 0.3;
    const patientCopay = Math.round(amount * rate);
    return { feeSystem: 'DRG' as FeeSystem, drgCode, totalAmount: amount, insuranceCovered: amount - patientCopay, patientCopay };
  }
}
