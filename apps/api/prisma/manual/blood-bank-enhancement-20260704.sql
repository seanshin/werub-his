-- 혈액은행 보강(P1~P3) — 신규 테이블 5 + 기존 컬럼(nullable/기본값·가산적·데이터 손실 0)
-- 적용:  docker exec -i docker-postgres-1 psql -U hospital -d hospitalrun < blood-bank-enhancement-20260704.sql
-- 이후 서버 npx prisma generate + nest build.

-- P1: 환자 혈액형
CREATE TABLE IF NOT EXISTS patient_blood_typings (
  id uuid PRIMARY KEY, patient_id uuid NOT NULL UNIQUE,
  abo varchar(3) NOT NULL, rh varchar(3) NOT NULL, abo_confirm varchar(3),
  method varchar(30), antibody_screen varchar(10), typed_by uuid,
  typed_at timestamptz NOT NULL DEFAULT now(), notes text
);

-- P1: 환자 불규칙항체
CREATE TABLE IF NOT EXISTS patient_antibodies (
  id uuid PRIMARY KEY, patient_id uuid NOT NULL,
  antibody varchar(30) NOT NULL, significance varchar(20), identified_by uuid,
  identified_at timestamptz NOT NULL DEFAULT now(), notes text
);
CREATE INDEX IF NOT EXISTS idx_pab_patient ON patient_antibodies(patient_id);

-- P1: 대량수혈 프로토콜
CREATE TABLE IF NOT EXISTS massive_transfusion_protocols (
  id uuid PRIMARY KEY, patient_id uuid NOT NULL, activated_by uuid NOT NULL,
  activated_at timestamptz NOT NULL DEFAULT now(), indication varchar(50) NOT NULL,
  ratio varchar(20), packs_issued integer NOT NULL DEFAULT 0,
  status varchar(20) NOT NULL DEFAULT 'ACTIVE', deactivated_by uuid, deactivated_at timestamptz, notes text
);
CREATE INDEX IF NOT EXISTS idx_mtp_patient_status ON massive_transfusion_protocols(patient_id, status);

-- P2: 수혈반응 보고
CREATE TABLE IF NOT EXISTS transfusion_reaction_reports (
  id uuid PRIMARY KEY, transfusion_id uuid NOT NULL UNIQUE, patient_id uuid NOT NULL,
  reaction_type varchar(30) NOT NULL, severity varchar(20) NOT NULL, signs text, workup jsonb,
  management_note text, reported_to_blood_center boolean NOT NULL DEFAULT false, reported_at timestamptz,
  outcome varchar(30), reported_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_trr_patient ON transfusion_reaction_reports(patient_id);

-- P3: 혈액원 발주
CREATE TABLE IF NOT EXISTS blood_reorder_requests (
  id uuid PRIMARY KEY, product_type varchar(30) NOT NULL, blood_type varchar(5) NOT NULL,
  units integer NOT NULL, urgency varchar(20) NOT NULL DEFAULT 'ROUTINE', supplier_name varchar(100),
  status varchar(20) NOT NULL DEFAULT 'REQUESTED', requested_by uuid NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(), notes text
);
CREATE INDEX IF NOT EXISTS idx_brr_status ON blood_reorder_requests(status);

-- 기존 컬럼 추가
ALTER TABLE blood_products ADD COLUMN IF NOT EXISTS irradiated boolean NOT NULL DEFAULT false;
ALTER TABLE blood_products ADD COLUMN IF NOT EXISTS leukoreduced boolean NOT NULL DEFAULT false;
ALTER TABLE blood_products ADD COLUMN IF NOT EXISTS cmv_negative boolean NOT NULL DEFAULT false;
ALTER TABLE blood_products ADD COLUMN IF NOT EXISTS washed boolean NOT NULL DEFAULT false;
ALTER TABLE blood_products ADD COLUMN IF NOT EXISTS discard_reason varchar(200);
ALTER TABLE transfusion_orders ADD COLUMN IF NOT EXISTS consent_id uuid;
ALTER TABLE blood_transfusions ADD COLUMN IF NOT EXISTS emergency_release boolean NOT NULL DEFAULT false;
ALTER TABLE blood_transfusions ADD COLUMN IF NOT EXISTS emergency_reason varchar(300);
