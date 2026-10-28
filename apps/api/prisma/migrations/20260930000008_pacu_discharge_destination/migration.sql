-- PACU 퇴실 목적지(2026-09-30) · 추가만(nullable 열 1) — prisma migrate diff 출력 그대로
-- AlterTable
ALTER TABLE "pacu_records" ADD COLUMN     "destination" JSONB;

