import { describe, it, expect } from 'vitest';
import { BillingService } from '../../src/modules/billing/billing.service';
import { isReducedCopay, REDUCED_COPAY_CATEGORIES } from '../../src/modules/eligibility/eligibility.service';

/**
 * 🔴 **본인부담 우선순위 — 비급여 > 감면 자격 > 코드별 특례 > 자격 기본율**
 *
 * 2026-08-27 운영 실측: 청구가 행위 코드의 `copayRate` 오버라이드를 **자격보다 먼저** 적용했다.
 *   · 산정특례 3건 — 자격 10% 인데 **30%** 청구
 *   · 차상위 1건 — 자격 14% 인데 **30%** 청구
 *   · 산재·보훈·자보(본인부담 0)에 그 코드가 쓰였다면 0원이어야 할 것이 청구됐을 것이다
 *
 * 이 저장소에는 같은 유형의 사고 이력이 있다(telehealth `copayRate=0.3` 하드코딩 →
 * 의료급여·산재·자보 과다청구). 그래서 **자격 우선**이 정본이다.
 */
const build = (
  codeRate: number | null,
  eligRate: number,
  category: string | null,
  covered = true,
) => {
  const svc = Object.create(BillingService.prototype) as BillingService;
  const rx = {
    id: 'rx1', type: 'PROCEDURE', medicationCodeId: null, procedureCodeId: 'p1', quantity: 1,
    procedureCode: {
      nameKo: 'MRI', unitPrice: 10000,
      copayRate: codeRate === null ? null : ({ toString: () => String(codeRate) } as never),
      insuranceCovered: covered,
    },
  };
  return (svc as unknown as {
    buildPrescriptionLineItem(r: unknown, e: number, c?: string | null): { copayRate: number } | null;
  }).buildPrescriptionLineItem(rx, eligRate, category);
};

describe('본인부담 우선순위', () => {
  it('🔴 감면 자격은 코드별 특례를 **이긴다** — 산정특례가 30%로 청구되던 것', () => {
    expect(build(0.3, 0.1, 'SPECIAL_EXEMPTION')!.copayRate).toBe(0.1);
  });

  it('🔴 차상위도 자격이 이긴다 — 14% 여야 하는데 30% 였다', () => {
    expect(build(0.3, 0.14, 'NEAR_POOR')!.copayRate).toBe(0.14);
  });

  it('🔴 본인부담 0 자격(산재·보훈·자보)에 코드 율이 새지 않는다', () => {
    for (const c of ['INDUSTRIAL', 'PATRIOT', 'AUTO']) {
      expect(build(0.8, 0, c)!.copayRate, `${c} 에 코드 특례가 적용됐다`).toBe(0);
    }
  });

  it('🔴 의료급여도 자격이 이긴다', () => {
    expect(build(0.3, 0, 'MA_TYPE1')!.copayRate).toBe(0);
  });

  /**
   * 🔴 **반대 방향 대조군** — 이것이 없으면 "전부 자격으로 덮는" 가드가 되고,
   *    MRI 80% 같은 고시 특례가 30%로 깎여 **또 다른 틀린 청구**가 된다.
   */
  it('🔴 대조군: 일반 건보(NHI)에는 코드 특례가 이긴다 — MRI 80% 가 30% 로 깎이면 안 된다', () => {
    expect(build(0.8, 0.3, 'NHI')!.copayRate).toBe(0.8);
  });

  it('대조군: 코드 특례가 없으면 자격 기본율을 그대로 쓴다', () => {
    expect(build(null, 0.3, 'NHI')!.copayRate).toBe(0.3);
    expect(build(null, 0.1, 'SPECIAL_EXEMPTION')!.copayRate).toBe(0.1);
  });

  it('🔴 비급여는 자격·코드와 무관하게 전액 본인부담이다(감면이 뚫지 못한다)', () => {
    expect(build(0.3, 0, 'MA_TYPE1', false)!.copayRate).toBe(1);
    expect(build(null, 0.1, 'SPECIAL_EXEMPTION', false)!.copayRate).toBe(1);
  });

  it('자격 구분이 없으면(미상) 종전대로 코드 특례를 쓴다 — 조용히 감면하지 않는다', () => {
    expect(build(0.8, 0.3, null)!.copayRate).toBe(0.8);
    expect(build(0.8, 0.3, undefined as never)!.copayRate).toBe(0.8);
  });
});

describe('감면 자격 어휘 — 정본 하나', () => {
  it('감면 목록에 0원 자격과 감면 자격이 모두 있다', () => {
    for (const c of ['MA_TYPE1', 'MA_TYPE2', 'MEDICAID', 'NEAR_POOR', 'SPECIAL_EXEMPTION', 'PATRIOT', 'INDUSTRIAL', 'AUTO']) {
      expect(isReducedCopay(c), `${c} 가 감면 목록에 없다`).toBe(true);
    }
  });

  it('🔴 일반 건보·전액 자부담은 감면이 아니다(전부 감면으로 접히지 않았다)', () => {
    expect(isReducedCopay('NHI')).toBe(false);
    expect(isReducedCopay('SELF_PAY')).toBe(false);
    expect(isReducedCopay(null)).toBe(false);
    expect(isReducedCopay(undefined)).toBe(false);
  });

  it('어휘가 한 곳에만 있다 — 청구가 자기 목록을 따로 갖지 않는다', () => {
    expect(REDUCED_COPAY_CATEGORIES.size).toBeGreaterThan(5);
  });
});
