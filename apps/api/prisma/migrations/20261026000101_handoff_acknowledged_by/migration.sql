-- 2026-10-26 v4.123.0 — 인수 확인한 사람(관리자 대리 확인 구별) · 추가만(운영 적용본 prisma/sql/ops/2026-10-26-handoff-acknowledged-by.sql)
-- AlterTable
ALTER TABLE "clinical_handoffs" ADD COLUMN "acknowledged_by" UUID;
