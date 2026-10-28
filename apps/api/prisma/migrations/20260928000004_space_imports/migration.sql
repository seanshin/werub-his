-- 공간 도면 가져오기(spatial-flow-vision-3d P1) — 테이블 1 추가. 기존 테이블·행 무변경.

-- CreateTable
CREATE TABLE "space_imports" (
    "id" UUID NOT NULL,
    "schema" VARCHAR(30) NOT NULL,
    "source" VARCHAR(20) NOT NULL,
    "status" VARCHAR(12) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "payload" JSONB NOT NULL,
    "summary" JSONB NOT NULL,
    "created_by_id" UUID,
    "confirmed_by_id" UUID,
    "confirmed_at" TIMESTAMPTZ,
    "rejected_reason" VARCHAR(300),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "space_imports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "space_imports_status_idx" ON "space_imports"("status");

