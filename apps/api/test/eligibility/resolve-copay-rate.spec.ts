import { describe, it, expect, vi } from 'vitest';
import { EligibilityService } from '../../src/modules/eligibility/eligibility.service';

/**
 * 본인부담률 정본 회귀 — 간이 청구(telehealth 등)가 `0.3` 을 하드코딩하면 안 된다.
 *
 * 🔴 종전 telehealth 실청구는 자격 무관 30% 고정이라 의료급여·산재·자보(전부 0%) 환자를
 *    30% 과다청구했다. resolveCopayRate 는 자격조회(copayCategory) 우선·보험유형 폴백으로
 *    자격을 반영한다. 이 스펙이 "MEDICAID=0" 을 고정 — 0.3 으로 되돌리면 실패한다.
 */

function makeSvc(opts: { elig?: unknown; rateConfig?: Record<string, unknown> } = {}) {
  const prisma = {
    eligibilityCheck: { findFirst: vi.fn().mockResolvedValue(opts.elig ?? null), findUnique: vi.fn().mockResolvedValue(opts.elig ?? null) },
    encounter: { findUnique: vi.fn().mockResolvedValue(null) },
  };
  const configRuntime = { get: vi.fn((k: string) => Promise.resolve(opts.rateConfig?.[k])) };
  return new EligibilityService(prisma as never, configRuntime as never, {} as never, {} as never);
}

describe('EligibilityService.resolveCopayRate — 자격 반영(하드코딩 금지)', () => {
  it('🔴 자격조회 없음 + MEDICAID — 0%(30% 아님·과다청구 차단)', async () => {
    const { rate } = await makeSvc().resolveCopayRate('p1', 'MEDICAID', 'OUTPATIENT');
    expect(rate).toBe(0);
  });

  it('🔴 자격조회 없음 + 산재/자보 — 0%', async () => {
    expect((await makeSvc().resolveCopayRate('p1', 'INDUSTRIAL', 'OUTPATIENT')).rate).toBe(0);
    expect((await makeSvc().resolveCopayRate('p1', 'AUTO', 'OUTPATIENT')).rate).toBe(0);
  });

  it('자격조회 없음 + 건강보험 — 30% 폴백', async () => {
    expect((await makeSvc().resolveCopayRate('p1', 'NHI', 'OUTPATIENT')).rate).toBe(0.3);
  });

  it('자격조회 없음 + 자비 — 100%', async () => {
    expect((await makeSvc().resolveCopayRate('p1', 'SELF_PAY', 'OUTPATIENT')).rate).toBe(1.0);
  });

  it('의료급여 1종 자격 — config 기반 율(copayCategory 우선)', async () => {
    const svc = makeSvc({
      elig: { status: 'VALID', copayCategory: 'MA_TYPE1', queriedAt: new Date() },
      rateConfig: { 'billing.copay.ma1.outpatient': 0 }, // MA1 외래 0%
    });
    const { rate, copayCategory } = await svc.resolveCopayRate('p1', 'NHI', 'OUTPATIENT');
    expect(copayCategory).toBe('MA_TYPE1');
    expect(rate).toBe(0);
  });

  it('🔴 자격상실(EXPIRED/NOT_FOUND) — 전액본인부담(100%)', async () => {
    const svc = makeSvc({ elig: { status: 'EXPIRED', copayCategory: 'NHI', queriedAt: new Date() } });
    expect((await svc.resolveCopayRate('p1', 'NHI', 'OUTPATIENT')).rate).toBe(1.0);
  });
});
