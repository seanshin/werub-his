-- 감염관리 보강(P1~P3) — 신규 테이블 3(가산적·데이터 손실 0)
-- 적용:  docker exec -i docker-postgres-1 psql -U hospital -d hospitalrun < infection-control-20260704.sql
-- 이후 서버 npx prisma generate + nest build.

CREATE TABLE IF NOT EXISTS hai_cases (
  id uuid PRIMARY KEY, patient_id uuid NOT NULL,
  hai_type varchar(20) NOT NULL, organism varchar(200),
  device_type varchar(50), device_inserted_at timestamptz, device_days integer,
  site varchar(100), onset_at timestamptz NOT NULL, ward varchar(50),
  criteria_met text, status varchar(20) NOT NULL DEFAULT 'ACTIVE',
  reported_to_konis boolean NOT NULL DEFAULT false, detected_by uuid, notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_hai_type_status ON hai_cases(hai_type, status);
CREATE INDEX IF NOT EXISTS idx_hai_patient ON hai_cases(patient_id);

CREATE TABLE IF NOT EXISTS mdro_registry (
  id uuid PRIMARY KEY, patient_id uuid NOT NULL, organism varchar(200) NOT NULL,
  mdro_type varchar(20) NOT NULL, mechanism varchar(100), specimen varchar(50), ward varchar(50),
  detected_at timestamptz NOT NULL, cleared_at timestamptz, isolation_type varchar(50),
  active boolean NOT NULL DEFAULT true, notes text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mdro_type_active ON mdro_registry(mdro_type, active);
CREATE INDEX IF NOT EXISTS idx_mdro_patient ON mdro_registry(patient_id);

CREATE TABLE IF NOT EXISTS notifiable_disease_reports (
  id uuid PRIMARY KEY, patient_id uuid NOT NULL, disease_name varchar(100) NOT NULL,
  disease_grade varchar(10), kcdc_code varchar(20), diagnosis_type varchar(30),
  status varchar(20) NOT NULL DEFAULT 'DRAFT', submitted_at timestamptz, ack_at timestamptz,
  report_ref varchar(50), error_log text, reported_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ndr_status ON notifiable_disease_reports(status);
CREATE INDEX IF NOT EXISTS idx_ndr_patient ON notifiable_disease_reports(patient_id);
