-- 예약관리 보완 P3b — 대기자명단(AppointmentWaitlist) (2026-07-08·멱등)
-- 배포: deploy.sh --schema 가 prisma db push로 반영. 본 SQL은 기록/수동 재적용용.
CREATE TABLE IF NOT EXISTS appointment_waitlists (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id      uuid NOT NULL REFERENCES patients(id),
  doctor_id       uuid,
  department_name varchar(100) NOT NULL,
  preferred_from  timestamptz,
  preferred_to    timestamptz,
  status          varchar(20) NOT NULL DEFAULT 'WAITING',
  notified_at     timestamptz,
  note            text,
  created_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_appointment_waitlists_doctor_status ON appointment_waitlists(doctor_id, status);
CREATE INDEX IF NOT EXISTS idx_appointment_waitlists_dept_status ON appointment_waitlists(department_name, status);
CREATE INDEX IF NOT EXISTS idx_appointment_waitlists_patient ON appointment_waitlists(patient_id);
