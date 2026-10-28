import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BillingService } from '../../src/modules/billing/billing.service';

/** 청구 심층검토 §2 — 비급여 항목 전액 본인부담(보험 과다청구 차단) */
describe('BillingService.buildPrescriptionLineItem — 비급여 full copay', () => {
  let svc: BillingService;
  const build = (rx: any, copayRate = 0.3) => (svc as any).buildPrescriptionLineItem(rx, copayRate);

  beforeEach(() => {
    svc = new BillingService({} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any);
  });

  it('비급여 약(insuranceCode 없음) → copayRate 1·fullCopay·NON_COVERED', () => {
    const r = build({ type: 'MEDICATION', medicationCodeId: 'm1', quantity: 2, medicationCode: { nameKo: '비급여약', unitPrice: 10000, insuranceCode: null } });
    expect(r.copayRate).toBe(1);
    expect(r.fullCopay).toBe(true);
    expect(r.insuranceCategory).toBe('NON_COVERED');
    expect(r.amount).toBe(20000); // 전액 환자 부담 근거
  });

  it('급여 약(insuranceCode 있음) → eligibility 율 유지', () => {
    const r = build({ type: 'MEDICATION', medicationCodeId: 'm2', quantity: 1, medicationCode: { nameKo: '급여약', unitPrice: 10000, insuranceCode: 'A123' } }, 0.3);
    expect(r.copayRate).toBe(0.3);
    expect(r.insuranceCategory).toBe('COVERED');
  });

  it('비급여 행위(insuranceCovered=false) → copayRate 1·NON_COVERED (마스터 copayRate 무시)', () => {
    const r = build({ type: 'PROCEDURE', procedureCodeId: 'p1', procedureCode: { nameKo: '비급여시술', unitPrice: 50000, insuranceCovered: false, copayRate: 0.2 } }, 0.3);
    expect(r.copayRate).toBe(1);
    expect(r.insuranceCategory).toBe('NON_COVERED');
  });

  it('급여 행위 → 마스터 copayRate 우선', () => {
    const r = build({ type: 'PROCEDURE', procedureCodeId: 'p2', procedureCode: { nameKo: '급여시술', unitPrice: 50000, insuranceCovered: true, copayRate: 0.5 } }, 0.3);
    expect(r.copayRate).toBe(0.5);
    expect(r.insuranceCategory).toBe('COVERED');
  });
});
