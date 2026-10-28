-- 만성질환 시계열 관찰값(chronic_observations) — 당뇨 등 추이
-- 적용: docker exec -i docker-postgres-1 psql -U hospital -d hospitalrun < this.sql
-- 안전: IF NOT EXISTS·무중단·재실행 무해. ⚠️ 배포 시 서버 prisma generate 필수.
CREATE TABLE IF NOT EXISTS chronic_observations (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id   UUID NOT NULL,
  code         VARCHAR(20) NOT NULL,
  value        NUMERIC(8,2) NOT NULL,
  unit         VARCHAR(10) NOT NULL,
  measured_at  TIMESTAMPTZ NOT NULL,
  source       VARCHAR(12) NOT NULL DEFAULT 'CLINIC',
  normal_min   NUMERIC(8,2),
  normal_max   NUMERIC(8,2),
  flag         VARCHAR(2),
  encounter_id UUID,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fk_chronic_obs_patient FOREIGN KEY (patient_id) REFERENCES patients(id)
);
CREATE INDEX IF NOT EXISTS idx_chronic_obs_patient_code_time ON chronic_observations (patient_id, code, measured_at);
