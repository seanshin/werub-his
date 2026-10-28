-- 2026-10-01 SQL 튜닝 — 이름 검색 트라이그램 GIN 복구 + 시점 유효 고시 조회 인덱스(신규 설치·migrate 용).
-- 🔴 운영(서버 이전 후)에 이름 검색 GIN 10종이 0종이었다 — 수동 SQL 로만 만들어 `prisma db push` 가 스키마 밖 인덱스로 지웠다.
--    이제 schema.prisma 의 @@index(type: Gin) 이 정본이다.
-- migrate 는 트랜잭션 안에서 돌므로 CONCURRENTLY 를 쓰지 않는다(설치 재현성 가드). 운영 무중단 적용본은
--    prisma/sql/2026-10-01-search-trgm-validfrom-indexes.concurrently.sql (트랜잭션 밖 한 문장씩).
CREATE INDEX IF NOT EXISTS "idx_patients_family_trgm" ON "patients" USING GIN ("family_name" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "idx_patients_given_trgm" ON "patients" USING GIN ("given_name" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "idx_patient_mrn_gin" ON "patients" USING GIN ("mrn" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "idx_diagnosis_codes_nameko_trgm" ON "diagnosis_codes" USING GIN ("name_ko" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "idx_diagnosis_code_code_gin" ON "diagnosis_codes" USING GIN ("code" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "idx_procedure_codes_nameko_trgm" ON "procedure_codes" USING GIN ("name_ko" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "idx_medication_codes_name_ko_trgm" ON "medication_codes" USING GIN ("name_ko" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "idx_medication_codes_name_en_trgm" ON "medication_codes" USING GIN ("name_en" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "idx_medication_codes_ingredient_trgm" ON "medication_codes" USING GIN ("ingredient" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "idx_drug_std_product_trgm" ON "drug_standard_codes" USING GIN ("product_name" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "idx_progress_notes_content_trgm" ON "progress_notes" USING GIN ("content" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "procedure_fees_valid_from_idx" ON "procedure_fees"("valid_from");
CREATE INDEX IF NOT EXISTS "drug_prices_valid_from_idx" ON "drug_prices"("valid_from");
