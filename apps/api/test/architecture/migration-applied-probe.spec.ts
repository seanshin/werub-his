/**
 * `scripts/migration-applied-probe.mjs` 가드 — "적용됨 표시(`migrate resolve --applied`) 전에 실제로 있는가"를 재는 도구.
 *
 * 🔴 이 도구가 틀리면 **이력이 거짓이 되고 그 마이그레이션은 영원히 건너뛰어진다.** 그래서 여기서는
 *    ① 네 판정(APPLIED/PARTIAL/ABSENT/UNPARSEABLE)이 각각 나오는 표본을 두고
 *    ② 🔴 **모르는 것을 있음으로 세지 않는다**(파싱 못 한 문장이 있으면 전부 있어도 APPLIED 라고 말하지 않는다)
 *    ③ 이름이 달라도 정의가 같으면 찾아낸다(운영 동의서 유니크가 이름만 달랐던 자리)
 *    ④ 저장소의 실제 마이그레이션 8개를 파싱해 객체 수가 기준선과 맞는지 본다(파서가 조용히 죽으면 0이 된다).
 *
 * 실제 DB 대조(빈 PG16 · 인덱스 DROP → PARTIAL · 문장 주입 → UNPARSEABLE)는 2026-09-14 일회용 컨테이너로 확인했고
 * 결과는 `docs/05-reference/manual-index-inventory.md` §9 에 적혀 있다 — 여기서는 DB 없이 도는 층만 본다.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  CATALOG_SQL,
  canonIndexDef,
  canonPgIndexDef,
  compare,
  looseIndexKey,
  normalizeColumnType,
  parseAddColumns,
  parseAlterNullability,
  parseCatalogText,
  parseMigrationSql,
  splitStatements,
  verdictOf,
} from '../../../../scripts/migration-applied-probe.mjs';

const MIGRATIONS_DIR = join(__dirname, '../../prisma/migrations');

/** 카탈로그(대조 대상 DB) 표본 — 아래 SQL 이 만드는 것이 전부 들어 있다 */
const CATALOG = {
  schemas: ['public'],
  extensions: ['pg_trgm'],
  sequences: ['mrn_daily_seq'],
  enums: [{ name: 'Color', labels: ['RED', 'BLUE'] }],
  tables: ['widgets'],
  columns: ['widgets.id', 'widgets.name'],
  indexes: [
    { name: 'widgets_pkey', table: 'widgets', def: 'CREATE UNIQUE INDEX widgets_pkey ON public.widgets USING btree (id)' },
    { name: 'idx_widgets_name_OTHER', table: 'widgets', def: 'CREATE INDEX "idx_widgets_name_OTHER" ON public.widgets USING btree (name) WHERE (name IS NOT NULL)' },
  ],
  constraints: [{ name: 'widgets_pkey', table: 'widgets' }],
  triggers: [{ name: 'trg_widgets', table: 'widgets' }],
  functions: ['widgets_guard'],
  migrations: ['00000000000001_baseline'],
};

const parseAndJudge = (sql: string, catalog: Record<string, unknown> = CATALOG) => {
  const parsed = parseMigrationSql(sql);
  const cmp = compare(parsed.objects, catalog);
  return { parsed, cmp, verdict: verdictOf(parsed, cmp) };
};

describe('문장 분해 — 달러 인용·주석·문자열을 세지 않는다', () => {
  it('$$ 본문 안의 세미콜론으로 쪼개지 않는다', () => {
    const sql = `CREATE FUNCTION f() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'a;b'; RETURN NEW; END; $$ LANGUAGE plpgsql;\nCREATE INDEX i ON t(a);`;
    expect(splitStatements(sql)).toHaveLength(2);
  });

  it('주석 줄은 문장이 되지 않는다(주석이 검사에 걸려 헛돈 사례가 있다)', () => {
    expect(splitStatements('-- CREATE TABLE fake (id int);\nCREATE TABLE real (id int);')).toEqual(['CREATE TABLE real (id int)']);
  });
});

describe('판정', () => {
  const applied = `
    CREATE EXTENSION IF NOT EXISTS pg_trgm;
    CREATE SEQUENCE IF NOT EXISTS mrn_daily_seq START 1;
    CREATE TYPE "Color" AS ENUM ('RED', 'BLUE');
    CREATE TABLE "widgets" ("id" UUID NOT NULL, "name" TEXT, CONSTRAINT "widgets_pkey" PRIMARY KEY ("id"));
    CREATE FUNCTION widgets_guard() RETURNS trigger AS $$ BEGIN RETURN NEW; END; $$ LANGUAGE plpgsql;
    DROP TRIGGER IF EXISTS trg_widgets ON widgets;
    CREATE TRIGGER trg_widgets BEFORE UPDATE ON "widgets" FOR EACH ROW EXECUTE FUNCTION widgets_guard();
  `;

  it('APPLIED — 파싱한 객체가 전부 있고 미파싱이 없다', () => {
    const r = parseAndJudge(applied);
    expect({ verdict: r.verdict, missing: r.cmp.missing, unparsed: r.parsed.unparsed }).toEqual({ verdict: 'APPLIED', missing: [], unparsed: [] });
  });

  it('🔴 UNPARSEABLE — 모르는 문장이 하나라도 있으면 전부 있어도 APPLIED 라고 말하지 않는다', () => {
    const r = parseAndJudge(`${applied}\nALTER TABLE "widgets" ALTER COLUMN "name" SET DEFAULT 'x';`);
    expect(r.cmp.missing).toEqual([]);
    expect(r.verdict).toBe('UNPARSEABLE');
    expect(r.parsed.unparsed[0]).toContain('SET DEFAULT');
  });

  it('PARTIAL — 일부만 있으면 빠진 것을 이름으로 지목한다(빠진 것이 있으면 미파싱보다 먼저 말한다)', () => {
    const r = parseAndJudge(`${applied}\nCREATE INDEX idx_widgets_missing ON "widgets" (name);\nALTER TABLE "widgets" ALTER COLUMN "name" SET DEFAULT 'x';`);
    expect(r.verdict).toBe('PARTIAL');
    expect(r.cmp.missing).toEqual(['index idx_widgets_missing']);
    expect(r.parsed.unparsed).toHaveLength(1); // 미파싱도 함께 남는다(둘 다 보여야 판단할 수 있다)
  });

  it('ABSENT — 하나도 없다', () => {
    const r = parseAndJudge('CREATE TABLE "zz" ("id" UUID NOT NULL);\nCREATE INDEX zz_idx ON "zz"(id);');
    expect({ verdict: r.verdict, missing: r.cmp.missing }).toEqual({ verdict: 'ABSENT', missing: ['table zz', 'index zz_idx'] });
  });

  it('테이블은 있는데 열이 빠지면 PARTIAL 로 열을 지목한다(테이블 이름만 보고 있다고 하지 않는다)', () => {
    const r = parseAndJudge('CREATE TABLE "widgets" ("id" UUID NOT NULL, "name" TEXT, "color" TEXT);');
    expect({ verdict: r.verdict, missing: r.cmp.missing }).toEqual({ verdict: 'ABSENT', missing: ['table widgets 열 color'] });
  });

  it('enum 값이 빠지면 지목한다', () => {
    const r = parseAndJudge(`CREATE TYPE "Color" AS ENUM ('RED', 'BLUE', 'GREEN');`);
    expect(r.cmp.missing).toEqual(['enum Color 값 GREEN']);
  });
});

describe('인덱스 — 이름이 달라도 정의가 같으면 찾는다(운영 동의서 유니크가 이름만 달랐다)', () => {
  it('정의가 같으면 있음 + 다른 이름을 밝힌다', () => {
    const r = parseAndJudge('CREATE INDEX idx_widgets_name ON "widgets" (name) WHERE name IS NOT NULL;');
    expect(r.cmp.missing).toEqual([]);
    expect(r.cmp.present[0]).toContain('다른 이름: idx_widgets_name_OTHER');
  });

  it('대조군 — 정의가 다르면(조건 없음) 같은 이름 없이는 없음이다', () => {
    const r = parseAndJudge('CREATE INDEX idx_widgets_name ON "widgets" (name);');
    expect(r.cmp.missing).toEqual(['index idx_widgets_name']);
  });

  it('`USING btree` 생략·괄호 차이를 같은 것으로 접는다', () => {
    const fromSql = canonIndexDef(false, 'widgets', '(name) WHERE name IS NOT NULL');
    const fromPg = canonPgIndexDef('CREATE INDEX x ON public.widgets USING btree (name) WHERE (name IS NOT NULL)');
    expect(fromSql).toContain('using btree');
    expect(looseIndexKey(fromSql)).toBe(looseIndexKey(fromPg!));
  });
});

describe('🔴 ALTER TABLE ADD COLUMN — 2026-09-14 적용분(열 8개 실재)이 UNPARSEABLE 로 나오던 자리', () => {
  const COL_CATALOG = {
    ...CATALOG,
    columns: [...CATALOG.columns, 'widgets.reason', 'widgets.changed_at'],
    columnTypes: [
      { c: 'widgets.reason', udt: 'varchar', len: 300 },
      { c: 'widgets.changed_at', udt: 'timestamptz', len: null },
    ],
  };
  const sql = `ALTER TABLE "widgets" ADD COLUMN "reason" VARCHAR(300);\nALTER TABLE "widgets" ADD COLUMN IF NOT EXISTS "changed_at" TIMESTAMPTZ, ADD COLUMN "noted_by" UUID;`;

  it('쉼표로 이은 여러 절까지 열 객체로 읽는다(타입 포함)', () => {
    expect(parseAddColumns('ALTER TABLE "t" ADD COLUMN "a" VARCHAR(300), ADD COLUMN IF NOT EXISTS b TIMESTAMPTZ(3) NOT NULL DEFAULT now(), ADD c text[]'))
      .toEqual([
        { kind: 'column', table: 't', name: 'a', type: { udt: 'varchar', len: 300 } },
        { kind: 'column', table: 't', name: 'b', type: { udt: 'timestamptz', len: null } },
        { kind: 'column', table: 't', name: 'c', type: { udt: '_text', len: null } },
      ]);
  });

  it('열 추가가 아닌 절이 하나라도 섞이면 문장 전체를 미파싱으로 남긴다(일부만 읽고 있다고 말하지 않는다)', () => {
    expect(parseAddColumns('ALTER TABLE t ADD COLUMN a int, ALTER COLUMN b SET DEFAULT 1')).toBeNull();
    const r = parseAndJudge('ALTER TABLE "widgets" ADD COLUMN "reason" VARCHAR(300), ALTER COLUMN "name" SET NOT NULL;', COL_CATALOG);
    expect(r.parsed.unparsed).toHaveLength(1);
    expect(r.verdict).toBe('UNPARSEABLE');
  });

  it('열이 모두 있으면 APPLIED, 하나 빠지면 PARTIAL 로 그 열을 지목한다', () => {
    const full = { ...COL_CATALOG, columns: [...COL_CATALOG.columns, 'widgets.noted_by'] };
    expect(parseAndJudge(sql, full).verdict).toBe('APPLIED');
    const r = parseAndJudge(sql, COL_CATALOG);
    expect({ verdict: r.verdict, missing: r.cmp.missing }).toEqual({ verdict: 'PARTIAL', missing: ['column widgets.noted_by'] });
  });

  it('타입이 다르면 PARTIAL 사유로 말한다 · 모르는 타입·옛 캡처(columnTypes 없음)는 대조하지 않는다', () => {
    const wrong = { ...COL_CATALOG, columns: [...COL_CATALOG.columns, 'widgets.noted_by'], columnTypes: [{ c: 'widgets.reason', udt: 'varchar', len: 100 }] };
    const r = parseAndJudge(sql, wrong);
    expect(r.verdict).toBe('PARTIAL');
    expect(r.cmp.missing).toEqual(['column widgets.reason 타입 불일치(SQL varchar(300) ≠ DB varchar(100))']);
    expect(normalizeColumnType('"MyEnum"')).toBeNull();
    const noTypes = { ...COL_CATALOG, columns: [...COL_CATALOG.columns, 'widgets.noted_by'], columnTypes: undefined };
    expect(parseAndJudge(sql, noTypes).verdict).toBe('APPLIED');
  });
});

describe('카탈로그 출력 잡음 허용 — 원격 psql -tA 의 BEGIN/SET/COMMIT 줄', () => {
  it('JSON 앞뒤의 명령 태그를 걷고 읽는다', () => {
    expect(parseCatalogText('BEGIN\nSET\n{"tables":["a"]}\nCOMMIT\n')).toEqual({ tables: ['a'] });
  });
  it('JSON 이 없으면 빈 카탈로그가 아니라 실패다', () => {
    expect(() => parseCatalogText('BEGIN\nSET\nCOMMIT')).toThrow();
  });
});

describe('🔴 ALTER COLUMN DROP/SET NOT NULL — 2026-09-15 크론 created_by nullable 마이그레이션', () => {
  const NULL_CATALOG = {
    ...CATALOG,
    columns: [...CATALOG.columns, 'widgets.created_by'],
    columnTypes: [{ c: 'widgets.created_by', udt: 'uuid', len: null, nullable: true }],
  };
  const sql = 'ALTER TABLE "widgets" ALTER COLUMN "created_by" DROP NOT NULL;';

  it('nullability 객체로 읽는다(여러 절 포함) · 다른 절이 섞이면 null', () => {
    expect(parseAlterNullability('ALTER TABLE "t" ALTER COLUMN "a" DROP NOT NULL, ALTER COLUMN b SET NOT NULL')).toEqual([
      { kind: 'nullability', table: 't', name: 'a', nullable: true },
      { kind: 'nullability', table: 't', name: 'b', nullable: false },
    ]);
    expect(parseAlterNullability('ALTER TABLE t ALTER COLUMN a DROP NOT NULL, ALTER COLUMN b SET DEFAULT 1')).toBeNull();
  });

  it('DB 가 NULL 허용이면 APPLIED · 아직 NOT NULL 이면 APPLIED 가 아니고 그 열을 지목', () => {
    expect(parseAndJudge(sql, NULL_CATALOG).verdict).toBe('APPLIED');
    const notYet = { ...NULL_CATALOG, columnTypes: [{ c: 'widgets.created_by', udt: 'uuid', len: null, nullable: false }] };
    const r = parseAndJudge(sql, notYet);
    // 객체가 하나뿐인 마이그레이션이라 빠지면 ABSENT(판정 규칙: 전부 없음=ABSENT) — 사유는 missing 이 말한다
    expect({ verdict: r.verdict, missing: r.cmp.missing }).toEqual({ verdict: 'ABSENT', missing: ['column widgets.created_by NULL 허용'] });
  });

  it('nullable 정보가 없는 옛 캡처는 있다고 세지 않는다(판정 불가)', () => {
    const old = { ...NULL_CATALOG, columnTypes: [{ c: 'widgets.created_by', udt: 'uuid', len: null }] };
    const r = parseAndJudge(sql, old);
    expect(r.verdict).not.toBe('APPLIED');
    expect(r.cmp.missing[0]).toContain('판정 불가');
  });

  it('카탈로그 질의가 nullable 을 함께 뽑는다', () => {
    expect(CATALOG_SQL).toContain("'nullable', is_nullable = 'YES'");
  });

  it('저장소 마이그레이션은 nullability 1 을 만들고 미파싱이 없다', () => {
    const parsed = parseMigrationSql(readFileSync(join(MIGRATIONS_DIR, '20260915000001_mapping_batch_job_created_by_nullable', 'migration.sql'), 'utf8'));
    expect({ objects: parsed.objects, unparsed: parsed.unparsed.length }).toEqual({
      objects: [{ kind: 'nullability', table: 'mapping_batch_jobs', name: 'created_by', nullable: true }],
      unparsed: 0,
    });
  });
});

describe('저장소 실제 마이그레이션 — 파서가 조용히 죽지 않는다', () => {
  const dirs = readdirSync(MIGRATIONS_DIR, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
  const parsedOf = (name: string) => parseMigrationSql(readFileSync(join(MIGRATIONS_DIR, name, 'migration.sql'), 'utf8'));

  it('마이그레이션을 모두 읽는다(목록 = 저장소 디렉터리 전체)', () => {
    expect(dirs).toEqual([
      '00000000000000_create_mrn_sequence',
      '00000000000001_baseline',
      '20260528000001_add_gin_indexes',
      '20260913000001_ancillary_constraints',
      '20260913000002_legal_hold',
      '20260914000001_diagnostic_test_status_transition',
      '20260914000002_critical_value_alert_states',
      '20260914000003_consult_reply_templates',
      '20260914000004_cssd_instrument_units',
      '20260915000001_mapping_batch_job_created_by_nullable',
      '20260928000001_asset_placements',
      '20260928000002_location_source_station_space',
      '20260928000003_clinic_rooms',
      '20260928000004_space_imports',
      '20260928000005_finance_disclosures',
      '20260929000001_emergency_arrival_notes',
      '20260929000002_arrival_note_prenotification',
      '20260929000003_finance_institution_code',
      '20260929000004_finance_disclosure_detail',
      '20260929000005_user_profession',
      '20260930000001_note_type_verbal_cosign',
      '20260930000002_prescription_discontinue',
      '20260930000003_prescription_renewal',
      '20260930000004_prescription_discharge_med',
      '20260930000005_patient_education_record',
      '20260930000006_substitution_decider',
      '20260930000007_pacu_assessment_provenance',
      '20260930000008_pacu_discharge_destination',
      '20260930000009_bed_transfer_request',
      '20261001000001_journey_v2_time_and_objects',
      '20261001000002_journey_v2_activity_transition',
      '20261001000003_order_specimen_collection',
      '20261001000004_search_trgm_and_validfrom_indexes',
      '20261001000005_waiting_queue_patient_index',
      '20261001000006_lab_test_code_updated_at',
      '20261002000001_bed_space_node',
      // 2026-10-02 상황판 디자인 F — 지표 이력(5분 칸) 테이블 1개·유일 인덱스 1개
      '20261002000002_command_center_kpi_snapshots',
      '20261002000003_registration_consent_evidence',
      // 2026-10-03 서명본 보존 — 테이블 1개·인덱스 2개
      '20261003000001_signed_record_versions',
      // 2026-10-03 응급 퇴실 시각(결정 D9) — 열 2개
      '20261003000002_emergency_departed_at',
      // 2026-10-03 정정 사유(선택) — 열 1개
      '20261003000003_signed_record_version_reason',
      // 2026-10-05 수술방 차트 — 수술 중 기록 원장·배치 테이블 2개·인덱스 2개
      '20261005000001_intraop_events_or_chart_layouts',
      // 2026-10-05 수술방 차트 P1 — 순회 간호 열 1·음성 세션 수술 단위(열 1·NOT NULL 해제 1)·인덱스 1
      '20261005000002_or_voice_circulating',
      '20261007000001_qi_improvement_actions',
      // 2026-10-07 회복실 상세화 — pacu_records 열 8(전부 NULL 허용)
      '20261007000002_pacu_detail',
      // 2026-10-08 의료질관리 흐름 — 측정 출처·층·사고 필드·재원일수·기구일수·보고서·인증(테이블 5·열 17·유일키 교체)
      '20261008000001_qi_flow',
      '20261009000001_device_lines',
      // 2026-10-09 경보 승인 원장(테이블 1)
      '20261009000002_alert_approvals',
      // 2026-10-09 진단별 POA 원장(테이블 1)
      '20261009000003_diagnosis_poa',
      // 2026-10-09 KOPS 직접 보고 기록(safety_incidents 열 3 · NULL 허용)
      '20261009000004_kops_manual_report',
      // 2026-10-09 무선 AP 위치(wifi_access_points·wifi_collectors·wifi_device_bindings·wifi_position_fixes 신설 · 기존 표 무변경)
      '20261009000005_wifi_location',
      // 2026-10-10 무선 현장 측정 표본(wifi_survey_samples 신설 · 기존 표 무변경)
      '20261010000001_wifi_survey',
      // 2026-10-10 수집기 키 교체 시각(wifi_collectors.key_rotated_at · NULL 허용)
      '20261010000401_wifi_collector_key_rotation',
      // 2026-10-10 서류 보낼 곳(document_requests.delivery_destination · NULL 허용)
      '20261010000501_doc_delivery_destination',
      '20261010000601_ad_revoke_consult_closed_by',
      '20261011000701_decision_log_entries',
      '20261020000101_patient_account_onboarding', // 2026-10-20 v4.99.0 포털 첫 안내 계정 단위(칸 추가)
      '20261021000101_form_schema_revisions', // 2026-10-21 v4.114.0 문진 폼 판 원장(form_schema_revisions 신설 · 칸 2 추가)
      '20261022000101_interim_billing_ledger', // 2026-10-22 v4.116.0 중간정산 근거 칸·수납 원장(interim_billing_payments 신설)·회차 유일
      '20261022000201_interim_billing_refunds', // 2026-10-22 v4.117.0 중간정산 환불 원장(ERP 회신 R5)
      '20261022000301_interim_refund_request_key', // 2026-10-22 v4.118.0 중간정산 환불 요청 중복 방지 키(ERP 2차 회신)
      '20261026000101_handoff_acknowledged_by', // 2026-10-26 v4.123.0 인수 확인한 사람(관리자 대리 구별)
    ]);
  });

  it('기준선 객체 수가 기준선 헤더(테이블 562·인덱스 1,039·열거형 61·외래키 566)와 같다', () => {
    const { objects, unparsed } = parsedOf('00000000000001_baseline');
    const count = (kind: string) => objects.filter((o: { kind: string }) => o.kind === kind).length;
    expect({ table: count('table'), index: count('index'), enum: count('enum'), constraint: count('constraint'), unparsed: unparsed.length })
      .toEqual({ table: 562, index: 1039, enum: 61, constraint: 566, unparsed: 0 });
  });

  it('부속 마이그레이션은 인덱스 7·함수 1·트리거 1 을 만들고, consent DO 블록은 미파싱으로 남는다(추측하지 않는다)', () => {
    const { objects, unparsed } = parsedOf('20260913000001_ancillary_constraints');
    const kinds = objects.reduce((a: Record<string, number>, o: { kind: string }) => ({ ...a, [o.kind]: (a[o.kind] ?? 0) + 1 }), {});
    expect(kinds).toEqual({ index: 7, function: 1, trigger: 1 });
    expect(unparsed).toHaveLength(1);
    expect(unparsed[0]).toContain('DO $$');
  });

  it('09-14 두 마이그레이션은 열 3·5 를 만들고 미파싱이 없다', () => {
    const a = parsedOf('20260914000001_diagnostic_test_status_transition');
    const b = parsedOf('20260914000002_critical_value_alert_states');
    expect({ a: a.objects.length, au: a.unparsed.length, b: b.objects.length, bu: b.unparsed.length }).toEqual({ a: 3, au: 0, b: 5, bu: 0 });
    expect(a.objects.every((o: { kind: string }) => o.kind === 'column')).toBe(true);
  });

  it('상담 빠른답변 템플릿 마이그레이션은 테이블 1·인덱스 1 을 만들고 미파싱이 없다', () => {
    const { objects, unparsed } = parsedOf('20260914000003_consult_reply_templates');
    const kinds = objects.reduce((a: Record<string, number>, o: { kind: string }) => ({ ...a, [o.kind]: (a[o.kind] ?? 0) + 1 }), {});
    expect(unparsed).toHaveLength(0);
    expect(kinds.table).toBe(1);
    expect(kinds.index).toBe(1);
  });

  it('legal_hold 는 테이블 2·인덱스 2·외래키 1·트리거 2 를 만든다', () => {
    const { objects } = parsedOf('20260913000002_legal_hold');
    const kinds = objects.reduce((a: Record<string, number>, o: { kind: string }) => ({ ...a, [o.kind]: (a[o.kind] ?? 0) + 1 }), {});
    expect(kinds).toEqual({ table: 2, index: 2, constraint: 1, function: 1, trigger: 2 });
  });
});

describe('접속은 읽기 전용이다', () => {
  it('카탈로그 질의에 쓰기 문장이 없다', () => {
    expect(CATALOG_SQL).not.toMatch(/\b(INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|TRUNCATE)\b/i);
  });

  it('스크립트가 실행하는 외부 명령은 psql(또는 컨테이너 psql)과 which 뿐이다 — prisma 를 부르지 않는다', () => {
    const src = readFileSync(join(__dirname, '../../../../scripts/migration-applied-probe.mjs'), 'utf8');
    expect(src).toContain('SET TRANSACTION READ ONLY');
    // 🔴 문자열 전체에서 "db push" 를 찾으면 설명 문장(SQL 주석)에 걸려 헛돈다(2026-09-14 첫 작성본이 그랬다) —
    //    실제로 **실행하는 자리**(spawnSync 첫 인자)만 본다.
    const commands = [...src.matchAll(/spawnSync\(\s*([^,]+),/g)].map((m) => m[1].trim());
    expect(commands.length).toBeGreaterThanOrEqual(3); // which · psql · docker — 0 이면 정규식이 죽은 것이다
    expect(commands.every((c) => /^('which'|havePsql|'docker')$/.test(c))).toBe(true);
    const dockerArgs = /spawnSync\('docker', \[([^\]]*)\]/.exec(src)?.[1] ?? '';
    expect(dockerArgs).toContain("'psql'");
    expect(dockerArgs).not.toMatch(/prisma|migrate/);
  });
});
