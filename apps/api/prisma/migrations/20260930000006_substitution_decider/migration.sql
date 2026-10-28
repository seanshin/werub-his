-- 대체조제 판정자·시각·사유(2026-09-30) · 추가만(nullable 열 3) — prisma migrate diff 출력 그대로
-- AlterTable
ALTER TABLE "generic_substitutions" ADD COLUMN     "decided_at" TIMESTAMPTZ,
ADD COLUMN     "decided_by_id" UUID,
ADD COLUMN     "decision_note" TEXT;

