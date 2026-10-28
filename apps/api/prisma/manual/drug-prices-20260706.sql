-- 약가(급여상한금액) 반영 — 2026-07-06 운영 적용 완료(기록용)
-- 원천: HIRA 약제급여목록및급여상한금액표(2026.7.1. 고시, 21,959품목) xlsx
--   → (code, name_ko, maker, spec, ingr_code, ingredient, price) CSV 추출 후 아래 적용
-- 결과: 매칭·갱신 20,249 / 신규 INSERT 1,665(2025.11 이후 등재) / 총 24,022품목·unitPrice 21,981
-- 재적용 시: CSV를 컨테이너 /tmp/drug-full.csv 로 넣고 실행(멱등 — UPDATE 덮어쓰기·INSERT는 미존재만)

BEGIN;
CREATE TEMP TABLE tmp_full (code varchar(20), name_ko varchar(500), maker varchar(200), spec varchar(50), ingr_code varchar(20), ingredient varchar(500), price int);
COPY tmp_full FROM '/tmp/drug-full.csv' WITH (FORMAT csv);

-- ① 기존 품목 가격 갱신 + (비어있으면) 성분 보강
UPDATE medication_codes m SET
  unit_price = t.price,
  ingredient = COALESCE(NULLIF(m.ingredient, ''), NULLIF(t.ingredient, '')),
  ingredient_code = COALESCE(NULLIF(m.ingredient_code, ''), NULLIF(t.ingr_code, '')),
  updated_at = now()
FROM (SELECT DISTINCT ON (code) * FROM tmp_full ORDER BY code, price) t
WHERE m.code = t.code;

-- ② 급여목록에만 있는 신규 품목 INSERT
INSERT INTO medication_codes (id, code, name_ko, manufacturer, unit, ingredient_code, ingredient, insurance_code, unit_price, is_active, valid_from, created_at, updated_at)
SELECT gen_random_uuid(), t.code, t.name_ko, NULLIF(t.maker,''), NULLIF(t.spec,''), NULLIF(t.ingr_code,''), NULLIF(t.ingredient,''), t.code, t.price, true, DATE '2026-07-01', now(), now()
FROM (SELECT DISTINCT ON (code) * FROM tmp_full ORDER BY code, price) t
WHERE NOT EXISTS (SELECT 1 FROM medication_codes m WHERE m.code = t.code);
COMMIT;
