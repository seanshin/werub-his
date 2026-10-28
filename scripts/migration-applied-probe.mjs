#!/usr/bin/env node
/**
 * 마이그레이션 "적용됨" 표시 전 실측 — 마이그레이션 SQL 이 만드는 객체가 대상 DB 에 실제로 있는가.
 *
 * 🔴 왜 필요한가: 운영 DB 는 `db push` 로 왔고 `_prisma_migrations` 이력이 없다. 이력을 만들려면
 *    `prisma migrate resolve --applied <name>` 로 표시하는데, **표시는 검사하지 않는다** — 그 마이그레이션이
 *    실제로 반영돼 있든 아니든 "적용됨"으로 기록한다. 2026-09-13 실측에서 `20260528000001_add_gin_indexes`
 *    인덱스 10개 전부와 `ancillary §5` 보조 인덱스 4개가 운영에 **없었다**(docs/05-reference/manual-index-inventory.md §4).
 *    그대로 resolve 하면 이력이 거짓이 되고, 이후 `migrate deploy` 는 그 마이그레이션을 영원히 건너뛴다.
 *
 * 판정(마이그레이션 단위)
 *   APPLIED      파싱한 객체가 전부 있고, 파싱하지 못한 문장이 없다
 *   PARTIAL      일부만 있다(빠진 객체를 나열)
 *   ABSENT       파싱한 객체가 하나도 없다
 *   UNPARSEABLE  파싱하지 못한 문장이 있다 — 전부 있어도 APPLIED 라고 말하지 않는다(모르는 것을 있음으로 세지 않는다)
 *   EMPTY        이 파일이 만드는 객체가 없다(예: DROP/데이터 문장만)
 *   🔴 PARTIAL 이 UNPARSEABLE 보다 우선한다(빠진 것이 확실하면 그것부터 말한다 — 두 수치를 함께 출력한다).
 *
 * 접속은 **읽기 전용**이다 — 모든 카탈로그 질의는 `BEGIN; SET TRANSACTION READ ONLY;` 안에서 돈다.
 * 이 도구는 DDL 을 실행하지 않고 `migrate resolve`/`db push`/`migrate deploy` 를 부르지도 않는다.
 *
 * 사용법
 *   node scripts/migration-applied-probe.mjs --db-url "postgres://…"          # psql(없으면 docker) 로 직접
 *   node scripts/migration-applied-probe.mjs --catalog-sql > catalog.sql      # 카탈로그 질의만 출력(원격 psql 용)
 *   node scripts/migration-applied-probe.mjs --catalog catalog.json           # 받아온 카탈로그로 대조
 *   옵션: --migrations <dir> · --json <파일> · --quiet
 *   종료코드: 0 = 전부 APPLIED · 1 = 그 밖(PARTIAL/ABSENT/UNPARSEABLE 있음) · 2 = 실행 오류
 */
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

// ── 1. SQL 문장 분해(주석·문자열·달러인용 인식) ────────────────────────────────────
export function splitStatements(sql) {
  const out = [];
  let buf = '';
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    const two = sql.slice(i, i + 2);
    if (two === '--') {
      const nl = sql.indexOf('\n', i);
      i = nl === -1 ? sql.length : nl; // 주석은 버린다(문장 텍스트에 남기지 않는다)
      continue;
    }
    if (two === '/*') {
      const end = sql.indexOf('*/', i + 2);
      i = end === -1 ? sql.length : end + 2;
      continue;
    }
    if (c === "'") {
      const end = findQuoteEnd(sql, i);
      buf += sql.slice(i, end);
      i = end;
      continue;
    }
    if (c === '$') {
      const tag = /^\$[A-Za-z_0-9]*\$/.exec(sql.slice(i));
      if (tag) {
        const close = sql.indexOf(tag[0], i + tag[0].length);
        const end = close === -1 ? sql.length : close + tag[0].length;
        buf += sql.slice(i, end);
        i = end;
        continue;
      }
    }
    if (c === ';') {
      if (buf.trim()) out.push(buf.trim());
      buf = '';
      i += 1;
      continue;
    }
    buf += c;
    i += 1;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

function findQuoteEnd(sql, start) {
  let i = start + 1;
  while (i < sql.length) {
    if (sql[i] === "'") {
      if (sql[i + 1] === "'") { i += 2; continue; }
      return i + 1;
    }
    if (sql[i] === '\\') { i += 2; continue; }
    i += 1;
  }
  return sql.length;
}

const unq = (s) => (s || '').replace(/"/g, '').replace(/^public\./i, '').trim();

// ── 2. 문장 → 만들어지는 객체 ────────────────────────────────────────────────────
/** @returns {{objects: Array, unparsed: string[], ignored: number}} */
export function parseMigrationSql(sql) {
  const objects = [];
  const unparsed = [];
  let ignored = 0;
  for (const st of splitStatements(sql)) {
    const s = st.replace(/\s+/g, ' ').trim();
    let m;
    if (/^(DROP|SET|BEGIN|COMMIT|COMMENT|ANALYZE|VACUUM|SELECT|UPDATE|DELETE|INSERT)\b/i.test(s)) { ignored += 1; continue; }
    if (/^CREATE SCHEMA\b/i.test(s)) {
      m = /^CREATE SCHEMA (?:IF NOT EXISTS )?("?[\w]+"?)/i.exec(s);
      if (m) { objects.push({ kind: 'schema', name: unq(m[1]) }); continue; }
    }
    if (/^CREATE EXTENSION\b/i.test(s)) {
      m = /^CREATE EXTENSION (?:IF NOT EXISTS )?("?[\w]+"?)/i.exec(s);
      if (m) { objects.push({ kind: 'extension', name: unq(m[1]) }); continue; }
    }
    if (/^CREATE SEQUENCE\b/i.test(s)) {
      m = /^CREATE SEQUENCE (?:IF NOT EXISTS )?("?[\w.]+"?)/i.exec(s);
      if (m) { objects.push({ kind: 'sequence', name: unq(m[1]) }); continue; }
    }
    if (/^CREATE TYPE\b/i.test(s)) {
      m = /^CREATE TYPE ("?[\w.]+"?) AS ENUM \((.*)\)$/i.exec(s);
      if (m) {
        const labels = [...m[2].matchAll(/'((?:[^']|'')*)'/g)].map((x) => x[1].replace(/''/g, "'"));
        objects.push({ kind: 'enum', name: unq(m[1]), labels });
        continue;
      }
    }
    if (/^CREATE TABLE\b/i.test(s)) {
      m = /^CREATE TABLE (?:IF NOT EXISTS )?("?[\w.]+"?) \((.*)\)$/i.exec(s);
      if (m) {
        objects.push({ kind: 'table', name: unq(m[1]), columns: parseColumns(m[2]) });
        continue;
      }
    }
    if (/^CREATE (UNIQUE )?INDEX\b/i.test(s)) {
      m = /^CREATE (UNIQUE )?INDEX (?:CONCURRENTLY )?(?:IF NOT EXISTS )?("?[\w.]+"?) ON (?:ONLY )?("?[\w.]+"?)\s*(.*)$/i.exec(s);
      if (m) {
        objects.push({
          kind: 'index',
          name: unq(m[2]),
          table: unq(m[3]),
          unique: Boolean(m[1]),
          def: canonIndexDef(Boolean(m[1]), unq(m[3]), m[4]),
        });
        continue;
      }
    }
    if (/^ALTER TABLE\b/i.test(s)) {
      m = /^ALTER TABLE (?:ONLY )?("?[\w.]+"?) ADD CONSTRAINT ("?[\w.]+"?)/i.exec(s);
      if (m) { objects.push({ kind: 'constraint', name: unq(m[2]), table: unq(m[1]) }); continue; }
      // 🔴 (2026-09-14) `ADD COLUMN` 을 못 읽어 그날 SQL 로 직접 적용한 두 마이그레이션(열 8개 실재)이 UNPARSEABLE 로 나왔다.
      //    쉼표로 이은 여러 `ADD [COLUMN] [IF NOT EXISTS]` 절을 읽는다. 절 하나라도 열 추가가 아니면(ALTER COLUMN·DROP 등)
      //    그 문장 전체를 미파싱으로 남긴다 — 일부만 읽고 "있다"고 말하지 않는다.
      const cols = parseAddColumns(s);
      if (cols) { objects.push(...cols); continue; }
      // 🔴 (2026-09-15) `ALTER COLUMN c DROP/SET NOT NULL` — 열의 null 허용 여부를 대조한다(catalog columnTypes.nullable).
      const nulls = parseAlterNullability(s);
      if (nulls) { objects.push(...nulls); continue; }
    }
    if (/^CREATE (OR REPLACE )?FUNCTION\b/i.test(s)) {
      m = /^CREATE (?:OR REPLACE )?FUNCTION ("?[\w.]+"?)\s*\(/i.exec(s);
      if (m) { objects.push({ kind: 'function', name: unq(m[1]) }); continue; }
    }
    if (/^CREATE (OR REPLACE )?TRIGGER\b/i.test(s)) {
      m = /^CREATE (?:OR REPLACE )?TRIGGER ("?[\w.]+"?) .* ON ("?[\w.]+"?)/i.exec(s);
      if (m) { objects.push({ kind: 'trigger', name: unq(m[1]), table: unq(m[2]) }); continue; }
    }
    unparsed.push(s.length > 300 ? `${s.slice(0, 300)}…` : s);
  }
  return { objects, unparsed, ignored };
}

/** `ALTER TABLE t ADD COLUMN c TYPE …, ADD COLUMN …` → column 객체들 · 열 추가 아닌 절이 섞이면 null */
export function parseAddColumns(stmt) {
  const m = /^ALTER TABLE (?:ONLY )?(?:IF EXISTS )?("?[\w.]+"?) (.*)$/i.exec(stmt);
  if (!m) return null;
  const table = unq(m[1]);
  const out = [];
  for (const c of splitTopLevel(m[2])) {
    const cm = /^ADD (?:COLUMN )?(?:IF NOT EXISTS )?("[^"]+"|[\w]+) (.+)$/i.exec(c.trim());
    if (!cm || /^(CONSTRAINT|PRIMARY|UNIQUE|FOREIGN|CHECK|EXCLUDE)$/i.test(unq(cm[1]))) return null;
    out.push({ kind: 'column', table, name: unq(cm[1]), type: normalizeColumnType(cm[2]) });
  }
  return out.length ? out : null;
}

/** `ALTER TABLE t ALTER COLUMN c DROP NOT NULL, ALTER COLUMN d SET NOT NULL` → nullability 객체들 · 다른 절이 섞이면 null */
export function parseAlterNullability(stmt) {
  const m = /^ALTER TABLE (?:ONLY )?(?:IF EXISTS )?("?[\w.]+"?) (.*)$/i.exec(stmt);
  if (!m) return null;
  const table = unq(m[1]);
  const out = [];
  for (const c of splitTopLevel(m[2])) {
    const cm = /^ALTER (?:COLUMN )?("[^"]+"|[\w]+) (DROP|SET) NOT NULL$/i.exec(c.trim());
    if (!cm) return null;
    out.push({ kind: 'nullability', table, name: unq(cm[1]), nullable: cm[2].toUpperCase() === 'DROP' });
  }
  return out.length ? out : null;
}

function splitTopLevel(body) {
  const parts = [];
  let depth = 0;
  let cur = '';
  for (const ch of body) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) parts.push(cur);
  return parts;
}

/**
 * SQL 타입 표기 → information_schema(udt_name·character_maximum_length) 와 같은 모양.
 * 모르는 타입은 null — 대조하지 않는다(모르는 것을 불일치로도 일치로도 세지 않는다).
 */
const TYPE_ALIASES = {
  uuid: 'uuid', text: 'text', boolean: 'bool', bool: 'bool', integer: 'int4', int: 'int4', int4: 'int4', bigint: 'int8', int8: 'int8',
  smallint: 'int2', int2: 'int2', jsonb: 'jsonb', json: 'json', date: 'date', timestamptz: 'timestamptz', timestamp: 'timestamp',
  'timestamp with time zone': 'timestamptz', 'timestamp without time zone': 'timestamp', 'double precision': 'float8', float8: 'float8',
  real: 'float4', numeric: 'numeric', decimal: 'numeric', varchar: 'varchar', 'character varying': 'varchar',
};
export function normalizeColumnType(rest) {
  const t = (rest || '').trim().replace(/\s+/g, ' ');
  const m = /^(timestamp(?:\(\d+\))? with(?:out)? time zone|double precision|character varying|[\w]+)(\s*\((\d+)(?:\s*,\s*\d+)?\))?(\[\])?/i.exec(t);
  if (!m) return null;
  const base = m[1].toLowerCase().replace(/\(\d+\)/, '');
  const udt = TYPE_ALIASES[base];
  if (!udt) return null;
  const len = udt === 'varchar' && m[3] ? Number(m[3]) : null;
  return { udt: m[4] ? `_${udt}` : udt, len };
}

function parseColumns(body) {
  const cols = [];
  let depth = 0;
  let cur = '';
  for (let i = 0; i < body.length; i += 1) {
    const c = body[i];
    if (c === '(') depth += 1;
    if (c === ')') depth -= 1;
    if (c === ',' && depth === 0) { cols.push(cur); cur = ''; continue; }
    cur += c;
  }
  cols.push(cur);
  return cols
    .map((x) => x.trim())
    .filter((x) => x && !/^(CONSTRAINT|PRIMARY KEY|UNIQUE|FOREIGN KEY|CHECK|EXCLUDE)\b/i.test(x))
    .map((x) => unq((/^("[^"]+"|[\w]+)/.exec(x) || [])[1] || ''))
    .filter(Boolean);
}

/**
 * 인덱스 정의 정규화 — 이름이 달라도 같은 정의인지 보려고 쓴다.
 * pg 의 `pg_get_indexdef` 는 `USING btree`·스키마 접두·따옴표를 항상 채우므로 양쪽을 같은 모양으로 접는다.
 * 🔴 문자열 정규화라 형변환·공백 차이까지 흡수하지는 못한다 — 일치하면 같은 정의, 불일치는 "모른다"로 읽는다.
 */
export function canonIndexDef(unique, table, tail) {
  let t = ` ${tail || ''}`.replace(/\s+/g, ' ');
  if (!/\bUSING\b/i.test(t)) t = t.replace(/^\s*\(/, ' USING btree (');
  return `${unique ? 'unique ' : ''}on ${table}${t}`
    .toLowerCase()
    .replace(/"/g, '')
    .replace(/\bpublic\./g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*([(),])\s*/g, '$1')
    .replace(/;+$/, '')
    .trim();
}

/**
 * 느슨한 키 — 공백·괄호를 지운다. `WHERE bundle_id IS NOT NULL` ↔ `WHERE (bundle_id IS NOT NULL)` 처럼
 * pg 가 다시 써서 내놓는 모양 차이를 흡수한다(2026-09-14 재주입에서 이 차이로 같은 정의를 놓쳤다).
 * 🔴 느슨한 대조로 찾은 것은 "이름만 다른 같은 정의"라고 단정하지 않고 그 사실을 함께 출력한다.
 */
export const looseIndexKey = (canon) => (canon || '').replace(/[\s()]/g, '');

/** pg_get_indexdef 출력 → canonIndexDef 와 같은 모양 */
export function canonPgIndexDef(def) {
  const m = /^CREATE (UNIQUE )?INDEX [\w."]+ ON (?:ONLY )?("?[\w.]+"?)\s*(.*)$/i.exec(def.replace(/\s+/g, ' ').trim());
  if (!m) return null;
  return canonIndexDef(Boolean(m[1]), unq(m[2]), m[3]);
}

// ── 3. 카탈로그 질의(읽기 전용) ──────────────────────────────────────────────────
export const CATALOG_SQL = `
-- 🔴 _prisma_migrations 는 없을 수 있다(운영은 db push 로 와서 이력 테이블이 없다). 없는 테이블을 CASE 안에 그냥 적으면
--    실행 전 계획 단계에서 'relation … does not exist' 로 죽는다(2026-09-14 운영 실측에서 실제로 죽었다) →
--    존재할 때만 읽도록 query_to_xml 로 동적 조회한다(읽기 전용 그대로).
WITH mig AS (
  SELECT CASE WHEN to_regclass('public._prisma_migrations') IS NULL THEN NULL
              ELSE query_to_xml('SELECT migration_name FROM public._prisma_migrations ORDER BY 1', false, false, '') END AS x
)
SELECT json_build_object(
  'schemas',   (SELECT coalesce(json_agg(nspname), '[]'::json) FROM pg_namespace),
  'extensions',(SELECT coalesce(json_agg(extname), '[]'::json) FROM pg_extension),
  'sequences', (SELECT coalesce(json_agg(c.relname), '[]'::json) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='S' AND n.nspname='public'),
  'enums',     (SELECT coalesce(json_agg(json_build_object('name', t.typname, 'labels', l.labels)), '[]'::json)
                FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace
                JOIN LATERAL (SELECT array_agg(e.enumlabel ORDER BY e.enumsortorder) AS labels FROM pg_enum e WHERE e.enumtypid=t.oid) l ON true
                WHERE t.typtype='e' AND n.nspname='public'),
  'tables',    (SELECT coalesce(json_agg(c.relname), '[]'::json) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind IN ('r','p') AND n.nspname='public'),
  'columns',   (SELECT coalesce(json_agg(table_name || '.' || column_name), '[]'::json) FROM information_schema.columns WHERE table_schema='public'),
  'columnTypes',(SELECT coalesce(json_agg(json_build_object('c', table_name || '.' || column_name, 'udt', udt_name, 'len', character_maximum_length, 'nullable', is_nullable = 'YES')), '[]'::json) FROM information_schema.columns WHERE table_schema='public'),
  'indexes',   (SELECT coalesce(json_agg(json_build_object('name', indexname, 'table', tablename, 'def', indexdef)), '[]'::json) FROM pg_indexes WHERE schemaname='public'),
  'constraints',(SELECT coalesce(json_agg(json_build_object('name', con.conname, 'table', cl.relname)), '[]'::json)
                FROM pg_constraint con JOIN pg_class cl ON cl.oid=con.conrelid JOIN pg_namespace n ON n.oid=cl.relnamespace WHERE n.nspname='public'),
  'triggers',  (SELECT coalesce(json_agg(json_build_object('name', t.tgname, 'table', cl.relname)), '[]'::json)
                FROM pg_trigger t JOIN pg_class cl ON cl.oid=t.tgrelid JOIN pg_namespace n ON n.oid=cl.relnamespace WHERE NOT t.tgisinternal AND n.nspname='public'),
  'functions', (SELECT coalesce(json_agg(p.proname), '[]'::json) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'),
  'migrations',(SELECT CASE WHEN x IS NULL THEN NULL ELSE to_json((xpath('//migration_name/text()', x))::text[]) END FROM mig)
)::text;
`.trim();

const READ_ONLY_PREFIX = 'BEGIN; SET TRANSACTION READ ONLY;';

/**
 * 카탈로그 JSON 텍스트 파싱 — 🔴 원격 `psql -tA` 로 돌리면 `BEGIN`·`SET`·`COMMIT` 줄이 출력에 섞여 JSON.parse 가 죽었다
 * (2026-09-14 운영 대조). 첫 `{` 부터 마지막 `}` 까지만 읽는다. 그 구간이 없으면 실패로 말한다(빈 카탈로그로 대조하지 않는다).
 */
export function parseCatalogText(text) {
  const s = String(text ?? '');
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  if (a === -1 || b <= a) throw new Error('카탈로그 출력에서 JSON 을 찾지 못했다');
  return JSON.parse(s.slice(a, b + 1));
}

export function fetchCatalog(dbUrl, { psqlBin = null, dockerImage = 'postgres:16-alpine' } = {}) {
  const sql = `${READ_ONLY_PREFIX}\n${CATALOG_SQL}\nCOMMIT;`;
  const havePsql = psqlBin || (spawnSync('which', ['psql']).status === 0 ? 'psql' : null);
  // psql 이 없으면 컨테이너 psql 로 — 리눅스는 host 네트워크, 그 밖(Docker Desktop)은 host.docker.internal 을 열어 준다.
  const netArgs = process.platform === 'linux' ? ['--network', 'host'] : ['--add-host=host.docker.internal:host-gateway'];
  const run = havePsql
    ? spawnSync(havePsql, ['-Atq', '-v', 'ON_ERROR_STOP=1', dbUrl, '-f', '-'], { input: sql, encoding: 'utf8', timeout: 120_000 })
    : spawnSync('docker', ['run', '--rm', '-i', ...netArgs, dockerImage, 'psql', '-Atq', '-v', 'ON_ERROR_STOP=1', dbUrl, '-f', '-'],
      { input: sql, encoding: 'utf8', timeout: 300_000 });
  if (run.status !== 0) throw new Error(`카탈로그 조회 실패(${havePsql ? 'psql' : 'docker psql'}): ${run.stderr || run.error?.message || ''}`);
  return parseCatalogText(run.stdout);
}

// ── 4. 대조 ─────────────────────────────────────────────────────────────────────
export function compare(objects, catalog) {
  const present = [];
  const missing = [];
  const has = {
    schema: new Set(catalog.schemas || []),
    extension: new Set(catalog.extensions || []),
    sequence: new Set(catalog.sequences || []),
    table: new Set(catalog.tables || []),
    column: new Set(catalog.columns || []),
    function: new Set(catalog.functions || []),
  };
  const enums = new Map((catalog.enums || []).map((e) => [e.name, e.labels || []]));
  const indexByName = new Map((catalog.indexes || []).map((i) => [i.name, i]));
  const indexByDef = new Map();
  const indexByLooseDef = new Map();
  for (const i of catalog.indexes || []) {
    const c = canonPgIndexDef(i.def);
    if (!c) continue;
    if (!indexByDef.has(c)) indexByDef.set(c, i.name);
    const l = looseIndexKey(c);
    if (!indexByLooseDef.has(l)) indexByLooseDef.set(l, i.name);
  }
  const colTypes = new Map((catalog.columnTypes || []).map((c) => [c.c, { udt: c.udt, len: c.len ?? null, nullable: typeof c.nullable === 'boolean' ? c.nullable : null }]));
  const constraints = new Set((catalog.constraints || []).map((c) => `${c.table}.${c.name}`));
  const triggers = new Set((catalog.triggers || []).map((t) => `${t.table}.${t.name}`));

  for (const o of objects) {
    const label = `${o.kind} ${o.name}`;
    if (o.kind === 'index') {
      if (indexByName.has(o.name)) { present.push(label); continue; }
      const alias = indexByDef.get(o.def);
      if (alias) { present.push(`${label} (다른 이름: ${alias})`); continue; }
      const loose = indexByLooseDef.get(looseIndexKey(o.def));
      if (loose) { present.push(`${label} (다른 이름: ${loose} · 공백·괄호 무시 대조)`); continue; }
      missing.push(label);
      continue;
    }
    if (o.kind === 'table') {
      if (!has.table.has(o.name)) { missing.push(label); continue; }
      const lostCols = (o.columns || []).filter((c) => !has.column.has(`${o.name}.${c}`));
      if (lostCols.length) missing.push(`${label} 열 ${lostCols.join(', ')}`);
      else present.push(label);
      continue;
    }
    if (o.kind === 'enum') {
      const labels = enums.get(o.name);
      if (!labels) { missing.push(label); continue; }
      const lost = (o.labels || []).filter((l) => !labels.includes(l));
      if (lost.length) missing.push(`${label} 값 ${lost.join(', ')}`);
      else present.push(label);
      continue;
    }
    if (o.kind === 'column') {
      const key = `${o.table}.${o.name}`;
      const colLabel = `column ${key}`;
      if (!has.column.has(key)) { missing.push(colLabel); continue; }
      const actual = colTypes.get(key);
      // 타입은 양쪽을 다 알 때만 대조한다(columnTypes 없는 옛 캡처·모르는 타입은 대조하지 않는다)
      if (o.type && actual && (o.type.udt !== actual.udt || (o.type.len != null && o.type.len !== actual.len))) {
        missing.push(`${colLabel} 타입 불일치(SQL ${o.type.udt}${o.type.len != null ? `(${o.type.len})` : ''} ≠ DB ${actual.udt}${actual.len != null ? `(${actual.len})` : ''})`);
        continue;
      }
      present.push(colLabel);
      continue;
    }
    if (o.kind === 'nullability') {
      const key = `${o.table}.${o.name}`;
      const nLabel = `column ${key} ${o.nullable ? 'NULL 허용' : 'NOT NULL'}`;
      if (!has.column.has(key)) { missing.push(`${nLabel} (열 없음)`); continue; }
      const actual = colTypes.get(key);
      // 모르는 것을 있음으로 세지 않는다 — nullable 정보가 없는 옛 캡처는 판정 불가로 빠진 쪽에 둔다
      if (!actual || actual.nullable == null) { missing.push(`${nLabel} (nullable 정보 없음 — 판정 불가)`); continue; }
      (actual.nullable === o.nullable ? present : missing).push(nLabel);
      continue;
    }
    if (o.kind === 'constraint') {
      (constraints.has(`${o.table}.${o.name}`) ? present : missing).push(label);
      continue;
    }
    if (o.kind === 'trigger') {
      (triggers.has(`${o.table}.${o.name}`) ? present : missing).push(label);
      continue;
    }
    (has[o.kind]?.has(o.name) ? present : missing).push(label);
  }
  return { present, missing };
}

export function verdictOf({ objects, unparsed }, { present, missing }) {
  if (objects.length === 0) return unparsed.length ? 'UNPARSEABLE' : 'EMPTY';
  if (missing.length && present.length === 0) return 'ABSENT';
  if (missing.length) return 'PARTIAL';
  if (unparsed.length) return 'UNPARSEABLE';
  return 'APPLIED';
}

export function probeMigrations(dir, catalog) {
  const names = readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(dir, d.name, 'migration.sql')))
    .map((d) => d.name)
    .sort();
  return names.map((name) => {
    const parsed = parseMigrationSql(readFileSync(join(dir, name, 'migration.sql'), 'utf8'));
    const cmp = compare(parsed.objects, catalog);
    return {
      migration: name,
      verdict: verdictOf(parsed, cmp),
      objects: parsed.objects.length,
      presentCount: cmp.present.length,
      // 이름이 아니라 정의로 찾은 것 — "있다"로 세지만 이름이 저장소와 다르다(사람이 봐야 한다)
      aliases: cmp.present.filter((p) => p.includes('다른 이름')),
      missing: cmp.missing,
      unparsed: parsed.unparsed,
      ignoredStatements: parsed.ignored,
      recordedInHistory: catalog.migrations == null ? null : catalog.migrations.includes(name),
    };
  });
}

// ── 5. CLI ─────────────────────────────────────────────────────────────────────
function main(argv) {
  const arg = (k, d = null) => {
    const i = argv.indexOf(k);
    return i === -1 ? d : argv[i + 1];
  };
  if (argv.includes('--catalog-sql')) {
    process.stdout.write(`${READ_ONLY_PREFIX}\n${CATALOG_SQL}\nCOMMIT;\n`);
    return 0;
  }
  // 🔴 경로에 공백이 있으면 URL 은 %20 으로 인코딩된다 — fileURLToPath 로 되돌린다(저장소 경로에 공백이 있다).
  const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const dir = resolve(arg('--migrations', join(root, 'apps/api/prisma/migrations')));
  const catalogFile = arg('--catalog');
  const dbUrl = arg('--db-url') || (catalogFile ? null : process.env.DATABASE_URL);
  if (!catalogFile && !dbUrl) {
    process.stderr.write('DATABASE_URL 또는 --db-url / --catalog 가 필요하다.\n');
    return 2;
  }
  const catalog = catalogFile ? parseCatalogText(readFileSync(catalogFile, 'utf8')) : fetchCatalog(dbUrl);
  const rows = probeMigrations(dir, catalog);
  const out = arg('--json');
  if (out) writeFileSync(out, `${JSON.stringify({ measuredAt: new Date().toISOString(), migrationsDir: basename(dir), rows }, null, 2)}\n`);
  if (!argv.includes('--quiet')) {
    process.stdout.write(`마이그레이션 적용 실측 — 대상 객체는 SQL 을 정적 파싱해 뽑고, 카탈로그(읽기 전용)와 대조한다.\n\n`);
    process.stdout.write(`${'판정'.padEnd(12)} ${'객체'.padStart(5)} ${'있음'.padStart(5)} ${'없음'.padStart(5)} ${'미파싱'.padStart(6)}  이력  마이그레이션\n`);
    for (const r of rows) {
      const hist = r.recordedInHistory == null ? ' -  ' : r.recordedInHistory ? ' 있음' : ' 없음';
      process.stdout.write(`${r.verdict.padEnd(12)} ${String(r.objects).padStart(5)} ${String(r.presentCount).padStart(5)} ${String(r.missing.length).padStart(5)} ${String(r.unparsed.length).padStart(6)} ${hist}  ${r.migration}\n`);
    }
    for (const r of rows.filter((x) => x.missing.length || x.unparsed.length || x.aliases.length)) {
      process.stdout.write(`\n── ${r.migration} (${r.verdict})\n`);
      for (const a of r.aliases) process.stdout.write(`  ⚠ 이름이 다르다(정의로 찾음): ${a}\n`);
      for (const m of r.missing.slice(0, 40)) process.stdout.write(`  🔴 없음: ${m}\n`);
      if (r.missing.length > 40) process.stdout.write(`  … 없음 ${r.missing.length - 40}건 더(전체는 --json)\n`);
      for (const u of r.unparsed.slice(0, 10)) process.stdout.write(`  ❔ 미파싱: ${u.slice(0, 160)}\n`);
      if (r.unparsed.length > 10) process.stdout.write(`  … 미파싱 ${r.unparsed.length - 10}건 더\n`);
    }
    const bad = rows.filter((r) => r.verdict !== 'APPLIED');
    process.stdout.write(`\n${bad.length === 0
      ? '전부 APPLIED — resolve --applied 로 표시해도 이력이 사실과 같다.'
      : `🔴 APPLIED 아님 ${bad.length}건 — 이 마이그레이션을 resolve --applied 로 표시하면 이력이 거짓이 된다(빠진 객체를 먼저 결정한다).`}\n`);
  }
  return rows.every((r) => r.verdict === 'APPLIED') ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (e) {
    process.stderr.write(`${e.message}\n`);
    process.exit(2);
  }
}
