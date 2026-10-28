/**
 * 🔴 W8 R3 가드 — 수납 계산기 본인부담률·약가 미등재(C3·C5).
 *
 * 원 결함(2026-08-14 실측):
 *  - 수납 계산기(`BillingService.calculateBilling`)가 `InsuranceType` 정적표로 요율을 정해
 *    의료급여 2종 외래 15% · 차상위 14% · 산정특례 10% · 자격상실 100% 를 전부 0%/30% 로 봤다.
 *    실청구(`createFromEncounter`)는 자격조회 기반이라 **같은 환자에게 다른 금액**을 말했다(P12).
 *  - 약가(unitPrice)가 없는 약 2,041건을 `?? 0` 으로 삼켜 **"급여 0원"** 으로 표시·청구했다(P1).
 *
 * 이 스펙이 지키는 것:
 *  ① 계산기 요율은 실청구와 **같은 함수**(EligibilityService.resolveCopayRate)에서 나온다
 *  ② 의료급여 2종·차상위·산정특례·자격상실이 0% 로 뭉개지지 않는다
 *  ④ 약가 미등재가 0원으로 표시되지 않는다
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { BillingService } from '../../src/modules/billing/billing.service';
import { EligibilityService } from '../../src/modules/eligibility/eligibility.service';
import { ConfigRuntimeService } from '../../src/modules/config/config-runtime.service';

const SRC = join(__dirname, '../../src/modules/billing/billing.service.ts');

function makeService(opts: {
  insuranceType?: string;
  eligibilityCheckId?: string | null;
  latestEligibility?: { id: string } | null;
  prescriptions?: unknown[];
  resolveCopayRate?: ReturnType<typeof vi.fn>;
}) {
  const resolveCopayRate = opts.resolveCopayRate
    ?? vi.fn().mockResolvedValue({ rate: 0.3, copayCategory: 'NHI' });
  const prisma = {
    encounter: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'e-1',
        visitType: 'OUTPATIENT',
        eligibilityCheckId: opts.eligibilityCheckId ?? null,
        patient: { id: 'p-1', insuranceType: opts.insuranceType ?? 'NHI' },
        doctor: { department: '내과' },
        prescriptions: opts.prescriptions ?? [],
        diagnoses: [],
      }),
      // P4-2: 계산기도 실청구와 같은 진찰료 판정(이전 서명 진료 있음 = 재진)
      count: vi.fn().mockResolvedValue(1),
    },
    procedureCode: { findFirst: vi.fn().mockResolvedValue({ id: 'pc-aa257', code: 'AA257', nameKo: '재진 진찰료', unitPrice: 11690 }) },
    systemConfig: { findMany: vi.fn().mockResolvedValue([]) },
    eligibilityCheck: { findFirst: vi.fn().mockResolvedValue(opts.latestEligibility ?? null) },
  };
  const eligibility = { resolveCopayRate, copayRateFor: vi.fn().mockResolvedValue(0.3) };
  const svc = new BillingService(
    prisma as never, {} as never, { enqueue: vi.fn() } as never,
    { get: vi.fn().mockResolvedValue(undefined) } as never,
    eligibility as never, {} as never, {} as never,
  );
  return { svc, eligibility, prisma };
}

describe('🔴 W8 R3 C3 — 본인부담률 정본은 resolveCopayRate 하나', () => {
  it('① 계산기는 실청구와 같은 함수(EligibilityService.resolveCopayRate)를 호출한다', async () => {
    const { svc, eligibility } = makeService({ eligibilityCheckId: 'el-1' });
    await svc.calculateBilling('e-1');
    expect(eligibility.resolveCopayRate).toHaveBeenCalledWith('p-1', 'NHI', 'OUTPATIENT', 'e-1');
  });

  it('① 계산기 소스에 InsuranceType 정적 요율표가 다시 생기지 않는다', () => {
    const src = readFileSync(SRC, 'utf8');
    // 종전: `const COPAY_RATES: Record<InsuranceType, number> = { NHI: 0.3, MEDICAID: 0.0, ... }`
    expect(src).not.toMatch(/Record<InsuranceType,\s*number>\s*=\s*\{/);
    expect(src).not.toMatch(/copayRateMap/);
  });

  it.each([
    ['의료급여 2종 외래', 'MEDICAID', 'MA_TYPE2', 0.15],
    ['차상위', 'MEDICAID', 'NEAR_POOR', 0.14],
    ['산정특례', 'NHI', 'SPECIAL_EXEMPTION', 0.10],
    ['자격상실', 'NHI', 'NHI', 1.0],
  ])('② %s 은 0%% 로 뭉개지지 않고 정본 요율(%s → %s)이 그대로 화면에 온다', async (_label, insType, category, rate) => {
    const resolveCopayRate = vi.fn().mockResolvedValue({ rate, copayCategory: category });
    const { svc } = makeService({ insuranceType: insType, eligibilityCheckId: 'el-1', resolveCopayRate });
    const r = await svc.calculateBilling('e-1');
    expect(r.copayRate).toBe(rate);
    expect(r.copayRate).not.toBe(0);
    expect(r.copayRateConfirmed).toBe(true);
    expect(r.copayBasis).toBe('ELIGIBILITY');
  });

  it('② 자격 미확인 의료급여는 0% 로 단정하지 않고 "산출 불가"라고 말한다', async () => {
    const { svc } = makeService({ insuranceType: 'MEDICAID', eligibilityCheckId: null, latestEligibility: null });
    const r = await svc.calculateBilling('e-1');
    expect(r.copayRate).toBeNull();                 // 0 이 아니라 null(모름)
    expect(r.copayRateConfirmed).toBe(false);
    expect(r.summary.patientCopay).toBeNull();
    expect(r.summary.insuranceCovered).toBeNull();
    expect(r.summary.complete).toBe(false);
    expect(r.warnings.join(' ')).toMatch(/자격 미확인/);
  });

  it('② 자격 미확인 건보는 폴백을 쓰되 "가정치"임을 밝힌다', async () => {
    const { svc } = makeService({ insuranceType: 'NHI', eligibilityCheckId: null, latestEligibility: null });
    const r = await svc.calculateBilling('e-1');
    expect(r.copayRate).toBe(0.3);
    expect(r.copayRateConfirmed).toBe(false);
    expect(r.copayBasis).toBe('INSURANCE_TYPE_FALLBACK');
    expect(r.warnings.join(' ')).toMatch(/산정특례|차상위|자격상실/);
  });
});

describe('🔴 W8 R3 C3 — 정본 요율표(config DEFAULTS)가 0 으로 무너지지 않는다', () => {
  const cfg = new ConfigRuntimeService({ systemConfig: { findUnique: vi.fn().mockResolvedValue(null) } } as never, {} as never);
  const elig = new EligibilityService({} as never, cfg, {} as never, {} as never);

  it.each([
    ['MA_TYPE2', 'OUTPATIENT', 0.15],
    ['NEAR_POOR', 'OUTPATIENT', 0.14],
    ['SPECIAL_EXEMPTION', 'OUTPATIENT', 0.10],
    ['SELF_PAY', 'OUTPATIENT', 1],
  ] as const)('%s(%s) = %s', async (category, visit, expected) => {
    expect(await elig.copayRateFor(category, visit)).toBeCloseTo(expected, 4);
  });
});

describe('🔴 W8 R3 C5 — 약가 미등재는 "급여 0원"이 아니다', () => {
  let svc: BillingService;
  beforeEach(() => {
    ({ svc } = makeService({
      eligibilityCheckId: 'el-1',
      prescriptions: [
        { type: 'MEDICATION', quantity: 30, duration: 30,
          medicationCode: { code: 'M-NOPRICE', nameKo: '약가미등재약', unitPrice: null, insuranceCode: 'A11500011' },
          procedureCode: null },
        { type: 'MEDICATION', quantity: 10, duration: 10,
          medicationCode: { code: 'M-OK', nameKo: '정상약', unitPrice: 500, insuranceCode: 'A11500022' },
          procedureCode: null },
      ],
    }));
  });

  it('④ 약가 없는 약은 금액 0 이 아니라 null(모름)로 나오고 급여 단정도 하지 않는다', async () => {
    const r = await svc.calculateBilling('e-1');
    const unpriced = r.items.find(i => i.code === 'M-NOPRICE')!;
    expect(unpriced.priceKnown).toBe(false);
    expect(unpriced.totalPrice).toBeNull();
    expect(unpriced.unitPrice).toBeNull();
    expect(unpriced.totalPrice).not.toBe(0);
    expect(unpriced.insuranceType).toBe('UNKNOWN'); // '급여'라고 말하지 않는다
    expect(unpriced.note).toMatch(/약가 미등재/);
  });

  it('④ 미등재 금액을 0 으로 합계에 섞지 않고, 합계가 불완전함을 밝힌다', async () => {
    const r = await svc.calculateBilling('e-1');
    expect(r.summary.unpricedItemCount).toBe(1);
    expect(r.summary.complete).toBe(false);
    expect(r.warnings.join(' ')).toMatch(/미등재/);
    // 정상약 500×10 + 진찰료 11690 만 합계에 들어간다(미등재분 0 원 가산 없음)
    // 🔴 (P4-2) 실청구에 없는 원내 조제료(AC200 4,500)를 더하지 않는다 — 실청구와 같은 함수로 만든다
    expect(r.summary.coveredTotal).toBe(500 * 10 + 11690);
  });
});
