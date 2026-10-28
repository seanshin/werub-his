/**
 * 🔴 이름 검색 인덱스는 스키마에 있어야 산다(2026-10-01 SQL 튜닝).
 * 운영(서버 이전 후)에 이름 검색 트라이그램 GIN 10종이 **0종**이었다 — 수동 SQL 로만 만들어 `prisma db push` 가
 * "스키마 밖 인덱스"로 지웠다(경과기록 본문 인덱스도 db push 미리보기가 DROP 하려 들었다 · 2026-09-13).
 * 지키는 것: 검색 열마다 GIN 이 schema.prisma 에 있다 · 운영 무중단 적용본(마이그레이션)과 이름이 같다 · 시점 고시 조회 인덱스.
 * 재주입: 스키마에서 한 줄을 지우면 실패한다.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const schema = readFileSync(join(__dirname, '../../prisma/schema.prisma'), 'utf8');
const migration = readFileSync(join(__dirname, '../../prisma/migrations/20261001000004_search_trgm_and_validfrom_indexes/migration.sql'), 'utf8');
/** 운영 무중단 적용본(트랜잭션 밖 · migrate 폴더 밖) */
const online = readFileSync(join(__dirname, '../../prisma/sql/2026-10-01-search-trgm-validfrom-indexes.concurrently.sql'), 'utf8');

/** [모델, 필드, 인덱스 이름] — 화면 검색이 ILIKE '%…%' 로 거는 열 */
const SEARCH_GIN: [string, string, string][] = [
  ['Patient', 'familyName', 'idx_patients_family_trgm'],
  ['Patient', 'givenName', 'idx_patients_given_trgm'],
  ['Patient', 'mrn', 'idx_patient_mrn_gin'],
  ['MedicationCode', 'nameKo', 'idx_medication_codes_name_ko_trgm'],
  ['MedicationCode', 'nameEn', 'idx_medication_codes_name_en_trgm'],
  ['MedicationCode', 'ingredient', 'idx_medication_codes_ingredient_trgm'],
  ['DiagnosisCode', 'nameKo', 'idx_diagnosis_codes_nameko_trgm'],
  ['DiagnosisCode', 'code', 'idx_diagnosis_code_code_gin'],
  ['ProcedureCode', 'nameKo', 'idx_procedure_codes_nameko_trgm'],
  ['DrugStandardCode', 'productName', 'idx_drug_std_product_trgm'],
  ['ProgressNote', 'content', 'idx_progress_notes_content_trgm'],
];

function modelBody(name: string): string {
  const i = schema.indexOf(`model ${name} {`);
  expect(i, name).toBeGreaterThan(-1);
  return schema.slice(i, schema.indexOf('\n}', i));
}

describe('이름 검색 인덱스는 스키마에 있다', () => {
  it.each(SEARCH_GIN)('%s.%s — GIN trigram(%s)', (model, field, name) => {
    const body = modelBody(model);
    expect(body).toContain(`@@index([${field}(ops: raw("gin_trgm_ops"))], type: Gin, map: "${name}")`);
    // 운영 무중단 적용본과 이름이 같다(다르면 db push 가 하나를 지우고 하나를 만든다)
    expect(migration).toContain(`"${name}"`);
  });

  it('시점 유효 고시 조회 — 수가·약가 valid_from 단독 인덱스', () => {
    expect(modelBody('ProcedureFee')).toMatch(/@@index\(\[validFrom\]\)/);
    expect(modelBody('DrugPrice')).toMatch(/@@index\(\[validFrom\]\)/);
    expect(migration).toContain('"procedure_fees_valid_from_idx"');
    expect(migration).toContain('"drug_prices_valid_from_idx"');
  });

  it('운영 적용본은 무중단(CONCURRENTLY)·멱등 · 설치용 마이그레이션은 트랜잭션 안에서 도는 일반 CREATE(같은 수)', () => {
    const on = online.split('\n').filter((l) => l.startsWith('CREATE'));
    const mg = migration.split('\n').filter((l) => l.startsWith('CREATE'));
    expect(on.length).toBe(SEARCH_GIN.length + 2);
    expect(mg.length).toBe(on.length);
    for (const l of on) expect(l).toMatch(/^CREATE INDEX CONCURRENTLY IF NOT EXISTS /);
    for (const l of mg) expect(l).toMatch(/^CREATE INDEX IF NOT EXISTS /);
  });

  it('대기열 환자 기준 조회 인덱스(2차 · 느린 쿼리·스캔 통계 실측) — 스키마·설치용·운영 적용본 이름 일치', () => {
    expect(modelBody('WaitingQueue')).toMatch(/@@index\(\[patientId, checkedInAt\]\)/);
    const mig = readFileSync(join(__dirname, '../../prisma/migrations/20261001000005_waiting_queue_patient_index/migration.sql'), 'utf8');
    const on = readFileSync(join(__dirname, '../../prisma/sql/2026-10-01-waiting-queue-patient-index.concurrently.sql'), 'utf8');
    expect(mig).toMatch(/^CREATE INDEX IF NOT EXISTS "waiting_queue_patient_id_checked_in_at_idx"/m);
    expect(on).toMatch(/^CREATE INDEX CONCURRENTLY IF NOT EXISTS "waiting_queue_patient_id_checked_in_at_idx"/m);
  });
});
