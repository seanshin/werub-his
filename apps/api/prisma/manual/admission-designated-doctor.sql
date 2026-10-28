-- 입원별 추가 지정의(담당 의료군) — 특수환자에 주치의 외 책임의 배치
-- 재실행 무해
CREATE TABLE IF NOT EXISTS admission_designated_doctors (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admission_id UUID NOT NULL,
  doctor_id    UUID NOT NULL,
  reason       VARCHAR(200),
  assigned_by  UUID NOT NULL,
  active       BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_admission_doctor UNIQUE (admission_id, doctor_id)
);
CREATE INDEX IF NOT EXISTS idx_admission_designated_active ON admission_designated_doctors (admission_id, active);
