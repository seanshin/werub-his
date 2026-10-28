-- 예약관리 전면 보완 P0 — Appointment 확장 + CONFIRMED 상태 (2026-07-08·멱등)
-- 배포: deploy.sh --schema 가 prisma db push로 반영. 본 SQL은 기록/수동 재적용용.
-- CONFIRMED enum 값 추가(멱등) — ADD VALUE는 트랜잭션 밖 단독 실행
ALTER TYPE "AppointmentStatus" ADD VALUE IF NOT EXISTS 'CONFIRMED';

-- Appointment 컬럼 추가(멱등)
ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS department_name varchar(100),
  ADD COLUMN IF NOT EXISTS room_name varchar(100),
  ADD COLUMN IF NOT EXISTS slot_period varchar(10),
  ADD COLUMN IF NOT EXISTS booked_via varchar(20),
  ADD COLUMN IF NOT EXISTS priority int DEFAULT 0,
  ADD COLUMN IF NOT EXISTS no_show_at timestamptz,
  ADD COLUMN IF NOT EXISTS rescheduled_from_id uuid,
  ADD COLUMN IF NOT EXISTS recurring_group_id uuid,
  ADD COLUMN IF NOT EXISTS reminder_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS confirmed_by uuid;

CREATE INDEX IF NOT EXISTS idx_appointments_recurring ON appointments(recurring_group_id);
