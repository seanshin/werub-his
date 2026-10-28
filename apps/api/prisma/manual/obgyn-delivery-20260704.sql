-- 산과 분만 보강(P1~P3) — 신규 테이블 3(가산적·데이터 손실 0)
-- 적용:  docker exec -i docker-postgres-1 psql -U hospital -d hospitalrun < obgyn-delivery-20260704.sql
-- 이후 서버 npx prisma generate + nest build.

CREATE TABLE IF NOT EXISTS delivery_records (
  id uuid PRIMARY KEY, patient_id uuid NOT NULL, encounter_id uuid,
  status varchar(20) NOT NULL DEFAULT 'IN_LABOR',
  delivery_type varchar(20), gestational_weeks varchar(10),
  labor_onset_at timestamptz, delivered_at timestamptz,
  stage1_minutes integer, stage2_minutes integer, stage3_minutes integer,
  anesthesia varchar(30), blood_loss_ml integer, indication varchar(200), complications text,
  delivered_by uuid, lochia varchar(100), fundus_status varchar(100), wound_status varchar(100),
  breastfeeding varchar(50), notes text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dr_status ON delivery_records(status);
CREATE INDEX IF NOT EXISTS idx_dr_patient ON delivery_records(patient_id);

CREATE TABLE IF NOT EXISTS newborn_records (
  id uuid PRIMARY KEY, delivery_id uuid NOT NULL, patient_id uuid,
  birth_at timestamptz NOT NULL, sex varchar(10) NOT NULL,
  weight_g integer, length_cm numeric(4,1), head_circ_cm numeric(4,1),
  apgar_1 integer, apgar_5 integer, apgar_10 integer,
  resuscitation varchar(100), nicu_admission boolean NOT NULL DEFAULT false,
  feeding_type varchar(30), notes text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_nb_delivery ON newborn_records(delivery_id);

CREATE TABLE IF NOT EXISTS labor_progress_records (
  id uuid PRIMARY KEY, delivery_id uuid NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  cervical_dilation integer, station integer, contraction_freq integer, contraction_dur integer,
  fetal_heart_rate integer, note varchar(200), recorded_by uuid
);
CREATE INDEX IF NOT EXISTS idx_lpr_delivery ON labor_progress_records(delivery_id, recorded_at);
