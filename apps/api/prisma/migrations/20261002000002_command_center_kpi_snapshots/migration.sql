-- 통합 상황판 지표 이력(2026-10-02 · 상황판 디자인 F 추세선) — 5분 칸마다 한 행 · 실패 섹션 지표는 null · 보존 30일
-- CreateTable
CREATE TABLE "command_center_kpi_snapshots" (
    "id" UUID NOT NULL,
    "bucket_at" TIMESTAMPTZ NOT NULL,
    "taken_at" TIMESTAMPTZ NOT NULL,
    "values" JSONB NOT NULL,
    "failed_sections" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "command_center_kpi_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "command_center_kpi_snapshots_bucket_at_key" ON "command_center_kpi_snapshots"("bucket_at");

