-- 진단검사 보드 보강(P1~P3) — DiagnosticTest 가산 필드(전부 nullable/기본값·데이터 손실 0)
-- 적용:  docker exec -i docker-postgres-1 psql -U hospital -d hospitalrun < diagnostics-board-enhancement-20260704.sql
-- 이후 서버 npx prisma generate + nest build.

ALTER TABLE diagnostic_tests ADD COLUMN IF NOT EXISTS priority varchar(20) NOT NULL DEFAULT 'ROUTINE';
ALTER TABLE diagnostic_tests ADD COLUMN IF NOT EXISTS target_tat_minutes integer;
ALTER TABLE diagnostic_tests ADD COLUMN IF NOT EXISTS critical_flag boolean NOT NULL DEFAULT false;
ALTER TABLE diagnostic_tests ADD COLUMN IF NOT EXISTS critical_note varchar(300);
ALTER TABLE diagnostic_tests ADD COLUMN IF NOT EXISTS room_name varchar(50);
ALTER TABLE diagnostic_tests ADD COLUMN IF NOT EXISTS equipment_name varchar(100);
ALTER TABLE diagnostic_tests ADD COLUMN IF NOT EXISTS order_id uuid;
ALTER TABLE diagnostic_tests ADD COLUMN IF NOT EXISTS reviewed_by uuid;
ALTER TABLE diagnostic_tests ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;
ALTER TABLE diagnostic_tests ADD COLUMN IF NOT EXISTS review_status varchar(20);
ALTER TABLE diagnostic_tests ADD COLUMN IF NOT EXISTS delta_flag boolean NOT NULL DEFAULT false;
ALTER TABLE diagnostic_tests ADD COLUMN IF NOT EXISTS delta_note varchar(300);

CREATE INDEX IF NOT EXISTS idx_dt_review_status ON diagnostic_tests(review_status);
