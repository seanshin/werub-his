-- pathology 리포트 TNM 분리 컬럼(pT/pN/pM) 영속화 — 가산·nullable
-- ihc·molecular_test·tnm_stage·tumor_grade·margin_status 는 기존 컬럼(매핑만 누락이었음)
ALTER TABLE pathology_reports ADD COLUMN IF NOT EXISTS tnm_t VARCHAR(10);
ALTER TABLE pathology_reports ADD COLUMN IF NOT EXISTS tnm_n VARCHAR(10);
ALTER TABLE pathology_reports ADD COLUMN IF NOT EXISTS tnm_m VARCHAR(10);
