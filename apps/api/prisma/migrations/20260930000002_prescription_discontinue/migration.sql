-- 처방 중단(DISCONTINUED) — 취소(무효)와 중단(그 시각 이후 멈춤)을 가른다 (2026-09-30)
-- 추가만: 열거형 값 1 · nullable 열 3. 기존 행은 그대로(ACTIVE/CANCELLED).
ALTER TYPE "PrescriptionStatus" ADD VALUE IF NOT EXISTS 'DISCONTINUED';
ALTER TABLE "prescriptions" ADD COLUMN IF NOT EXISTS "discontinued_at" TIMESTAMPTZ;
ALTER TABLE "prescriptions" ADD COLUMN IF NOT EXISTS "discontinued_by" UUID;
ALTER TABLE "prescriptions" ADD COLUMN IF NOT EXISTS "discontinue_reason" TEXT;
