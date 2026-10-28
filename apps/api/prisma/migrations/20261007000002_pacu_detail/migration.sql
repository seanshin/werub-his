-- 회복실 상세화(2026-10-07) — 점수 이력·섭취배설·간호기록·마취과 퇴실 확인·지연 사유·베이 (전부 NULL 허용 · 기존 행 무변경)
ALTER TABLE "pacu_records" ADD COLUMN IF NOT EXISTS "score_history" JSONB;
ALTER TABLE "pacu_records" ADD COLUMN IF NOT EXISTS "io_entries" JSONB;
ALTER TABLE "pacu_records" ADD COLUMN IF NOT EXISTS "nursing_notes" JSONB;
ALTER TABLE "pacu_records" ADD COLUMN IF NOT EXISTS "anesthesia_sign_off_at" TIMESTAMPTZ;
ALTER TABLE "pacu_records" ADD COLUMN IF NOT EXISTS "anesthesia_sign_off_by_id" UUID;
ALTER TABLE "pacu_records" ADD COLUMN IF NOT EXISTS "delay_reason" VARCHAR(30);
ALTER TABLE "pacu_records" ADD COLUMN IF NOT EXISTS "delay_note" VARCHAR(300);
ALTER TABLE "pacu_records" ADD COLUMN IF NOT EXISTS "bay_code" VARCHAR(10);
