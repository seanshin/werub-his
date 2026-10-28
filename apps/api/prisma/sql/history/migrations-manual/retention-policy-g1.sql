-- 데이터 보유/파기 정책 G1 (security-governance)
-- 운영 적용: npx prisma db execute (db push 금지). additive·비파괴.
CREATE TABLE IF NOT EXISTS "retention_policy" (
  "id"              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "resource_type"   VARCHAR(40) NOT NULL UNIQUE,
  "retention_days"  INTEGER NOT NULL,
  "legal_min_days"  INTEGER NOT NULL DEFAULT 0,
  "action"          VARCHAR(16) NOT NULL DEFAULT 'REPORT_ONLY',
  "legal_confirmed" BOOLEAN NOT NULL DEFAULT false,
  "enabled"         BOOLEAN NOT NULL DEFAULT true,
  "description"     VARCHAR(200),
  "last_run_at"     TIMESTAMPTZ,
  "last_candidates" INTEGER,
  "created_at"      TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at"      TIMESTAMPTZ NOT NULL DEFAULT now()
);
