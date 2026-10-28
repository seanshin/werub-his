-- AlterTable
-- 기존 행은 마이그레이션 시각으로 시작한다(언제 바뀌었는지 모른다 — 다음 증분 동기화 한 번은 전 패널을 다시 싣는다 · 안전측)
ALTER TABLE "lab_test_codes" ADD COLUMN     "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;
