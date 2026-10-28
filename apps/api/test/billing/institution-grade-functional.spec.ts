/**
 * 병원 종별 · 건보 외래 본인부담률(종별) — 화면에서 정하면 실제 청구가 따른다(2026-10-20 · 사용자 지시 "UI 화면으로 기능 구현").
 *  · 종별 = 결정 `billing.institutionType` 기록 → 집행 엔진이 설정 반영 → 새 청구의 진찰료 코드·청구 단가(고시 종별 열)·정액
 *    🔴 종전: 종별을 정해도 청구 단가는 수가 마스터(의원 열) 그대로였다 — 병원급 진찰료 0원 등
 *  · 고시 0(그 종별 미산정) → 단가 없음(0원 라인 정책 · 경고) · 고시 밖 코드 → 마스터 · 종별 미설정 → 아무것도 바꾸지 않는다
 *  · 건보 외래 율: 종별 차등 설정이 있고 종별이 명시되면 그 율 · 아니면 단일 율 · 입원은 그대로
 */
import { readFileSync } from 'node:fs';
import { describe, it, expect, vi } from 'vitest';
import { gradeRatesInvalidReason, nhiOutpatientRatePct, settingValueInvalidReason } from '@hospital-run/shared';
import { TierPriceService } from '../../src/modules/billing/tier-price.service';
import { EligibilityService } from '../../src/modules/eligibility/eligibility.service';
import { DECISION_REGISTRY } from '../../src/modules/decision-registry/decision.registry';

const FEES = [
  { code: 'AA155', priceClinic: 0, priceHospital: 17500 },
  { code: 'AA154', priceClinic: 18840, priceHospital: 0 },
  { code: 'D1', priceClinic: 18810, priceHospital: 16490 },
];
function tier(grade: string | null, gazette = true) {
  const prisma: any = {
    systemConfig: { findUnique: vi.fn().mockResolvedValue(grade ? { value: grade } : null) },
    procedureFee: {
      findFirst: vi.fn().mockResolvedValue(gazette ? { validFrom: new Date('2026-06-01') } : null),
      findMany: vi.fn(async ({ where }: any) => FEES.filter((f) => where.code.in.includes(f.code))),
    },
  };
  return { svc: new TierPriceService(prisma), prisma };
}

describe('🔴 청구 단가 = 고시 종별 단가(종별 명시 설정 때만)', () => {
  it('병원: 진찰료 AA155 마스터 0 → 17,500 · 검사 18,810 → 16,490 · 🔴 의원 전용 AA154 → 단가 없음 · 고시 밖 코드 그대로', async () => {
    const rows = [{ code: 'AA155', unitPrice: 0 }, { code: 'D1', unitPrice: 18810 }, { code: 'AA154', unitPrice: 18840 }, { code: 'LOCAL1', unitPrice: 5000 }];
    const n = await tier('HOSPITAL').svc.apply(rows);
    expect(rows.map((r) => r.unitPrice)).toEqual([17500, 16490, null, 5000]);
    expect(n).toBe(3);
  });
  it('대조군 — 종별 미설정이면 아무것도 바꾸지 않는다(고시도 읽지 않는다) · 표 밖 값도 마찬가지', async () => {
    for (const g of [null, 'DENTAL']) {
      const { svc, prisma } = tier(g);
      const rows = [{ code: 'D1', unitPrice: 18810 }];
      expect(await svc.apply(rows)).toBe(0);
      expect(rows[0].unitPrice).toBe(18810);
      expect(prisma.procedureFee.findMany).not.toHaveBeenCalled();
    }
  });
  it('그 시점 고시가 없으면 마스터 그대로 · 의원 설정이면 의원 열(마스터와 같은 값은 그대로)', async () => {
    const rows = [{ code: 'D1', unitPrice: 20000 }];
    await tier('HOSPITAL', false).svc.apply(rows);
    expect(rows[0].unitPrice).toBe(20000);
    const clinic = [{ code: 'D1', unitPrice: 20000 }, { code: 'AA155', unitPrice: 0 }];
    await tier('CLINIC').svc.apply(clinic);
    expect(clinic.map((r) => r.unitPrice)).toEqual([18810, null]);
  });
  it('🔴 구조 — 청구 생성·재계산·계산 패널·진찰료·입원료·ERP 발생 라인·FFS·원격진료가 같은 서비스를 거친다', () => {
    const b = readFileSync('src/modules/billing/billing.service.ts', 'utf8');
    expect(b.match(/await this\.applyTierPrices\(encounter\.prescriptions\.map\(\(rx\) => rx\.procedureCode\)\)/g)?.length).toBe(3);
    expect(b).toMatch(/await this\.applyTierPrices\(\[consultProc\]\)/);
    expect(b).toMatch(/await this\.applyTierPrices\(\[proc\]\)/);
    expect(b).toMatch(/await this\.applyTierPrices\(\[rx\.procedureCode\]\)/);
    expect(readFileSync('src/modules/billing-advanced/billing-advanced.service.ts', 'utf8')).toMatch(/tierPrice\?\.apply\(encounter\.prescriptions/);
    expect(readFileSync('src/modules/telehealth/telehealth.service.ts', 'utf8')).toMatch(/tierPrice\?\.apply\(\[consultProc\]\)/);
    for (const m of ['billing/billing.module.ts', 'billing-advanced/billing-advanced.module.ts', 'telehealth/telehealth.module.ts']) {
      expect(readFileSync(`src/modules/${m}`, 'utf8'), m).toMatch(/TierPriceService/);
    }
  });
});

describe('🔴 건보 외래 본인부담률 — 종별 차등', () => {
  function elig(o: { byGrade?: unknown; grade?: string | null; single?: number }) {
    const svc = Object.create(EligibilityService.prototype) as any;
    const cfg: Record<string, unknown> = { 'billing.copay.nhi.outpatient': o.single ?? 30, 'billing.copay.nhi.inpatient': 20, 'billing.copay.nhi.outpatient.byGrade': o.byGrade ?? null };
    svc.configRuntime = { get: vi.fn(async (k: string) => cfg[k] ?? null) };
    svc.prisma = { systemConfig: { findUnique: vi.fn().mockResolvedValue(o.grade ? { value: o.grade } : null) }, eligibilityCheck: { findFirst: vi.fn().mockResolvedValue(null) }, encounter: { findUnique: vi.fn() } };
    return svc;
  }
  const RATES = { CLINIC: 30, HOSPITAL: 40, GENERAL: 50, TERTIARY: 60 };
  it('차등 설정 + 종별 병원 → 40% · 입원은 그대로 20% · 계산기가 종별을 넘기면 그 종별', async () => {
    const s = elig({ byGrade: RATES, grade: 'HOSPITAL' });
    expect(await s.copayRateFor('NHI', 'OUTPATIENT')).toBe(0.4);
    expect(await s.copayRateFor('NHI', 'INPATIENT')).toBe(0.2);
    expect(await s.copayRateFor('NHI', 'OUTPATIENT', 'TERTIARY')).toBe(0.6);
  });
  it('대조군 — 차등 미설정이면 단일 율 · 종별 미설정이면 차등이 있어도 단일 율(짐작하지 않는다) · 의료급여는 무관', async () => {
    expect(await elig({ grade: 'HOSPITAL', single: 30 }).copayRateFor('NHI', 'OUTPATIENT')).toBe(0.3);
    expect(await elig({ byGrade: RATES, grade: null, single: 30 }).copayRateFor('NHI', 'OUTPATIENT')).toBe(0.3);
    expect(await elig({ byGrade: RATES, grade: 'TERTIARY' }).copayRateFor('MA_TYPE1', 'OUTPATIENT')).not.toBe(0.6);
  });
  it('🔴 자격조회 없는 건보 외래도 같은 율(종전 정적 30%) · 입원 폴백은 종전 그대로', async () => {
    const s = elig({ byGrade: RATES, grade: 'GENERAL' });
    expect(await s.resolveCopayRate('p1', 'NHI', 'OUTPATIENT')).toEqual({ rate: 0.5, copayCategory: 'NHI' });
    expect(await s.resolveCopayRate('p1', 'NHI', 'INPATIENT')).toEqual({ rate: 0.3, copayCategory: 'NHI' });
  });
  it('저장 검사 — 네 종별 0~100 정수만 · null 허용 · 일부·모르는 종별·소수 거부 · 설정 저장·집행 엔진이 같은 검사', () => {
    expect(gradeRatesInvalidReason(RATES)).toBeNull();
    expect(gradeRatesInvalidReason(null)).toBeNull();
    expect(gradeRatesInvalidReason({ CLINIC: 30 })).not.toBeNull();
    expect(gradeRatesInvalidReason({ ...RATES, DENTAL: 10 })).not.toBeNull();
    expect(gradeRatesInvalidReason({ ...RATES, HOSPITAL: 40.5 })).not.toBeNull();
    expect(gradeRatesInvalidReason({ ...RATES, TERTIARY: 101 })).not.toBeNull();
    expect(settingValueInvalidReason('billing.copay.nhi.outpatient.byGrade', { CLINIC: 30 })).not.toBeNull();
    expect(settingValueInvalidReason('billing.institution.grade', 'DENTAL')).not.toBeNull();
    expect(settingValueInvalidReason('billing.institution.grade', 'GENERAL')).toBeNull();
    expect(nhiOutpatientRatePct({ CLINIC: 30 }, 'CLINIC', 30)).toEqual({ pct: 30, source: 'SINGLE' }); // 잘못된 값은 단일 율로
  });
});

describe('종별 결정 — 네 종별을 고를 수 있다', () => {
  it('선택지 의원·병원·종합병원·상급종합이 각각 그 설정 값을 집행한다 · 미확인·그 밖은 설정을 바꾸지 않는다', () => {
    const d = DECISION_REGISTRY.find((x) => x.key === 'billing.institutionType')!;
    const enacts = Object.fromEntries(d.options.map((o) => [o.value, o.enact ? (o.enact as any).newValue : null]));
    expect(enacts).toEqual({ UNSET: null, CLINIC: 'CLINIC', HOSPITAL: 'HOSPITAL', GENERAL: 'GENERAL', TERTIARY: 'TERTIARY', OTHER: null });
    expect(d.approvalPath).toBe('AUTHORIZED_ROLE');
  });
});

describe('🔴 실청구 — 종별을 정하면 새 청구의 진찰료·처치 단가가 고시 종별 단가', () => {
  it('병원 설정: 진찰료 AA155(마스터 0) → 17,500 · 처치 D1 18,810 → 16,490 · 대조군 미설정이면 마스터 단가(AA254·18,810)', async () => {
    const { BillingService } = await import('../../src/modules/billing/billing.service');
    const run = async (grade: string | null) => {
      const created: any[] = [];
      const masters: Record<string, any> = {
        AA155: { id: 'pc-aa155', code: 'AA155', nameKo: '초진-병원', unitPrice: 0 },
        AA154: { id: 'pc-aa154', code: 'AA154', nameKo: '초진-의원', unitPrice: 18840 },
      };
      const prisma: any = {
        encounter: {
          findUnique: vi.fn().mockResolvedValue({ id: 'e1', visitType: 'OUTPATIENT', patient: { id: 'p1', insuranceType: 'NHI' }, appointment: { type: 'INITIAL' },
            prescriptions: [{ id: 'rx1', type: 'PROCEDURE', quantity: 1, duration: null, medicationCodeId: null, procedureCodeId: 'pd1', medicationCode: null,
              procedureCode: { code: 'D1', nameKo: '처치', unitPrice: 18810, copayRate: null, insuranceCovered: true } }] }),
          count: vi.fn().mockResolvedValue(0),
        },
        procedureCode: { findFirst: vi.fn(async ({ where }: any) => (masters[where.code] ? { ...masters[where.code] } : null)) },
        billing: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn(async ({ data }: any) => { created.push(data); return { id: 'b1', ...data }; }) },
      };
      const cfg: Record<string, unknown> = { 'billing.institution.grade': grade ?? undefined };
      const config = { get: vi.fn(async (k: string) => cfg[k]) };
      const tierPrisma = tier(grade).prisma;
      const svc = new BillingService(prisma, {} as any, { enqueue: vi.fn() } as any, config as any, {} as any, {} as any, {} as any,
        undefined, undefined, undefined, undefined, new TierPriceService(tierPrisma));
      (svc as any).resolveCopay = vi.fn().mockResolvedValue({ rate: 0.3, copayCategory: 'NHI' });
      (svc as any).applyCopayCap = vi.fn(async (_p: string, c: number) => ({ patientCopay: c, capExcess: 0 }));
      await svc.createFromEncounter('e1');
      return created[0].items.create.map((i: any) => [i.codeName, i.unitPrice]);
    };
    expect(await run('HOSPITAL')).toEqual([['초진-병원', 17500], ['처치', 16490]]);
    expect(await run(null)).toEqual([['초진-의원', 18840], ['처치', 18810]]);
  });
});
