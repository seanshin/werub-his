-- 약물 한/영명 병용 P0 (2026-08-05) — medication-bilingual-naming.plan.md
-- 적용: docker exec -i docker-postgres-1 psql -U hospital -d hospitalrun < this
--
-- 실측 보정(기획 0.2/0.5 대비):
--  · ingredient 영문은 이미 21,595/24,022 존재(HIRA 백필분 "thiotepa   15mg" 형) — 외부 소스 불필요
--  · WeRU.B drug_master(305K)에는 영문명 컬럼이 없다(한글상품명·ingr_code·ATC 크로스워크만) — D1 소스 아님
--  · medication_codes 에 trgm 인덱스 전무였음(기획 0.5 의 name_ko 적용 기록은 타 테이블 건)
--
-- ── ① trgm 인덱스 3본 (D8·2026-08-05 운영 적용 완료 — 재실행 무해) ──
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_medication_codes_name_ko_trgm ON medication_codes USING gin (name_ko gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_medication_codes_name_en_trgm ON medication_codes USING gin (name_en gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_medication_codes_ingredient_trgm ON medication_codes USING gin (ingredient gin_trgm_ops);

-- ── ② ingredient 코드 결속 전파 백필 — ⚠️ 약제팀 검토 게이트(D1) 통과 후에만 실행 ──
-- 대상: ingredient 가 비어 있는 행 중, 같은 ingredient_code 의 영문 ingredient 가 존재하는 1,606건(2026-08-05 실측).
-- 안전 근거: 동일 ingredient_code 내 영문 성분명(용량 제거 정규화 후) 상이 0건 실측 — 이름 유사도 추정이 아니라
--            식약처 주성분코드 결속 전파. 용량 suffix 는 제거한 순수 성분명만 전파(원행의 용량과 다를 수 있으므로).
--
-- 검토용 후보 조회(적용 전 약제팀 확인):
--   WITH en AS (
--     SELECT ingredient_code, min(trim(regexp_replace(ingredient, '\s+[0-9].*$', ''))) AS ingr_en
--     FROM medication_codes
--     WHERE ingredient !~ '[가-힣]' AND ingredient IS NOT NULL AND ingredient <> '' AND ingredient_code IS NOT NULL
--     GROUP BY ingredient_code)
--   SELECT m.code, m.name_ko, m.ingredient_code, en.ingr_en
--   FROM medication_codes m JOIN en ON en.ingredient_code = m.ingredient_code
--   WHERE (m.ingredient IS NULL OR m.ingredient = '') ORDER BY m.code;
--
-- 적용(게이트 통과 후 주석 해제):
-- WITH en AS (
--   SELECT ingredient_code, min(trim(regexp_replace(ingredient, '\s+[0-9].*$', ''))) AS ingr_en
--   FROM medication_codes
--   WHERE ingredient !~ '[가-힣]' AND ingredient IS NOT NULL AND ingredient <> '' AND ingredient_code IS NOT NULL
--   GROUP BY ingredient_code)
-- UPDATE medication_codes m SET ingredient = en.ingr_en
-- FROM en WHERE en.ingredient_code = m.ingredient_code AND (m.ingredient IS NULL OR m.ingredient = '');

-- ── ③ 잔여 갭(사람 몫 — §H 등재) ──
--  · 한글 ingredient 386건(시드 계열·KR-헥사 ingredient_code): 코드 결속 소스 없음 → 약제팀 수기 확인
--  · nameEn(영문 상품명) 51건뿐: 공신력 소스 실존 여부 약제팀 확인 — 로마자 자동 변환 금지(D1).
--    ※ 영문 '검색'은 P1 buildMedicationSearchWhere 가 ingredient(영문 21,595)를 포함하므로 nameEn 백필 없이도 동작한다.
