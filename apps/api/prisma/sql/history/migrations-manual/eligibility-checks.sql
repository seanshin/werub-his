-- 수진자 자격조회 — 추가 전용 DDL (idempotent). prisma db push 무관 드리프트 회피.
CREATE TABLE IF NOT EXISTS eligibility_checks (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id          uuid NOT NULL REFERENCES patients(id),
  insurance_type      "InsuranceType" NOT NULL,
  status              varchar(16) NOT NULL,
  copay_category      varchar(24) NOT NULL,
  coverage_start_date timestamptz,
  coverage_end_date   timestamptz,
  special_exemption   varchar(40),
  exemption_expiry    timestamptz,
  source              varchar(12) NOT NULL,
  visit_type          varchar(12),
  raw_response        jsonb,
  message             varchar(200),
  checked_by_id       uuid,
  queried_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS eligibility_checks_patient_id_queried_at_idx ON eligibility_checks(patient_id, queried_at);

ALTER TABLE waiting_queue ADD COLUMN IF NOT EXISTS eligibility_status varchar(16);
ALTER TABLE waiting_queue ADD COLUMN IF NOT EXISTS eligibility_check_id uuid;
ALTER TABLE waiting_queue ADD COLUMN IF NOT EXISTS identity_verified_at timestamptz;

ALTER TABLE encounters ADD COLUMN IF NOT EXISTS eligibility_check_id uuid;
