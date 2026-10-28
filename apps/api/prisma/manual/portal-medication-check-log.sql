-- F-2 복약 리마인더 발송·체크 로그 (patient-portal-enhancement 설계 §3.1)
-- 참고: schema.prisma의 MedicationCheckLog와 동일 — 신규 테이블이라 `prisma db push`(무플래그)로도 생성됨.
--       본 파일은 수동 적용/감사 기록용.
CREATE TABLE IF NOT EXISTS medication_check_logs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id      uuid NOT NULL,
  prescription_id uuid NOT NULL,
  slot_date       date NOT NULL,
  slot            varchar(20) NOT NULL,          -- 정본 4종: 아침 식후|점심 식후|저녁 식후|취침 전 (+모바일 'manual')
  reminded_at     timestamptz,                   -- 발송 시각(발송 기록 겸용·멱등)
  taken           boolean,                       -- null=미체크
  checked_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT medication_check_logs_rx_slot_uq UNIQUE (prescription_id, slot_date, slot)
);
CREATE INDEX IF NOT EXISTS idx_mcl_patient_date ON medication_check_logs (patient_id, slot_date);
