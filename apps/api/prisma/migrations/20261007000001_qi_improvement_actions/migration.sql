-- 질 개선 활동(PDCA · 2026-10-07) — CPOE 질 지표 신호 → 계획·실행·효과 확인·표준화 · 경과는 덧붙이기만
-- CreateTable
CREATE TABLE "qi_improvement_actions" (
    "id" UUID NOT NULL,
    "indicator_key" VARCHAR(40) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "problem" TEXT NOT NULL,
    "root_cause" TEXT,
    "plan" TEXT NOT NULL,
    "owner_id" UUID,
    "due_date" DATE,
    "status" VARCHAR(16) NOT NULL DEFAULT 'PLAN',
    "trigger_period" VARCHAR(20),
    "baseline_from" TIMESTAMPTZ NOT NULL,
    "baseline_to" TIMESTAMPTZ NOT NULL,
    "baseline_numerator" INTEGER NOT NULL,
    "baseline_denominator" INTEGER NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "closed_at" TIMESTAMPTZ,

    CONSTRAINT "qi_improvement_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qi_improvement_events" (
    "id" UUID NOT NULL,
    "action_id" UUID NOT NULL,
    "kind" VARCHAR(16) NOT NULL,
    "from_status" VARCHAR(16),
    "to_status" VARCHAR(16),
    "note" TEXT,
    "check_from" TIMESTAMPTZ,
    "check_to" TIMESTAMPTZ,
    "check_numerator" INTEGER,
    "check_denominator" INTEGER,
    "actor_id" UUID NOT NULL,
    "at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "qi_improvement_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "qi_improvement_actions_indicator_key_status_idx" ON "qi_improvement_actions"("indicator_key", "status");

-- CreateIndex
CREATE INDEX "qi_improvement_events_action_id_at_idx" ON "qi_improvement_events"("action_id", "at");

-- AddForeignKey
ALTER TABLE "qi_improvement_events" ADD CONSTRAINT "qi_improvement_events_action_id_fkey" FOREIGN KEY ("action_id") REFERENCES "qi_improvement_actions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
