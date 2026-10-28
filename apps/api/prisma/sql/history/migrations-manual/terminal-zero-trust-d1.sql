-- 제로 트러스트 단말 보안 D1 (terminal-zero-trust 설계 §2)
-- 운영 적용: npx prisma db execute --file <this> (db push 금지 — procedure_codes 드리프트)
-- 전부 additive·비파괴(ADD COLUMN/CREATE TABLE IF NOT EXISTS).

-- 1) 단말 자산 레지스트리
CREATE TABLE IF NOT EXISTS "terminal_registry" (
  "id"                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "device_uuid"       VARCHAR(128) NOT NULL UNIQUE,
  "ip_address"        VARCHAR(45),
  "mac_address"       VARCHAR(32),
  "mode"              VARCHAR(8) NOT NULL DEFAULT 'PUBLIC',
  "dedicated_user_id" UUID,
  "location"          VARCHAR(120),
  "label"             VARCHAR(120),
  "beacon_id"         VARCHAR(64),
  "status"            VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
  "lock_timeout_sec"  INTEGER,
  "registered_by_id"  UUID,
  "created_at"        TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at"        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "terminal_registry_device_uuid_idx" ON "terminal_registry" ("device_uuid");
CREATE INDEX IF NOT EXISTS "terminal_registry_ip_address_idx" ON "terminal_registry" ("ip_address");

-- 2) 직원 단말 보안 동의(위치·생체·패스키)
CREATE TABLE IF NOT EXISTS "staff_consent" (
  "id"                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id"           UUID NOT NULL UNIQUE,
  "location_consent"  BOOLEAN NOT NULL DEFAULT false,
  "biometric_consent" BOOLEAN NOT NULL DEFAULT false,
  "passkey_consent"   BOOLEAN NOT NULL DEFAULT false,
  "consent_doc_id"    UUID,
  "consented_at"      TIMESTAMPTZ,
  "revoked_at"        TIMESTAMPTZ,
  "updated_at"        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3) 미퇴근 근태 무결성 보정 컬럼 (§5.3.3)
ALTER TABLE "attendance_records" ADD COLUMN IF NOT EXISTS "provisional" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "attendance_records" ADD COLUMN IF NOT EXISTS "auto_closed_at" TIMESTAMPTZ;
