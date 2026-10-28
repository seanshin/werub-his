-- 2026-10-21 v4.114.0 — 문진 폼 판 원장(임상 규칙·템플릿 P5 A7)
-- schema.prisma FormSchema.revision · FormSubmission.formSchemaRevision · FormSchemaRevision 과 같은 칸 · 추가만
--  · 기존 폼은 revision 1(원장 시작 전 내용) · 기존 제출은 form_schema_revision null(어떤 문항으로 받았는지 모름 — 지어내지 않는다)
-- 🔴 db push 대신 이 SQL 만 적용한다(db push 는 스키마 밖 수동 인덱스를 지운다 — CLAUDE.md 배포 규칙)
-- 적용: deploy.sh --backup 뒤 · 서버 prisma generate 전에
ALTER TABLE "form_schemas" ADD COLUMN IF NOT EXISTS "revision" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "form_submissions" ADD COLUMN IF NOT EXISTS "form_schema_revision" INTEGER;

CREATE TABLE IF NOT EXISTS "form_schema_revisions" (
    "id" UUID NOT NULL,
    "form_schema_id" UUID NOT NULL,
    "revision" INTEGER NOT NULL,
    "version" VARCHAR(20) NOT NULL,
    "schema" JSONB NOT NULL,
    "origin" VARCHAR(20) NOT NULL,
    "changed_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "form_schema_revisions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "form_schema_revisions_form_schema_id_revision_key" ON "form_schema_revisions"("form_schema_id", "revision");
DO $$ BEGIN
  ALTER TABLE "form_schema_revisions" ADD CONSTRAINT "form_schema_revisions_form_schema_id_fkey"
    FOREIGN KEY ("form_schema_id") REFERENCES "form_schemas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
