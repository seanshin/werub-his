-- 임상차트 결과 영속 (Track5 증분5) — db push 차단 환경: 운영 DB에 수동 적용
-- 적용:  docker exec -i <hospitalrun-postgres> psql -U hospital -d hospitalrun < clinical-chart-results-20260630.sql
-- 이후 서버에서 npx prisma generate + nest build 필요.

CREATE TABLE IF NOT EXISTS clinical_chart_results (
  id                 uuid PRIMARY KEY,
  patient_id         uuid NOT NULL,
  encounter_id       uuid,
  chart_id           varchar(50) NOT NULL,
  chart_name         varchar(200) NOT NULL,
  archetype          varchar(20) NOT NULL,
  source_version     varchar(50),
  inputs             jsonb NOT NULL,
  result_label       varchar(200),
  result_level       varchar(20),
  result_value       numeric(12,3),
  recommendation     text,
  flags              text[] NOT NULL DEFAULT '{}',
  performed_by       uuid NOT NULL,
  performed_by_name  varchar(100) NOT NULL,
  used_tool_version  varchar(20) NOT NULL,
  performed_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ccr_patient_chart ON clinical_chart_results(patient_id, chart_id);
CREATE INDEX IF NOT EXISTS idx_ccr_encounter ON clinical_chart_results(encounter_id);
