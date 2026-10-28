import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DECISION_REGISTRY } from '../../src/modules/decision-registry/decision.registry';
import { ReferenceDatasetService } from '../../src/modules/code-master/reference-dataset.service';
import * as fs from 'fs';
import * as path from 'path';
import { GoLiveService } from '../../src/modules/go-live/go-live.service';
import { GO_LIVE_REGISTRY } from '../../src/modules/go-live/go-live.registry';

/**
 * 🔴 사람 지시(2026-08-26): *"올리는 데이터들이 **해당 날짜와 고시에 맞춰서** 저장되면 됨."*
 *    기준일이 없으면 다음 사람이 그 값을 **현재로 읽는다.**
 *
 * 🔴 실측 근거: 우리 `medication_codes.barcode` 22,306건은 **전부 대표코드**였다
 *    (심평원 파일 대표코드와 22,305/22,306 일치). 실제 약 상자에 찍히는 것은 **포장단위 표준코드**라
 *    — 한 약에 최대 112개 — **스캔하면 못 찾았다.**
 *    그리고 그 공식 파일 305,522건 중 체크디지트 불일치는 **1건**이었다(파일 자체의 오타).
 */
const SVC = join(process.cwd(), 'src/modules/code-master/reference-dataset.service.ts');

const mk = (opts: { meds?: { id: string; code: string }[]; found?: unknown[] } = {}) => {
  const created: Record<string, unknown>[] = [];
  return {
    prisma: {
      referenceDataset: {
        create: vi.fn().mockImplementation((a: { data: Record<string, unknown> }) => {
          created.push(a.data);
          return { id: 'ds1', ...a.data };
        }),
        update: vi.fn().mockResolvedValue({}),
        findMany: vi.fn().mockResolvedValue([]),
      },
      medicationCode: { findMany: vi.fn().mockResolvedValue(opts.meds ?? []) },
      drugBarcode: {
        createMany: vi.fn().mockImplementation((a: { data: unknown[] }) => ({ count: a.data.length })),
        findMany: vi.fn().mockResolvedValue(opts.found ?? []),
      },
    } as never,
    created,
  };
};

const meta = { effectiveDate: '2025-10-31', sourceName: '심평원 약가마스터 의약품표준코드', userId: 'u1' };

/** 🔴 정본 생성자가 요구하는 협력자 — 빠뜨리면 undefined 인 채 통과해 결함을 숨긴다 */
const CFG = { get: async () => null } as never;

describe('기초 데이터 원장', () => {
  it('🔴 고시 기준일 없이는 등재되지 않는다', async () => {
    const svc = new ReferenceDatasetService(mk().prisma, CFG);
    await expect(
      svc.record({ ...meta, effectiveDate: '2025-10', kind: 'DRUG_STANDARD_CODE', rowCount: 0, appliedCount: 0, skippedCount: 0 }),
    ).rejects.toThrow(/YYYY-MM-DD/);
  });

  it('알 수 없는 종류는 받지 않는다', async () => {
    const svc = new ReferenceDatasetService(mk().prisma, CFG);
    await expect(
      svc.record({ ...meta, kind: 'MYSTERY', rowCount: 0, appliedCount: 0, skippedCount: 0 }),
    ).rejects.toThrow(/알 수 없는/);
  });

  it('🔴 같은 파일을 두 번 올렸는지 기계로 안다 — 사람 기억에 맡기지 않는다', () => {
    const svc = new ReferenceDatasetService(mk().prisma, CFG);
    expect(svc.hashOf('a')).toBe(svc.hashOf('a'));
    expect(svc.hashOf('a')).not.toBe(svc.hashOf('b'));
  });

  it('반영 기록에 기준일이 남는다 — 올린 날이 아니라 고시 시점', async () => {
    const { prisma, created } = mk();
    await new ReferenceDatasetService(prisma, CFG).importStandardCodes(
      [{ standardCode: '8800628000107' }],
      meta,
    );
    // 🔴 UTC 자정으로 저장한다 — 로컬 문자열로 비교하면 KST 에서 하루가 밀려 보인다
    //    (이 저장소가 `@db.Date` 로 여러 번 겪은 함정이라 비교도 UTC 로 한다)
    expect((created[0].effectiveDate as Date).toISOString().slice(0, 10)).toBe('2025-10-31');
    expect(created[0].kind).toBe('DRUG_STANDARD_CODE');
  });
});

describe('표준코드 반영', () => {
  it('EDI 로 약품 마스터에 연결한다', async () => {
    const { prisma } = mk({ meds: [{ id: 'm1', code: '645302132' }] });
    const r = await new ReferenceDatasetService(prisma, CFG).importStandardCodes(
      [{ standardCode: '8800628000107', ediCode: '645302132' }],
      meta,
    );
    expect(r.linked).toBe(1);
  });

  it('🔴 체크디지트가 틀려도 저장한다 — 막으면 그 약을 아예 못 찾는다', async () => {
    const { prisma } = mk();
    // 심평원 공식 파일에 실제로 있던 불일치 코드
    const r = await new ReferenceDatasetService(prisma, CFG).importStandardCodes(
      [{ standardCode: '8806428006706' }],
      meta,
    );
    expect(r.created).toBe(1);
    expect(r.badCheckDigit).toBe(1);
    expect(r.notes.join(' ')).toMatch(/저장은 했습니다/);
  });

  it('대조군 — 정상 코드는 불일치로 세지 않는다', async () => {
    const { prisma } = mk();
    const r = await new ReferenceDatasetService(prisma, CFG).importStandardCodes(
      [{ standardCode: '8800628000107' }],
      meta,
    );
    expect(r.badCheckDigit).toBe(0);
    expect(r.notes.join(' ')).toMatch(/불일치 없음/);
  });

  it('🔴 자리수가 아닌 것은 반영하지 않고 그 사실을 남긴다', async () => {
    const { prisma, created } = mk();
    const r = await new ReferenceDatasetService(prisma, CFG).importStandardCodes(
      [{ standardCode: '짧다' }, { standardCode: '8800628000107' }],
      meta,
    );
    expect(r.created).toBe(1);
    expect(String(created[0].notes)).toMatch(/반영하지 않았습니다/);
  });

  it('🔴 다시 올려도 덮지 않는다 — 먼저 들어온 출처를 지킨다', () => {
    const src = readFileSync(SVC, 'utf8');
    expect(src).toMatch(/skipDuplicates: true/);
  });
});

describe('바코드 조회', () => {
  it('빈 입력을 받지 않는다', async () => {
    const svc = new ReferenceDatasetService(mk().prisma, CFG);
    await expect(svc.lookupByBarcode('')).rejects.toThrow(/입력하세요/);
  });

  it('🔴 0건은 "없는 약"이 아니다 — 아직 반영하지 않은 표준코드일 수 있다', async () => {
    const svc = new ReferenceDatasetService(mk({ found: [] }).prisma, CFG);
    const r = await svc.lookupByBarcode('8800628000107');
    expect(r.found).toBe(0);
    expect(r.caveat).toMatch(/그 약이 없다는 뜻이 아니라/);
  });

  it('🔴 찾으면 어느 고시 기준 데이터인지 함께 말한다', async () => {
    const found = [{
      standardCode: '8800628000107', representativeCode: null, ediCode: '645302132',
      productName: '포크랄시럽', maker: '한림제약', packageSpec: '95mL', checkDigitValid: true,
      medicationCode: { id: 'm1', code: '645302132', nameKo: '포크랄시럽', ingredient: null, unitPrice: 129 },
      dataset: { effectiveDate: new Date('2025-10-31'), sourceName: '심평원 약가마스터' },
    }];
    const r = await new ReferenceDatasetService(mk({ found }).prisma, CFG).lookupByBarcode('8800628000107');
    expect(r.items[0].basis.sourceName).toMatch(/심평원/);
    expect(r.caveat).toBeNull();
  });

  it('14자리로 들어와도 13자리 표준코드를 찾는다', async () => {
    const { prisma } = mk({ found: [] });
    await new ReferenceDatasetService(prisma, CFG).lookupByBarcode('08800628000107');
    const where = (prisma as unknown as { drugBarcode: { findMany: { mock: { calls: unknown[][] } } } })
      .drugBarcode.findMany.mock.calls[0][0] as { where: { OR: { standardCode?: { in: string[] } }[] } };
    expect(where.where.OR[0].standardCode!.in).toContain('8800628000107');
  });
});

/**
 * 🔴 실측(2026-08-26): 2026.6.1 → 7.1 한 달 사이 **삭제 38건** 중 **31건이 우리 마스터에 활성**이었다.
 *    급여에서 빠진 약을 처방하면 삭감된다. 그러나 **자동 폐지하지 않는다** — 비급여로 쓸 수 있다.
 */
describe('고시에 없는 원내 약품', () => {
  const mkMeds = (rows: unknown[], total: number) => ({
    medicationCode: {
      findMany: vi.fn().mockResolvedValue(rows),
      count: vi.fn().mockResolvedValue(total),
    },
  }) as never;

  const many = Array.from({ length: 200 }, (_, i) => `C${i}`);

  it('🔴 부분 목록으로는 판정하지 않는다 — 전 약품이 "빠짐"으로 나온다', async () => {
    const svc = new ReferenceDatasetService(mkMeds([], 0), CFG);
    await expect(svc.notInGazette(['A', 'B'])).rejects.toThrow(/전체 목록이어야/);
  });

  it('전체 목록이면 판정한다', async () => {
    const svc = new ReferenceDatasetService(mkMeds([{ id: 'm1', code: 'X', nameKo: '약' }], 1), CFG);
    const r = await svc.notInGazette(many);
    expect(r.total).toBe(1);
    expect(r.gazetteSize).toBe(200);
  });

  it('🔴 폐지하지 않는다고 화면이 말한다', async () => {
    const svc = new ReferenceDatasetService(mkMeds([], 0), CFG);
    const r = await svc.notInGazette(many);
    expect(r.notice).toMatch(/자동으로 폐지하지 않습니다/);
    expect(r.notice).toMatch(/비급여로 계속 쓰는 약일 수 있습니다/);
  });

  it('🔴 자르면 잘랐다고 말한다', async () => {
    const svc = new ReferenceDatasetService(mkMeds([{ id: 'm1', code: 'X', nameKo: '약' }], 900), CFG);
    const r = await svc.notInGazette(many);
    expect(r.truncated).toBe(true);
  });

  it('대조군 — 중복은 접어서 센다(같은 코드를 여러 번 줘도 목록 크기가 부풀지 않는다)', async () => {
    const svc = new ReferenceDatasetService(mkMeds([], 0), CFG);
    const r = await svc.notInGazette([...many, ...many]);
    expect(r.gazetteSize).toBe(200);
  });
});


/**
 * 🔴 약제급여목록은 **고시 시점별**로 보관한다.
 *    실측(2026-08-26): 2026.6.1 → 7.1 한 달 사이 가격변동 13건
 *    (줄토피플렉스터치주 38,482 → 103,406 = 2.7배 · 렉라자 63,363 → 41,000) · 신규 99 · 삭제 38.
 *    현재가 한 벌만 두면 **6월 진료를 7월 값으로 청구한다.**
 */
describe('약가 — 시점으로 판정한다', () => {
  const D = (s: string) => new Date(`${s}T00:00:00.000Z`);
  const mk = (rows: Record<string, unknown>[], prev: Record<string, unknown>[] = []) => {
    const store = [...prev];
    return {
      prisma: {
        drugPrice: {
          // 🔴 목은 정본이 실제로 거는 조건을 전부 지킨다. `validFrom` 정확 일치를 무시했더니
          //    두 고시를 다 돌려줘 6월 조회에 7월 값이 나왔다 — 목이 결함을 만들어낼 뻔했다.
          findMany: vi.fn(async ({ where }: never) => {
            const w = where as { validFrom?: { lt?: Date } | Date; code?: { in: string[] } };
            let r = store as Record<string, unknown>[];
            if (w?.validFrom instanceof Date) r = r.filter((x) => +(x.validFrom as Date) === +(w.validFrom as Date));
            else if ((w?.validFrom as { lt?: Date })?.lt) r = r.filter((x) => +(x.validFrom as Date) < +(w.validFrom as { lt: Date }).lt);
            if (w?.code?.in) r = r.filter((x) => w.code!.in.includes(x.code as string));
            return r;
          }),
          findFirst: vi.fn(async ({ where, orderBy }: never) => {
            const w = where as { validFrom: { lte?: Date; lt?: Date } };
            const o = (orderBy as { validFrom: 'asc' | 'desc' })?.validFrom ?? 'desc';
            // 🔴 정본이 거는 조건을 그대로 — 시점 조회(lte + validTo) · 직전 고시 찾기(lt · validTo 조건 없음 · 2026-10-01)
            const cand = w.validFrom.lt
              ? store.filter((x) => +(x.validFrom as Date) < +w.validFrom.lt!)
              : store.filter((x) => +(x.validFrom as Date) <= +w.validFrom.lte!
                && (x.validTo == null || +(x.validTo as Date) >= +w.validFrom.lte!));
            cand.sort((a, b) => (o === 'desc' ? 1 : -1) * (+(b.validFrom as Date) - +(a.validFrom as Date)));
            return cand[0] ?? null;
          }),
          createMany: vi.fn(async ({ data }: { data: Record<string, unknown>[] }) => {
            store.push(...data); return { count: data.length };
          }),
          updateMany: vi.fn(async () => ({ count: prev.length })),
        },
        referenceDataset: { create: vi.fn(async () => ({ id: 'ds1' })), update: vi.fn() },
      },
      store,
    };
  };
  // 🔴 정본 생성자 인자를 그대로 맞춘다(빠뜨리면 그 협력자가 undefined 인 채 통과한다)
  const svc = (p: unknown) => new ReferenceDatasetService(p as never, { get: async () => null } as never);
  const meta = { effectiveDate: '2026-07-01', sourceName: '약제급여목록', userId: 'u1' };

  it('🔴 가격이 바뀐 것을 "변동"으로 센다 — 조용히 덮지 않는다', async () => {
    const { prisma } = mk([], [{ code: 'A', price: 38482, validFrom: D('2026-06-01') }]);
    const r = await svc(prisma).importDrugPriceList([{ code: 'A', price: 103406 }], meta);
    expect(r.changed).toBe(1);
    expect(r.created).toBe(0);
    expect(r.previousEffectiveDate).toBe('2026-06-01');
  });

  it('🔴 직전 고시를 이 고시 전날로 닫는다 — 안 닫으면 한 시점에 정본이 둘이다', async () => {
    const { prisma } = mk([], [{ code: 'A', price: 1, validFrom: D('2026-06-01') }]);
    await svc(prisma).importDrugPriceList([{ code: 'A', price: 2 }], meta);
    const call = prisma.drugPrice.updateMany.mock.calls[0][0] as { data: { validTo: Date } };
    expect(call.data.validTo.toISOString().slice(0, 10)).toBe('2026-06-30');
  });

  it('🔴 이 고시에서 빠진 코드를 지우지 않는다 — 과거 청구는 그대로 재계산돼야 한다', async () => {
    const { prisma } = mk([], [
      { code: 'A', price: 1, validFrom: D('2026-06-01') },
      { code: 'GONE', price: 9, validFrom: D('2026-06-01') },
    ]);
    const r = await svc(prisma).importDrugPriceList([{ code: 'A', price: 1 }], meta);
    expect(r.delisted).toBe(1);
    expect(r.delistedSample).toContain('GONE');
    expect((prisma.drugPrice as Record<string, unknown>).deleteMany).toBeUndefined();
    expect(r.caveat).toMatch(/그런 약이 없었다.*아닙니다/);
  });

  it('🔴 그 시점의 값을 돌려준다 — 오늘 값으로 과거를 계산하지 않는다', async () => {
    const { prisma } = mk([], [
      { code: 'A', nameKo: '줄토피', price: 38482, validFrom: D('2026-06-01'), validTo: D('2026-06-30') },
      { code: 'A', nameKo: '줄토피', price: 103406, validFrom: D('2026-07-01'), validTo: null },
    ]);
    const june = await svc(prisma).priceOn(['A'], '2026-06-15');
    expect(june.items[0].price).toBe(38482);
    expect(june.gazetteEffectiveDate).toBe('2026-06-01');
    const july = await svc(prisma).priceOn(['A'], '2026-07-15');
    expect(july.items[0].price).toBe(103406);
  });

  it('🔴 고시에 없는 코드는 `null` 이며 0 이 아니다 — 0 은 "무료"라는 다른 사실이다', async () => {
    const { prisma } = mk([], [{ code: 'A', price: 1, validFrom: D('2026-06-01') }]);
    const r = await svc(prisma).priceOn(['ZZZ'], '2026-06-15');
    expect(r.items[0].price).toBeNull();
    expect(r.items[0].basis).toBe('NOT_LISTED');
    expect(r.caveat).toMatch(/0원이 아닙니다/);
  });

  it('🔴 그 시점을 덮는 고시가 없으면 "판정 불가" — "급여 아님"과 합치지 않는다', async () => {
    const { prisma } = mk([], []);
    const r = await svc(prisma).priceOn(['A'], '2020-01-01');
    expect(r.items[0].basis).toBe('NO_GAZETTE_LOADED');
    expect(r.items[0].price).toBeNull();
    expect(r.gazetteEffectiveDate).toBeNull();
  });

  it('대조군: 값이 그대로면 "변동"이라 말하지 않는다(거짓 경보 금지)', async () => {
    const { prisma } = mk([], [{ code: 'A', price: 500, validFrom: D('2026-06-01') }]);
    const r = await svc(prisma).importDrugPriceList([{ code: 'A', price: 500 }], meta);
    expect(r.changed).toBe(0);
    expect(r.unchanged).toBe(1);
  });

  /**
   * 🔴 이 케이스가 없어서 가드에 구멍이 있었다 — 고시가 **둘뿐**이면 `orderBy` 를 asc 로 뒤집어도
   *    결과가 같아 재주입이 통과했다. 고시가 셋이어야 "가장 최근"이 실제로 판정을 가른다.
   */
  it('🔴 고시가 여럿 앞서 있어도 **가장 최근** 것을 쓴다(정렬이 뒤집히면 옛 값을 준다)', async () => {
    const { prisma } = mk([], [
      { code: 'A', price: 100, validFrom: D('2026-05-01'), validTo: D('2026-05-31') },
      { code: 'A', price: 200, validFrom: D('2026-06-01'), validTo: D('2026-06-30') },
      { code: 'A', price: 300, validFrom: D('2026-07-01'), validTo: null },
    ]);
    const r = await svc(prisma).priceOn(['A'], '2026-07-15');
    expect(r.gazetteEffectiveDate).toBe('2026-07-01');
    expect(r.items[0].price).toBe(300);
    // 중간 시점도 그 시점 고시를 쓴다 — 최신도 최초도 아니다
    const mid = await svc(prisma).priceOn(['A'], '2026-06-15');
    expect(mid.items[0].price).toBe(200);
  });

  it('대조군: 첫 고시 이전 시점은 판정 불가다(있는 값을 억지로 끌어오지 않는다)', async () => {
    const { prisma } = mk([], [{ code: 'A', price: 100, validFrom: D('2026-05-01'), validTo: null }]);
    const r = await svc(prisma).priceOn(['A'], '2026-04-30');
    expect(r.items[0].basis).toBe('NO_GAZETTE_LOADED');
  });

  /**
   * 🔴 `orderBy: desc` 는 **기간이 겹칠 때만** 일한다. 정상적으로 닫혀 있으면 구간이 서로 겹치지 않아
   *    정렬을 뒤집어도 결과가 같다 — 그래서 "정렬을 뒤집는" 재주입이 통과했고, 나는 가드에 구멍이 있다고
   *    잠시 오판했다. **겨눠야 할 것은 정렬이 아니라 겹침이다.**
   *
   *    겹침은 실제로 일어날 수 있다: 닫기(`updateMany`)가 실패하거나, 같은 기준일을 두 번 반영하거나,
   *    사람이 과거 고시를 뒤늦게 넣는 경우. 그때 **옛 값이 이기면 청구가 옛 약가로 나간다.**
   */
  it('🔴 기간이 겹쳐 있으면(닫기 실패) 가장 최근 고시가 이긴다 — 옛 값으로 청구되지 않는다', async () => {
    const { prisma } = mk([], [
      { code: 'A', price: 38482, validFrom: D('2026-06-01'), validTo: null },  // 닫히지 않았다
      { code: 'A', price: 103406, validFrom: D('2026-07-01'), validTo: null },
    ]);
    const r = await svc(prisma).priceOn(['A'], '2026-07-15');
    expect(r.gazetteEffectiveDate).toBe('2026-07-01');
    expect(r.items[0].price).toBe(103406);
  });

  it('빈 입력·날짜 아님은 400', async () => {
    const { prisma } = mk([], []);
    await expect(svc(prisma).priceOn([])).rejects.toThrow(/코드/);
    await expect(svc(prisma).importDrugPriceList([{ code: 'A' }], { ...meta, effectiveDate: 'x' }))
      .rejects.toThrow(/날짜/);
  });
});

/**
 * 🔴 수가는 **시점 × 종별**로 판정한다.
 *
 * 실측(2026-08-26 · 「수가반영내역」26.6.1 시행 전체판 419,024코드):
 *   · 의원단가 ≠ 병원급이상단가 **408,196건(97.4%)**
 *   · 운영 `procedure_codes.unit_price` 166,643건은 **의원단가와 164,704건(98.8%) 일치**
 *     → 병원인데 의원 단가를 들고 있었다
 *   · 병원급에서만 산정되는 코드 **245,961건이 우리 마스터에 없다**
 *   · `unit_price = 0` 인 5,004건 중 **2,898건은 병원급에 실제 금액이 있다**
 *     → 그 0 은 "무료"가 아니라 **"그 종별 미산정"** 이었다
 */
describe('수가 — 시점 × 종별로 판정한다', () => {
  const D = (s: string) => new Date(`${s}T00:00:00.000Z`);
  const mk = (store: Record<string, unknown>[], tier: string | null) => ({
    prisma: {
      procedureFee: {
        findMany: vi.fn(async ({ where }: never) => {
          const w = where as { validFrom?: { lt?: Date } | Date; code?: { in: string[] } };
          let r = store;
          if (w?.validFrom instanceof Date) r = r.filter((x) => +(x.validFrom as Date) === +(w.validFrom as Date));
          else if ((w?.validFrom as { lt?: Date })?.lt) r = r.filter((x) => +(x.validFrom as Date) < +(w.validFrom as { lt: Date }).lt);
          if (w?.code?.in) r = r.filter((x) => w.code!.in.includes(x.code as string));
          return r;
        }),
        findFirst: vi.fn(async ({ where, orderBy }: never) => {
          const w = where as { validFrom: { lte?: Date; lt?: Date } };
          const o = (orderBy as { validFrom: 'asc' | 'desc' })?.validFrom ?? 'desc';
          const c = w.validFrom.lt
            ? store.filter((x) => +(x.validFrom as Date) < +w.validFrom.lt!)
            : store.filter((x) => +(x.validFrom as Date) <= +w.validFrom.lte!
              && (x.validTo == null || +(x.validTo as Date) >= +w.validFrom.lte!));
          c.sort((a, b) => (o === 'desc' ? 1 : -1) * (+(b.validFrom as Date) - +(a.validFrom as Date)));
          return c[0] ?? null;
        }),
        createMany: vi.fn(async ({ data }: { data: Record<string, unknown>[] }) => {
          store.push(...data); return { count: data.length };
        }),
        updateMany: vi.fn(async () => ({ count: 0 })),
      },
      referenceDataset: { create: vi.fn(async () => ({ id: 'ds1' })), update: vi.fn() },
    },
    config: { get: vi.fn(async () => tier) },
  });
  const svc = (m: ReturnType<typeof mk>) =>
    new ReferenceDatasetService(m.prisma as never, m.config as never);
  const row = (over: Record<string, unknown> = {}) => ({
    code: 'AA254', nameKo: '재진진찰료', priceClinic: 13370, priceHospital: 0,
    validFrom: D('2026-06-01'), validTo: null, copay50: false, copay80: false, copay90: false, ...over,
  });

  it('🔴 종별이 미설정이면 금액을 말하지 않는다 — 기본값을 끼워 넣지 않는다', async () => {
    const m = mk([row()], null);
    const r = await svc(m).feeOn(['AA254'], { onDate: '2026-06-15' });
    expect(r.items[0].basis).toBe('TIER_UNKNOWN');
    expect(r.items[0].price).toBeNull();
    expect(r.caveat).toMatch(/97\.4/);
    // 대조군: 종별을 주면 말한다
    const ok = await svc(m).feeOn(['AA254'], { onDate: '2026-06-15', tier: 'CLINIC' });
    expect(ok.items[0].price).toBe(13370);
  });

  it('🔴 고시 단가 0 은 "그 종별 미산정" 이며 0원 청구가 아니다', async () => {
    const m = mk([row()], 'HOSPITAL');
    const r = await svc(m).feeOn(['AA254'], { onDate: '2026-06-15' });
    expect(r.items[0].basis).toBe('NOT_BILLABLE_AT_TIER');
    expect(r.items[0].price).toBeNull();   // 🔴 0 을 그대로 돌려주지 않는다
    expect(r.items[0].note).toMatch(/0원으로 청구하는 것이 아닙니다/);
  });

  it('🔴 종별이 다르면 다른 금액을 준다 — 한 칸에 하나만 두면 이 사실이 사라진다', async () => {
    const store = [row({ code: 'X', priceClinic: 100, priceHospital: 300 })];
    expect((await svc(mk(store, 'CLINIC')).feeOn(['X'], { onDate: '2026-06-15' })).items[0].price).toBe(100);
    expect((await svc(mk(store, 'HOSPITAL')).feeOn(['X'], { onDate: '2026-06-15' })).items[0].price).toBe(300);
  });

  it('🔴 "그 종별 미산정"과 "고시에 없음"을 합치지 않는다', async () => {
    const m = mk([row()], 'HOSPITAL');
    const r = await svc(m).feeOn(['AA254', 'NOPE'], { onDate: '2026-06-15' });
    expect(r.items[0].basis).toBe('NOT_BILLABLE_AT_TIER');
    expect(r.items[1].basis).toBe('NOT_LISTED');
  });

  it('🔴 그 시점을 덮는 고시가 없으면 판정 불가 — "산정 안 됨"이 아니다', async () => {
    const r = await svc(mk([row()], 'HOSPITAL')).feeOn(['AA254'], { onDate: '2020-01-01' });
    expect(r.items[0].basis).toBe('NO_GAZETTE_LOADED');
  });

  it('본인부담률 특례를 고시 근거대로 싣는다(없으면 빈 목록 — 30% 라고 말하지 않는다)', async () => {
    const m = mk([row({ code: 'Y', priceHospital: 500, copay80: true })], 'HOSPITAL');
    const r = await svc(m).feeOn(['Y'], { onDate: '2026-06-15' });
    expect(r.items[0].copaySpecial).toEqual(['80/100']);
    const plain = await svc(mk([row({ code: 'Z', priceHospital: 500 })], 'HOSPITAL')).feeOn(['Z'], { onDate: '2026-06-15' });
    expect(plain.items[0].copaySpecial).toEqual([]);
  });

  it('알 수 없는 종별을 조용히 통과시키지 않는다', async () => {
    const r = await svc(mk([row()], 'BOGUS')).feeOn(['AA254'], { onDate: '2026-06-15' });
    expect(r.items[0].basis).toBe('TIER_UNKNOWN');
    expect(r.caveat).toMatch(/고시 단가 열로 옮길 수 없습니다/);
    // 🔴 치과·한방 등은 종별가산 어휘가 표현하지 못한다 — 그 사실을 그 자리에서 말한다
    expect(r.caveat).toMatch(/임의로 끼워 맞추지 않았습니다/);
  });

  it('반영은 종별 단가를 전부 보관하고, 종별 선택을 자기가 하지 않는다', async () => {
    const m = mk([], null);
    const r = await svc(m).importProcedureFees(
      [{ code: 'X', priceClinic: 100, priceHospital: 300 }],
      { effectiveDate: '2026-06-01', sourceName: '수가반영내역', userId: 'u1' },
    );
    expect(r.applied).toBe(1);
    expect(r.caveat).toMatch(/이 반영이 정하지 않습니다/);
    const saved = m.prisma.procedureFee.createMany.mock.calls[0][0].data[0] as Record<string, unknown>;
    expect(saved.priceClinic).toBe(100);
    expect(saved.priceHospital).toBe(300);
  });
});

/**
 * 🔴 **요양기관 종별의 정본은 `billing.institution.grade` 하나다.**
 *
 * 2026-08-27: 수가 고시를 반영하면서 `hospital.institutionType` 이라는 **두 번째 키를 만들 뻔했다.**
 * 사람이 "그 부분이 설정되는 곳이 있다"고 알려줘서 찾아보니 이미 있었다 —
 * ERP 종별가산(`institutionGrade`)·의료급여 정액(`grade === 'clinic'`)을 이미 가르고 있었고
 * 편집 화면(`/admin/billing-calc`)까지 있었다.
 *
 * 정본이 둘이면 갈라진다(P12). 한쪽만 바꾼 병원은 **청구와 수가 조회가 서로 다른 종별로 답한다.**
 */
describe('요양기관 종별 — 정본은 하나다', () => {
  const SRC = path.resolve(__dirname, '../../src');
  const read = (rel: string) => fs.readFileSync(path.resolve(SRC, rel), 'utf8');
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('🔴 `hospital.institutionType` 같은 두 번째 키가 없다', () => {
    const walk = (d: string): string[] =>
      fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(path.resolve(d, e.name)) : e.name.endsWith('.ts') ? [path.resolve(d, e.name)] : []);
    const bad = walk(SRC).filter((f) => /hospital\.institutionType/.test(strip(fs.readFileSync(f, 'utf8'))));
    expect(bad.map((f) => f.replace(SRC, 'src')),
      '종별 정본은 `billing.institution.grade` 하나다 — 두 번째 키를 만들지 마라').toEqual([]);
  });

  it('🔴 수가 조회가 청구와 **같은 키**를 읽는다', () => {
    const fee = strip(read('modules/code-master/reference-dataset.service.ts'));
    const billing = strip(read('modules/billing/billing.service.ts'));
    expect(fee).toMatch(/INSTITUTION_GRADE_KEY = 'billing\.institution\.grade'/);
    expect(billing, '청구가 이 키를 읽지 않는다면 이 가드의 전제가 틀린 것이다')
      .toMatch(/billing\.institution\.grade/);
  });

  it('🔴 종별가산 어휘가 화면·DEFAULTS·매핑 셋에서 같다 — 한쪽만 늘리면 조용히 판정 불가가 된다', () => {
    // 🔴 주석 제거에 기대지 않는다. 이 파일 앞쪽의 `/*` 가 짝을 못 찾아 내 대상 줄까지 삼켰다
    //    (2026-08-27 실제로 그랬다 — 내 도구가 먼저 거짓말한 사례). DEFAULTS 항목 형태로 좁게 조준한다.
    const defaults = read('modules/config/config-runtime.service.ts');
    const line = defaults.split('\n').find((l) => l.includes("'billing.institution.grade': {"))!;
    expect(line, 'DEFAULTS 에서 종별 항목을 찾지 못했다 — 키 이름을 바꿨다면 이 가드도 함께 고쳐라').toBeTruthy();
    const inDefaults = ['CLINIC', 'HOSPITAL', 'GENERAL', 'TERTIARY'].filter((g) => line.includes(g));
    expect(inDefaults).toHaveLength(4);

    // 2026-10-20 — 화면이 고르는 값 = 결정 billing.institutionType 의 집행 값(종별 패널이 결정 기록 경로로 고른다 · 설정 목록의 직접 선택은 없앴다)
    const decision = DECISION_REGISTRY.find((d) => d.key === 'billing.institutionType')!;
    const opts = decision.options.map((o) => (o.enact as { newValue?: unknown } | null)?.newValue).filter((v): v is string => typeof v === 'string');
    expect(new Set(opts)).toEqual(new Set(inDefaults));
    const panel = fs.readFileSync(path.resolve(SRC, '../../web/src/app/(main)/admin/billing-calc/institution-settings.tsx'), 'utf8');
    expect(panel).toMatch(/const GRADES: Grade\[\] = \['CLINIC', 'HOSPITAL', 'GENERAL', 'TERTIARY'\]/);

    const map = ReferenceDatasetService.GRADE_TO_FEE_COLUMN;
    expect(new Set(Object.keys(map)), '화면이 고를 수 있는 값은 전부 고시 단가 열로 옮겨져야 한다')
      .toEqual(new Set(opts));
  });

  it('🔴 병원·종합병원·상급종합은 고시상 같은 열(병원급이상단가)을 쓴다', () => {
    const m = ReferenceDatasetService.GRADE_TO_FEE_COLUMN;
    expect(m.HOSPITAL).toBe('priceHospital');
    expect(m.GENERAL).toBe('priceHospital');
    expect(m.TERTIARY).toBe('priceHospital');
    // 대조군: 의원은 다른 열이다(전부 같은 열로 접히지 않았는지)
    expect(m.CLINIC).toBe('priceClinic');
  });
});

/**
 * 🔴 개시 전 점검이 **기본값을 "설정됨"으로 읽으면** 아무도 확인하지 않은 채 개통한다.
 *
 * `ConfigRuntimeService.get('billing.institution.grade')` 는 DB 행이 없어도 DEFAULTS 의 `'CLINIC'` 을
 * 돌려준다. 그것으로 판정하면 **미설정이 "의원으로 설정됨"** 이 되어 READY 로 보인다.
 * 그래서 `/admin/go-live` 판정기는 **`system_configs` 행의 실재**로 판정한다.
 */
describe('개시 전 점검 — 기본값은 설정이 아니다', () => {
  const mk = (row: { value: unknown } | null | Error) => new GoLiveService(
    {
      systemConfig: {
        findUnique: vi.fn(async () => { if (row instanceof Error) throw row; return row; }),
      },
    } as never,
    { get: async () => 'CLINIC' } as never,   // 🔴 config 는 언제나 기본값을 준다 — 여기에 속으면 안 된다
  );
  const derive = (svc: GoLiveService) =>
    (svc as unknown as { deriveInstitutionGrade(): Promise<{ status: string; detail: string }> })
      .deriveInstitutionGrade();

  it('🔴 DB 행이 없으면 NOT_READY — config 가 CLINIC 을 주더라도', async () => {
    const r = await derive(mk(null));
    expect(r.status).toBe('NOT_READY');
    expect(r.detail).toMatch(/의원으로 청구됩니다/);
  });

  it('대조군: 행이 있으면 READY 이고 그 값을 말한다', async () => {
    const r = await derive(mk({ value: 'HOSPITAL' }));
    expect(r.status).toBe('READY');
    expect(r.detail).toMatch(/병원\(HOSPITAL\)/);
  });

  it('JSON 문자열로 저장돼 있어도 읽는다(따옴표를 값으로 읽지 않는다)', async () => {
    expect((await derive(mk({ value: '"TERTIARY"' }))).status).toBe('READY');
  });

  it('🔴 알 수 없는 값을 조용히 통과시키지 않는다', async () => {
    const r = await derive(mk({ value: 'BOGUS' }));
    expect(r.status).toBe('NOT_READY');
    expect(r.detail).toMatch(/알 수 없는 종별/);
  });

  it('🔴 못 읽었으면 "미설정"이라 말하지 않는다 — 모르는 것과 없는 것은 다른 사실이다', async () => {
    const r = await derive(mk(new Error('DB down')));
    expect(r.status).toBe('BLOCKED');
    expect(r.detail).toMatch(/판정 불가/);
  });

  it('레지스트리에 개시 전 항목으로 등재돼 있고 편집 화면을 가리킨다', () => {
    const item = GO_LIVE_REGISTRY.find((i) => i.key === 'billing.institutionGrade');
    expect(item, '등재하지 않으면 개시 전에 아무도 판정하지 않는다').toBeTruthy();
    expect(item!.sourceKey).toBe('institutionGrade');
    expect(item!.drillDown).toBe('/admin/billing-calc');
  });
});
