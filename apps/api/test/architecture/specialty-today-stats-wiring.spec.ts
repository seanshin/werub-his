import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { specialtyTodayStats, SPECIALTY_DEPARTMENTS } from '../../src/common/specialty-board';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';

/**
 * 전문과 '오늘 현황' 정본 배선 가드 — 2026-08-26.
 *
 * 🔴 `specialtyTodayStats` 는 2026-08-13 에 12과 KPI 를 살리려고 만든 정본인데,
 *    **안과·이비인후과·피부과·치과 4과는 그 함수를 `import` 만 하고 부르지 않았다.**
 *    화면은 `stats.completed ?? 0` 을 읽으므로 서버가 그 키를 주지 않으면 값이 **항상 0** 이다.
 *    표본 부재가 아니라 **재본 적이 없는 값을 0이라 단정**하는 것(P1-ⓐ).
 *    → `import` 는 배선이 아니다. 호출을 기계로 확인한다.
 *
 * 🔴 그리고 노쇼가 어느 칸에도 없었다 — 목록·총계에는 들어가는데 완료·진행·대기 어디에도 없어
 *    "오늘 예약 1 / 완료 0 / 진행 0 / 대기 0" 이 됐다. 4칸 합 + 노쇼 = 총계여야 한다.
 */

const MODULES = join(__dirname, '..', '..', 'src', 'modules');

/** 이 정본을 쓰는 과 전부 — 하나라도 빠지면 그 과 KPI 가 영구 0 이 된다. */
const SPECIALTY_SERVICES: { module: string; key: string }[] = [
  { module: 'ophthalmology', key: 'ophthalmology' },
  { module: 'ent', key: 'ent' },
  { module: 'dermatology', key: 'dermatology' },
  { module: 'dental', key: 'dental' },
  { module: 'plastic', key: 'plastic' },
  { module: 'urology', key: 'urology' },
];

function serviceSrc(module: string): string {
  return readFileSync(join(MODULES, module, `${module}.service.ts`), 'utf8');
}

describe('전문과 stats 는 정본 specialtyTodayStats 를 실제로 호출한다', () => {
  for (const { module, key } of SPECIALTY_SERVICES) {
    it(`${module} — import 만 하고 두지 않는다`, () => {
      const src = serviceSrc(module);
      expect(src, `${module}: 정본을 import 하지 않는다`).toContain('specialtyTodayStats');
      // 🔴 `import` 문 자리를 지우고 나서도 남아 있어야 **호출**이다.
      const withoutImports = src.replace(/^import .*$/gm, '');
      expect(
        withoutImports.includes(`specialtyTodayStats(this.prisma, '${key}')`),
        `${module}: specialtyTodayStats 를 import 만 하고 호출하지 않는다 → 완료·진행·대기 카드가 영구 0`,
      ).toBe(true);
    });
  }

  it('🔴 재주입 대조군 — 호출을 지운 소스는 이 검사에서 실패한다', () => {
    const broken = serviceSrc('ophthalmology').replace(/specialtyTodayStats\(this\.prisma, '[^']*'\)/g, '{}');
    const withoutImports = broken.replace(/^import .*$/gm, '');
    expect(withoutImports.includes("specialtyTodayStats(this.prisma, 'ophthalmology')")).toBe(false);
  });
});

describe('오늘 현황 집계는 노쇼를 잃어버리지 않는다', () => {
  /** groupBy 결과만 돌려주는 최소 목 — 정본이 실제로 읽는 모양 그대로. */
  const prismaMock = (rows: { status: string; n: number }[]) =>
    ({
      appointment: {
        groupBy: async () => rows.map((r) => ({ status: r.status, _count: { _all: r.n } })),
      },
    }) as unknown as PrismaService;

  it('노쇼를 별도 칸으로 낸다 (대기에 섞지 않는다)', async () => {
    const stats = await specialtyTodayStats(
      prismaMock([{ status: 'NO_SHOW', n: 1 }, { status: 'CONFIRMED', n: 2 }, { status: 'COMPLETED', n: 3 }]),
      'ophthalmology',
    );
    expect(stats.noShow).toBe(1);
    expect(stats.waiting, '노쇼는 대기가 아니다').toBe(2);
    expect(stats.completed).toBe(3);
    expect(stats.todayAppointments).toBe(6);
  });

  it('🔴 4칸 합 + 노쇼 = 총계 — 어긋나면 화면이 설명할 수 없는 차이를 보인다', async () => {
    const rows = [
      { status: 'NO_SHOW', n: 2 }, { status: 'SCHEDULED', n: 1 }, { status: 'CONFIRMED', n: 1 },
      { status: 'CHECKED_IN', n: 1 }, { status: 'IN_PROGRESS', n: 1 }, { status: 'COMPLETED', n: 4 },
    ];
    const s = await specialtyTodayStats(prismaMock(rows), 'dental');
    expect(s.completed + s.inProgress + s.waiting + s.noShow).toBe(s.todayAppointments);
  });

  it('대조군 — 노쇼가 없으면 0 이지 "표시 안 함"이 아니다', async () => {
    const s = await specialtyTodayStats(prismaMock([{ status: 'COMPLETED', n: 1 }]), 'ent');
    expect(s.noShow).toBe(0);
    expect(s.completed + s.inProgress + s.waiting + s.noShow).toBe(s.todayAppointments);
  });

  it('미등재 과는 조용히 0 을 만들지 않고 정의된 과만 센다', async () => {
    const s = await specialtyTodayStats(prismaMock([{ status: 'COMPLETED', n: 9 }]), 'no-such-specialty');
    expect(s).toEqual({ todayAppointments: 0, completed: 0, inProgress: 0, waiting: 0, noShow: 0 });
    // 대조군: 이 스펙이 조준하는 6과는 전부 등재돼 있어야 한다
    for (const { key } of SPECIALTY_SERVICES) {
      expect(SPECIALTY_DEPARTMENTS[key], `${key} 가 SPECIALTY_DEPARTMENTS 에 없다`).toBeTruthy();
    }
  });
});

/* ════════════════════════════════════════════════════════════════════════
   라우트 그림자 — 같은 모양의 경로 두 개는 공존할 수 없다
   ════════════════════════════════════════════════════════════════════════ */

/**
 * 🔴 피부과 컨트롤러는 `@Get('lesions/:patientId')` 뒤에 `@Get('lesions/:id')` 를 선언했다.
 *    환자 UUID 와 병변 UUID 는 구분할 수 없으므로 NestJS 는 전부 먼저 선언된 쪽으로 보낸다 —
 *    `getLesionDetail` 은 **개통 이래 한 번도 실행된 적이 없다.**
 *    같은 모양의 경로가 한 컨트롤러에 두 번 나오면 뒤엣것은 죽은 코드다.
 */
describe('컨트롤러에 그림자 라우트(도달 불가)가 없다', () => {
  const CONTROLLERS = ['ophthalmology', 'ent', 'dermatology', 'dental', 'plastic', 'urology'];

  /** `@Get('a/:b')` → `GET a/:param` (파라미터 이름은 라우팅에 영향이 없다) */
  function routeShapes(src: string): string[] {
    const re = /@(Get|Post|Put|Patch|Delete)\((?:'([^']*)'|"([^"]*)")?\)/g;
    const out: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) {
      const path = (m[2] ?? m[3] ?? '').split('/').filter(Boolean)
        .map((s) => (s.startsWith(':') ? ':param' : s)).join('/');
      out.push(`${m[1]} ${path}`);
    }
    return out;
  }

  for (const module of CONTROLLERS) {
    it(`${module} — 같은 메서드·같은 모양의 라우트가 중복되지 않는다`, () => {
      const src = readFileSync(join(MODULES, module, `${module}.controller.ts`), 'utf8');
      const shapes = routeShapes(src);
      expect(shapes.length, `${module}: 라우트를 하나도 못 읽었다(정규식 확인)`).toBeGreaterThan(0);
      const dupes = shapes.filter((s, i) => shapes.indexOf(s) !== i);
      expect(
        [...new Set(dupes)],
        `${module}: 뒤에 선언된 쪽이 영원히 도달 불가다 — 세그먼트를 분리하라`,
      ).toEqual([]);
    });
  }

  it('🔴 재주입 대조군 — 그림자 라우트를 되살리면 탐지된다', () => {
    const injected = `
      @Get('lesions/:patientId') getA() {}
      @Get('lesions/:id') getB() {}
    `;
    const shapes = routeShapes(injected);
    expect(shapes).toEqual(['Get lesions/:param', 'Get lesions/:param']);
    expect(shapes.filter((s, i) => shapes.indexOf(s) !== i)).toHaveLength(1);
  });
});

/* ════════════════════════════════════════════════════════════════════════
   Prisma JSON 필터가 실제로 필터한다
   ════════════════════════════════════════════════════════════════════════ */

/**
 * 🔴 `where: { audiogramRight: { not: undefined } }` 는 Prisma 가 "조건 없음"으로 읽어 **no-op** 이다.
 *    청력도가 없는 검사도 '청력검사' 목록에 섞였고, 거기에 PTA `?? 0` 이 겹쳐 '정상' 배지가 붙었다.
 *    JsonB 의 SQL NULL 은 `Prisma.DbNull` 로 걸러야 한다.
 */
describe('JSON 컬럼 필터가 no-op 이 아니다', () => {
  const SERVICES = readdirSync(MODULES, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => join(MODULES, d.name, `${d.name}.service.ts`));

  /**
   * 남은 1건은 **동결한 기준선**이다(고쳤다고 말하지 않는다).
   * `CheckupStationLog.arrivedAt` 은 스키마상 non-nullable(`DateTime`)이라 이 필터는
   * no-op 이지만 걸러낼 행 자체가 없다 — **실피해 0건**이고, 고치면(=필터를 실제로 걸면)
   * 검진 스테이션 대기 집계가 바뀌므로 그 도메인 담당이 판단할 일이다.
   */
  const BASELINE = ['checkup/checkup-station.service.ts:336'];

  /** 봉합 주석은 "종전에 무엇이었는가"를 그대로 적는다 — 주석을 코드로 세지 않는다. */
  const codeOnly = (src: string) =>
    src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
      .split('\n').map((l) => (l.trim().startsWith('//') ? '' : l));

  it('`{ not: undefined }` 를 쓰는 where 절이 (동결 기준선 밖에) 없다', () => {
    const hits: string[] = [];
    for (const f of SERVICES) {
      let src: string;
      try { src = readFileSync(f, 'utf8'); } catch { continue; }
      codeOnly(src).forEach((line, i) => {
        if (/\{\s*not:\s*undefined\s*\}/.test(line)) hits.push(`${f.split('/modules/')[1]}:${i + 1}`);
      });
    }
    const newOnes = hits.filter((h) => !BASELINE.includes(h));
    expect(newOnes, `Prisma 는 undefined 를 "조건 없음"으로 읽는다 — 이 필터들은 아무것도 거르지 않는다:\n${newOnes.join('\n')}`).toEqual([]);
    // 🔴 기준선은 올리지 않는다 — 동결분이 사라졌으면 목록에서 지운다(늘어나는 것도 막는다).
    expect(hits.length, `기준선(${BASELINE.length}건)보다 늘었다: ${hits.join(', ')}`).toBeLessThanOrEqual(BASELINE.length);
  });

  it('대조군 — 스캔이 실제로 파일을 읽고 결함 모양을 알아본다', () => {
    expect(SERVICES.length).toBeGreaterThan(100);
    expect(/\{\s*not:\s*undefined\s*\}/.test('where: { x: { not: undefined } }')).toBe(true);
    // 봉합 주석은 세지 않는다
    expect(codeOnly('// 종전 `{ not: undefined }` 였다').join('\n').includes('not: undefined')).toBe(false);
  });

  it('🔴 ENT·치과는 실제로 DbNull 로 거른다 (조준을 잃지 않았는지 대조)', () => {
    for (const m of ['ent', 'dental']) {
      const src = readFileSync(join(MODULES, m, `${m}.service.ts`), 'utf8');
      expect(src, `${m}: JSON 필터가 DbNull 로 바뀌지 않았다`).toContain('not: Prisma.DbNull');
    }
  });
});
