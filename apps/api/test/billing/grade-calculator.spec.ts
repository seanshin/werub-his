/**
 * 요양기관 종별 계산기(2026-10-20 · 사용자 지시 "병원 종별 처리되는 계산기를 만들어서 탑재").
 *  · 같은 진료를 의원·병원·종합·상급종합으로 — 진찰료 코드는 종별 코드 · 단가는 고시 종별 열
 *  · 🔴 고시 0 = 그 종별 미산정(0원 아님 · 합계에서 빼고 센다) · 고시에 없으면 미등재
 *  · 본인부담 = 실청구와 같은 우선순위(비급여 > 감면 자격 > 코드 특례 > 자격 기본율) · 의료급여 정액은 종별별
 *  · 실청구 단가(수가 마스터)와 다르면 줄마다 · 종별 미설정·건보 단일 율을 말한다 · 저장 없음
 */
import { describe, it, expect, vi } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { readFileSync } from 'node:fs';
import { GradeCalculatorService } from '../../src/modules/billing/grade-calculator.service';
import { GradeCalculatorDto } from '../../src/modules/billing/dto/grade-calculator.dto';
import { TierPriceService } from '../../src/modules/billing/tier-price.service';

// 운영 고시(2026-06-01) 실값 — 진찰료 종별 코드
const FEES = [
  { code: 'AA154', nameKo: '초진진찰료-의원', priceClinic: 18840, priceHospital: 0, benefitType: '급여' },
  { code: 'AA155', nameKo: '초진진찰료-병원', priceClinic: 0, priceHospital: 17500, benefitType: '급여' },
  { code: 'AA156', nameKo: '초진진찰료-종합병원', priceClinic: 0, priceHospital: 19470, benefitType: '급여' },
  { code: 'AA157', nameKo: '초진진찰료-상급종합병원', priceClinic: 0, priceHospital: 21440, benefitType: '급여' },
  { code: 'X1', nameKo: '의원만 산정', priceClinic: 5000, priceHospital: 0, benefitType: '급여' },
  { code: 'MRI', nameKo: 'MRI', priceClinic: 200000, priceHospital: 220000, benefitType: '급여' },
  { code: 'NC', nameKo: '비급여 처치', priceClinic: 10000, priceHospital: 10000, benefitType: '비급여' },
];
const MASTERS = [
  { code: 'AA154', nameKo: '초진진찰료-의원', unitPrice: 18840, copayRate: null, insuranceCovered: true },
  { code: 'MRI', nameKo: 'MRI', unitPrice: 200000, copayRate: 0.8, insuranceCovered: true },
  { code: 'NC', nameKo: '비급여 처치', unitPrice: 10000, copayRate: null, insuranceCovered: false },
];

function mk(o: { grade?: unknown; gazette?: boolean; rate?: number; byGrade?: Record<string, number> } = {}) {
  const prisma: any = {
    systemConfig: { findUnique: vi.fn(async ({ where }: any) => (where.key === 'billing.institution.grade'
      ? (o.grade === undefined ? null : { value: o.grade })
      : where.key === 'billing.copay.nhi.outpatient.byGrade' ? (o.byGrade ? { value: o.byGrade } : null) : null)) },
    procedureFee: {
      findFirst: vi.fn().mockResolvedValue(o.gazette === false ? null : { validFrom: new Date('2026-06-01') }),
      findMany: vi.fn(async ({ where }: any) => FEES.filter((f) => where.code.in.includes(f.code))),
    },
    procedureCode: { findMany: vi.fn(async ({ where }: any) => MASTERS.filter((m) => where.code.in.includes(m.code))) },
  };
  // 자격 기본율 — 종별 차등이 있으면 그 종별 율(실서비스 copayRateFor(…, grade) 와 같은 계약)
  const eligibility: any = { copayRateFor: vi.fn(async (_c: string, _v: string, g?: string) => (o.byGrade && g ? o.byGrade[g] / 100 : (o.rate ?? 0.3))) };
  const billing: any = { patientCopayForGrade: vi.fn(async (items: any[]) => items.reduce((s, i) => s + Math.round(i.amount * i.copayRate), 0)) };
  const tierPrice = new TierPriceService(prisma);
  return { svc: new GradeCalculatorService(prisma, eligibility, billing, tierPrice), prisma, billing, eligibility };
}
const run = (svc: GradeCalculatorService, over: Partial<GradeCalculatorDto> = {}) =>
  svc.calculate({ visitKind: 'INITIAL', copayCategory: 'NHI', items: [], ...over } as GradeCalculatorDto);

describe('🔴 종별로 나란히 — 진찰료 코드·고시 종별 단가', () => {
  it('초진 진찰료 = 종별 코드 · 그 종별 단가(의원 18,840 · 병원 17,500 · 종합 19,470 · 상급종합 21,440)', async () => {
    const r = await run(mk().svc);
    expect(r.results.map((x) => [x.grade, x.lines[0].code, x.lines[0].unitPrice])).toEqual([
      ['CLINIC', 'AA154', 18840], ['HOSPITAL', 'AA155', 17500], ['GENERAL', 'AA156', 19470], ['TERTIARY', 'AA157', 21440],
    ]);
    expect(r.results[0].totalAmount).toBe(18840);
  });
  it('🔴 고시 0(그 종별 미산정)·고시 없음은 0원이 아니다 — 금액 null · 합계에서 빼고 뺀 줄을 센다', async () => {
    const r = await run(mk().svc, { visitKind: 'NONE', items: [{ code: 'X1', quantity: 2 }, { code: 'ZZZ', quantity: 1 }] });
    const clinic = r.results.find((x) => x.grade === 'CLINIC')!;
    const hosp = r.results.find((x) => x.grade === 'HOSPITAL')!;
    expect(clinic.lines[0]).toMatchObject({ amount: 10000, basis: 'GAZETTE' });
    expect(hosp.lines[0]).toMatchObject({ amount: null, unitPrice: null, basis: 'NOT_BILLABLE_AT_TIER' });
    expect(hosp.lines[1]).toMatchObject({ amount: null, basis: 'NOT_LISTED' });
    expect(clinic).toMatchObject({ totalAmount: 10000, excludedLines: 1 });
    expect(hosp).toMatchObject({ totalAmount: null, patientCopay: null, excludedLines: 2 });
  });
  it('고시가 등재되지 않은 기준일 → 모든 줄 NO_GAZETTE_LOADED · 합계 없음 · 그 사실을 말한다', async () => {
    const r = await run(mk({ gazette: false }).svc);
    expect(r.gazetteEffectiveDate).toBeNull();
    expect(r.results.every((x) => x.totalAmount === null && x.lines[0].basis === 'NO_GAZETTE_LOADED')).toBe(true);
    expect(r.caveats.map((c) => c.code)).toContain('NO_GAZETTE');
  });
});

describe('🔴 본인부담 = 실청구와 같은 규칙', () => {
  it('건보: 코드 특례(MRI 80%)가 이기고 · 비급여는 전액 · 대조군 감면 자격(의료급여 2종)은 자격율이 특례를 이긴다', async () => {
    const nhi = await run(mk().svc, { visitKind: 'NONE', items: [{ code: 'MRI', quantity: 1 }, { code: 'NC', quantity: 1 }] });
    const c = nhi.results.find((x) => x.grade === 'CLINIC')!;
    expect(c.lines.map((l) => l.copayRate)).toEqual([0.8, 1]);
    expect(c.patientCopay).toBe(160000 + 10000);
    const ma2 = await run(mk({ rate: 0.15 }).svc, { visitKind: 'NONE', copayCategory: 'MA_TYPE2', items: [{ code: 'MRI', quantity: 1 }] });
    expect(ma2.results[0].lines[0].copayRate).toBe(0.15);
  });
  it('의료급여 정액 등 종별 규칙은 그 종별로 센다(실청구 함수에 종별을 넘긴다)', async () => {
    const { svc, billing } = mk();
    await run(svc, { copayCategory: 'MA_TYPE1' });
    expect(billing.patientCopayForGrade.mock.calls.map((c: any[]) => [c[1], c[3]])).toEqual([
      ['MA_TYPE1', 'CLINIC'], ['MA_TYPE1', 'HOSPITAL'], ['MA_TYPE1', 'GENERAL'], ['MA_TYPE1', 'TERTIARY'],
    ]);
  });
});

describe('사실을 숨기지 않는다', () => {
  it('청구 단가 = 지금 설정의 실청구 단가(종별 미설정 → 마스터) · 다르면 줄마다 · 종별 미설정 · 건보 단일 율을 말한다', async () => {
    const r = await run(mk().svc, { visitKind: 'NONE', items: [{ code: 'MRI', quantity: 1 }] });
    const hosp = r.results.find((x) => x.grade === 'HOSPITAL')!;
    expect(hosp.lines[0]).toMatchObject({ unitPrice: 220000, billedUnitPrice: 200000 });
    expect(hosp.billedMismatchLines).toBe(1);
    expect(r.results.find((x) => x.grade === 'CLINIC')!.billedMismatchLines).toBe(0);
    expect(r.configuredGrade).toBeNull();
    expect(r.caveats).toContainEqual({ code: 'GRADE_UNSET' });
    expect(r.caveats).toContainEqual({ code: 'NHI_SINGLE_RATE', value: '30' });
  });
  it('설정 종별이면 그 열을 표시 · 표 밖 값은 "알 수 없다"', async () => {
    const set = await run(mk({ grade: 'HOSPITAL' }).svc);
    expect(set.configuredGrade).toBe('HOSPITAL');
    expect(set.results.filter((x) => x.isConfigured).map((x) => x.grade)).toEqual(['HOSPITAL']);
    // 🔴 종별을 정하면 실청구 단가 = 그 종별 고시 단가 → 설정 열은 차이가 없다(계산기 = 실청구)
    const setMri = await run(mk({ grade: 'HOSPITAL' }).svc, { visitKind: 'NONE', items: [{ code: 'MRI', quantity: 1 }] });
    expect(setMri.results.find((x) => x.grade === 'HOSPITAL')!).toMatchObject({ billedMismatchLines: 0 });
    expect(setMri.results.find((x) => x.grade === 'HOSPITAL')!.lines[0].billedUnitPrice).toBe(220000);
    expect(setMri.results.find((x) => x.grade === 'CLINIC')!.billedMismatchLines).toBe(1);
    const odd = await run(mk({ grade: 'DENTAL' }).svc);
    expect(odd.configuredGrade).toBeNull();
    expect(odd.caveats).toContainEqual({ code: 'GRADE_UNKNOWN', value: 'DENTAL' });
  });
  it('저장하지 않는다 — 계산기 서비스에 쓰기 호출이 없다 · EP 는 관리자·원무·경영진 · 변이 감사 면제', () => {
    const src = readFileSync('src/modules/billing/grade-calculator.service.ts', 'utf8');
    expect(src).not.toMatch(/\.(create|update|upsert|delete)(Many)?\(/);
    const ctl = readFileSync('src/modules/billing/billing.controller.ts', 'utf8');
    expect(ctl).toMatch(/@Post\('billing\/grade-calculator'\)\s*\n\s*@Roles\(UserRole\.ADMIN, UserRole\.RECEPTIONIST, UserRole\.EXECUTIVE\)\s*\n\s*@NoAudit\(\)/);
  });
});

describe('🔴 건보 외래 본인부담률 종별 차등', () => {
  it('설정되면 열마다 그 종별 율 · 단서가 차등 사용을 말한다 · 대조군 미설정은 단일 율', async () => {
    const r = await run(mk({ byGrade: { CLINIC: 30, HOSPITAL: 40, GENERAL: 50, TERTIARY: 60 } }).svc);
    expect(r.results.map((x) => [x.grade, x.baseCopayRate])).toEqual([['CLINIC', 0.3], ['HOSPITAL', 0.4], ['GENERAL', 0.5], ['TERTIARY', 0.6]]);
    expect(r.results.find((x) => x.grade === 'TERTIARY')!.patientCopay).toBe(Math.round(21440 * 0.6));
    expect(r.caveats).toContainEqual({ code: 'NHI_GRADE_RATES' });
    const single = await run(mk().svc);
    expect(new Set(single.results.map((x) => x.baseCopayRate))).toEqual(new Set([0.3]));
  });
});

describe('입력 검증', () => {
  it('모르는 종별·본인부담 구분·수량 0·코드 형식·50줄 초과는 거부 · 대조군 정상 입력 통과', async () => {
    const errs = async (o: object) => (await validate(plainToInstance(GradeCalculatorDto, o))).length;
    const ok = { visitKind: 'INITIAL', copayCategory: 'NHI', items: [{ code: 'D2200', quantity: 1 }] };
    expect(await errs(ok)).toBe(0);
    expect(await errs({ ...ok, grades: ['DENTAL'] })).toBeGreaterThan(0);
    expect(await errs({ ...ok, copayCategory: 'FOO' })).toBeGreaterThan(0);
    expect(await errs({ ...ok, items: [{ code: 'D2200', quantity: 0 }] })).toBeGreaterThan(0);
    expect(await errs({ ...ok, items: [{ code: "D2200'; --", quantity: 1 }] })).toBeGreaterThan(0);
    expect(await errs({ ...ok, items: Array.from({ length: 51 }, () => ({ code: 'D2200', quantity: 1 })) })).toBeGreaterThan(0);
  });
});

describe('🔴 실청구 본인부담 함수가 지정 종별을 쓴다(의료급여 1종 외래 정액)', () => {
  it('설정이 의원이어도 계산기가 상급종합을 넘기면 상급종합 정액 · 대조군 실청구(넘기지 않음)는 설정 종별', async () => {
    const { BillingService } = await import('../../src/modules/billing/billing.service');
    const cfg: Record<string, unknown> = { 'billing.institution.grade': 'CLINIC', 'billing.copay.ma1.flat.clinic': 1000, 'billing.copay.ma1.flat.tertiary': 2000 };
    const svc = Object.create(BillingService.prototype) as any;
    svc.configRuntime = { get: vi.fn(async (k: string) => cfg[k]) };
    expect(await svc.patientCopayForGrade([{ amount: 21440, copayRate: 0 }], 'MA_TYPE1', 21440, 'TERTIARY')).toBe(2000);
    expect(await svc.computePatientCopay([{ amount: 18840, copayRate: 0 }], 'OUTPATIENT', 'MA_TYPE1', 18840)).toBe(1000);
  });
});
