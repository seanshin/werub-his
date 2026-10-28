-- 앰비언트 진료 스크라이브 P0 (additive·비파괴) — 2026-07-08
-- 적용: psql "$DATABASE_URL" -f apps/api/prisma/manual/scribe-p0-20260708.sql
-- (npx prisma db push --accept-data-loss 금지 — manual SQL로 안전 적용, 배포 후 서버 `prisma generate` 필수)
-- 롤백: additive라 컬럼/테이블 잔존 무해, 동작은 config `scribe.enabled=false`로 즉시 회귀.

-- 1) ConsentType에 RECORDING 추가 (PG12+ · autocommit에서 실행)
ALTER TYPE "ConsentType" ADD VALUE IF NOT EXISTS 'RECORDING';

-- 2) 신규 enum 타입
DO $$ BEGIN
  CREATE TYPE "ScribeSessionStatus" AS ENUM
    ('RECORDING','UPLOADED','TRANSCRIBING','TRANSCRIBED','DRAFTED','APPLIED','FAILED','DELETED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "ScribeVoiceProfileStatus" AS ENUM ('ACTIVE','REVOKED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 3) Encounter 프로비넌스 컬럼(additive)
ALTER TABLE "encounters" ADD COLUMN IF NOT EXISTS "ai_scribed" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "encounters" ADD COLUMN IF NOT EXISTS "scribe_session_id" UUID;
ALTER TABLE "encounters" ADD COLUMN IF NOT EXISTS "ai_edit_distance" INTEGER;

-- 4) scribe_sessions (id는 Prisma가 앱단에서 생성 — DB default 불필요)
CREATE TABLE IF NOT EXISTS "scribe_sessions" (
  "id"               UUID PRIMARY KEY,
  "encounter_id"     UUID NOT NULL,
  "patient_id"       UUID NOT NULL,
  "doctor_id"        UUID NOT NULL,
  "consent_id"       UUID,
  "status"           "ScribeSessionStatus" NOT NULL DEFAULT 'RECORDING',
  "audio_path"       TEXT,
  "audio_deleted_at" TIMESTAMPTZ,
  "legal_hold"       BOOLEAN NOT NULL DEFAULT false,
  "transcript"       JSONB,
  "stt_tier"         VARCHAR(16),
  "resolver_kind"    VARCHAR(16),
  "job_id"           VARCHAR(64),
  "draft_snapshot"   JSONB,
  "ai_model"         VARCHAR(64),
  "ai_prompt_version" VARCHAR(32),
  "created_at"       TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at"       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "scribe_sessions_encounter_id_idx" ON "scribe_sessions" ("encounter_id");
CREATE INDEX IF NOT EXISTS "scribe_sessions_doctor_id_idx"    ON "scribe_sessions" ("doctor_id");

-- 5) scribe_voice_profiles
CREATE TABLE IF NOT EXISTS "scribe_voice_profiles" (
  "id"           UUID PRIMARY KEY,
  "doctor_id"    UUID NOT NULL UNIQUE,
  "embedding"    JSONB,
  "sample_count" INTEGER NOT NULL DEFAULT 0,
  "consent_at"   TIMESTAMPTZ NOT NULL,
  "status"       "ScribeVoiceProfileStatus" NOT NULL DEFAULT 'ACTIVE',
  "revoked_at"   TIMESTAMPTZ,
  "created_at"   TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at"   TIMESTAMPTZ NOT NULL DEFAULT now()
);
