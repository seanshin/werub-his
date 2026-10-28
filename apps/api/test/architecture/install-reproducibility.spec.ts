import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/**
 * 🔴 설치·업그레이드 재현성 가드 — 상용 릴리즈 T2 (2026-09-13).
 *
 * 실측 경위: 운영 DB 에 `_prisma_migrations` 가 **없었다** — 스키마는 `db push` + 순서 불명 SQL 128개로만 적용됐다.
 * 그래서 빈 DB 에 이 제품을 재현해 설치할 방법이 없었고, 버전 간 업그레이드 절차도 정의할 수 없었다.
 * 기준선(`00000000000001_baseline`)을 만들다 드러난 것:
 *   · `migrations/manual/`(migration.sql 없는 폴더)가 있어 **migrate 가 P3015 로 멈출 구조**였다.
 *   · GIN 마이그레이션이 `CONCURRENTLY` 라 **트랜잭션 안에서 실패**했다.
 *   · ER 베드 동시 배정 방지(부분 유니크)·동의서 템플릿 부분 유니크는 **SQL 파일조차 없었다**(스키마 주석에만).
 *   · 데모 시드와 필수 마스터가 한 덩어리라 REAL 에서 `prisma db seed` 한 번이면 실환자 DB 에 가상 병원이 섞였다.
 *
 * 이 가드가 못박는 것(전부 재주입으로 실패 확인):
 *   (a) migrations/ 는 migrate 가 읽을 수 있는 모양이다(폴더마다 migration.sql · 잡파일 0 · CONCURRENTLY 0).
 *   (b) 기준선이 schema.prisma 와 **테이블·열거형·컬럼 단위로 같다** — 스키마를 바꾸고 마이그레이션을 안 만들면 실패한다.
 *   (c) 부속 마이그레이션이 정합성 객체 4종을 담는다(install.sh·CI 가 같은 이름으로 확인한다).
 *   (d) 모든 시드 진입점이 모드 가드를 부르고, MASTER 자칭은 허용 목록뿐이다 · 가드는 REAL/미설정에서 거부한다.
 *   (e) install.sh 는 데모 시드를 부르지 않고, 매니페스트는 원천 미확인을 VERIFIED 로 적지 않는다.
 *   (f) CI 는 self-hosted 에 의존하지 않고 `.nvmrc`(22)를 쓰며 배포 단계가 없다.
 */

const API = join(__dirname, '../..');
const ROOT = join(API, '../..');
const PRISMA = join(API, 'prisma');
const MIG = join(PRISMA, 'migrations');
const read = (p: string) => readFileSync(p, 'utf8');

const BASELINE_DIR = '00000000000001_baseline';
const ANCILLARY_DIR = '20260913000001_ancillary_constraints';

/* ── schema.prisma 파서(모델·열거형·스칼라 컬럼) ─────────────────────────── */
function parseSchema(src: string) {
  const enums = new Map<string, string>(); // prisma 이름 → DB 이름
  for (const m of src.matchAll(/^enum (\w+) \{([\s\S]*?)^\}/gm)) {
    const map = m[2].match(/@@map\("([^"]+)"\)/);
    enums.set(m[1], map ? map[1] : m[1]);
  }
  const blocks = [...src.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)];
  const modelNames = new Set(blocks.map((b) => b[1]));
  const tables = new Map<string, Set<string>>();
  for (const b of blocks) {
    const map = b[2].match(/@@map\("([^"]+)"\)/);
    const table = map ? map[1] : b[1];
    const cols = new Set<string>();
    for (const line of b[2].split('\n')) {
      const t = line.replace(/\/\/.*$/, '').trim();
      if (!t || t.startsWith('@@')) continue;
      const f = t.match(/^(\w+)\s+([\w.]+)(\[\])?(\?)?(\s|$)/);
      if (!f) continue;
      const type = f[2];
      // 관계(단일·목록)는 컬럼이 아니다. 🔴 스칼라 목록(`String[]`·enum[] — PostgreSQL 배열)은 컬럼이다 — 첫 판이 `[]` 를 전부 관계로 봐 31건을 놓쳤다
      if (modelNames.has(type) || type.startsWith('Unsupported')) continue;
      if (/@relation\(/.test(t) && modelNames.has(type)) continue;
      const colMap = t.match(/@map\("([^"]+)"\)/);
      cols.add(colMap ? colMap[1] : f[1]);
    }
    tables.set(table, cols);
  }
  return { enums, tables };
}

function parseBaseline(sql: string) {
  const enums = new Set([...sql.matchAll(/^CREATE TYPE "([^"]+)" AS ENUM/gm)].map((m) => m[1]));
  const tables = new Map<string, Set<string>>();
  for (const m of sql.matchAll(/^CREATE TABLE "([^"]+)" \(\n([\s\S]*?)\n\);/gm)) {
    tables.set(m[1], new Set([...m[2].matchAll(/^ {4}"([^"]+)" /gm)].map((c) => c[1])));
  }
  return { enums, tables };
}

/* ── 시드 진입점 ────────────────────────────────────────────────────────── */
const MASTER_ALLOW = ['seed-clinical-tool-templates.ts', 'seed-specialty-templates.ts'];
/** 테스트가 import 하는 순수 모듈(DB 없음) — 가드를 두면 import 만으로 테스트가 죽는다 */
// 2026-10-10 `decision-dev-seeds.ts` — 위원회 몫 개발 시드 선택 데이터(DB 접근 없음 · seed.ts 가 import 하고 seed.ts 가 모드 가드를 부른다)
// 2026-10-27 `nursing-rules-dev-seed.ts` — 간호 원내 규정 개발 시드 값(DB 접근 없음 · seed.ts 가 import)
const SEED_PURE_MODULES = ['clinical-volume-core.ts', 'qi-measurement.ts', 'recent-activity-plan.ts', 'decision-dev-seeds.ts', 'nursing-rules-dev-seed.ts'];
function seedEntries(): string[] {
  const top = readdirSync(PRISMA).filter((f) => /^seed(-.+)?\.(ts|js)$/.test(f) && !f.startsWith('seed-mode-guard')).map((f) => join(PRISMA, f));
  const sub = readdirSync(join(PRISMA, 'seeds'))
    .filter((f) => /\.(ts|cjs|js)$/.test(f) && !SEED_PURE_MODULES.includes(f))
    .map((f) => join(PRISMA, 'seeds', f));
  return [...top, ...sub];
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const guard = require(join(PRISMA, 'seed-mode-guard.js')) as {
  assertSeedAllowed: (file: string, kind?: string, env?: Record<string, string | undefined>, rootEnvPath?: string) => void;
  currentSeedMode: (env?: Record<string, string | undefined>, rootEnvPath?: string) => { mode: string; source: string };
};

describe('🔴 설치·업그레이드 재현성 (상용 릴리즈 T2)', () => {
  it('대조군 — 파서가 실제로 대상을 읽는다(0 이 되면 통과가 무의미하다)', () => {
    const s = parseSchema(read(join(PRISMA, 'schema.prisma')));
    const b = parseBaseline(read(join(MIG, BASELINE_DIR, 'migration.sql')));
    expect(s.tables.size, 'schema 모델 파싱').toBeGreaterThan(500);
    expect(b.tables.size, '기준선 테이블 파싱').toBeGreaterThan(500);
    expect(s.enums.size).toBeGreaterThan(40);
    expect([...s.tables.values()].reduce((n, c) => n + c.size, 0), '컬럼 파싱').toBeGreaterThan(5000);
    expect(seedEntries().length, '시드 진입점 수집').toBeGreaterThan(40);
  });

  it('(a) migrations/ 는 migrate 가 읽는 모양이다 — 폴더마다 migration.sql · 잡파일 0 · CONCURRENTLY 0', () => {
    const entries = readdirSync(MIG);
    const bad: string[] = [];
    for (const e of entries) {
      const p = join(MIG, e);
      if (statSync(p).isDirectory()) {
        if (!existsSync(join(p, 'migration.sql'))) bad.push(`${e}/ — migration.sql 없음(P3015 로 migrate 가 멈춘다)`);
        else if (/\bCONCURRENTLY\b/i.test(read(join(p, 'migration.sql')).replace(/--[^\n]*/g, ''))) bad.push(`${e} — CONCURRENTLY(트랜잭션 안에서 실패)`);
      } else if (e !== 'migration_lock.toml') bad.push(`${e} — 마이그레이션 폴더 밖 파일(prisma/sql/ 로)`);
    }
    expect(bad, bad.join('\n')).toEqual([]);
    expect(read(join(MIG, 'migration_lock.toml'))).toMatch(/provider = "postgresql"/);
    const dirs = entries.filter((e) => statSync(join(MIG, e)).isDirectory()).sort();
    expect(dirs[0], '시퀀스·확장이 맨 앞').toBe('00000000000000_create_mrn_sequence');
    expect(dirs[1], '기준선이 두 번째').toBe(BASELINE_DIR);
    expect(dirs).toContain(ANCILLARY_DIR);
  });

  it('(b) 🔴 기준선이 schema.prisma 와 테이블·열거형·컬럼 단위로 같다 — 스키마를 바꾸고 마이그레이션을 안 만들면 실패', () => {
    const s = parseSchema(read(join(PRISMA, 'schema.prisma')));
    const migSql = readdirSync(MIG)
      .filter((e) => statSync(join(MIG, e)).isDirectory())
      .sort()
      .map((e) => read(join(MIG, e, 'migration.sql')))
      .join('\n');
    const b = parseBaseline(migSql);
    // 기준선 뒤 마이그레이션의 ALTER TABLE ... ADD COLUMN 도 반영한다(이후 스키마 변경 경로)
    // 🔴 (2026-09-14) `prisma migrate diff` 는 `ADD COLUMN     "col"` 처럼 공백을 여러 칸 찍는다 — 한 칸만 읽으면 실제 생성 SQL 의 컬럼을 "없음"으로 판정한다
    // 🔴 (2026-09-30) 한 문장에 여러 열을 더하면(`ALTER TABLE "t" ADD COLUMN "a" …,\nADD COLUMN "b" …;`) 둘째 열부터
    //    `ALTER TABLE` 접두가 없다 — 첫 열만 읽으면 나머지를 "없음"으로 판정했다. 문장 단위로 끊고 안의 ADD COLUMN 을 모두 읽는다.
    for (const st of migSql.matchAll(/ALTER TABLE "([^"]+)"([\s\S]*?);/g)) {
      for (const c of st[2].matchAll(/ADD COLUMN\s+(?:IF NOT EXISTS\s+)?"([^"]+)"/g)) b.tables.get(st[1])?.add(c[1]);
    }
    const diff: string[] = [];
    for (const [t, cols] of s.tables) {
      const bc = b.tables.get(t);
      if (!bc) { diff.push(`테이블 없음: ${t}`); continue; }
      for (const c of cols) if (!bc.has(c)) diff.push(`컬럼 없음: ${t}.${c}`);
      for (const c of bc) if (!cols.has(c)) diff.push(`스키마에 없는 컬럼: ${t}.${c}`);
    }
    for (const t of b.tables.keys()) if (!s.tables.has(t)) diff.push(`스키마에 없는 테이블: ${t}`);
    for (const [, dbName] of s.enums) if (!b.enums.has(dbName)) diff.push(`열거형 없음: ${dbName}`);
    expect(
      diff.slice(0, 30),
      `schema.prisma 와 마이그레이션이 갈라졌다(${diff.length}건) — 스키마를 바꿨으면 마이그레이션을 만든다(DB 없이):\n` +
        '  npx prisma migrate diff --from-schema-datamodel <이전 schema> --to-schema-datamodel prisma/schema.prisma --script > prisma/migrations/<YYYYMMDDHHMMSS>_<이름>/migration.sql\n' +
        diff.slice(0, 30).join('\n'),
    ).toEqual([]);
  });

  it('(c) 부속 마이그레이션이 정합성 객체 4종 + 트리거를 담는다(install.sh·CI 와 같은 이름)', () => {
    const sql = read(join(MIG, ANCILLARY_DIR, 'migration.sql'));
    for (const name of ['uq_er_bed_active', 'uq_er_visit_active', 'consent_templates_name_lang_latest_key', 'formulary_items_uniq_nn', 'trg_voucher_events_append_only']) {
      expect(sql, `${name} 가 부속 마이그레이션에 없다`).toContain(name);
    }
    expect(sql).toMatch(/uq_er_bed_active ON emergency_bed_assignments \(bed_id\) WHERE released_at IS NULL/);
    // 🔴 (2026-09-13) consent 부분 유니크는 운영 이름을 쓰고, 같은 정의가 다른 이름으로 있으면 만들지 않는다 —
    //    IF NOT EXISTS 는 이름만 보므로 운영에서 실행하면 2벌이 생길 자리였다(manual-index-inventory.md §4)
    const sqlNoComments = sql.replace(/--.*$/gm, '');
    expect(sqlNoComments).not.toContain('uq_consent_templates_name_language_latest');
    expect(sqlNoComments).toMatch(/IF NOT EXISTS \(\s*SELECT 1 FROM pg_index[\s\S]*consent_templates[\s\S]*is_latest = true[\s\S]*CREATE UNIQUE INDEX consent_templates_name_lang_latest_key/);
    const install = read(join(ROOT, 'infra/install/install.sh'));
    const ci = read(join(ROOT, '.github/workflows/ci.yml'));
    for (const src of [install, ci]) {
      expect(src).toContain("'uq_er_bed_active','uq_er_visit_active','consent_templates_name_lang_latest_key','formulary_items_uniq_nn'");
      expect(src).toContain('trg_voucher_events_append_only');
    }
  });

  it('(d) 🔴 모든 시드 진입점이 모드 가드를 부르고 · MASTER 자칭은 허용 목록뿐', () => {
    const missing: string[] = [];
    const masters: string[] = [];
    for (const f of seedEntries()) {
      const src = read(f);
      const call = src.match(/assertSeedAllowed\(__filename, '(DEMO|MASTER)'\)/);
      if (!call) missing.push(f.replace(PRISMA + '/', ''));
      else if (call[1] === 'MASTER') masters.push(f.split('/').pop()!);
    }
    expect(missing, `모드 가드 없는 시드 진입점:\n${missing.join('\n')}`).toEqual([]);
    expect(masters.sort()).toEqual([...MASTER_ALLOW].sort());
  });

  it('(d) 가드 동작 — REAL·미설정은 거부, DEV·REHEARSAL 은 허용, MASTER 는 REAL 에서도 허용', () => {
    const dir = mkdtempSync(join(tmpdir(), 'seed-guard-'));
    const noEnv = join(dir, 'none.env');
    const realEnv = join(dir, 'real.env');
    writeFileSync(realEnv, 'FOO=1\nHIS_MODE=REAL\n');
    const rehearsalEnv = join(dir, 'rehearsal.env');
    writeFileSync(rehearsalEnv, 'HIS_MODE="REHEARSAL"\n');

    expect(() => guard.assertSeedAllowed('x.ts', 'DEMO', { HIS_MODE: 'REAL' }, noEnv)).toThrow(/REAL 모드에서 데모 시드를 실행하지 않습니다/);
    expect(() => guard.assertSeedAllowed('x.ts', 'DEMO', {}, noEnv), '🔴 미설정은 폴백 REAL — 모르면 안전측').toThrow(/폴백/);
    expect(() => guard.assertSeedAllowed('x.ts', 'DEMO', {}, realEnv), '루트 .env 의 REAL').toThrow(/REAL/);
    expect(() => guard.assertSeedAllowed('x.ts', 'DEMO', { HIS_MODE: 'garbage' }, noEnv), '해석 불가도 REAL').toThrow();
    expect(() => guard.assertSeedAllowed('x.ts', 'DEMO', { HIS_MODE: 'DEV' }, realEnv), '환경변수가 .env 보다 우선').not.toThrow();
    expect(() => guard.assertSeedAllowed('x.ts', 'DEMO', {}, rehearsalEnv), '리허설 서버(.env REHEARSAL)').not.toThrow();
    expect(() => guard.assertSeedAllowed('x.ts', 'MASTER', { HIS_MODE: 'REAL' }, noEnv)).not.toThrow();
    expect(() => guard.assertSeedAllowed('x.ts', 'OTHER', { HIS_MODE: 'DEV' }, noEnv)).toThrow(/알 수 없는 kind/);
    expect(guard.currentSeedMode({}, rehearsalEnv).mode).toBe('REHEARSAL');
  });

  it('(e) install.sh 는 데모 시드를 부르지 않고 migrate deploy 를 쓴다 · 매니페스트는 원천 미확인을 VERIFIED 로 적지 않는다', () => {
    const install = read(join(ROOT, 'infra/install/install.sh'));
    const code = install.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
    expect(code).toContain('npx prisma migrate deploy');
    expect(code, 'db push 는 설치 경로가 아니다').not.toMatch(/prisma db push/);
    expect(code, '데모 시드를 부르면 안 된다').not.toMatch(/prisma db seed|seed\.ts|prisma\/seeds\/|demo-seed\.sql|\.seed\.sql/);
    const rows = read(join(ROOT, 'infra/install/masters.manifest.tsv'))
      .split('\n')
      .filter((l) => l && !l.startsWith('#'))
      .map((l) => l.split('\t'));
    expect(rows.length).toBeGreaterThanOrEqual(4);
    for (const [key, , src, asof, status] of rows) {
      if (status === 'VERIFIED') expect(`${src} ${asof}`, `${key}: VERIFIED 인데 원천이 미확인`).not.toMatch(/미확인/);
      else expect(status, `${key}: 상태는 VERIFIED|UNVERIFIED`).toBe('UNVERIFIED');
    }
  });

  it('(f) CI 는 self-hosted 에 의존하지 않고 .nvmrc(22)를 쓰며 배포 단계가 없다', () => {
    const ci = read(join(ROOT, '.github/workflows/ci.yml'));
    const code = ci.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
    expect(code, 'self-hosted 러너는 서버 이전 뒤 조용히 멈췄다').not.toMatch(/self-hosted/);
    expect(code).toMatch(/node-version-file: \.nvmrc/);
    expect(code, '🔴 GitHub 기능으로 배포하지 않는다').not.toMatch(/deploy\.sh|rsync|\bssh\b|pm2/);
    expect(code, '전체 수로 돈다(vitest run test 는 src 스펙을 뺀다)').toMatch(/cd apps\/api && npx vitest run\n/);
    expect(read(join(ROOT, '.nvmrc')).trim()).toBe('22');
  });
});
