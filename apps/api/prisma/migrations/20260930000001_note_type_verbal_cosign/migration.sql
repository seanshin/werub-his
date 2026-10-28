-- 입원 초진기록(H&P) 구분 · 구두/전화 처방 처방의 사후 확인 (2026-09-30)
-- 추가만(nullable·기본값) — 기존 행은 경과기록(PROGRESS)·미확인(null)
ALTER TABLE "progress_notes" ADD COLUMN IF NOT EXISTS "note_type" VARCHAR(20) NOT NULL DEFAULT 'PROGRESS';
ALTER TABLE "prescriptions" ADD COLUMN IF NOT EXISTS "prescriber_cosigned_at" TIMESTAMPTZ;
ALTER TABLE "prescriptions" ADD COLUMN IF NOT EXISTS "prescriber_cosigned_by" UUID;
-- 대기 목록 조회(구두·전화 · 미확인) — 부분 인덱스
CREATE INDEX IF NOT EXISTS "idx_prescriptions_verbal_cosign_pending"
  ON "prescriptions" ("prescriber_id", "created_by")
  WHERE "order_source" IN ('VERBAL', 'TELEPHONE') AND "prescriber_cosigned_at" IS NULL;
