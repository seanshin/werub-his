import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BloodBankService } from '../../src/modules/blood-bank/blood-bank.service';

/** 혈액은행 잔여 3건(A-7) — 특수제제 오더 자동매칭·MTP 팩 자동소진·재고임계 SystemConfig화 */
describe('혈액은행 잔여(A-7)', () => {
  let service: BloodBankService;
  let mockPrisma: any;
  let configMap: Record<string, unknown>;

  const unit = (over: Record<string, unknown> = {}) => ({
    id: 'bp-1', unitNumber: 'U001', productType: 'RBC', bloodType: 'A', rhFactor: 'POS', status: 'AVAILABLE',
    volume: 320, expiresAt: new Date('2099-07-01'), irradiated: false, leukoreduced: false, cmvNegative: false, washed: false, ...over,
  });

  beforeEach(() => {
    configMap = {};
    mockPrisma = {
      transfusionOrder: { findUnique: vi.fn().mockResolvedValue({ id: 'o-1', patientId: 'p-1', productType: 'RBC', units: 2, specialReqs: null }) },
      patientBloodTyping: { findUnique: vi.fn().mockResolvedValue({ abo: 'A', rh: 'POS' }) },
      patientAntibody: { findMany: vi.fn().mockResolvedValue([]) },
      bloodProduct: {
        findMany: vi.fn().mockResolvedValue([unit()]),
        findUnique: vi.fn().mockResolvedValue(unit()),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        groupBy: vi.fn().mockResolvedValue([]),
      },
      bloodCrossmatch: { findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn().mockResolvedValue({ id: 'cx-1', result: 'COMPATIBLE', validUntil: new Date('2099-01-01') }) },
      bloodTransfusion: { create: vi.fn().mockResolvedValue({ id: 't-1', orderId: 'o-1', bloodProductId: 'bp-1', patientId: 'p-1' }), count: vi.fn().mockResolvedValue(0) },
      massiveTransfusionProtocol: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      $transaction: vi.fn().mockImplementation((arg) => (typeof arg === 'function' ? arg(mockPrisma) : Promise.all(arg))),
    };
    const config = { get: vi.fn(async (k: string) => configMap[k] ?? null) };
    service = new BloodBankService(mockPrisma, config as any);
  });

  describe('특수제제 오더 자동매칭 (getCandidateUnits)', () => {
    it('ABO/Rh 적합 + 특수요구 충족 유닛만 추천·교차상태 주석', async () => {
      mockPrisma.transfusionOrder.findUnique.mockResolvedValue({ id: 'o-1', patientId: 'p-1', productType: 'RBC', units: 2, specialReqs: { irradiated: true } });
      mockPrisma.bloodProduct.findMany.mockResolvedValue([
        unit({ id: 'u-ok', unitNumber: 'OK', irradiated: true }),                      // 적합+조사제제
        unit({ id: 'u-no-irr', unitNumber: 'NOIRR', irradiated: false }),              // 특수요구 미충족 → 제외
        unit({ id: 'u-incompat', unitNumber: 'BADABO', bloodType: 'B', irradiated: true }), // ABO 부적합 → 제외
      ]);
      mockPrisma.bloodCrossmatch.findMany.mockResolvedValue([
        { bloodProductId: 'u-ok', result: 'COMPATIBLE', validUntil: new Date('2099-01-01'), testedAt: new Date() },
      ]);
      const r = await service.getCandidateUnits('o-1');
      expect(r.total).toBe(1);
      expect(r.items[0]).toEqual(expect.objectContaining({ id: 'u-ok', crossmatch: 'COMPATIBLE_VALID', readyToIssue: true }));
    });

    it('교차 미시행 유닛은 readyToIssue=false·정렬은 적합유효 우선→FEFO', async () => {
      mockPrisma.bloodProduct.findMany.mockResolvedValue([
        unit({ id: 'u-early', unitNumber: 'EARLY', expiresAt: new Date('2099-01-01') }), // 교차 없음(FEFO 선두)
        unit({ id: 'u-xm', unitNumber: 'XM', expiresAt: new Date('2099-06-01') }),       // 교차 적합·유효
      ]);
      mockPrisma.bloodCrossmatch.findMany.mockResolvedValue([
        { bloodProductId: 'u-xm', result: 'COMPATIBLE', validUntil: new Date('2099-01-01'), testedAt: new Date() },
      ]);
      const r = await service.getCandidateUnits('o-1');
      expect(r.items.map((i: any) => i.id)).toEqual(['u-xm', 'u-early']); // 즉시 출고 가능 우선
      expect(r.items[1].crossmatch).toBe('NONE');
      expect(r.items[1].readyToIssue).toBe(false);
    });

    it('FFP 등 교차 불요 카테고리는 NOT_REQUIRED·즉시 출고 가능', async () => {
      mockPrisma.transfusionOrder.findUnique.mockResolvedValue({ id: 'o-1', patientId: 'p-1', productType: 'FFP', units: 2, specialReqs: null });
      mockPrisma.bloodProduct.findMany.mockResolvedValue([unit({ id: 'u-ffp', productType: 'FFP', bloodType: 'A' })]);
      const r = await service.getCandidateUnits('o-1');
      expect(r.items[0]?.crossmatch).toBe('NOT_REQUIRED');
      expect(r.items[0]?.readyToIssue).toBe(true);
    });
  });

  describe('MTP 팩 자동소진', () => {
    it('정규 출고 성공 → 활성 MTP packsIssued +1 (best-effort)', async () => {
      await service.issueBlood('o-1', 'bp-1');
      await new Promise((r) => setTimeout(r, 0));
      expect(mockPrisma.massiveTransfusionProtocol.updateMany).toHaveBeenCalledWith({
        where: { patientId: 'p-1', status: 'ACTIVE' },
        data: { packsIssued: { increment: 1 } },
      });
    });

    it('긴급 출고도 동일 반영', async () => {
      await service.issueEmergency('o-1', 'bp-1', '외상 대량출혈');
      await new Promise((r) => setTimeout(r, 0));
      expect(mockPrisma.massiveTransfusionProtocol.updateMany).toHaveBeenCalled();
    });

    it('MTP 갱신 실패해도 출고는 성공(비차단)', async () => {
      mockPrisma.massiveTransfusionProtocol.updateMany.mockRejectedValue(new Error('db down'));
      const r = await service.issueBlood('o-1', 'bp-1');
      expect(r).toEqual(expect.objectContaining({ id: 't-1' }));
    });
  });

  describe('재고임계 SystemConfig화 (getInventoryAlerts)', () => {
    it('config 미설정 → 기본 min 2·미달 조합 경고', async () => {
      mockPrisma.bloodProduct.groupBy
        .mockResolvedValueOnce([{ productType: 'RBC', bloodType: 'A', rhFactor: 'POS', _count: { id: 1 } }]) // AVAILABLE 통계
        .mockResolvedValueOnce([{ productType: 'RBC', _count: { id: 1 } }]); // 이력 유형
      const r = await service.getInventoryAlerts();
      expect(r.min).toBe(2);
      expect(r.alerts).toContainEqual({ productType: 'RBC', bloodType: 'A', rhFactor: 'POS', count: 1, min: 2 });
    });

    it('bloodbank.inventoryMin=5 반영 + 제제별 차등(inventoryMinByType) 오버라이드', async () => {
      configMap['bloodbank.inventoryMin'] = 5;
      configMap['bloodbank.inventoryMinByType'] = { FFP: 1 };
      mockPrisma.bloodProduct.groupBy
        .mockResolvedValueOnce([
          { productType: 'RBC', bloodType: 'A', rhFactor: 'POS', _count: { id: 3 } }, // min 5 미달 → 경고
          { productType: 'FFP', bloodType: 'A', rhFactor: 'POS', _count: { id: 2 } }, // 차등 min 1 충족 → 경고 없음
        ])
        .mockResolvedValueOnce([]);
      const r = await service.getInventoryAlerts();
      expect(r.min).toBe(5);
      expect(r.alerts).toContainEqual({ productType: 'RBC', bloodType: 'A', rhFactor: 'POS', count: 3, min: 5 });
      expect(r.alerts.find((a: any) => a.productType === 'FFP' && a.bloodType === 'A' && a.rhFactor === 'POS')).toBeUndefined();
    });

    it('완전 소진(0) 조합 경고 — 키 공간은 DB 정본(ABO×rhFactor)이다', async () => {
      // 🔴 종전엔 표준표를 'A+' 합성 문자열로 만들어 실재 키('A'+'POS')와 영원히 어긋났고,
      //    실재 재고가 있어도 유령 0 알림 32건이 섰다(2026-08-13 W3 실측).
      mockPrisma.bloodProduct.groupBy
        .mockResolvedValueOnce([{ productType: 'RBC', bloodType: 'A', rhFactor: 'POS', _count: { id: 9 } }])
        .mockResolvedValueOnce([{ productType: 'RBC', _count: { id: 9 } }]);
      const r = await service.getInventoryAlerts();
      expect(r.alerts).toContainEqual({ productType: 'RBC', bloodType: 'O', rhFactor: 'NEG', count: 0, min: 2 });
      expect(r.alerts.filter((a: any) => a.count === 0)).toHaveLength(7); // A+(POS) 제외 ABO×Rh 7조합
      // 실재 재고 조합(A POS 9단위)이 0 으로 서지 않는다 — 유령 알림 회귀 방지
      expect(r.alerts.find((a: any) => a.bloodType === 'A' && a.rhFactor === 'POS' && a.count === 0)).toBeUndefined();
    });
  });
});
