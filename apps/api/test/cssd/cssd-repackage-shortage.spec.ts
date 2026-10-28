/**
 * 🔴 재포장 자재 소모 — **부분 실패를 "부족 없음"으로 말하지 않는다**(2026-08-27).
 *
 * 원 결함: `CssdPackageService.repackage` 가
 *   `this.inventory.consumeForRepackage(...).catch(() => [])`
 * 라서, 소모 도중 한 품목이 실패하면 **앞 품목 재고는 이미 차감된 채로** 응답이 `shortages: []`
 * (= 부족 없음)이 됐다. 재고는 줄었는데 "부족 없다"고 말하는 상태
 * (v4.6.0 `.catch(()=>[])` 축 — 실패를 없음으로 번역하는 코드).
 *
 * 재주입 검증(실제로 되돌려 확인함):
 *   · `consumeForRepackage` 의 try/catch 를 걷어내고 반환을 `string[]` 로 되돌린 뒤
 *     호출부를 `.catch(() => [])` 로 바꾸면 → 아래 '부분 실패' 2건이 실패한다.
 * 대조군: 전부 성공하면 complete=true·failed=[] (무조건 미완료라 말하지 않는다).
 */
import { describe, it, expect, vi } from 'vitest';
import { CssdInventoryService } from '../../src/modules/cssd/cssd-inventory.service';
import { CssdPackageService } from '../../src/modules/cssd/cssd-package.service';

const item = (id: string, name: string, stock: number, safetyStock = 0) => ({ id, name, stock, safetyStock });

function inventorySvc(items: Record<string, ReturnType<typeof item>>, failOn?: { find?: string; update?: string; tx?: string }) {
  const prisma = {
    instrumentItem: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        if (failOn?.find === where.id) throw new Error(`find 실패(${where.id})`);
        return items[where.id] ?? null;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: { stock: { decrement: number } } }) => {
        if (failOn?.update === where.id) throw new Error(`update 실패(${where.id})`);
        return { stock: items[where.id].stock - data.stock.decrement };
      }),
    },
    supplyTransaction: {
      create: vi.fn(async ({ data }: { data: { itemId: string } }) => {
        if (failOn?.tx === data.itemId) throw new Error(`원장 기록 실패(${data.itemId})`);
        return {};
      }),
    },
  };
  const svc = new CssdInventoryService(prisma as never, {} as never, { enqueue: vi.fn() } as never);
  vi.spyOn((svc as unknown as { logger: { error: unknown } }).logger, 'error').mockImplementation((() => undefined) as never);
  return { svc, prisma };
}

describe('재포장 자재 소모 — 3상태로 말한다', () => {
  const items = { i1: item('i1', '켈리 겸자', 10), i2: item('i2', '수술 가위', 10), i3: item('i3', '포셉', 10) };
  const list = [{ itemId: 'i1', qty: 1 }, { itemId: 'i2', qty: 1 }, { itemId: 'i3', qty: 1 }];

  it('🔴 중간 품목이 실패하면 complete=false 이고 failed 에 담긴다 — shortages 는 "부족 없음"의 근거가 아니다', async () => {
    const { svc } = inventorySvc(items, { update: 'i2' });

    const r = await svc.consumeForRepackage(list, 'PKG-1', 'u1');

    expect(r.complete, '한 품목이라도 실패하면 판정이 끝나지 않은 것이다').toBe(false);
    expect(r.failed.map((f) => f.itemId)).toEqual(['i2']);
    // 🔴 앞 품목은 이미 차감됐다 — 그 사실이 응답에 남아야 한다(재고는 줄었는데 아무 말도 없던 것이 결함이었다)
    expect(r.consumed).toEqual(['켈리 겸자', '포셉']);
    expect(r.shortages).toEqual([]); // 판정된 것만. complete=false 와 함께 읽어야 한다
  });

  it('🔴 재고는 차감됐는데 원장 기록만 실패한 건도 failed 로 센다(차감은 되돌리지 않는다)', async () => {
    const { svc, prisma } = inventorySvc(items, { tx: 'i2' });

    const r = await svc.consumeForRepackage(list, 'PKG-1', 'u1');

    expect(r.complete).toBe(false);
    expect(r.consumed).toContain('수술 가위');        // 차감은 일어났다
    expect(r.failed[0].message).toContain('원장 기록 실패');
    expect(prisma.instrumentItem.update).toHaveBeenCalledTimes(3);
  });

  it('안전재고 이하로 떨어진 품목은 shortages 로 판정된다 — 대조군(무조건 빈 목록이 아니다)', async () => {
    const { svc } = inventorySvc({ i1: item('i1', '켈리 겸자', 3, 5), i2: item('i2', '수술 가위', 10) });

    const r = await svc.consumeForRepackage([{ itemId: 'i1', qty: 1 }, { itemId: 'i2', qty: 1 }], 'PKG-1');

    expect(r.shortages).toEqual(['켈리 겸자']);
    expect(r.complete).toBe(true);
    expect(r.failed).toEqual([]);
  });

  it('대조군 — 전부 성공하면 complete=true·failed=[]', async () => {
    const { svc } = inventorySvc(items);

    const r = await svc.consumeForRepackage(list, 'PKG-1');

    expect(r).toEqual({ shortages: [], consumed: ['켈리 겸자', '수술 가위', '포셉'], failed: [], complete: true });
  });
});

describe('repackage 응답 — 자재 소모 실패를 감추지 않는다', () => {
  function pkgSvc(consume: () => Promise<unknown>) {
    const prisma = {
      instrumentSetTemplate: { findUnique: vi.fn().mockResolvedValue({ id: 't1', name: '개복 세트', packagingType: 'POUCH', items: [{ itemId: 'i1', qty: 1 }] }) },
      sterilePackage: { count: vi.fn().mockResolvedValue(0), create: vi.fn().mockResolvedValue({ id: 'p1', lotNo: 'PKG-20260827-001' }) },
      packageEvent: { create: vi.fn().mockResolvedValue({}) },
    };
    const svc = new CssdPackageService(prisma as never, { consumeForRepackage: consume } as never, undefined);
    const errors: string[] = [];
    vi.spyOn((svc as unknown as { logger: { error: unknown } }).logger, 'error')
      .mockImplementation(((m: string) => { errors.push(m); }) as never);
    return { svc, errors };
  }

  it('🔴 소모 호출 자체가 던져도 패키지는 만들어지고(500 아님) inventory.complete=false 로 말한다', async () => {
    const { svc, errors } = pkgSvc(async () => { throw new Error('inventory down'); });

    const r = await svc.repackage({ templateId: 't1', countVerified: true, userId: 'u1' }) as {
      shortages: string[]; inventory: { complete: boolean; failed: { message: string }[] };
    };

    expect(r.inventory.complete, '실패를 "부족 없음"으로 번역하면 안 된다').toBe(false);
    expect(r.inventory.failed[0].message).toContain('inventory down');
    expect(r.shortages).toEqual([]);            // 빈 목록이지만 complete=false 가 함께 있다
    expect(errors.length, '흔적 없이 넘어가지 않는다').toBeGreaterThan(0);
  });

  it('대조군 — 정상 소모면 complete=true 이고 error 로그가 없다', async () => {
    const { svc, errors } = pkgSvc(async () => ({ shortages: ['켈리 겸자'], consumed: ['켈리 겸자'], failed: [], complete: true }));

    const r = await svc.repackage({ templateId: 't1', countVerified: true, userId: 'u1' }) as {
      shortages: string[]; inventory: { complete: boolean };
    };

    expect(r.inventory.complete).toBe(true);
    expect(r.shortages).toEqual(['켈리 겸자']);
    expect(errors).toEqual([]);
  });
});
