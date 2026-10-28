-- 검수 고도화(4-eyes·정의 해시) — def_hash 컬럼 추가(가산적·무손실)
-- 적용:  docker exec -i docker-postgres-1 psql -U hospital -d hospitalrun < clinical-chart-verifications-defhash-20260703.sql
ALTER TABLE clinical_chart_verifications ADD COLUMN IF NOT EXISTS def_hash varchar(64);
