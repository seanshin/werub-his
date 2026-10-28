-- 한글 검색 pg_trgm GIN 인덱스 — **migrate deploy 로 적용 가능한 형태**(2026-09-13 상용 릴리즈 T2-1 재작성).
--
-- 🔴 종전 이 파일은 `CREATE INDEX CONCURRENTLY` 였다. CONCURRENTLY 는 트랜잭션 블록 안에서 실행할 수 없는데
--    `prisma migrate deploy` 는 한 마이그레이션 스크립트를 한 번에 보내므로 **빈 DB 설치가 이 단계에서 실패**했다.
--    그 원본(운영 DB 에 무중단으로 거는 용도)은 `prisma/sql/ops/gin-trgm-indexes-concurrently.sql` 로 옮겼다.
--    빈 DB 에는 행이 없으므로 일반 CREATE INDEX 로 충분하다.
--
-- 🔴 운영 DB 에는 같은 컬럼에 **이름이 다른 trgm 인덱스가 중복**으로 걸려 있을 수 있다 — 같은 대상에 수동 SQL 3개가
--    각자 이름을 붙였다(`add_gin_indexes`·`manual/search-trgm-indexes-20260705.sql`·`manual/medication-bilingual-p0-20260805.sql`).
--    새 설치는 아래 한 벌만 만든다(컬럼당 1개 · 이름은 가장 먼저 쓰인 것을 따른다).
--    운영 기준선 적용(`migrate resolve --applied`) 전에 `pg_indexes` 로 중복을 확인한다 — `docs/05-reference/sql-inventory.md` §운영 적용.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 환자 검색(이름·MRN)
CREATE INDEX IF NOT EXISTS idx_patient_family_name_gin ON patients USING gin (family_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_patient_given_name_gin ON patients USING gin (given_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_patient_mrn_gin ON patients USING gin (mrn gin_trgm_ops);

-- 진단 코드(명칭·코드)
CREATE INDEX IF NOT EXISTS idx_diagnosis_code_name_gin ON diagnosis_codes USING gin (name_ko gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_diagnosis_code_code_gin ON diagnosis_codes USING gin (code gin_trgm_ops);

-- 약품 코드(한글명·영문명·성분 — 영문 검색 정본 buildMedicationSearchWhere)
CREATE INDEX IF NOT EXISTS idx_medication_code_name_gin ON medication_codes USING gin (name_ko gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_medication_codes_name_en_trgm ON medication_codes USING gin (name_en gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_medication_codes_ingredient_trgm ON medication_codes USING gin (ingredient gin_trgm_ops);

-- 수가 코드 명칭 · 약가 표준코드 제품명
CREATE INDEX IF NOT EXISTS idx_procedure_code_name_gin ON procedure_codes USING gin (name_ko gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_drug_std_product_trgm ON drug_standard_codes USING gin (product_name gin_trgm_ops);

-- 감사 로그 사용자·시각 역순(스키마 @@index 로는 DESC 를 표현하지 않았다)
CREATE INDEX IF NOT EXISTS idx_audit_log_user_time ON audit_logs (user_id, timestamp DESC);
