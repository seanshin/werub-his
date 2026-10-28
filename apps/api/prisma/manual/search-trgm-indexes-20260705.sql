-- 🔴 적용 이력 정정(2026-08-14): 이 헤더에는 "2026-07-30 프로드 적용 완료" 와
--    "Seq Scan 9.0ms → Bitmap Index Scan 0.28ms" 라는 **검증 결과가 적혀 있었으나 사실이 아니었다**.
--    실측(운영 DB, 2026-08-14):
--      · pg_indexes 에 아래 6개 인덱스 **전부 부재**(존재하는 gin 인덱스는 encounters/nursing_notes/
--        progress_notes 의 임상기록 검색용 3본뿐).
--      · EXPLAIN ANALYZE SELECT id FROM medication_codes WHERE name_ko LIKE '%졸피뎀%' LIMIT 20
--        → Seq Scan on medication_codes, Rows Removed by Filter 24007 (반복 실행 Execution Time 7.4~12.0 ms
--          — 캐시 상태에 따라 흔들리므로 단일 수치로 적지 않는다. 안정된 사실은 '인덱스 부재 + Seq Scan').
--    ⇒ 현재 상태 = **미적용**. deploy.sh 는 manual/ SQL 을 실행하지 않는다(psql 로 수동 적용 필수).
--    적용/미적용은 선언하지 말고 /admin/go-live 의 `infra.ginIndex`(pg_indexes 실측)로 확인할 것.
--    적용 후에는 같은 EXPLAIN 을 다시 떠서 **실제 측정치로** 이 주석을 갱신한다(추정치 기재 금지).
-- 성능: 선행 와일드카드 ILIKE 검색(환자명·코드명) seq scan → pg_trgm GIN 인덱스(대규모 대비)
-- CONCURRENTLY = 무중단(트랜잭션 밖·psql -f 직접 실행). pg_trgm 확장 기활성.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_patients_family_trgm ON patients USING gin (family_name gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_patients_given_trgm ON patients USING gin (given_name gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_procedure_codes_nameko_trgm ON procedure_codes USING gin (name_ko gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_medication_codes_nameko_trgm ON medication_codes USING gin (name_ko gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_diagnosis_codes_nameko_trgm ON diagnosis_codes USING gin (name_ko gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_drug_std_product_trgm ON drug_standard_codes USING gin (product_name gin_trgm_ops);
