/**
 * QI 공급원 "통증 재평가 기한 내 수행률"(2026-10-27).
 *  · 🔴 원내 규정 미설정·조회 실패면 산출하지 않는다(이유) — 기준을 지어내지 않는다
 *  · 규정 출처(원내 설정/개발 시드)를 근거에 남긴다 · 분류 모르는 투약은 넣지 않고 센다 · 표본 0 = 산출 불가
 *  · 비율 지표(p 관리도) · 공급원 정의·산출 불가 문구 등재
 */
import { describe, it, expect, vi } from 'vitest';
import { QI_PROPORTION_KINDS, QI_SUPPLIERS, QI_SUPPLIER_DEFINITION, QI_SUPPLY_UNAVAILABLE_TEXT } from '@hospital-run/shared';
import { IndicatorSupplierService } from '../../src/modules/quality/indicator-supplier.service';

const KEY = 'PAIN_REASSESS_ON_TIME' as const;
const RANGE = { from: new Date('2026-09-01T00:00:00Z'), to: new Date('2026-10-01T00:00:00Z') };
const T = (d: number, h: number, m = 0) => new Date(Date.UTC(2026, 8, d, h, m));
const RULE = { thresholdScore: 4, withinMinutes: 60, afterAnalgesicMinutes: 30 };

function svcWith(o: { rule?: unknown; seeded?: boolean; throws?: boolean; flows?: any[]; mar?: any[] }) {
  const config: any = {
    getWithSource: vi.fn(async (k: string) => {
      if (o.throws) throw new Error('db down');
      return k === 'nursing.pain.reassessRule' && o.rule !== undefined ? { value: o.rule, source: 'db', registered: true, ...(o.seeded ? { seeded: true } : {}) } : { value: null, source: 'default', registered: true };
    }),
    get: vi.fn(async () => null),
  };
  const prisma: any = {
    admission: { findMany: vi.fn(async () => [{ id: 'a1', patientId: 'p1', admitDate: T(1, 0), dischargeDate: null }]) },
    flowSheetEntry: { findMany: vi.fn(async () => o.flows ?? []) },
    preVisitVitals: { findMany: vi.fn(async () => []) },
    nursingAssessment: { findMany: vi.fn(async () => []) },
    medicationAdministration: { findMany: vi.fn(async () => o.mar ?? []) },
  };
  return { svc: new IndicatorSupplierService(prisma, config), prisma };
}
const flow = (at: Date, painScore: number) => ({ id: `f${+at}`, admissionId: 'a1', recordedAt: at, nurseId: 'n', painScore, systolicBp: null, diastolicBp: null, heartRate: null, temperature: null, spo2: null, respiratoryRate: null, consciousness: null, notes: null });

describe('🔴 통증 재평가 기한 내 수행률', () => {
  it('규정 미설정 → PAIN_RULE_UNSET(원장 조회 안 함) · 조회 실패 → PAIN_RULE_UNKNOWN', async () => {
    const u = svcWith({});
    expect(await u.svc.supply(KEY, RANGE)).toMatchObject({ available: false, reason: 'PAIN_RULE_UNSET' });
    expect(u.prisma.admission.findMany).not.toHaveBeenCalled();
    expect(await svcWith({ rule: RULE, throws: true }).svc.supply(KEY, RANGE)).toMatchObject({ available: false, reason: 'PAIN_RULE_UNKNOWN' });
  });
  it('분자·분모 · 규정 출처 근거 · 분류 모르는 투약 따로', async () => {
    const flows = [flow(T(5, 1), 7), flow(T(5, 1, 40), 3), flow(T(6, 9), 8), flow(T(6, 12), 2)];
    const mar = [{ patientId: 'p1', administeredAt: T(7, 1), prescription: { medicationCode: null } }];
    const r = await svcWith({ rule: RULE, seeded: true, flows, mar }).svc.supply(KEY, RANGE);
    expect(r).toMatchObject({ available: true, numerator: 1, denominator: 2, evidence: { ruleSource: 'SEED', rule: RULE, missed: { late: 1, never: 0 }, excluded: { unclassifiedAdministrations: 1 } } });
    const real = await svcWith({ rule: RULE, flows }).svc.supply(KEY, RANGE);
    expect(real).toMatchObject({ evidence: { ruleSource: 'CONFIGURED' } });
  });
  it('사건 없음 → 산출 불가(0% 아님)', async () => {
    expect(await svcWith({ rule: RULE, flows: [flow(T(5, 1), 2)] }).svc.supply(KEY, RANGE)).toMatchObject({ available: false, reason: 'NO_SAMPLE' });
  });
  it('등재 — 공급원·정의·비율 지표·산출 불가 문구', () => {
    expect(QI_SUPPLIERS[KEY].kind).toBe('PAIN_REASSESS');
    expect(QI_SUPPLIER_DEFINITION[KEY].dependsOn).toContain('nursing.pain.reassessRule');
    expect(QI_PROPORTION_KINDS.has('PAIN_REASSESS')).toBe(true);
    for (const r of ['PAIN_RULE_UNSET', 'PAIN_RULE_UNKNOWN']) expect(QI_SUPPLY_UNAVAILABLE_TEXT[r]).toBeTruthy();
  });
});
