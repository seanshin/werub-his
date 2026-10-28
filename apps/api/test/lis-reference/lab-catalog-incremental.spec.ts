/**
 * LIS 검사코드 카탈로그 증분(`?since=`) — 패널 변경·비활성을 싣는다.
 *
 * 🔴 종전: 증분은 수가 코드(ProcedureCode.updatedAt)만 보았고 패널 항목(LabTestCode)엔 `updatedAt` 이 없었다 —
 *    결과 항목을 패널에 추가·수정·비활성해도 부모 코드가 다시 나가지 않아 **LIS 는 옛 패널을 계속 썼다**.
 *    수가 코드의 비활성도 증분에 실리지 않았다(활성만 실었다).
 * 지키는 것: ② 패널 항목이 바뀐 코드도 실린다(현재 전체 패널 — 교체용) · ③ 비활성 코드를 `deactivated` 로 · 대조군: since 없으면 종전 모양.
 * 재주입: 패널 변경 OR 를 지우면 ②, deactivated 조회를 지우면 ③ 이 실패한다.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { LisReferenceService } from '../../src/modules/lis-reference/lis-reference.service';

type Where = Record<string, any>;
const flat = (w: Where) => JSON.stringify(w);

function make(opts: { changedPanels?: string[]; procedure?: { code: string; nameKo: string; isActive: boolean; updatedAt: Date; outOfScope?: boolean }[]; panelItems?: { code: string; ediCode: string; nameKo: string }[] }) {
  const procedure = opts.procedure ?? [];
  const procedureFindMany = vi.fn(async ({ where, select }: { where: Where; select?: Where }) => {
    const w = flat(where);
    // ③ 비활성 조회
    if (where.isActive === false) return procedure.filter((p) => !p.isActive).map((p) => ({ code: p.code }));
    // 패널 공시 — 범위 안(검사 범위·유효기간)인가
    if (where.code?.in && where.AND) return procedure.filter((p) => p.isActive && !p.outOfScope && where.code.in.includes(p.code)).map((p) => ({ code: p.code }));
    // ③ 아직 활성판이 있는가 · 패널 공시 — 처방 코드가 있는가
    if (where.code?.in && where.isActive === true) return procedure.filter((p) => p.isActive && where.code.in.includes(p.code)).map((p) => ({ code: p.code }));
    // 목록·총수 — 증분이면 패널 변경 OR 가 들어 있는지 본다
    const panelOr = /"code":\{"in":\[([^\]]*)\]/.exec(w);
    const panelCodes = panelOr ? JSON.parse(`[${panelOr[1]}]`) as string[] : [];
    const sinceIdx = w.indexOf('"updatedAt":{"gte"');
    const rows = procedure.filter((p) => p.isActive && !p.outOfScope && (sinceIdx < 0 || p.updatedAt.getTime() >= Date.parse('2026-10-01T00:00:00Z') || panelCodes.includes(p.code)));
    return select?.nameKo ? rows.map((p) => ({ ...p, loincCode: null, category: '검사료', validFrom: new Date('2020-01-01') })) : rows.map((p) => ({ code: p.code }));
  });
  const labFindMany = vi.fn(async ({ where }: { where: Where }) => {
    if (where.updatedAt) return (opts.changedPanels ?? []).map((ediCode) => ({ ediCode }));
    return (opts.panelItems ?? []).map((p) => ({ ...p, nameEn: null, loincCode: null, specimen: null, unit: null }));
  });
  const svc = new LisReferenceService({ procedureCode: { findMany: procedureFindMany }, labTestCode: { findMany: labFindMany } } as never);
  return { svc, procedureFindMany, labFindMany };
}

const OLD = new Date('2026-01-01T00:00:00Z');
const NEW = new Date('2026-10-01T05:00:00Z');

describe('검사코드 카탈로그 증분', () => {
  it('🔴 ② 코드는 그대로인데 패널 항목이 바뀌면 그 코드를 현재 전체 패널과 함께 싣는다', async () => {
    const { svc } = make({
      changedPanels: ['B101'],
      procedure: [{ code: 'B101', nameKo: '일반혈액', isActive: true, updatedAt: OLD }, { code: 'B102', nameKo: '응고', isActive: true, updatedAt: OLD }],
      panelItems: [{ code: 'L1', ediCode: 'B101', nameKo: 'WBC' }, { code: 'L2', ediCode: 'B101', nameKo: 'RBC' }],
    });
    const r = await svc.getLabCodeCatalog('2026-10-01T00:00:00Z');
    expect(r.items.map((i) => i.code)).toEqual(['B101']); // 바뀌지 않은 B102 는 싣지 않는다
    expect(r.items[0].panel.map((p) => p.resultItemCode)).toEqual(['L1', 'L2']);
    expect(r).toMatchObject({ panelChangedCodes: 1 });
  });

  it('대조군 — 코드 자체가 바뀐 것은 종전처럼 실린다 · 아무것도 안 바뀌면 빈 증분', async () => {
    const a = make({ procedure: [{ code: 'B101', nameKo: '일반혈액', isActive: true, updatedAt: NEW }] });
    expect((await a.svc.getLabCodeCatalog('2026-10-01T00:00:00Z')).items.map((i) => i.code)).toEqual(['B101']);
    const b = make({ procedure: [{ code: 'B101', nameKo: '일반혈액', isActive: true, updatedAt: OLD }] });
    expect((await b.svc.getLabCodeCatalog('2026-10-01T00:00:00Z')).items).toEqual([]);
  });

  it('🔴 ③ 기간 안에 비활성된 코드는 deactivated 로 — 다른 활성판이 남아 있으면 비활성이 아니다', async () => {
    const { svc } = make({
      procedure: [
        { code: 'B200', nameKo: '폐지 검사', isActive: false, updatedAt: NEW },
        { code: 'B300', nameKo: '옛 판만 비활성', isActive: false, updatedAt: NEW },
        { code: 'B300', nameKo: '새 판', isActive: true, updatedAt: OLD },
      ],
    });
    const r = await svc.getLabCodeCatalog('2026-10-01T00:00:00Z');
    expect(r.deactivated).toEqual(['B200']);
  });

  it('대조군 — since 없는 전체 동기화는 종전 모양(패널 변경 조회·deactivated 없음)', async () => {
    const { svc, labFindMany } = make({ procedure: [{ code: 'B101', nameKo: '일반혈액', isActive: true, updatedAt: OLD }] });
    const r = await svc.getLabCodeCatalog();
    expect(r.items.map((i) => i.code)).toEqual(['B101']);
    expect(r).not.toHaveProperty('deactivated');
    expect(r).not.toHaveProperty('panelChangedCodes');
    expect(labFindMany.mock.calls.some((c) => (c[0] as { where: Where }).where.updatedAt)).toBe(false);
  });

  it('잘못된 since 는 400', async () => {
    await expect(make({}).svc.getLabCodeCatalog('nope')).rejects.toMatchObject({ status: 400 });
  });
});

describe('결과 항목은 있는데 카탈로그에 실리지 않는 패널 — 실리지 않는다고 말한다', () => {
  /**
   * 🔴 운영 실측(2026-10-01): 패널 25 중 18 이 실리지 않았다 — 11 은 처방 코드 행이 없고, 7 은 실제 수가 마스터에서 **다른 행위**다
   *    (일반혈액 결과 항목 5개가 '심전도검사' E6541 에 붙어 있다). 범위를 넓히면 LIS 가 '심전도검사 = CBC 패널'을 받는다 — 넓히지 않는다.
   */
  it('🔴 처방 코드 없음·검사 범위 밖을 갈라 밝히고, 범위 밖 코드를 패널째 싣지 않는다 · 대조군: 정상 패널은 싣는다', async () => {
    const { svc } = make({
      procedure: [
        { code: 'B101', nameKo: '일반혈액', isActive: true, updatedAt: OLD },
        { code: 'E6541', nameKo: '심전도검사', isActive: true, updatedAt: OLD, outOfScope: true },
      ],
      panelItems: [
        { code: 'L1', ediCode: 'B101', nameKo: 'WBC' },
        { code: 'L2', ediCode: 'E6541', nameKo: 'CBC' },
        { code: 'M1', ediCode: 'D6591', nameKo: 'SARS-CoV-2' },
      ],
    });
    const r = await svc.getLabCodeCatalog();
    expect(r.items.map((i) => i.code)).toEqual(['B101']);
    expect(r.items[0].panel.map((p) => p.resultItemCode)).toEqual(['L1']);
    expect(r.panelsOutOfCatalog).toEqual({ missingProcedureCode: ['D6591'], outOfScope: ['E6541'] });
  });

  it('대조군 — 전부 실리면 빈 목록(0 이 사실일 때 0 이라 말한다)', async () => {
    const { svc } = make({ procedure: [{ code: 'B101', nameKo: '일반혈액', isActive: true, updatedAt: OLD }], panelItems: [{ code: 'L1', ediCode: 'B101', nameKo: 'WBC' }] });
    expect((await svc.getLabCodeCatalog()).panelsOutOfCatalog).toEqual({ missingProcedureCode: [], outOfScope: [] });
  });
});

describe('감시자 86 — 카탈로그 범위 규칙과 같은 규칙으로 센다', () => {
  it('🔴 SQL 의 접두·검사 분류·LOINC 조건이 서비스 labScope 와 같다(한쪽만 바뀌면 감시자가 다른 것을 센다)', () => {
    const sql = readFileSync(join(__dirname, '../../../../infra/scripts/data-integrity-scan.sql'), 'utf8');
    const seg = sql.slice(sql.indexOf("'86 검사 결과 항목"), sql.indexOf('UNION ALL', sql.indexOf("'86 검사 결과 항목")));
    const svc = readFileSync(join(__dirname, '../../src/modules/lis-reference/lis-reference.service.ts'), 'utf8');
    const scope = svc.slice(svc.indexOf('const labScope'), svc.indexOf('};', svc.indexOf('const labScope')));
    const prefixes = [...scope.matchAll(/startsWith: '(\w)'/g)].map((m) => m[1]);
    const cats = /category: \{ in: \[([^\]]+)\]/.exec(scope)![1].match(/'[^']+'/g)!;
    expect(prefixes).toEqual(['B', 'C', 'D']);
    for (const p of prefixes) expect(seg).toContain(`p.code LIKE '${p}%'`);
    expect(seg).toContain(`p.category IN (${cats.join(', ')})`);
    expect(scope).toMatch(/loincCode: \{ not: null \}/);
    expect(seg).toContain('p.loinc_code IS NOT NULL');
  });
});
