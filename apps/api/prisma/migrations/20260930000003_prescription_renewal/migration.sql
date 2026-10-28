-- 지속 처방 갱신 — 갱신 처방이 원처방을 가리킨다 (2026-09-30) · 추가만(nullable 열 1·인덱스 1)
ALTER TABLE "prescriptions" ADD COLUMN IF NOT EXISTS "renewed_from_id" UUID;
CREATE INDEX IF NOT EXISTS "idx_prescriptions_renewed_from" ON "prescriptions" ("renewed_from_id");
