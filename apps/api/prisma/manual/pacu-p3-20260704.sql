-- PACU P3: 구조화 합병증 + 통증 재평가 추이(nullable·가산적·데이터 손실 0)
-- 적용:  docker exec -i docker-postgres-1 psql -U hospital -d hospitalrun < pacu-p3-20260704.sql
-- 이후 서버 npx prisma generate + nest build.

ALTER TABLE pacu_records ADD COLUMN IF NOT EXISTS complications     jsonb;
ALTER TABLE pacu_records ADD COLUMN IF NOT EXISTS pain_assessments  jsonb;
