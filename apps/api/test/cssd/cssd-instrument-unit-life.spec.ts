/**
 * CSSD 기구 개체 수명·멸균 횟수(cssd-inventory 잔여).
 * 지키는 것:
 *  ① 멸균 횟수는 패키지 기록에서 **파생** — 멸균 합격(sterilizedAt) 패키지만 센다(실패·진행 중 로드는 세지 않는다)
 *  ② 최초 사용일은 가장 이른 usedAt, 사용 기록이 없으면 null(지어내지 않음)
 *  ③ 한도 미설정이면 NO_LIMIT·remaining null — 경보 없음(대조군: 설정하면 경고가 난다)
 *  ④ 개체 한도가 품목 한도를 덮고, 0·음수·소수 한도는 한도로 쓰지 않는다
 *  ⑤ 재포장: 한도 도달 개체는 **막지 않고** 경고 + 패키지 이벤트 · 등록 안 된 번호·폐기 개체는 LOT 만들기 전에 400
 */
import { describe, it, expect, vi } from 'vitest';
import { aggregateUnitUsage, evaluateUnitLife } from '../../src/modules/cssd/instrument-unit-life';
import { CssdUnitService } from '../../src/modules/cssd/cssd-unit.service';
import { CssdPackageService } from '../../src/modules/cssd/cssd-package.service';
import { DomainException } from '../../src/common/errors/domain.exception';

const d = (s: string) => new Date(s);

describe('기구 개체 수명 판정(순수)', () => {
  const rows = [
    { sterilizedAt: d('2026-03-01T01:00:00Z'), usedAt: d('2026-03-02T02:00:00Z') },
    { sterilizedAt: null, usedAt: null }, // 실패 로드로 되돌아간 패키지 — 세지 않는다
    { sterilizedAt: d('2026-02-01T01:00:00Z'), usedAt: null }, // 합격했지만 아직 안 씀
    { sterilizedAt: d('2026-04-01T01:00:00Z'), usedAt: d('2026-04-03T02:00:00Z') },
  ];

  it('① 합격 사이클만 센다 · 연결 패키지는 따로 · ② 최초 사용일·최초 합격일은 가장 이른 값', () => {
    expect(aggregateUnitUsage(rows)).toEqual({
      sterilizedCycles: 3,
      linkedPackages: 4,
      firstUsedAt: '2026-03-02T02:00:00.000Z',
      firstSterilizedAt: '2026-02-01T01:00:00.000Z',
    });
  });

  it('② 사용 기록이 없으면 최초 사용일 null', () => {
    expect(aggregateUnitUsage([{ sterilizedAt: d('2026-01-01T00:00:00Z'), usedAt: null }]).firstUsedAt).toBeNull();
    expect(aggregateUnitUsage([])).toEqual({ sterilizedCycles: 0, linkedPackages: 0, firstUsedAt: null, firstSterilizedAt: null });
  });

  it('③ 한도 미설정 → NO_LIMIT · remaining null(0 이 아니다)', () => {
    const life = evaluateUnitLife(aggregateUnitUsage(rows), null, null);
    expect(life).toMatchObject({ limit: null, limitSource: null, remaining: null, state: 'NO_LIMIT' });
  });

  it('③ 대조군 — 품목 한도 3 이면 합격 3회에서 LIMIT_REACHED · 5 이면 WITHIN(남은 2)', () => {
    expect(evaluateUnitLife(aggregateUnitUsage(rows), null, 3)).toMatchObject({ limit: 3, limitSource: 'ITEM', remaining: 0, state: 'LIMIT_REACHED' });
    expect(evaluateUnitLife(aggregateUnitUsage(rows), null, 5)).toMatchObject({ remaining: 2, state: 'WITHIN' });
  });

  it('④ 개체 한도가 품목 한도를 덮는다 · 0·음수·소수는 한도로 쓰지 않는다', () => {
    expect(evaluateUnitLife(aggregateUnitUsage(rows), 10, 3)).toMatchObject({ limit: 10, limitSource: 'UNIT', state: 'WITHIN' });
    expect(evaluateUnitLife(aggregateUnitUsage(rows), 0, 3)).toMatchObject({ limit: 3, limitSource: 'ITEM' });
    expect(evaluateUnitLife(aggregateUnitUsage(rows), -1, 2.5)).toMatchObject({ limit: null, state: 'NO_LIMIT' });
  });
});

type Unit = { id: string; serialNo: string; status: string; maxCycles: number | null; item: { maxCycles: number | null } };
type Link = { unitId: string; package: { sterilizedAt: Date | null; usedAt: Date | null; status: string; lotNo: string } };

function fakePrisma(units: Unit[], links: Link[]) {
  const events: { action: string; note?: string | null }[] = [];
  const createdLinks: { packageId: string; unitId: string }[] = [];
  const prisma = {
    events,
    createdLinks,
    instrumentUnit: {
      findMany: vi.fn(async ({ where }: { where: { serialNo: { in: string[] } } }) => units.filter((u) => where.serialNo.in.includes(u.serialNo))),
    },
    sterilePackageUnit: {
      findMany: vi.fn(async ({ where }: { where: { unitId: { in: string[] }; package?: { status: { in: string[] } } } }) =>
        links
          .filter((l) => where.unitId.in.includes(l.unitId))
          .filter((l) => !where.package || where.package.status.in.includes(l.package.status)),
      ),
      createMany: vi.fn(async ({ data }: { data: { packageId: string; unitId: string }[] }) => { createdLinks.push(...data); return { count: data.length }; }),
    },
    instrumentSetTemplate: {
      findUnique: vi.fn(async () => ({ id: 't1', name: '일반 수술 세트', packagingType: 'POUCH', items: [] })),
    },
    sterilePackage: {
      count: vi.fn(async () => 0),
      create: vi.fn(async ({ data }: { data: { lotNo: string } }) => ({ id: 'pkg-new', ...data })),
    },
    packageEvent: {
      create: vi.fn(async ({ data }: { data: { action: string; note?: string | null } }) => { events.push(data); return data; }),
    },
  };
  return prisma;
}

const unitsFixture: Unit[] = [
  { id: 'u1', serialNo: 'KF-001', status: 'ACTIVE', maxCycles: 2, item: { maxCycles: null } }, // 합격 2회 = 한도 도달
  { id: 'u2', serialNo: 'KF-002', status: 'ACTIVE', maxCycles: null, item: { maxCycles: null } }, // 한도 미설정
  { id: 'u3', serialNo: 'KF-003', status: 'RETIRED', maxCycles: null, item: { maxCycles: 100 } },
];
const linksFixture: Link[] = [
  { unitId: 'u1', package: { sterilizedAt: d('2026-01-01T00:00:00Z'), usedAt: null, status: 'RETURNED', lotNo: 'PKG-A' } },
  { unitId: 'u1', package: { sterilizedAt: d('2026-02-01T00:00:00Z'), usedAt: null, status: 'RETURNED', lotNo: 'PKG-B' } },
  { unitId: 'u2', package: { sterilizedAt: d('2026-02-01T00:00:00Z'), usedAt: null, status: 'STERILE', lotNo: 'PKG-C' } }, // 아직 열린 패키지
  ...Array.from({ length: 50 }, (_, i) => ({ unitId: 'u2', package: { sterilizedAt: d('2025-01-01T00:00:00Z'), usedAt: null, status: 'RETURNED', lotNo: `OLD-${i}` } })),
];

describe('재포장에 개체 연결 — 막지 않고 경고', () => {
  it('⑤ 한도 도달 개체는 경고만(LOT 생성·연결은 진행) · 한도 미설정 개체는 사이클이 많아도 수명 경고 없음 · 열린 패키지 중복도 경고', async () => {
    const prisma = fakePrisma(unitsFixture, linksFixture);
    const units = new CssdUnitService(prisma as never);
    const inventory = { consumeForRepackage: vi.fn(async () => ({ shortages: [], consumed: [], failed: [], complete: true })) };
    const pkgSvc = new CssdPackageService(prisma as never, inventory as never, undefined, units);

    const r = await pkgSvc.repackage({ templateId: 't1', countVerified: true, unitSerials: ['KF-001', 'KF-002'], userId: 'n1' });

    expect(prisma.sterilePackage.create).toHaveBeenCalledTimes(1);
    expect(prisma.createdLinks.map((l) => l.unitId).sort()).toEqual(['u1', 'u2']);
    expect(r.unitWarnings).toEqual([
      { serialNo: 'KF-001', code: 'LIFE_LIMIT_REACHED', sterilizedCycles: 2, limit: 2 },
      { serialNo: 'KF-002', code: 'IN_OPEN_PACKAGE', otherLots: ['PKG-C'] },
    ]);
    expect(prisma.events.map((e) => e.action)).toEqual(expect.arrayContaining(['기구 개체 구성', '수명 한도 도달 기구 포함', '다른 열린 패키지의 기구 포함']));
  });

  it('⑤ 등록되지 않은 번호는 LOT 를 만들기 전에 400(details.missing)', async () => {
    const prisma = fakePrisma(unitsFixture, linksFixture);
    const pkgSvc = new CssdPackageService(prisma as never, { consumeForRepackage: vi.fn() } as never, undefined, new CssdUnitService(prisma as never));
    const err = await pkgSvc.repackage({ templateId: 't1', countVerified: true, unitSerials: ['KF-001', 'NOPE-9'], userId: 'n1' }).catch((e) => e);
    expect(err).toBeInstanceOf(DomainException);
    expect((err as DomainException).getResponse()).toMatchObject({ domainCode: 'CSSD_UNIT_NOT_REGISTERED', details: { missing: ['NOPE-9'] } });
    expect(prisma.sterilePackage.create).not.toHaveBeenCalled();
  });

  it('⑤ 폐기 개체는 400 — 폐기는 사람의 명시적 결정이라 한도 경고와 다르다', async () => {
    const prisma = fakePrisma(unitsFixture, linksFixture);
    const pkgSvc = new CssdPackageService(prisma as never, { consumeForRepackage: vi.fn() } as never, undefined, new CssdUnitService(prisma as never));
    const err = await pkgSvc.repackage({ templateId: 't1', countVerified: true, unitSerials: ['KF-003'], userId: 'n1' }).catch((e) => e);
    expect((err as DomainException).getResponse()).toMatchObject({ domainCode: 'CSSD_UNIT_RETIRED' });
    expect(prisma.sterilePackage.create).not.toHaveBeenCalled();
  });

  it('대조군 — 개체 번호 없이 재포장하면 종전과 같다(연결·경고 없음)', async () => {
    const prisma = fakePrisma(unitsFixture, linksFixture);
    const inventory = { consumeForRepackage: vi.fn(async () => ({ shortages: [], consumed: [], failed: [], complete: true })) };
    const pkgSvc = new CssdPackageService(prisma as never, inventory as never, undefined, new CssdUnitService(prisma as never));
    const r = await pkgSvc.repackage({ templateId: 't1', countVerified: true, userId: 'n1' });
    expect(r.unitWarnings).toEqual([]);
    expect(prisma.sterilePackageUnit.createMany).not.toHaveBeenCalled();
  });
});
