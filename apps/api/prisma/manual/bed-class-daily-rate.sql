-- 임상무결성 백로그 #6 — 병상 등급별 입원료 일당.
-- Bed 에 등급(bed_class) 추가. 비파괴 ADD COLUMN(기본 'GENERAL' → 기존 병상은 일반실로 분류).
-- 등급별 일당은 config inpatient.bedRates(JSON: {"GENERAL":50000,"SEMI_PRIVATE":80000,"PRIVATE":120000}).
--   미설정 시 inpatient.dailyRate → ₩50,000 로 폴백(현행 동작 유지·무회귀).
ALTER TABLE beds ADD COLUMN IF NOT EXISTS bed_class varchar(20) NOT NULL DEFAULT 'GENERAL';
