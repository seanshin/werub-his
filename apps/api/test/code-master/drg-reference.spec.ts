import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DrgReferenceService } from '../../src/modules/code-master/drg-reference.service';

/**
 * 🔴 DRG(질병군) **참조 자료** — 고시 별표4(중증도 점수)·별표5(0점 결정 주진단).
 *    실측(2026-08-26): 별표4 **4,796코드** · 별표5 기타진단 **4,853종 × 729,446쌍**.
 *
 * 🔴 **이 자료로 DRG 를 산정할 수 없다.** 계산되는 것은 중증도 점수 합계뿐이고,
 *    질병군(ADRG) 배정·수가는 별도 자료·규칙이다. 할 수 없는 것을 할 수 있는 척하지 않는다.
 */
const SVC = join(process.cwd(), 'src/modules/code-master/drg-reference.service.ts');

const mk = (opts: { scores?: { diagnosisCode: string; score: number }[]; zeros?: { otherDiagnosis: string; mainDiagnoses: string[] }[]; hasData?: boolean } = {}) => {
  const hasData = opts.hasData ?? true;
  return {
    drgSeverityScore: {
      findFirst: vi.fn().mockResolvedValue(
        hasData ? { datasetId: 'ds1', dataset: { effectiveDate: new Date('2026-01-01'), sourceName: '고시 별표4' } } : null,
      ),
      findMany: vi.fn().mockResolvedValue(opts.scores ?? []),
      createMany: vi.fn().mockImplementation((a: { data: unknown[] }) => ({ count: a.data.length })),
    },
    drgZeroScoreRule: {
      findMany: vi.fn().mockResolvedValue(opts.zeros ?? []),
      createMany: vi.fn().mockImplementation((a: { data: unknown[] }) => ({ count: a.data.length })),
    },
    referenceDataset: { create: vi.fn().mockResolvedValue({ id: 'ds1' }), update: vi.fn() },
  } as never;
};
const refStub = { record: vi.fn().mockResolvedValue({ id: 'ds1' }) } as never;

describe('중증도 점수 산출', () => {
  it('점수를 더한다', async () => {
    const svc = new DrgReferenceService(mk({ scores: [{ diagnosisCode: 'A010', score: 2 }, { diagnosisCode: 'B011', score: 3 }] }), refStub);
    const r = await svc.severity('C500', ['A010', 'B011']);
    expect(r.totalScore).toBe(5);
    expect(r.unknownCount).toBe(0);
  });

  it('🔴 주진단이 0점 규칙에 걸리면 그 기타진단은 0 이 된다', async () => {
    const svc = new DrgReferenceService(
      mk({ scores: [{ diagnosisCode: 'A010', score: 4 }], zeros: [{ otherDiagnosis: 'A010', mainDiagnoses: ['C500'] }] }),
      refStub,
    );
    const r = await svc.severity('C500', ['A010']);
    expect(r.totalScore).toBe(0);
    expect(r.items[0].zeroedByMain).toBe(true);
    expect(r.items[0].baseScore).toBe(4); // 🔴 원 점수를 숨기지 않는다
  });

  it('대조군 — 다른 주진단이면 0 처리하지 않는다', async () => {
    const svc = new DrgReferenceService(
      mk({ scores: [{ diagnosisCode: 'A010', score: 4 }], zeros: [{ otherDiagnosis: 'A010', mainDiagnoses: ['C500'] }] }),
      refStub,
    );
    const r = await svc.severity('D123', ['A010']);
    expect(r.totalScore).toBe(4);
    expect(r.items[0].zeroedByMain).toBe(false);
  });

  it('🔴 표에 없는 진단은 0 이 아니라 "모른다" — 합계를 그대로 믿지 말라고 말한다', async () => {
    const svc = new DrgReferenceService(mk({ scores: [] }), refStub);
    const r = await svc.severity('C500', ['ZZ999']);
    expect(r.unknownCount).toBe(1);
    expect(r.items[0].known).toBe(false);
    expect(r.items[0].baseScore).toBeNull();
    expect(r.limits.join(' ')).toMatch(/세지 못했습니다/);
  });

  it('🔴 자료가 없으면 합계 0 을 "중증도 없음"이라 말하지 않는다', async () => {
    const svc = new DrgReferenceService(mk({ hasData: false }), refStub);
    const r = await svc.severity('C500', ['A010']);
    expect(r.basis).toBeNull();
    expect(r.limits.join(' ')).toMatch(/산출 불가/);
  });

  it('🔴 응답이 "DRG 산정이 아니다"를 항상 말한다', async () => {
    const svc = new DrgReferenceService(mk({ scores: [] }), refStub);
    const r = await svc.severity('C500', []);
    expect(r.limits.join(' ')).toMatch(/질병군\(ADRG\) 배정도, 수가 산정도 아닙니다/);
  });

  it('점 표기(A01.0)와 고시 표기(A010)를 같은 코드로 본다', async () => {
    const prisma = mk({ scores: [{ diagnosisCode: 'A010', score: 2 }] });
    const svc = new DrgReferenceService(prisma, refStub);
    const r = await svc.severity('C50.0', ['A01.0']);
    expect(r.totalScore).toBe(2);
    expect(r.mainDiagnosis).toBe('C500');
  });

  it('주진단이 없으면 계산하지 않는다', async () => {
    const svc = new DrgReferenceService(mk(), refStub);
    await expect(svc.severity('', ['A010'])).rejects.toThrow(/주진단/);
  });
});

describe('반영', () => {
  it('🔴 점수 범위 밖·코드 형태 아님은 반영하지 않고 그 사실을 남긴다', async () => {
    const svc = new DrgReferenceService(mk(), refStub);
    const r = await svc.importSeverity(
      [{ diagnosisCode: 'A010', score: 2 }, { diagnosisCode: '엉터리', score: 2 }, { diagnosisCode: 'B011', score: 9 }],
      { effectiveDate: '2026-01-01', sourceName: '별표4', userId: 'u1' },
    );
    expect(r.created).toBe(1);
    expect(r.skipped).toBe(2);
  });

  it('0점 규칙은 기타진단당 한 행 + 주진단 배열로 담는다(73만 행을 만들지 않는다)', async () => {
    const svc = new DrgReferenceService(mk(), refStub);
    const r = await svc.importZeroRules(
      [{ otherDiagnosis: 'A010', mainDiagnoses: ['C500', 'C501', 'C500'] }],
      { effectiveDate: '2026-01-01', sourceName: '별표5', userId: 'u1' },
    );
    expect(r.created).toBe(1);
    expect(r.pairs).toBe(2); // 중복은 접는다
  });

  it('🔴 기준일 없이는 반영되지 않는다(원장이 강제한다)', () => {
    const src = readFileSync(SVC, 'utf8');
    expect(src).toMatch(/effectiveDate: meta\.effectiveDate/);
  });
});

/**
 * 🔴 행위 **별도보상** — 포괄수가에 묶이지 않고 따로 산정하는 행위(고시 73,419코드).
 *    우리 수가 마스터 166,744 중 **10,878건**이 이 목록에 있다.
 */
describe('별도보상 판정', () => {
  const row = (over: Record<string, unknown> = {}) => ({
    code: 'C5807166', gazetteClass: '나580다(2)', name: '유전성 유전자검사',
    validFrom: new Date('2024-01-01'), validTo: new Date('9999-12-31'), ...over,
  });
  const mkSep = (rows: unknown[]) => ({
    drgSeparateBilling: {
      findMany: vi.fn().mockResolvedValue(rows),
      createMany: vi.fn().mockImplementation((a: { data: unknown[] }) => ({ count: a.data.length })),
    },
    procedureCode: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    referenceDataset: { create: vi.fn().mockResolvedValue({ id: 'ds1' }), update: vi.fn() },
  }) as never;

  it('기간 안이면 별도 산정 가능이라고 말한다', async () => {
    const r = await new DrgReferenceService(mkSep([row()]), refStub).isSeparatelyBillable(['C5807166'], '2026-05-01');
    expect(r.items[0].separatelyBillable).toBe(true);
  });

  it('🔴 기간이 지났으면 가능이라 말하지 않는다 — 그대로 청구된다', async () => {
    const r = await new DrgReferenceService(
      mkSep([row({ validTo: new Date('2025-12-31') })]), refStub,
    ).isSeparatelyBillable(['C5807166'], '2026-05-01');
    expect(r.items[0].separatelyBillable).toBe(false);
    expect(r.items[0].expiredOnly).toBe(true);
  });

  it('🔴 목록에 없으면 `null`(판정 불가) — "포괄 대상"이 아니다', async () => {
    const r = await new DrgReferenceService(mkSep([]), refStub).isSeparatelyBillable(['ZZZZ']);
    expect(r.items[0].separatelyBillable).toBeNull();
    expect(r.caveat).toMatch(/"포괄 대상"을 뜻하지 않습니다/);
  });

  it('빈 입력은 받지 않는다', async () => {
    await expect(new DrgReferenceService(mkSep([]), refStub).isSeparatelyBillable([])).rejects.toThrow(/수가코드/);
  });

  it('🔴 수가 마스터에는 분류**번호**를 채우고 분류**명**을 지어내지 않는다', async () => {
    const prisma = mkSep([]);
    await new DrgReferenceService(prisma, refStub).importSeparateBilling(
      [{ code: 'C5807166', gazetteClass: '나580다(2)' }],
      { effectiveDate: '2026-05-01', sourceName: '별도보상목록', userId: 'u1' },
    );
    const call = (prisma as unknown as { procedureCode: { updateMany: { mock: { calls: unknown[][] } } } })
      .procedureCode.updateMany.mock.calls[0][0] as { where: Record<string, unknown>; data: Record<string, unknown> };
    expect(call.data.gazetteClass).toBe('나580다(2)');
    expect(call.data.category).toBeUndefined(); // 🔴 분류명은 손대지 않는다
    expect(call.where.gazetteClass).toBeNull();  // 이미 있으면 덮지 않는다
  });
});
