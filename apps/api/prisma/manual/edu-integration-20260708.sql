-- edu 연동 P1-5/P1-7/P0-3 스키마 (2026-07-08·멱등)
-- 배포: deploy.sh --schema (prisma db push). 본 SQL은 기록/수동 재적용용.
-- P1-7 보고라인
ALTER TABLE staff ADD COLUMN IF NOT EXISTS manager_staff_id uuid REFERENCES staff(id);
CREATE INDEX IF NOT EXISTS idx_staff_manager ON staff(manager_staff_id);
-- P0-3 이수기록 멱등키
ALTER TABLE staff_educations ADD COLUMN IF NOT EXISTS idempotency_key varchar(120);
CREATE UNIQUE INDEX IF NOT EXISTS staff_educations_idempotency_key_key ON staff_educations(idempotency_key);
