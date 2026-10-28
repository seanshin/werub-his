import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FinanceBenchmarkService } from '../../src/modules/finance-benchmark/finance-benchmark.service';

/**
 * 경영성과 벤치마크(의료기관 회계정보공시 손익).
 *   ① 가져오기: 머리행 필수 열 · 항등식 깨진 행·숫자 아닌 칸·파일 안 중복·키 없는 행은 들이지 않고 사유 · 좌표 0 은 좌표 아님
 *   ② 개관: 우리 병원 미설정/미존재/존재 3상태 · 동급에서 우리 병원 제외 · 편차 기준 중앙값
 *   ③ 권한: 조회 ADMIN·EXECUTIVE · 가져오기 ADMIN
 * 실데이터 검증(로컬 DB · 저장소에 넣지 않음): 원 저장소 final_data 842행 전량 통과 · 재가져오기 0 생성/842 갱신 ·
 *   가상암센터 2021 재료비율 40.7% vs 종합병원 중앙값 23.9%(+16.8%p) — 원 대시보드 README 예시 재현.
 */
const H = ',연도,기관명,병상수,종별,설립형태,주소,Ⅰ.의료수익,Ⅱ.의료비용,Ⅱ-1.인건비,Ⅱ-2.재료비,Ⅱ-3.관리운영비,Ⅱ-4.기타의료비용,Ⅲ.의료이익(손실),Ⅳ.의료외수익,Ⅴ.의료외비용,Ⅵ.법인세차감전순이익(순손실),위도,경도';
const row = (i: number, name: string, rev: number, labor: number, mat: number, adm: number, extra = '', profitOverride?: number) => {
  const cost = labor + mat + adm;
  const profit = profitOverride ?? rev - cost;
  return `${i},2021,${name},300,종합병원,의료법인,"서울특별시 강남구 테헤란로 ${i}",${rev},${cost},${labor},${mat},${adm},0,${profit},10,5,${profit + 5}${extra}`;
};

function fakePrisma(existing: Array<{ fiscalYear: number; institutionName: string; institutionCode?: string | null; id?: string }> = []) {
  // 🔴 실제 서비스가 쓰는 모양 그대로 — 기존 행 조회(id·연도·이름·코드) → 행마다 update(id) 또는 create
  const upserts: any[] = []; // { op, id?, create } — 옛 단언과 같은 자리에 create/update 데이터를 싣는다
  const created: any[] = [];
  const rows = existing.map((e, i) => ({ id: e.id ?? `row${i}`, institutionCode: null, ...e }));
  const prisma: any = {
    financeDisclosure: {
      findMany: vi.fn(async () => rows),
    },
    $transaction: vi.fn(async (fn: any) => fn({
      financeDisclosureImport: { create: vi.fn(async (a: any) => { created.push(a.data); return { id: 'imp1', ...a.data }; }) },
      financeDisclosure: {
        update: vi.fn(async (a: any) => { upserts.push({ op: 'update', id: a.where.id, create: a.data }); return a.data; }),
        create: vi.fn(async (a: any) => { upserts.push({ op: 'create', create: a.data }); return a.data; }),
      },
    })),
  };
  return { prisma, upserts, created };
}
const csv = (...lines: string[]) => ({ buffer: Buffer.from('﻿' + [H, ...lines].join('\r\n'), 'utf8'), originalname: 't.csv' });

describe('① 가져오기 검증', () => {
  it('정상 행 적재 · 항등식 깨짐·숫자 아님·중복·키 없음은 사유와 함께 거절 · 좌표 0 은 null', async () => {
    const { prisma, upserts, created } = fakePrisma([{ fiscalYear: 2021, institutionName: 'A병원' }]);
    const bad = row(3, 'C병원', 1000, 400, 200, 100, '', 999); // 의료이익 999 ≠ 1000−700 — 항등식 깨기
    expect(bad).toContain(',999,'); // 🔴 주입이 실제로 들어갔는지 먼저 확인(치환 무동작을 통과로 읽지 않게)
    const r = await new FinanceBenchmarkService(prisma).importCsv(csv(
      row(1, 'A병원', 1000, 400, 200, 100) + ',37.5,127.0',
      row(2, 'B병원', 2000, 800, 500, 300) + ',0,0',
      bad + ',37.5,127.0',
      row(4, 'A병원', 1000, 400, 200, 100) + ',37.5,127.0',
      row(5, 'D병원', 1000, 400, 200, 100).replace('종합병원,의료법인,', '종합병원,의료법인,').replace(',1000,', ',1천,') + ',1,1',
      `6,2021,,300,종합병원,의료법인,x,1,1,1,0,0,0,0,0,0,0,1,1`,
    ), 'HASPA 2021', 'u1');
    expect(r).toMatchObject({ totalRows: 6, created: 1, updated: 1, rejected: 4 });
    expect(r.rejects.map((x) => x.reason).sort()).toEqual(['DUPLICATE_IN_FILE', 'IDENTITY', 'NUMBER_INVALID', 'ROW_KEY_MISSING']);
    expect(r.rejects.find((x) => x.reason === 'IDENTITY')!.detail).toContain('PROFIT');
    expect(upserts.map((u) => u.create.institutionName)).toEqual(['A병원', 'B병원']);
    const b = upserts.find((u) => u.create.institutionName === 'B병원').create;
    expect([b.lat, b.lng]).toEqual([null, null]); // 0,0 = 지오코딩 실패 표식
    expect(b).toMatchObject({ sido: '서울특별시', sigungu: '강남구', beds: 300, hospitalType: '종합병원' });
    expect(created[0]).toMatchObject({ sourceNote: 'HASPA 2021', rejected: 4, importedById: 'u1' });
  });
  it('🔴 시도·시군구 — 구조화 열(시도·시군구)이 주소 해석보다 먼저 · 약칭은 정식 이름 · 열이 없으면 주소에서(약칭도 정식)', async () => {
    // FY2024 실측: 주소 칸에 병원명·층수만 온 기관 172곳 · '대전 유성구' 같은 약칭 — 지도에서 빠지거나 시도가 둘로 갈렸다
    const HR = H + ',시도,시군구';
    const mk = (...lines: string[]) => ({ buffer: Buffer.from([HR, ...lines].join('\n'), 'utf8'), originalname: 'r.csv' });
    const { prisma, upserts } = fakePrisma();
    const r1 = row(1, '가병원', 1000, 400, 200, 100).replace('"서울특별시 강남구 테헤란로 1"', '"새움병원"') + ',,,대전,유성구';
    const r2 = row(2, '나병원', 1000, 400, 200, 100).replace('"서울특별시 강남구 테헤란로 2"', '"경북 안동시 앙실로 11"') + ',,,,';
    expect(r1).toContain('"새움병원"'); expect(r2).toContain('경북 안동시'); // 주입 확인
    await new FinanceBenchmarkService(prisma).importCsv(mk(r1, r2), undefined, null);
    const byName = Object.fromEntries(upserts.map((u) => [u.create.institutionName, u.create]));
    expect(byName['가병원']).toMatchObject({ sido: '대전광역시', sigungu: '유성구', address: '새움병원' });
    expect(byName['나병원']).toMatchObject({ sido: '경상북도', sigungu: '안동시' });
  });

  it('🔴 기관 코드 식별 — 코드가 있으면 (연도, 코드) · 같은 해 같은 이름의 다른 기관도 둘 다 들인다 · 코드 없는 기존 행(원 저장소)엔 코드를 붙인다', async () => {
    const HC = H + ',기관코드';
    const mk = (...lines: string[]) => ({ buffer: Buffer.from([HC, ...lines].join('\n'), 'utf8'), originalname: 'c.csv' });
    // 기존: 원 저장소 행(코드 없음) '가병원' · 코드 있는 행 C9
    const { prisma, upserts } = fakePrisma([
      { id: 'old-ga', fiscalYear: 2021, institutionName: '가병원', institutionCode: null },
      { id: 'coded', fiscalYear: 2021, institutionName: '옛이름병원', institutionCode: 'C9' },
    ]);
    const r = await new FinanceBenchmarkService(prisma).importCsv(mk(
      row(1, '가병원', 1000, 400, 200, 100) + ',,,C1',   // 코드 없는 기존 '가병원'에 코드를 붙여 갱신
      row(2, '명지병원', 1000, 400, 200, 100) + ',,,C2', // 같은 이름 다른 기관 둘 — 둘 다 새로
      row(3, '명지병원', 900, 400, 200, 100) + ',,,C3',
      row(4, '새이름병원', 1000, 400, 200, 100) + ',,,C9', // 이름이 바뀌어도 코드로 같은 행을 갱신
      row(5, '명지병원', 900, 400, 200, 100) + ',,,C3',   // 같은 코드 파일 안 중복 → 거절
    ), undefined, null);
    expect(r).toMatchObject({ created: 2, updated: 2, rejected: 1 });
    const u = upserts.filter((x) => x.op === 'update').map((x) => [x.id, x.create.institutionName, x.create.institutionCode]);
    expect(u).toEqual([['old-ga', '가병원', 'C1'], ['coded', '새이름병원', 'C9']]);
    expect(upserts.filter((x) => x.op === 'create').map((x) => x.create.institutionCode)).toEqual(['C2', 'C3']);
  });

  it('코드 없는 입력은 같은 (연도, 이름) 행이 둘 이상이면 어느 기관인지 모르므로 거절(AMBIGUOUS_NAME)', async () => {
    const { prisma, upserts } = fakePrisma([
      { id: 'a', fiscalYear: 2021, institutionName: '명지병원', institutionCode: 'C2' },
      { id: 'b', fiscalYear: 2021, institutionName: '명지병원', institutionCode: 'C3' },
    ]);
    const r = await new FinanceBenchmarkService(prisma).importCsv(csv(row(1, '명지병원', 1000, 400, 200, 100) + ',,'), undefined, null);
    expect(r.rejects.map((x) => x.reason)).toEqual(['AMBIGUOUS_NAME']);
    expect(upserts).toHaveLength(0);
  });

  it('필수 열 없음 → 400 CSV_HEADER_MISSING', async () => {
    const { prisma } = fakePrisma();
    await expect(new FinanceBenchmarkService(prisma).importCsv({ buffer: Buffer.from('연도,이름\n2021,x'), originalname: 'x.csv' }, undefined, null))
      .rejects.toMatchObject({ response: { code: 'CSV_HEADER_MISSING' } });
  });
});

describe('② 개관 — 우리 병원 3상태 · 동급에서 제외 · 중앙값 편차', () => {
  const mk = (name: string, rev: number, mat: number, type = '종합병원') => ({
    fiscalYear: 2021, institutionName: name, hospitalType: type, beds: 100,
    accounts: { medicalRevenue: rev, materialCost: mat, medicalProfit: rev * 0.01, laborCost: 1, adminCost: 1 },
  });
  const rows = [mk('우리', 100, 40), mk('p1', 100, 20), mk('p2', 100, 22), mk('p3', 100, 90), mk('big', 100, 30, '상급종합병원')];
  function svc(self: string | null) {
    const prisma: any = {
      financeDisclosure: {
        groupBy: vi.fn(async () => [{ fiscalYear: 2021 }]),
        findMany: vi.fn(async () => rows),
      },
      financeDisclosureImport: { findFirst: vi.fn(async () => null) },
    };
    return new FinanceBenchmarkService(prisma, { get: vi.fn(async () => self) } as any);
  }
  it('미설정 → NOT_SET · 없는 이름 → NOT_FOUND(비교하지 않는다)', async () => {
    expect((await svc(null).overview() as any).self).toEqual({ status: 'NOT_SET', name: null });
    expect((await svc('없는병원').overview() as any).self).toEqual({ status: 'NOT_FOUND', name: '없는병원' });
  });
  it('존재 → 종별 자동 · 동급에서 자기 제외 · 재료비 편차는 중앙값 기준', async () => {
    const o: any = await svc('우리').overview();
    expect(o.type).toBe('종합병원');
    expect(o.peerCount).toBe(3);
    expect(o.peer.materialRatio).toMatchObject({ n: 3, median: 0.22 });
    expect(o.self.deviations.materialRatio.diff).toBeCloseTo(0.18, 9); // 평균(0.44) 기준이면 −0.04 로 '양호'가 된다
    expect(o.self.deviations.materialRatio.worse).toBe(true);
  });
  it('데이터 없음 → available:false(0 으로 그리지 않는다)', async () => {
    const prisma: any = { financeDisclosure: { groupBy: vi.fn(async () => []) }, financeDisclosureImport: { findFirst: vi.fn(async () => null) } };
    expect(await new FinanceBenchmarkService(prisma).overview()).toMatchObject({ available: false, reason: 'NO_DATA' });
  });
});

describe('③ 권한', () => {
  const ctl = readFileSync(join(__dirname, '../../src/modules/finance-benchmark/finance-benchmark.controller.ts'), 'utf8');
  it('조회는 ADMIN·EXECUTIVE · 가져오기는 ADMIN 만', () => {
    expect(ctl).toMatch(/@Roles\(UserRole\.ADMIN, UserRole\.EXECUTIVE\)\n@Controller\('api\/v1\/finance-benchmark'\)/);
    expect(/@Post\('imports'\)\s*\n\s*@Roles\(UserRole\.ADMIN\)\n/.test(ctl)).toBe(true);
  });
});

describe('④ 추이 — 기관 코드로 잇는다', () => {
  const acc = (rev: number, profit: number) => ({ medicalRevenue: rev, medicalProfit: profit, preTaxIncome: profit });
  it('🔴 코드가 같으면 해마다 이름이 달라도 한 줄 · 동급에서 자기는 id 로 뺀다 · linkedBy/names 로 사실을 말한다', async () => {
    const mine = [
      { id: 'r16', fiscalYear: 2016, institutionName: '재단법인아산사회복지재단가상중앙병원', institutionCode: '11100001', hospitalType: '상급종합병원', accounts: acc(1000, 50) },
      { id: 'r22', fiscalYear: 2022, institutionName: '가상중앙병원', institutionCode: '11100001', hospitalType: '상급종합병원', accounts: acc(1200, 30) },
    ];
    const findMany = vi.fn(async (a: any) => (a.where.institutionCode ? mine : [{ id: 'peer', accounts: acc(1000, 10) }]));
    const svc = new FinanceBenchmarkService({ financeDisclosure: { findMany } } as any);
    const t = await svc.trend(undefined, '11100001');
    expect(findMany.mock.calls[0][0].where).toEqual({ institutionCode: '11100001' });
    expect(t.rows.map((r) => r.year)).toEqual([2016, 2022]);
    expect(t.linkedBy).toBe('CODE');
    expect(t.names).toEqual(['재단법인아산사회복지재단가상중앙병원', '가상중앙병원']);
    expect(findMany.mock.calls[1][0].where.NOT).toEqual({ id: 'r16' });
  });
  it('코드가 없으면 이름으로 찾고 linkedBy=NAME', async () => {
    const findMany = vi.fn(async (a: any) => (a.where.institutionName ? [{ id: 'x', fiscalYear: 2021, institutionName: '가병원', institutionCode: null, hospitalType: '종합병원', accounts: acc(10, 1) }] : []));
    const t = await new FinanceBenchmarkService({ financeDisclosure: { findMany } } as any).trend('가병원');
    expect(t.linkedBy).toBe('NAME');
  });
});

describe('⑤ 세목 드릴다운', () => {
  it('가져오기 — 세목 JSON 은 트리 코드만 남기고 · 깨진 JSON·숫자 아닌 값은 행을 거절(DETAIL_INVALID)', async () => {
    const HD = H + ',세목';
    const q = (o: unknown) => `"${JSON.stringify(o).replace(/"/g, '""')}"`;
    const mk = (...lines: string[]) => ({ buffer: Buffer.from([HD, ...lines].join('\n'), 'utf8'), originalname: 'd.csv' });
    const { prisma, upserts } = fakePrisma();
    const r = await new FinanceBenchmarkService(prisma).importCsv(mk(
      row(1, '가병원', 1000, 400, 200, 100) + ',,,' + q({ '60201010': 300, '60201030': 100, '99999999': 5 }),
      row(2, '나병원', 1000, 400, 200, 100) + ',,,' + q({ '60201010': '많음' }),
      row(3, '다병원', 1000, 400, 200, 100) + ',,,{깨짐',
    ), undefined, null);
    expect(r.rejects.map((x) => x.reason)).toEqual(['DETAIL_INVALID', 'DETAIL_INVALID']);
    expect(upserts[0].create.detail).toEqual({ '60201010': 300, '60201030': 100 }); // 모르는 코드는 버린다
  });

  const acc = { medicalRevenue: 1000 };
  it('🔴 비중·동급 중앙값(n) · 세목 합 ≠ 상위면 mismatches · 세목 없는 행은 available:false(0 으로 그리지 않는다)', async () => {
    const me = { id: 'me', fiscalYear: 2024, institutionName: '가', institutionCode: 'C1', hospitalType: '요양병원', accounts: acc,
      detail: { '60201000': 500, '60201010': 300, '60201020': 100 } }; // 급여+제수당 400 ≠ 인건비 500
    const peers = [
      { accounts: { medicalRevenue: 2000 }, detail: { '60201010': 600 } },
      { accounts: { medicalRevenue: 1000 }, detail: { '60201010': 400 } },
      { accounts: { medicalRevenue: 1000 }, detail: null }, // 세목 없는 동급은 분모에서 뺀다
    ];
    const prisma: any = { financeDisclosure: {
      groupBy: vi.fn(async () => [{ fiscalYear: 2024 }]),
      findFirst: vi.fn(async () => me),
      findMany: vi.fn(async () => peers),
    } };
    const d: any = await new FinanceBenchmarkService(prisma).detail('C1');
    const salary = d.nodes.find((n: any) => n.code === '60201010');
    expect(salary).toMatchObject({ amount: 300, share: 0.3, peerMedianShare: 0.35, peerN: 2 });
    expect(d.mismatches.map((m: any) => m.code)).toEqual(['60201000']);
    prisma.financeDisclosure.findFirst.mockResolvedValue({ ...me, detail: null });
    expect(await new FinanceBenchmarkService(prisma).detail('C1')).toMatchObject({ available: false, reason: 'NO_DETAIL' });
  });
});
