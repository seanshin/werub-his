-- 수술방 차트(2026-10-05) — 수술 중 기록 원장(덧붙이기만 · 무효 처리) · 사람×기기×역할 배치
-- CreateTable
CREATE TABLE "intraop_events" (
    "id" UUID NOT NULL,
    "surgery_id" UUID NOT NULL,
    "kind" VARCHAR(16) NOT NULL,
    "occurred_at" TIMESTAMPTZ NOT NULL,
    "occurred_at_source" VARCHAR(16) NOT NULL,
    "payload" JSONB NOT NULL,
    "recorded_by_id" UUID NOT NULL,
    "recorded_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voided_at" TIMESTAMPTZ,
    "voided_by_id" UUID,
    "void_reason" TEXT,

    CONSTRAINT "intraop_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "or_chart_layouts" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "device_profile" VARCHAR(16) NOT NULL,
    "or_role" VARCHAR(16) NOT NULL,
    "layout" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "or_chart_layouts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "intraop_events_surgery_id_occurred_at_idx" ON "intraop_events"("surgery_id", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "or_chart_layouts_user_id_device_profile_or_role_key" ON "or_chart_layouts"("user_id", "device_profile", "or_role");
