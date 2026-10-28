import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { toFullScanSql, parseIntegrityRows, INTEGRITY_DRILLDOWN } from '../../src/sentinel/integrity-sweep';
import { SentinelService } from '../../src/sentinel/sentinel.service';
import { SentinelReadService, SENTINEL_AXES } from '../../src/sentinel/sentinel-read.service';

const REPO_ROOT = join(process.cwd(), '..', '..');

describe('감시자 축 A — 정합성 SQL 을 그대로 쓴다', () => {
  it('🔴 psql 메타커맨드만 걷어내고 SQL 본문은 손대지 않는다', () => {
    const raw = readFileSync(join(REPO_ROOT, 'infra/scripts/data-integrity-scan.sql'), 'utf-8');
    const sql = toFullScanSql(raw);
    expect(sql).not.toMatch(/^\s*\\pset/m);
    expect(sql).not.toMatch(/^\s*\\timing/m);
    expect(sql, '불변식 본문이 살아 있어야 한다').toContain('WITH checks AS');
    expect(sql, 'UNION ALL 절이 통째로 사라지면 안 된다').toMatch(/UNION ALL/);
  });

  it('🔴 0건 항목도 받는다 — "평가했는데 0"과 "평가 안 함"은 다른 사실이다', () => {
    const raw = readFileSync(join(REPO_ROOT, 'infra/scripts/data-integrity-scan.sql'), 'utf-8');
    expect(raw, '원본은 위반만 낸다').toContain('WHERE n > 0');
    expect(toFullScanSql(raw), '감시자용은 전 항목을 받아야 한다').not.toContain('WHERE n > 0');
  });

  it('🔴 치환이 무동작이면 조용히 통과하지 않고 던진다', () => {
    // 꼬리가 없는 SQL — 구조가 바뀐 상황을 흉내낸다
    expect(() => toFullScanSql('SELECT 1;')).toThrow(/0회 찾았습니다/);
    // 꼬리가 둘이면 어느 것을 지울지 모른다 → 역시 던진다
    expect(() => toFullScanSql('a\nWHERE n > 0\nb\nWHERE n > 0\nc')).toThrow(/2회 찾았습니다/);
  });

  it('점검 항목을 코드와 라벨로 가른다(48e 처럼 접미가 붙은 것 포함)', () => {
    const out = parseIntegrityRows([
      { sev: '🔴', chk: '09 서명된 진료인데 진단 없음', n: 83 },
      { sev: '🟡', chk: '48e 24시간 넘게 청소 중인 베드', n: 2 },
      { sev: '⚪', chk: '12 30일 넘은 DRAFT 진료(미완결)', n: 193 },
    ]);
    expect(out[0]).toEqual({ key: 'integrity.09', severity: 'RED', label: '서명된 진료인데 진단 없음', value: 83 });
    expect(out[1].key).toBe('integrity.48e');
    expect(out[1].severity).toBe('AMBER');
    expect(out[2].severity).toBe('INFO');
  });

  it('🔴 모르는 심각도를 낮추지 않는다 — 사람이 보게 RED 로 올린다', () => {
    expect(parseIntegrityRows([{ sev: '?', chk: '99 알 수 없음', n: 1 }])[0].severity).toBe('RED');
  });

  /**
   * 🔴 **아티팩트를 적색으로 띄우면 진짜 적색이 묻힌다**(2026-09-03 실측).
   *    59번 `진료 서명이 생성보다 앞` 30건이 **전부 1초 미만**이었다 — 같은 트랜잭션에서
   *    두 시각이 각자 `now()` 를 잡아 밀리초로 뒤집힌 것이지 사람이 고칠 사실이 아니다.
   *    허용 오차를 두되 **버리지는 않는다**(⚪ 관측 항목으로 남겨 규모 변화가 보이게).
   */
  it('🔴 시각 역전 검사에 아티팩트 허용 오차가 있다', () => {
    const sql = readFileSync(join(REPO_ROOT, 'infra/scripts/data-integrity-scan.sql'), 'utf-8');
    for (const n of ['58 간호기록 서명이 생성보다 앞', '59 진료 서명이 생성보다 앞']) {
      const line = new RegExp(`'${n}[^']*',[\\s\\S]{0,220}`).exec(sql)?.[0] ?? '';
      expect(line, `${n} 항목을 찾지 못했습니다 — 검사가 헛돕니다`).not.toBe('');
      expect(line, `${n}: 1ms 역전까지 적색으로 세면 거짓 경보가 진짜를 묻는다`)
        .toMatch(/interval '1 second'/);
    }
    // 🔴 아티팩트를 지우지 않았는지 — 관측 항목으로 남아야 규모 변화가 보인다
    expect(sql, '아티팩트를 통째로 버리면 시각 기록 방식이 바뀌어도 모른다')
      .toContain('58b 서명·생성 1초 미만 역전');
  });

  it('🔴 딥링크는 실재하는 화면만 — 지어낸 경로가 없다', () => {
    for (const [key, href] of Object.entries(INTEGRITY_DRILLDOWN)) {
      const page = join(REPO_ROOT, 'apps/web/src/app/(main)', href.replace(/^\//, ''), 'page.tsx');
      expect(() => readFileSync(page, 'utf-8'), `${key} → ${href} 화면이 없습니다(경로를 지어냈습니다)`).not.toThrow();
    }
  });
});

/** 최소 목 — 실제 반환 모양을 흉내낸다(내가 가정한 모양을 테스트하면 가드가 헛돈다) */
function mockPrisma(over: Record<string, unknown> = {}) {
  const runs: Record<string, unknown>[] = [];
  const findings = new Map<string, Record<string, unknown>>();
  return {
    runs, findings,
    sentinelRun: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `run-${runs.length}`, ...data, ok: false, attempted: 0, succeeded: 0, failed: 0, error: null, durationMs: null };
        runs.push(row); return row;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = runs.find((r) => r.id === where.id)!; Object.assign(row, data); return row;
      }),
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        const list = runs.filter((r) => r.axis === where.axis && (where.ok === undefined || r.ok === where.ok));
        return list.length ? list[list.length - 1] : null;
      }),
    },
    sentinelFinding: {
      findUnique: vi.fn(async ({ where }: { where: { axis_checkKey: { axis: string; checkKey: string } } }) =>
        findings.get(`${where.axis_checkKey.axis}|${where.axis_checkKey.checkKey}`) ?? null),
      upsert: vi.fn(async ({ where, create, update }: { where: { axis_checkKey: { axis: string; checkKey: string } }; create: Record<string, unknown>; update: Record<string, unknown> }) => {
        const k = `${where.axis_checkKey.axis}|${where.axis_checkKey.checkKey}`;
        const cur = findings.get(k);
        const row = cur ? { ...cur, ...update } : { ...create };
        findings.set(k, row); return row;
      }),
      findMany: vi.fn(async () => [...findings.values()]),
    },
    $queryRawUnsafe: vi.fn(async () => [
      { 구분: '🔴', '점검 항목': '09 서명된 진료인데 진단 없음', 건수: 83 },
      { 구분: '🟡', '점검 항목': '23 하루 넘게 대기중인 접수', 건수: 406 },
      { 구분: '⚪', '점검 항목': '07 ACTIVE 처방인데 오더 없음', 건수: 0 },
    ]),
    ...over,
  };
}

describe('감시자 — 자기 자신이 정직하다', () => {
  let prisma: ReturnType<typeof mockPrisma>;
  let svc: SentinelService;

  beforeEach(() => {
    prisma = mockPrisma();
    svc = new SentinelService(prisma as never);
  });

  it('스윕이 전 항목을 평가하고 0건도 원장에 남긴다', async () => {
    const r = await svc.sweepData(REPO_ROOT);
    expect(r.attempted).toBe(3);
    expect(r.succeeded).toBe(3);
    expect(r.ok).toBe(true);
    // 0건 항목도 행으로 남되 해결 표시가 붙는다(지우면 추이가 사라진다)
    const zero = prisma.findings.get('DATA|integrity.07')!;
    expect(zero.value).toBe(0);
    expect(zero.resolvedAt).not.toBeNull();
  });

  it('🔴 저장 실패를 성공으로 세지 않는다 — 품질 스냅샷이 저지른 실수를 되풀이하지 않는다', async () => {
    let n = 0;
    prisma.sentinelFinding.upsert = vi.fn(async () => {
      n += 1;
      if (n === 2) throw new Error('디스크 오류');
      return {};
    }) as never;
    const r = await svc.sweepData(REPO_ROOT);
    expect(r.attempted).toBe(3);
    expect(r.succeeded).toBe(2);
    expect(r.failed).toBe(1);
    expect(r.ok).toBe(false);
    const run = prisma.runs.at(-1)!;
    expect(run.error, '실패 사유가 원장에 남아야 한다').toMatch(/디스크 오류/);
  });

  it('🔴 0행 반환을 "전부 정상"으로 적지 않는다 — 스캔이 깨진 것이다', async () => {
    prisma.$queryRawUnsafe = vi.fn(async () => []) as never;
    await expect(svc.sweepData(REPO_ROOT)).rejects.toThrow(/0행/);
    const run = prisma.runs.at(-1)!;
    expect(run.ok).toBe(false);
    expect(run.error).toMatch(/전부 정상이 아닙니다/);
  });

  it('🔴 스윕이 통째로 실패해도 이전 발견을 지우지 않는다', async () => {
    await svc.sweepData(REPO_ROOT);
    const before = prisma.findings.size;
    prisma.$queryRawUnsafe = vi.fn(async () => { throw new Error('DB 불달'); }) as never;
    await expect(svc.sweepData(REPO_ROOT)).rejects.toThrow(/DB 불달/);
    expect(prisma.findings.size, '실패가 "위반 0건"으로 보이면 안 된다').toBe(before);
  });
});

describe('감시자 읽기 — 미판정을 0으로 그리지 않는다', () => {
  it('🔴 스윕이 한 번도 없으면 open 은 null 이고 사유가 붙는다', async () => {
    const prisma = mockPrisma();
    const read = new SentinelReadService(prisma as never);
    const { axes } = await read.overview();
    const data = axes.find((a) => a.key === 'DATA')!;
    expect(data.open, '0이 아니라 null 이어야 한다').toBeNull();
    expect(data.unavailableReason).toMatch(/실행되지 않았습니다/);
  });

  it('🔴 미구현 축을 "위반 0건"이라 말하지 않는다', async () => {
    const prisma = mockPrisma();
    const read = new SentinelReadService(prisma as never);
    const { axes } = await read.overview();
    for (const a of axes.filter((x) => !x.implemented)) {
      expect(a.open).toBeNull();
      expect(a.unavailableReason).toMatch(/구현되지 않았습니다/);
    }
  });

  it('스윕이 성공하면 축별 숫자와 심각도 분포가 나온다(대조군 — 성공을 실패로 말하지 않는다)', async () => {
    const prisma = mockPrisma();
    await new SentinelService(prisma as never).sweepData(REPO_ROOT);
    const { axes } = await new SentinelReadService(prisma as never).overview();
    const data = axes.find((a) => a.key === 'DATA')!;
    expect(data.open).toBe(2);            // 0건인 07 은 제외
    expect(data.bySeverity).toEqual({ RED: 1, AMBER: 1, INFO: 0 });
    expect(data.resolved).toBe(1);
    expect(data.unavailableReason).toBeNull();
    expect(data.lastRun?.ok).toBe(true);
  });

  it('실제로 도는 축을 선언한다 — 미구현 축을 0건이라 말하지 않으려면 이 목록이 사실이어야 한다', () => {
    // P0 DATA(75불변식) · P1 PIPE(백업·크론·이벤트·배포) · P2 CONTRACT(런타임 드리프트) · P3 FLOW(분포 기반)
    // 🔴 네 축 전부 구현됐다 = 전부 판정한다는 뜻이 아니다. FLOW 는 표본이 찰 때까지 관측 불가를 낸다.
    expect(SENTINEL_AXES.filter((a) => a.implemented).map((a) => a.key)).toEqual(['DATA', 'FLOW', 'CONTRACT', 'PIPE']);
    expect(SENTINEL_AXES.filter((a) => !a.implemented).map((a) => a.key)).toEqual([]);
  });
});
