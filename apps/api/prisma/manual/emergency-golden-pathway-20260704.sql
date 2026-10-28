-- 응급실 골든타임 크리티컬 패스웨이(STEMI/뇌졸중/패혈증) — 신규 테이블(가산적·데이터 손실 0)
-- 적용:  docker exec -i docker-postgres-1 psql -U hospital -d hospitalrun < emergency-golden-pathway-20260704.sql
-- 이후 서버 npx prisma generate + nest build.

CREATE TABLE IF NOT EXISTS emergency_golden_pathways (
  id                     uuid PRIMARY KEY,
  visit_id               uuid,
  patient_id             uuid NOT NULL,
  pathway_type           varchar(20) NOT NULL,
  primary_metric         varchar(40) NOT NULL,
  target_minutes         integer NOT NULL,
  milestones             jsonb NOT NULL,
  status                 varchar(20) NOT NULL DEFAULT 'ACTIVE',
  activated_by           uuid NOT NULL,
  activated_at           timestamptz NOT NULL DEFAULT now(),
  completed_at           timestamptz,
  primary_metric_minutes integer,
  notes                  text
);
CREATE INDEX IF NOT EXISTS idx_egp_status ON emergency_golden_pathways(status);
CREATE INDEX IF NOT EXISTS idx_egp_patient ON emergency_golden_pathways(patient_id);
