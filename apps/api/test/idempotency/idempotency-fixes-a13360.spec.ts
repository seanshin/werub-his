import { describe, it, expect, vi, afterEach } from 'vitest';
import { BadRequestException, ConflictException } from '@nestjs/common';

import { ClaimService } from '../../src/modules/claim/claim.service';
import { InsuranceClaimService } from '../../src/modules/insurance-claim/insurance-claim.service';
import { InventoryService, nextDailyDocNumber } from '../../src/modules/inventory/inventory.service';
import { CssdPoService } from '../../src/modules/cssd/cssd-po.service';

/**
 * 🔴 재시도·멱등 재판정 a13360(2026-09-28) — **봉합한 자리의 동작 계약**.
 *
 * 기준선 스펙(`architecture/idempotency-inventory.spec.ts`)은 "가드가 있다"만 센다. 여기서는 그 가드가
 * **동시에 온 두 요청**을 실제로 가르는지 부른다(순차 재클릭만 보면 check-then-act 경합은 영원히 초록이다).
 *
 * 목은 정본의 실제 모양을 쓴다 — `withAdvisoryLock` 은 `$transaction(cb)` 안에서
 * `tx.$executeRaw\`SELECT pg_advisory_xact_lock(hashtext(${key}))\`` 를 부르고 트랜잭션이 끝나면 풀린다.
 * 아래 `fakeDb` 는 그 잠금을 **키별 직렬화**로 흉내낸다(키가 다르면 병행) — 잠금을 부르지 않는 코드는 직렬화되지 않는다.
 */

type Row = Record<string, any>;

/** await 사이에서 두 요청이 실제로 엇갈리게 한 틱 양보한다 */
const tick = () => new Promise<void>((r) => setImmediate(r));

function fakeDb(tables: Record<string, Row[]>) {
  const locks = new Map<string, Promise<void>>();
  const lockKeys: string[] = [];
  let seq = 0;

  const match = (row: Row, where: Row = {}): boolean =>
    Object.entries(where).every(([k, v]) => {
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        if ('startsWith' in v) return String(row[k] ?? '').startsWith(v.startsWith);
        if ('not' in v) return row[k] !== v.not;
        if ('in' in v) return (v.in as unknown[]).includes(row[k]);
      }
      return row[k] === v;
    });

  const delegate = (name: string) => ({
    findMany: vi.fn(async (a: Row = {}) => { await tick(); return tables[name].filter((r) => match(r, a.where)).map((r) => ({ ...r })); }),
    findFirst: vi.fn(async (a: Row = {}) => { await tick(); const r = tables[name].find((x) => match(x, a.where)); return r ? { ...r } : null; }),
    findUnique: vi.fn(async (a: Row = {}) => {
      await tick();
      const r = tables[name].find((x) => match(x, a.where));
      if (!r) return null;
      const out = { ...r };
      if (a.include?.lines) out.lines = tables.cssdPoLine.filter((l) => l.poId === r.id).map((l) => ({ ...l }));
      return out;
    }),
    count: vi.fn(async (a: Row = {}) => { await tick(); return tables[name].filter((r) => match(r, a.where)).length; }),
    create: vi.fn(async (a: Row) => {
      await tick();
      const { items, lines, ...data } = a.data;
      void items; void lines;
      const row = { id: `${name}-${++seq}`, ...data };
      tables[name].push(row);
      return { ...row };
    }),
    update: vi.fn(async (a: Row) => {
      await tick();
      const r = tables[name].find((x) => match(x, a.where));
      if (!r) throw new Error(`${name} 없음`);
      for (const [k, v] of Object.entries(a.data)) {
        r[k] = v && typeof v === 'object' && 'increment' in (v as Row) ? r[k] + (v as Row).increment : v;
      }
      const out = { ...r };
      if (a.include?.lines) out.lines = tables.cssdPoLine.filter((l) => l.poId === r.id).map((l) => ({ ...l }));
      return out;
    }),
  });

  const prisma: Row = {};
  for (const t of Object.keys(tables)) prisma[t] = delegate(t);
  prisma.$transaction = vi.fn(async (arg: unknown) => {
    if (typeof arg !== 'function') return Promise.all(arg as unknown[]);
    const held: Array<() => void> = [];
    const tx = {
      ...prisma,
      $executeRaw: vi.fn(async (_s: TemplateStringsArray, key: string) => {
        lockKeys.push(key);
        const prev = locks.get(key) ?? Promise.resolve();
        let release!: () => void;
        const mine = new Promise<void>((r) => { release = r; });
        locks.set(key, prev.then(() => mine));
        await prev;
        held.push(release);
        return 1;
      }),
    };
    try {
      return await (arg as (t: unknown) => Promise<unknown>)(tx);
    } finally {
      held.forEach((r) => r());
    }
  });
  return { prisma, tables, lockKeys };
}

afterEach(() => vi.restoreAllMocks());

// ── ① 청구 일괄 생성 ────────────────────────────────────────────────────────
describe('🔴 청구 생성 — 동시에 두 번 눌러도 같은 수납에 청구가 두 벌 생기지 않는다', () => {
  const billing = {
    id: 'bill-1', status: 'PAID', patientId: 'p-1', totalAmount: 1000, insuranceCovered: 700, patientCopay: 300,
    patient: { id: 'p-1', insuranceType: 'NHI' }, items: [],
  };
  const make = (claims: Row[] = []) => {
    const db = fakeDb({ billing: [billing], claim: claims });
    // 후보 조회(`claims: { none: {} }`)는 관계 필터라 fakeDb 가 해석하지 않는다 — 정본 모양 그대로 "그 순간 청구 없는 수납"을 돌려준다
    db.prisma.billing.findMany = vi.fn(async () => { await tick(); return db.tables.claim.some((c) => c.billingId === 'bill-1') ? [] : [billing]; });
    const svc = new ClaimService(db.prisma as never, { enqueue: vi.fn() } as never, { create: vi.fn() } as never);
    return { db, svc };
  };

  it('🔴 동시 호출 둘 → 청구 1건 · 패자는 skipped 로 말한다', async () => {
    const { db, svc } = make();
    const [a, b] = await Promise.all([svc.generateClaims(), svc.generateClaims()]);
    expect(db.tables.claim.filter((c) => c.billingId === 'bill-1')).toHaveLength(1);
    expect(a.generated + b.generated).toBe(1);
    expect(a.skipped + b.skipped).toBe(1);
  });

  it('🔴 수납 단위로 잠근다 — 형제 경로(InsuranceClaimService.create)와 같은 키', async () => {
    const { db, svc } = make();
    await svc.generateClaims();
    expect(db.lockKeys).toEqual(['claim:billing:bill-1']);
  });

  it('대조군 — 청구가 없으면 정상 생성한다(막기만 하는 가드가 아니다)', async () => {
    const { db, svc } = make();
    const r = await svc.generateClaims();
    expect(r).toEqual(expect.objectContaining({ generated: 1, skipped: 0 }));
    expect(db.tables.claim[0]).toEqual(expect.objectContaining({ billingId: 'bill-1', claimedAmount: 700 }));
  });
});

describe('🔴 수납 한 건 청구(InsuranceClaimService.create) — 동시 두 요청 중 하나만 만든다', () => {
  it('🔴 둘 중 하나는 ConflictException · 청구는 1건', async () => {
    const db = fakeDb({ billing: [{ id: 'bill-1', patientId: 'p-1', totalAmount: 1000, insuranceCovered: 700, items: [], status: 'PAID', patient: { insuranceType: 'NHI' } }], claim: [] });
    const svc = new InsuranceClaimService(db.prisma as never);
    const res = await Promise.allSettled([svc.create('bill-1'), svc.create('bill-1')]);
    expect(res.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rej = res.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(rej.reason).toBeInstanceOf(ConflictException);
    expect(db.tables.claim).toHaveLength(1);
    expect(db.lockKeys).toEqual(['claim:billing:bill-1', 'claim:billing:bill-1']);
  });

  it('대조군 — 반려(REJECTED)된 청구만 있으면 재청구된다(정책 보존)', async () => {
    const db = fakeDb({
      billing: [{ id: 'bill-1', patientId: 'p-1', totalAmount: 1000, insuranceCovered: 700, items: [], status: 'PAID', patient: { insuranceType: 'NHI' } }],
      claim: [{ id: 'c-0', billingId: 'bill-1', status: 'REJECTED' }],
    });
    const svc = new InsuranceClaimService(db.prisma as never);
    await svc.create('bill-1');
    expect(db.tables.claim).toHaveLength(2);
  });
});

// ── ② 재고 문서번호 ─────────────────────────────────────────────────────────
describe('🔴 재고 문서번호 — 같은 순간 두 문서가 번호로 부딪히지 않는다(Date.now 끝 세 자리가 아니다)', () => {
  const today = () => new Date().toISOString().slice(0, 10).replace(/-/g, '');

  it('🔴 시계가 같은 값을 줘도 동시 생성 둘은 서로 다른 번호를 받는다', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_758_000_000_123);
    const db = fakeDb({ inventoryRequest: [] });
    const svc = new InventoryService(db.prisma as never, { enqueue: vi.fn() } as never);
    await Promise.all([
      svc.createRequest({ department: '내과', items: [] } as never, 'u-1'),
      svc.createRequest({ department: '내과', items: [] } as never, 'u-2'),
    ]);
    const nums = db.tables.inventoryRequest.map((r) => r.requestNumber);
    expect(new Set(nums).size, `번호가 겹쳤다: ${nums.join(', ')}`).toBe(2);
    expect(nums.sort()).toEqual([`REQ-${today()}-001`, `REQ-${today()}-002`]);
  });

  it.each([
    ['createPurchaseOrder', 'purchaseOrder', 'orderNumber', 'PO', { supplierId: 's-1', items: [] }],
    ['createRepackOrder', 'repackOrder', 'orderNumber', 'RPK', { type: 'SPLIT', targetItemName: 'x', targetQty: 1, items: [] }],
    ['createCount', 'inventoryCount', 'countNumber', 'CNT', { title: '정기', scheduledDate: '2026-09-28' }],
  ] as const)('🔴 %s — 옛 방식 번호(시계 꼬리)가 섞인 날에도 최대 + 1 을 받는다', async (method, table, col, kind, dto) => {
    const pfx = `${kind}-${today()}-`;
    const db = fakeDb({ [table]: [{ id: 'old-1', [col]: `${pfx}002` }, { id: 'old-2', [col]: `${pfx}987` }], inventoryItem: [] });
    const svc = new InventoryService(db.prisma as never, { enqueue: vi.fn() } as never);
    await (svc as any)[method](dto, 'u-1');
    expect(db.tables[table].map((r) => r[col])).toContain(`${pfx}988`);
    expect(db.lockKeys).toEqual([`inventory:doc:${pfx}`]);
  });

  it('nextDailyDocNumber — 다른 날·숫자 아닌 꼬리는 세지 않는다 · 999 다음은 1000', () => {
    expect(nextDailyDocNumber('PO-20260928-', [])).toBe('PO-20260928-001');
    expect(nextDailyDocNumber('PO-20260928-', ['PO-20260927-555', 'PO-20260928-00x', 'PO-20260928-004'])).toBe('PO-20260928-005');
    expect(nextDailyDocNumber('PO-20260928-', ['PO-20260928-999'])).toBe('PO-20260928-1000');
  });
});

// ── ③ CSSD 발주 입고 ────────────────────────────────────────────────────────
describe('🔴 CSSD 발주 입고 — 전량 입고된 발주를 한 번 더 받지 않고, 동시 두 요청도 한 번만 더한다', () => {
  const make = (status: string, receivedQty = 0) => {
    const db = fakeDb({
      cssdPurchaseOrder: [{ id: 'po-1', poNo: 'PO-20260928-001', status }],
      cssdPoLine: [{ id: 'l-1', poId: 'po-1', itemId: 'i-1', qty: 10, receivedQty }],
      instrumentItem: [{ id: 'i-1', stock: 5 }],
      supplyTransaction: [],
    });
    const notify = vi.fn();
    const svc = new CssdPoService(db.prisma as never, { enqueue: vi.fn() } as never, { notifyErpPublic: notify } as never);
    return { db, svc, notify };
  };

  it('🔴 RECEIVED 발주에 같은 입고가 다시 오면 400 — 재고·원장이 늘지 않는다', async () => {
    const { db, svc } = make('RECEIVED', 10);
    await expect(svc.receive('po-1', [{ lineId: 'l-1', qty: 10 }], 'u-1')).rejects.toBeInstanceOf(BadRequestException);
    expect(db.tables.instrumentItem[0].stock).toBe(5);
    expect(db.tables.supplyTransaction).toHaveLength(0);
  });

  it('🔴 "전량 입고" 더블클릭(동시 두 요청) → 한 번만 더해지고 나머지는 400', async () => {
    const { db, svc } = make('APPROVED');
    const res = await Promise.allSettled([
      svc.receive('po-1', [{ lineId: 'l-1', qty: 10 }], 'u-1'),
      svc.receive('po-1', [{ lineId: 'l-1', qty: 10 }], 'u-1'),
    ]);
    expect(res.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(db.tables.instrumentItem[0].stock).toBe(15);
    expect(db.tables.supplyTransaction).toHaveLength(1);
    expect(db.tables.cssdPoLine[0].receivedQty).toBe(10);
    expect(db.tables.cssdPurchaseOrder[0].status).toBe('RECEIVED');
  });

  it('대조군 — APPROVED 발주는 정상 입고되고 원장 잔량이 실제 재고와 같다', async () => {
    const { db, svc, notify } = make('APPROVED');
    await svc.receive('po-1', [{ lineId: 'l-1', qty: 4 }], 'u-1');
    expect(db.tables.instrumentItem[0].stock).toBe(9);
    expect(db.tables.supplyTransaction[0]).toEqual(expect.objectContaining({ type: 'IN', qty: 4, balanceAfter: 9, ref: 'PO-20260928-001' }));
    expect(db.tables.cssdPurchaseOrder[0].status).toBe('APPROVED'); // 부분 입고는 APPROVED 로 남는다
    expect(notify).toHaveBeenCalledWith('i-1', 'IN', 4, 9, 'PO-20260928-001');
  });

  it('🔴 발주 생성 — 동시 둘이 같은 발주번호를 받지 않는다(count + 1 을 잠근 안에서)', async () => {
    const db = fakeDb({ cssdPurchaseOrder: [], cssdPoLine: [], instrumentItem: [{ id: 'i-1', name: '겸자', unitPrice: 100 }], supplyTransaction: [] });
    const svc = new CssdPoService(db.prisma as never, { enqueue: vi.fn() } as never, {} as never);
    await Promise.all([
      svc.create({ lines: [{ itemId: 'i-1', qty: 1 }] }),
      svc.create({ lines: [{ itemId: 'i-1', qty: 1 }] }),
    ]);
    const nos = db.tables.cssdPurchaseOrder.map((p) => p.poNo);
    expect(new Set(nos).size, `발주번호가 겹쳤다: ${nos.join(', ')}`).toBe(2);
  });
});
