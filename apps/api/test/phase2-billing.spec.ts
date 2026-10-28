import { describe, it, expect } from 'vitest';

// 본인부담률
const COPAY_RATES: Record<string, number> = {
  NHI: 0.3, MEDICAID: 0.0, INDUSTRIAL: 0.0, AUTO: 0.0, SELF_PAY: 1.0,
};

function calculateBilling(
  items: { unitPrice: number; quantity: number }[],
  insuranceType: string,
) {
  const copayRate = COPAY_RATES[insuranceType] ?? 0.3;
  const totalAmount = items.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0);
  const patientCopay = Math.round(totalAmount * copayRate);
  const insuranceCovered = totalAmount - patientCopay;
  return { totalAmount, patientCopay, insuranceCovered };
}

describe('Billing Calculation', () => {
  describe('NHI (건강보험 30%)', () => {
    it('초진 + 약 처방', () => {
      const items = [
        { unitPrice: 16820, quantity: 1 },  // 초진 진찰료
        { unitPrice: 68, quantity: 15 },     // 타이레놀 15정
      ];
      const result = calculateBilling(items, 'NHI');
      expect(result.totalAmount).toBe(16820 + 68 * 15); // 17840
      expect(result.patientCopay).toBe(Math.round(17840 * 0.3)); // 5352
      expect(result.insuranceCovered).toBe(17840 - 5352); // 12488
    });

    it('재진 + 검사', () => {
      const items = [
        { unitPrice: 11690, quantity: 1 },  // 재진 진찰료
        { unitPrice: 3890, quantity: 1 },   // CBC
      ];
      const result = calculateBilling(items, 'NHI');
      expect(result.totalAmount).toBe(15580);
      expect(result.patientCopay).toBe(Math.round(15580 * 0.3));
    });
  });

  describe('MEDICAID (의료급여 0%)', () => {
    it('본인부담금 0원', () => {
      const items = [{ unitPrice: 16820, quantity: 1 }];
      const result = calculateBilling(items, 'MEDICAID');
      expect(result.patientCopay).toBe(0);
      expect(result.insuranceCovered).toBe(16820);
    });
  });

  describe('SELF_PAY (자비 100%)', () => {
    it('전액 본인 부담', () => {
      const items = [{ unitPrice: 16820, quantity: 1 }, { unitPrice: 5120, quantity: 1 }];
      const result = calculateBilling(items, 'SELF_PAY');
      expect(result.totalAmount).toBe(21940);
      expect(result.patientCopay).toBe(21940);
      expect(result.insuranceCovered).toBe(0);
    });
  });

  describe('Edge Cases', () => {
    it('빈 항목 → 0원', () => {
      const result = calculateBilling([], 'NHI');
      expect(result.totalAmount).toBe(0);
      expect(result.patientCopay).toBe(0);
    });

    it('unknown insurance type → default 30%', () => {
      const result = calculateBilling([{ unitPrice: 10000, quantity: 1 }], 'UNKNOWN');
      expect(result.patientCopay).toBe(3000);
    });
  });
});

// ── 법정 13개 항목 분류 테스트 ──
const CATEGORIES_LEGAL = [
  { no: '①', name: '진찰료', types: ['CONSULTATION'] },
  { no: '②', name: '입원료', types: ['ADMISSION'] },
  { no: '③', name: '식대', types: ['MEAL', 'DIET'] },
  { no: '④', name: '투약·조제료', types: ['MEDICATION'] },
  { no: '⑤', name: '주사료', types: ['INJECTION'] },
  { no: '⑥', name: '마취료', types: ['ANESTHESIA'] },
  { no: '⑦', name: '이학요법료', types: ['PHYSICAL_THERAPY', 'REHAB'] },
  { no: '⑧', name: '정신요법료', types: ['PSYCHIATRIC_THERAPY'] },
  { no: '⑨', name: '처치·수술료', types: ['THERAPY', 'SURGERY', 'PROCEDURE'] },
  { no: '⑩', name: '검사료', types: ['LAB'] },
  { no: '⑪', name: '영상진단료', types: ['IMAGING'] },
  { no: '⑫', name: '치료재료대', types: ['MATERIAL'] },
  { no: '⑬', name: '전혈·혈액대', types: ['BLOOD', 'TRANSFUSION'] },
];

function classifyItems(items: { type: string; amount: number }[]) {
  return CATEGORIES_LEGAL.map(cat => {
    const matched = items.filter(i => cat.types.includes(i.type));
    const amount = matched.reduce((s, i) => s + i.amount, 0);
    return { ...cat, amount };
  });
}

describe('Legal 13 Categories (별지 제11호)', () => {
  it('13개 법정 항목이 올바른 순서', () => {
    expect(CATEGORIES_LEGAL).toHaveLength(13);
    expect(CATEGORIES_LEGAL[0].name).toBe('진찰료');
    expect(CATEGORIES_LEGAL[2].name).toBe('식대');  // 식대는 ③번
    expect(CATEGORIES_LEGAL[12].name).toBe('전혈·혈액대');
  });

  it('처방 타입이 올바른 카테고리에 분류', () => {
    const items = [
      { type: 'CONSULTATION', amount: 11690 },
      { type: 'MEDICATION', amount: 5000 },
      { type: 'LAB', amount: 3890 },
      { type: 'IMAGING', amount: 142000 },
      { type: 'PHYSICAL_THERAPY', amount: 5280 },
      { type: 'BLOOD', amount: 45000 },
      { type: 'PROCEDURE', amount: 28900 },
    ];
    const result = classifyItems(items);
    expect(result.find(c => c.name === '진찰료')!.amount).toBe(11690);
    expect(result.find(c => c.name === '투약·조제료')!.amount).toBe(5000);
    expect(result.find(c => c.name === '검사료')!.amount).toBe(3890);
    expect(result.find(c => c.name === '영상진단료')!.amount).toBe(142000);
    expect(result.find(c => c.name === '이학요법료')!.amount).toBe(5280);
    expect(result.find(c => c.name === '전혈·혈액대')!.amount).toBe(45000);
    expect(result.find(c => c.name === '처치·수술료')!.amount).toBe(28900);
  });

  it('미해당 항목은 0원', () => {
    const items = [{ type: 'CONSULTATION', amount: 11690 }];
    const result = classifyItems(items);
    expect(result.find(c => c.name === '마취료')!.amount).toBe(0);
    expect(result.find(c => c.name === '정신요법료')!.amount).toBe(0);
  });

  it('REHAB은 이학요법료로 분류', () => {
    const items = [{ type: 'REHAB', amount: 12300 }];
    const result = classifyItems(items);
    expect(result.find(c => c.name === '이학요법료')!.amount).toBe(12300);
  });

  it('TRANSFUSION은 전혈·혈액대로 분류', () => {
    const items = [{ type: 'TRANSFUSION', amount: 38000 }];
    const result = classifyItems(items);
    expect(result.find(c => c.name === '전혈·혈액대')!.amount).toBe(38000);
  });
});

// ── DB→프론트 필드 매핑 테스트 ──
function mapBillingItemToFrontend(dbItem: {
  codeType: string; codeId: string; codeName: string;
  amount: number; unitPrice: number; quantity: number;
  insuranceCategory?: string | null;
}) {
  return {
    type: dbItem.codeType,
    category: dbItem.codeType,
    name: dbItem.codeName,
    code: dbItem.codeId,
    totalPrice: dbItem.amount,
    unitPrice: dbItem.unitPrice,
    quantity: dbItem.quantity,
    insuranceType: dbItem.insuranceCategory ?? 'COVERED',
  };
}

describe('BillingItem Field Mapping (DB → Frontend)', () => {
  it('codeType → type/category', () => {
    const mapped = mapBillingItemToFrontend({
      codeType: 'LAB', codeId: 'E6541', codeName: 'CBC',
      amount: 3890, unitPrice: 3890, quantity: 1, insuranceCategory: 'COVERED',
    });
    expect(mapped.type).toBe('LAB');
    expect(mapped.category).toBe('LAB');
    expect(mapped.name).toBe('CBC');
    expect(mapped.totalPrice).toBe(3890);
    expect(mapped.insuranceType).toBe('COVERED');
  });

  it('null insuranceCategory → COVERED (default)', () => {
    const mapped = mapBillingItemToFrontend({
      codeType: 'MEDICATION', codeId: 'M001', codeName: '타이레놀',
      amount: 1020, unitPrice: 68, quantity: 15, insuranceCategory: null,
    });
    expect(mapped.insuranceType).toBe('COVERED');
  });

  it('NON_COVERED insuranceCategory preserved', () => {
    const mapped = mapBillingItemToFrontend({
      codeType: 'PHYSICAL_THERAPY', codeId: 'MM201', codeName: '도수치료',
      amount: 52800, unitPrice: 52800, quantity: 1, insuranceCategory: 'NON_COVERED',
    });
    expect(mapped.insuranceType).toBe('NON_COVERED');
  });
});

// ── 원단위 절사 테스트 ──
describe('Rounding (원단위 절사)', () => {
  const roundDown = (n: number, unit: number) => Math.floor(n / unit) * unit;

  it('10원 미만 절사', () => {
    expect(roundDown(5352, 10)).toBe(5350);
    expect(roundDown(11257, 10)).toBe(11250);
    expect(roundDown(10000, 10)).toBe(10000);
  });

  it('1원 단위 절사 없음', () => {
    expect(roundDown(5352, 1)).toBe(5352);
  });
});
