-- PACU 평가 시각·평가자(2026-09-30) · 추가만(nullable 열 6) — prisma migrate diff 출력 그대로
-- AlterTable
ALTER TABLE "pacu_records" ADD COLUMN     "aldrete_assessed_at" TIMESTAMPTZ,
ADD COLUMN     "aldrete_assessed_by_id" UUID,
ADD COLUMN     "padss_assessed_at" TIMESTAMPTZ,
ADD COLUMN     "padss_assessed_by_id" UUID,
ADD COLUMN     "ponv_assessed_at" TIMESTAMPTZ,
ADD COLUMN     "ponv_assessed_by_id" UUID;

