-- 결정 이력 원장(덧붙이기만) — 2026-10-11
CREATE TABLE "decision_log_entries" (
    "id" UUID NOT NULL,
    "decision_key" VARCHAR(120) NOT NULL,
    "kind" VARCHAR(30) NOT NULL,
    "choice" VARCHAR(80),
    "prev_choice" VARCHAR(80),
    "basis_ref" TEXT,
    "authority_claim" TEXT,
    "actor_user_id" UUID,
    "source_key" VARCHAR(160),
    "committee_decision_id" UUID,
    "detail" JSONB,
    "occurred_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "decision_log_entries_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "decision_log_entries_decision_key_occurred_at_idx" ON "decision_log_entries"("decision_key", "occurred_at");
CREATE INDEX "decision_log_entries_occurred_at_idx" ON "decision_log_entries"("occurred_at");
CREATE INDEX "decision_log_entries_kind_idx" ON "decision_log_entries"("kind");

-- 🔴 원장 시작 전 기록 이관 — 지금 남아 있는 결정 기록 한 행씩(그 이전 이력은 남아 있지 않다는 사실을 detail 에 적는다)
INSERT INTO "decision_log_entries" ("id", "decision_key", "kind", "choice", "basis_ref", "authority_claim", "actor_user_id", "detail", "occurred_at")
SELECT gen_random_uuid(),
       substring(c.key from 10),
       'BACKFILL',
       left(c.value->>'choice', 80),
       c.value->>'legalReviewRef',
       c.value->>'authorityClaim',
       CASE WHEN (c.value->>'decidedByUserId') ~ '^[0-9a-f-]{36}$' THEN (c.value->>'decidedByUserId')::uuid ELSE NULL END,
       jsonb_build_object('note', '원장 시작 전 기록을 옮겼다 — 이 기록 이전의 선택 이력은 남아 있지 않다',
                          'seeded', (coalesce(c.value->>'legalReviewRef','') || ' ' || coalesce(c.value->>'authorityClaim','') || ' ' || coalesce(c.value->>'note','')) ~* 'DEV-SEED|개발 시드',
                          'applied', c.value->'applied', 'appliedDetail', c.value->'appliedDetail'),
       coalesce((c.value->>'decidedAt')::timestamptz, c.updated_at, c.created_at)
FROM "system_configs" c
WHERE c.key LIKE 'decision.%' AND c.key NOT LIKE 'decision.attachments.%' AND jsonb_typeof(c.value) = 'object' AND c.value ? 'choice';
