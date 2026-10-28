-- 임상차트 검수 기록 (verified 임상검수) — db push 차단 환경: 운영 DB에 수동 적용
-- 적용:  docker exec -i docker-postgres-1 psql -U hospital -d hospitalrun < clinical-chart-verifications-20260703.sql
-- 이후 서버에서 npx prisma generate + nest build 필요.

CREATE TABLE IF NOT EXISTS clinical_chart_verifications (
  id                uuid PRIMARY KEY,
  chart_id          varchar(50) NOT NULL,
  status            varchar(20) NOT NULL,
  source_guideline  varchar(200),
  source_version    varchar(50),
  note              text,
  verified_by       uuid NOT NULL,
  verified_by_name  varchar(100) NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ccv_chart_created ON clinical_chart_verifications(chart_id, created_at);
