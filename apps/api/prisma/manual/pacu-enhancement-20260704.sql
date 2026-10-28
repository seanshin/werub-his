-- PACU 보강: PONV·PADSS·구조화 핸드오프 컬럼(전부 nullable·가산적·데이터 손실 0)
-- 적용:  docker exec -i docker-postgres-1 psql -U hospital -d hospitalrun < pacu-enhancement-20260704.sql
-- 이후 서버 npx prisma generate + nest build.

ALTER TABLE pacu_records ADD COLUMN IF NOT EXISTS ponv_score        integer;
ALTER TABLE pacu_records ADD COLUMN IF NOT EXISTS ponv_management   varchar(200);
ALTER TABLE pacu_records ADD COLUMN IF NOT EXISTS padss_score       integer;
ALTER TABLE pacu_records ADD COLUMN IF NOT EXISTS padss_detail      jsonb;
ALTER TABLE pacu_records ADD COLUMN IF NOT EXISTS arrival_handoff   jsonb;
ALTER TABLE pacu_records ADD COLUMN IF NOT EXISTS discharge_handoff jsonb;
