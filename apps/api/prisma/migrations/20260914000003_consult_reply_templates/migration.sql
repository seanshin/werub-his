-- 상담 빠른답변 템플릿(직원 입력 보조) — 2026-09-14 R4
-- 추가만 한다(기존 테이블 무변경). 시드 없음.
CREATE TABLE "consult_reply_templates" (
    "id" UUID NOT NULL,
    "team_id" UUID,
    "title" VARCHAR(80) NOT NULL,
    "body" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" UUID NOT NULL,
    "updated_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "consult_reply_templates_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "consult_reply_templates_team_id_active_idx" ON "consult_reply_templates"("team_id", "active");
