-- GIN indexes for Korean text search using pg_trgm
-- Improves LIKE/ILIKE performance on large tables (100K+ rows)
--
-- ⚠️ 테이블/컬럼명은 @@map/@map 의 snake_case 실제 DB 식별자를 사용해야 한다.
--    (이전 버전은 "Patient"."familyName" 등 PascalCase/camelCase로 작성돼 relation 부재로
--     적용 실패 → 인덱스 부재로 한글검색 seq scan. 2026-06-15 교정.)
-- ⚠️ deploy.sh 는 `prisma db push`만 실행하며 migrations/ 를 적용하지 않는다.
--    이 파일은 수동 적용 전용: `npx prisma db execute --file <this> --schema prisma/schema.prisma`
--    또는 psql 직접 실행. CONCURRENTLY 는 트랜잭션 밖에서만 동작하므로 db execute 시
--    각 문이 개별 실행돼야 한다(psql 권장).

-- pg_trgm 확장(없으면 생성)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Patient search (이름, MRN) — patients(family_name, given_name, mrn)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_patient_family_name_gin ON patients USING gin (family_name gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_patient_given_name_gin ON patients USING gin (given_name gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_patient_mrn_gin ON patients USING gin (mrn gin_trgm_ops);

-- Diagnosis code search (코드명 한글검색) — diagnosis_codes(name_ko, code)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_diagnosis_code_name_gin ON diagnosis_codes USING gin (name_ko gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_diagnosis_code_code_gin ON diagnosis_codes USING gin (code gin_trgm_ops);

-- Medication code search — medication_codes(name_ko)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_medication_code_name_gin ON medication_codes USING gin (name_ko gin_trgm_ops);

-- Procedure code search — procedure_codes(name_ko)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_procedure_code_name_gin ON procedure_codes USING gin (name_ko gin_trgm_ops);

-- Audit log search (user_id, timestamp 복합) — audit_logs(user_id, timestamp DESC)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_log_user_time ON audit_logs (user_id, timestamp DESC);
