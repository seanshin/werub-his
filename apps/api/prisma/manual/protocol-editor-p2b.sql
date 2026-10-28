-- 프로토콜 편집기(P2b) — 버전-행 분리. db push 미실행 → 수동 적용.
-- 기존 데이터는 code별 1행(version=1)이라 unique 전환 안전.
ALTER TABLE protocol_templates ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE protocol_templates ADD COLUMN IF NOT EXISTS published_at timestamptz;
ALTER TABLE protocol_templates ADD COLUMN IF NOT EXISTS published_by uuid;

-- code 단독 unique → (code, version) 복합 unique 로 전환(버전별 행 허용)
ALTER TABLE protocol_templates DROP CONSTRAINT IF EXISTS protocol_templates_code_key;
DROP INDEX IF EXISTS protocol_templates_code_key;
CREATE UNIQUE INDEX IF NOT EXISTS protocol_templates_code_version_key ON protocol_templates(code, version);
CREATE INDEX IF NOT EXISTS protocol_templates_code_status_idx ON protocol_templates(code, status);

-- 기존 시드 행을 발행 완료 상태로 표기(ACTIVE인데 published_at 미설정 보정)
UPDATE protocol_templates SET published_at = created_at WHERE status = 'ACTIVE' AND published_at IS NULL;
