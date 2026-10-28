-- 정정 사유(2026-10-03 · 선택 입력) — 서명본 보존 행에 · null = 사유 미입력
-- AlterTable
ALTER TABLE "signed_record_versions" ADD COLUMN     "reason" VARCHAR(500);
