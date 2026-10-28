import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BloodBankService } from '../../src/modules/blood-bank/blood-bank.service';

/**
 * 재고 통계의 Rh 축 가드 (W8 이연 회수 · 2026-08-14)
 *
 * 🔴 원 결함: `GET /api/v1/blood-bank/inventory/stats` 의 groupBy 축이
 *    `[productType, bloodType, status]` 뿐이라 **`rhFactor` 가 빠져 있었다**.
 *    `bloodType` 은 ABO(A·B·O·AB) 뿐인데 화면·위젯은 "A형 6" 을 "A+ 6" 으로 읽는다.
 *    운영 실측(2026-08-14 · docker-postgres-1 hospitalrun):
 *      A/POS 5 · A/NEG 1 · AB/POS 2 · B/POS 3 · O/POS 6(+ISSUED 1) · O/NEG 1
 *    → 종전 응답은 `A: 6`. 이걸 'A+ 6' 이라 말하면 **수혈 적합성 오정보**다
 *      (RhD 음성 수혈자에게 양성 재고를 있다고 말하는 것과 같다).
 *
 * 원칙: **혈액형은 추정하지 않는다.** 축에 넣어 실제로 세거나, 모르면 모른다고 한다.
 */
describe('BloodBankService.getInventoryStats — Rh 축', () => {
  let service: BloodBankService;
  let prisma: any;

  beforeEach(() => {
    prisma = { bloodProduct: { groupBy: vi.fn() } };
    service = new BloodBankService(prisma);
  });

  /** 운영 실측 그대로 */
  const LIVE = [
    { productType: 'PRBC', bloodType: 'A', rhFactor: 'POS', status: 'AVAILABLE', _count: { id: 5 } },
    { productType: 'PRBC', bloodType: 'A', rhFactor: 'NEG', status: 'AVAILABLE', _count: { id: 1 } },
    { productType: 'PRBC', bloodType: 'AB', rhFactor: 'POS', status: 'AVAILABLE', _count: { id: 2 } },
    { productType: 'PRBC', bloodType: 'B', rhFactor: 'POS', status: 'AVAILABLE', _count: { id: 3 } },
    { productType: 'PRBC', bloodType: 'O', rhFactor: 'POS', status: 'AVAILABLE', _count: { id: 6 } },
    { productType: 'PRBC', bloodType: 'O', rhFactor: 'NEG', status: 'AVAILABLE', _count: { id: 1 } },
    { productType: 'PRBC', bloodType: 'O', rhFactor: 'POS', status: 'ISSUED', _count: { id: 1 } },
  ];

  it('🔴 groupBy 축에 rhFactor 가 반드시 있다 — 없으면 A+/A− 를 구분할 수 없다(역검증 지점)', async () => {
    prisma.bloodProduct.groupBy.mockResolvedValue(LIVE);
    await service.getInventoryStats();

    const by = prisma.bloodProduct.groupBy.mock.calls[0][0].by as string[];
    expect(by).toContain('rhFactor');
    expect(by).toContain('bloodType');
    expect(by).toContain('status');
  });

  it('A+ 5 와 A− 1 이 한 행으로 뭉치지 않는다 (실측)', async () => {
    prisma.bloodProduct.groupBy.mockResolvedValue(LIVE);
    const rows = await service.getInventoryStats();

    const aRows = rows.filter(r => r.bloodType === 'A');
    expect(aRows).toHaveLength(2);
    expect(aRows.find(r => r.rhFactor === 'POS')?.count).toBe(5);
    expect(aRows.find(r => r.rhFactor === 'NEG')?.count).toBe(1);
    // 🔴 종전 결함이면 여기서 6 이 잡히고, 화면은 그것을 'A+ 6' 으로 읽었다
    expect(aRows.find(r => r.count === 6)).toBeUndefined();
  });

  it('표시 라벨은 ABO+Rh 를 붙여 정본으로 낸다', async () => {
    prisma.bloodProduct.groupBy.mockResolvedValue(LIVE);
    const rows = await service.getInventoryStats();

    expect(rows.find(r => r.bloodType === 'A' && r.rhFactor === 'POS')?.bloodTypeLabel).toBe('A+');
    expect(rows.find(r => r.bloodType === 'A' && r.rhFactor === 'NEG')?.bloodTypeLabel).toBe('A-');
    expect(rows.every(r => r.rhKnown)).toBe(true);
  });

  it('Rh 표기가 +/- 로 들어와도 POS/NEG 정본으로 정규화한다', async () => {
    prisma.bloodProduct.groupBy.mockResolvedValue([
      { productType: 'PRBC', bloodType: 'A', rhFactor: '+', status: 'AVAILABLE', _count: { id: 2 } },
      { productType: 'PRBC', bloodType: 'A', rhFactor: '-', status: 'AVAILABLE', _count: { id: 1 } },
    ]);
    const rows = await service.getInventoryStats();
    expect(rows.map(r => r.bloodTypeLabel)).toEqual(['A+', 'A-']);
  });

  it('🔴 원장에 Rh 가 없으면 표기를 지어내지 않는다 — ABO 만 두고 rhKnown=false', async () => {
    prisma.bloodProduct.groupBy.mockResolvedValue([
      { productType: 'PRBC', bloodType: 'A', rhFactor: null, status: 'AVAILABLE', _count: { id: 4 } },
    ]);
    const rows = await service.getInventoryStats();

    expect(rows[0].rhFactor).toBeNull();
    expect(rows[0].rhKnown).toBe(false);
    expect(rows[0].bloodTypeLabel).toBe('A');
    expect(rows[0].bloodTypeLabel).not.toContain('+');
    expect(rows[0].bloodTypeLabel).not.toContain('-');
  });

  it('상태별 합만 보는 종전 소비처는 그대로 동작한다(키 제거 없음)', async () => {
    prisma.bloodProduct.groupBy.mockResolvedValue(LIVE);
    const rows = await service.getInventoryStats();

    const sum = (s: string) => rows.filter(r => r.status === s).reduce((a, r) => a + r.count, 0);
    expect(sum('AVAILABLE')).toBe(18);
    expect(sum('ISSUED')).toBe(1);
    expect(rows.every(r => 'productType' in r && 'bloodType' in r && 'status' in r && 'count' in r)).toBe(true);
  });
});
