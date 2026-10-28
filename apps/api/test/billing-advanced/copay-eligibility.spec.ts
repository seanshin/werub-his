import { describe, it, expect, vi } from 'vitest';
import { BillingAdvancedService } from '../../src/modules/billing-advanced/billing-advanced.service';

/**
 * 🔴 FFS/DRG 견적 본인부담이 자격 정본을 반영한다 (2026-09-01 · 발굴).
 * 종전엔 flat 0.3/코드율만 써서 의료급여·산재·자보 환자에게 30% 견적을 보여줬다(정본 우회).
 * 우선순위: 감면자격 > 코드특례(고시) > 자격기본.
 */
function svc(elig: { rate: number; copayCategory: string }, encounter?: any) {
  const prisma: any = {
    encounter: {
      findUnique: vi.fn().mockResolvedValue(encounter ?? { patientId: 'p1', patient: { insuranceType: 'MEDICAID' } }),
    },
    procedureCode: { findFirst: vi.fn().mockResolvedValue(null) },
    systemConfig: { findUnique: vi.fn().mockResolvedValue(null) },
  };
  const eligibility: any = { resolveCopayRate: vi.fn().mockResolvedValue(elig) };
  return new BillingAdvancedService(prisma, eligibility);
}

describe('DRG 포괄수가 견적 — 자격 반영', () => {
  it('🔴 의료급여(감면)는 flat 30% 가 아니라 자격율로 계산', async () => {
    const s = svc({ rate: 0, copayCategory: 'MA_TYPE1' }); // 의료급여 1종 = 0%
    const r = await s.calculateDRG('e1', 'G01');
    expect(r.patientCopay).toBe(0); // 종전엔 500000*0.3=150000 을 물렸다
    expect(r.insuranceCovered).toBe(500000);
  });
  it('건보(NHI)는 자격 기본율(30%)', async () => {
    const s = svc({ rate: 0.3, copayCategory: 'NHI' }, { patientId: 'p2', patient: { insuranceType: 'NHI' } });
    const r = await s.calculateDRG('e2', 'G01');
    expect(r.patientCopay).toBe(150000);
  });
});

describe('FFS 우선순위', () => {
  it('🔴 감면 자격이면 코드특례(고시 80%)를 이긴다', async () => {
    const prisma: any = {
      encounter: { findUnique: vi.fn().mockResolvedValue({
        id: 'e1', patientId: 'p1', patient: { id: 'p1', insuranceType: 'MEDICAID' }, appointment: { type: 'INITIAL' },
        prescriptions: [{ status: 'ACTIVE', type: 'IMAGING', quantity: 1, duration: 1, procedureCode: { code: 'MRI', nameKo: 'MRI', unitPrice: 100000, copayRate: 0.8 } }],
      }) },
      procedureCode: { findFirst: vi.fn().mockResolvedValue(null) },
      systemConfig: { findUnique: vi.fn().mockResolvedValue(null) },
    };
    const eligibility: any = { resolveCopayRate: vi.fn().mockResolvedValue({ rate: 0.14, copayCategory: 'MA_TYPE2' }) };
    const s = new BillingAdvancedService(prisma, eligibility);
    const r = await s.calculateFFS('e1');
    // MRI 코드특례 80% 가 아니라 의료급여 14% 가 적용돼야 한다
    const mri = r!.items.find((i) => i.code === 'MRI')!;
    expect(mri.copayRate).toBe(0.14);
  });
});
