/**
 * 수납 화면 '진료 기반 자동 계산' = 실청구와 같은 함수(2026-10-14 결함 발굴 수납·청구 P4-2).
 *  · 🔴 종전: 진찰료 늘 재진 AA261 11,690(설정값) · 실청구에 없는 원내 조제료 AC200 4,500 · 약 수량 = 투약일수 ·
 *    코드별 본인부담 특례(예: 80%) 무시 · 의료급여 정액 빠짐 · 원 단위 절사 → 정상 청구에도 "N원 차이"
 *  · 같은 진료로 계산 패널과 실청구를 둘 다 돌려 총액·본인부담이 같아야 한다(대조군: 단가 미등재는 패널만 '모름')
 */
import { describe, it, expect, vi } from 'vitest';
import { BillingService } from '../../src/modules/billing/billing.service';

function mk(over: { copayCategory?: string; rate?: number; prior?: number } = {}) {
  const enc = {
    id: 'e1', visitType: 'OUTPATIENT', eligibilityCheckId: 'el1', status: 'SIGNED',
    patient: { id: 'p1', insuranceType: 'NHI' }, doctor: { department: '내과' }, appointment: null, diagnoses: [],
    prescriptions: [
      { id: 'rx1', type: 'MEDICATION', quantity: 6, duration: 3, medicationCodeId: 'm1', procedureCodeId: null,
        medicationCode: { code: 'M1', nameKo: '아목시실린', unitPrice: 1000, insuranceCode: 'A1', dosageForm: 'TAB' }, procedureCode: null },
      { id: 'rx2', type: 'IMAGING', quantity: 1, duration: null, medicationCodeId: null, procedureCodeId: 'pmri',
        medicationCode: null, procedureCode: { code: 'HE101', nameKo: 'MRI', unitPrice: 300000, insuranceCovered: true, copayRate: 0.8 } },
    ],
  };
  const created: any[] = [];
  const prisma: any = {
    encounter: { findUnique: vi.fn().mockResolvedValue(enc), count: vi.fn().mockResolvedValue(over.prior ?? 0) },
    procedureCode: { findFirst: vi.fn(async ({ where }: any) => ({ id: `pc-${where.code}`, code: where.code, nameKo: where.code === 'AA154' ? '초진 진찰료' : '재진 진찰료', unitPrice: where.code === 'AA154' ? 16820 : 11690 })) },
    systemConfig: { findMany: vi.fn().mockResolvedValue([]) },
    eligibilityCheck: { findFirst: vi.fn().mockResolvedValue({ id: 'el1' }) },
    billing: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn(async ({ data }: any) => { created.push(data); return { id: 'b1', ...data }; }) },
  };
  const elig = { resolveCopayRate: vi.fn().mockResolvedValue({ rate: over.rate ?? 0.3, copayCategory: over.copayCategory ?? 'NHI' }) };
  const config = { get: vi.fn(async (k: string) => (k === 'billing.institution.grade' ? 'CLINIC' : k.startsWith('billing.copay.ma') ? 1000 : undefined)) };
  const svc = new BillingService(prisma, {} as any, { enqueue: vi.fn() } as any, config as any, elig as any, {} as any, {} as any);
  (svc as any).resolveCopay = vi.fn().mockResolvedValue({ rate: over.rate ?? 0.3, copayCategory: over.copayCategory ?? 'NHI' });
  (svc as any).applyCopayCap = vi.fn(async (_p: string, c: number) => ({ patientCopay: c, capExcess: 0 }));
  return { svc, created };
}

describe('🔴 계산 패널 = 실청구', () => {
  it('초진·약 수량(투약일수 아님)·MRI 코드 특례 80% · 절사 없음 — 총액·본인부담이 실청구와 같다', async () => {
    const { svc, created } = mk({ prior: 0 });
    const calc: any = await svc.calculateBilling('e1');
    await svc.createFromEncounter('e1');
    expect(calc.summary.totalAmount).toBe(created[0].totalAmount);
    expect(calc.summary.patientCopay).toBe(created[0].patientCopay);
    // 종별 CLINIC(의원) → 초진 AA154 — 실청구와 같은 종별 정본(2026-10-20 · 종전 상급종합 AA157 고정)
    expect(calc.items.map((i: any) => i.code)).toEqual(['AA154', 'M1', 'HE101']);
    expect(calc.items.find((i: any) => i.code === 'AC200')).toBeUndefined();
    // 16,820×0.3 + 6,000×0.3 + 300,000×0.8 = 5,046 + 1,800 + 240,000 (절사 없음)
    expect(calc.summary.patientCopay).toBe(246846);
  });
  it('재진 · 의료급여 1종 외래 정액 — 실청구와 같다', async () => {
    const { svc, created } = mk({ prior: 3, copayCategory: 'MA_TYPE1', rate: 0 });
    const calc: any = await svc.calculateBilling('e1');
    await svc.createFromEncounter('e1');
    expect(calc.items[0].code).toBe('AA254');
    expect(calc.summary.patientCopay).toBe(created[0].patientCopay);
    expect(calc.summary.patientCopay).toBe(1000);
  });
});
