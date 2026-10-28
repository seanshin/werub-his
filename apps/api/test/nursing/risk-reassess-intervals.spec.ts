/**
 * 낙상·욕창 위험 재평가 주기 = 원내 규정(2026-10-27).
 *  · 🔴 주기가 코드 상수였다 → 설정 키 · 비면 코드 기본값으로 일정은 계속(출처 CODE_DEFAULT) · 시드·원내 설정 출처
 *  · 일정을 만드는 세 경로(재평가 기록·안전 화면 낙상 평가·초기평가 자동 일정·입원 자동 생성·수동 생성)가 같은 표를 쓴다
 *  · QI 공급원 "위험 재평가 기한 내 수행률" — 평가마다 · Braden 중복 한 번 · 점수 범위 밖 제외 · 주기 출처 근거
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import { RISK_REASSESS_INTERVAL_DEFAULT, settingValueInvalidReason } from '@hospital-run/shared';
import { readRiskReassessIntervals } from '../../src/modules/nursing-rules/nursing-rules.read';
import { intervalHoursFor, scheduleFromInitialScore, REASSESSMENT_INTERVAL_HOURS } from '../../src/modules/risk-reassessment/risk-reassessment.policy';
import { PatientSafetyService } from '../../src/modules/patient-safety/patient-safety.service';
import { IndicatorSupplierService } from '../../src/modules/quality/indicator-supplier.service';

const SRC = join(__dirname, '../../src/modules');
const KEY = 'nursing.riskReassess.intervalHours';
const RULE = { FALL_RISK: { HIGH: 1, MODERATE: 3, LOW: 12 }, PRESSURE_ULCER: { HIGH: 2, MODERATE: 6, LOW: 48 } };
const cfg = (v?: unknown, opts: { seeded?: boolean; throws?: boolean } = {}) => ({
  getWithSource: vi.fn(async (k: string) => {
    if (opts.throws) throw new Error('db down');
    return k === KEY && v !== undefined ? { value: v, source: 'db', registered: true, ...(opts.seeded ? { seeded: true } : {}) } : { value: null, source: 'default', registered: true };
  }),
  get: vi.fn(async () => null),
}) as any;

describe('🔴 재평가 주기 — 원내 규정', () => {
  it('출처 4상태 · 비거나 실패해도 코드 기본값으로 계속', async () => {
    expect(await readRiskReassessIntervals(cfg(RULE))).toEqual({ table: RULE, source: 'CONFIGURED' });
    expect(await readRiskReassessIntervals(cfg(RULE, { seeded: true }))).toEqual({ table: RULE, source: 'SEED' });
    expect(await readRiskReassessIntervals(cfg())).toEqual({ table: RISK_REASSESS_INTERVAL_DEFAULT, source: 'CODE_DEFAULT' });
    expect(await readRiskReassessIntervals(cfg(undefined, { throws: true }))).toEqual({ table: RISK_REASSESS_INTERVAL_DEFAULT, source: 'UNKNOWN' });
    expect(REASSESSMENT_INTERVAL_HOURS).toBe(RISK_REASSESS_INTERVAL_DEFAULT);
  });
  it('🔴 값 검사 — 범위·정수·고위험이 저위험보다 길면 거부', () => {
    expect(settingValueInvalidReason(KEY, RULE)).toBeNull();
    expect(settingValueInvalidReason(KEY, { ...RULE, FALL_RISK: { HIGH: 12, MODERATE: 4, LOW: 8 } })).toBeTruthy();
    expect(settingValueInvalidReason(KEY, { ...RULE, FALL_RISK: { HIGH: 0, MODERATE: 4, LOW: 8 } })).toBeTruthy();
    expect(settingValueInvalidReason(KEY, { FALL_RISK: RULE.FALL_RISK })).toBeTruthy();
  });
  it('정책 함수가 표를 받는다 · 초기평가 일정도 그 표', () => {
    expect(intervalHoursFor('FALL_RISK', 'HIGH', RULE)).toBe(1);
    expect(scheduleFromInitialScore('PRESSURE_ULCER', 20, new Date(0), RULE)).toMatchObject({ intervalHours: 48 });
  });
  it('안전 화면 낙상 평가가 원내 규정 주기로 다음 일정', async () => {
    const tx = vi.fn(async (ops: any[]) => Promise.all(ops));
    const prisma: any = {
      fallRiskAssessment: { create: vi.fn(async ({ data }: any) => ({ id: 'f1', ...data })) },
      riskReassessmentSchedule: { updateMany: vi.fn(async (a: any) => ({ count: 1, a })) },
      $transaction: tx,
    };
    const svc = new PatientSafetyService(prisma, { emit: vi.fn() } as never, cfg(RULE));
    await (svc as any).persistFallAssessment({ patientId: 'p1', assessorId: 'n1', score: 50, factors: {} });
    expect(prisma.riskReassessmentSchedule.updateMany.mock.calls[0][0].data.intervalHours).toBe(1);
  });
  it('일정을 만드는 경로가 전부 읽기 정본을 거친다(구조)', () => {
    const rr = readFileSync(join(SRC, 'risk-reassessment/risk-reassessment.service.ts'), 'utf8');
    expect(rr.match(/readRiskReassessIntervals\(this\.config\)/g)?.length).toBe(3);
    expect(rr).not.toMatch(/INITIAL_INTERVAL_HOURS/);
    expect(readFileSync(join(SRC, 'nursing/nursing.service.ts'), 'utf8')).toMatch(/scheduleFromInitialScore\(type, scores\[type\], assessedAt, intervals\)/);
  });
});

describe('🔴 QI 공급원 위험 재평가 기한 내 수행률', () => {
  const T = (d: number, h: number) => new Date(Date.UTC(2026, 8, d, h));
  const RANGE = { from: new Date('2026-09-01T00:00:00Z'), to: new Date('2026-10-01T00:00:00Z') };
  function svc(o: { falls?: any[]; initials?: any[]; tool?: any[]; seeded?: boolean }) {
    const prisma: any = {
      admission: { findMany: vi.fn(async () => [{ id: 'a1', patientId: 'p1', admitDate: T(1, 0), dischargeDate: null }]) },
      fallRiskAssessment: { findMany: vi.fn(async () => o.falls ?? []) },
      nursingAssessment: { findMany: vi.fn(async () => o.initials ?? []) },
      clinicalChartResult: { findMany: vi.fn(async () => o.tool ?? []) },
    };
    return new IndicatorSupplierService(prisma, cfg(RULE, { seeded: o.seeded }));
  }
  it('평가마다 · 등급 주기 · 유형별 · 주기 출처 근거', async () => {
    // Morse 50(HIGH 1h): 2:00 → 2:30 onTime · 2:30 HIGH → 5:00 late · 5:00 Morse 10(LOW 12h) → 없음 never
    const falls = [{ patientId: 'p1', assessedAt: T(5, 2), score: 50 }, { patientId: 'p1', assessedAt: new Date(T(5, 2).getTime() + 30 * 60e3), score: 50 }, { patientId: 'p1', assessedAt: T(5, 5), score: 10 }];
    const r = await svc({ falls, seeded: true }).supply('RISK_REASSESS_ON_TIME', RANGE);
    expect(r).toMatchObject({ available: true, numerator: 1, denominator: 3, evidence: { intervalSource: 'SEED', intervals: RULE, byType: { FALL_RISK: { onTime: 1, denominator: 3 } } } });
  });
  it('🔴 Braden — 초기평가가 남긴 도구 결과는 한 번만 · 점수 범위 밖은 등급을 지어내지 않고 뺀다', async () => {
    const initials = [{ admissionId: 'a1', assessedAt: T(5, 0), bradenScore: 12 }];
    const tool = [
      { patientId: 'p1', performedAt: T(5, 0), resultValue: 12, inputs: { nursingAssessmentId: 'na1' } },
      { patientId: 'p1', performedAt: T(5, 1), resultValue: 13, inputs: {} },
      { patientId: 'p1', performedAt: T(6, 1), resultValue: 40, inputs: {} },
    ];
    const r = await svc({ initials, tool }).supply('RISK_REASSESS_ON_TIME', RANGE);
    // 0:00 HIGH(2h) → 1:00 onTime · 1:00 HIGH(13) → 다음 없음 never
    expect(r).toMatchObject({ available: true, numerator: 1, denominator: 2, evidence: { excluded: { outOfRangeScore: 1 } } });
  });
});
