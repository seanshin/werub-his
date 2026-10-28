-- 2026-10-01 SQL 튜닝 — 이름 검색 트라이그램 GIN 복구 + 시점 유효 고시 조회 인덱스.
-- 🔴 운영(서버 이전 후)에 이름 검색 GIN 10종이 0종이었다 — 종전엔 수동 SQL 로만 만들어 `prisma db push` 가
--    "스키마 밖 인덱스"로 지웠다. 이제 schema.prisma 의 @@index(type: Gin) 이 정본이고, 이 파일은 운영 무중단 적용본이다.
-- 운영 무중단 적용본(prisma/sql) — 적용: **트랜잭션 밖에서 한 문장씩**(CONCURRENTLY 는 트랜잭션 블록 안에서 실행할 수 없다) —
--    docker exec docker-postgres-1 psql -U hospital -d hospitalrun -c '<문장>'
-- 쓰기 잠금 없음(CONCURRENTLY) · 이미 있으면 건너뜀(IF NOT EXISTS) · 되돌리기 = DROP INDEX CONCURRENTLY <이름>
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_patients_family_trgm" ON "patients" USING GIN ("family_name" gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_patients_given_trgm" ON "patients" USING GIN ("given_name" gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_patient_mrn_gin" ON "patients" USING GIN ("mrn" gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_diagnosis_codes_nameko_trgm" ON "diagnosis_codes" USING GIN ("name_ko" gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_diagnosis_code_code_gin" ON "diagnosis_codes" USING GIN ("code" gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_procedure_codes_nameko_trgm" ON "procedure_codes" USING GIN ("name_ko" gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_medication_codes_name_ko_trgm" ON "medication_codes" USING GIN ("name_ko" gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_medication_codes_name_en_trgm" ON "medication_codes" USING GIN ("name_en" gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_medication_codes_ingredient_trgm" ON "medication_codes" USING GIN ("ingredient" gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_drug_std_product_trgm" ON "drug_standard_codes" USING GIN ("product_name" gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_progress_notes_content_trgm" ON "progress_notes" USING GIN ("content" gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS "procedure_fees_valid_from_idx" ON "procedure_fees"("valid_from");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "drug_prices_valid_from_idx" ON "drug_prices"("valid_from");
