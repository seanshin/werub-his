-- 2026-10-21 v4.114.0 — 문진 폼 판 원장(임상 규칙 P5 A7) · FormSchema.revision·FormSubmission.formSchemaRevision·FormSchemaRevision · 추가만(운영 적용본 prisma/sql/ops/2026-10-21-form-schema-revisions.sql)
-- AlterTable
ALTER TABLE "form_schemas" ADD COLUMN     "revision" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "form_submissions" ADD COLUMN     "form_schema_revision" INTEGER;

-- CreateTable
CREATE TABLE "form_schema_revisions" (
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

-- CreateIndex
CREATE UNIQUE INDEX "form_schema_revisions_form_schema_id_revision_key" ON "form_schema_revisions"("form_schema_id", "revision");

-- AddForeignKey
ALTER TABLE "form_schema_revisions" ADD CONSTRAINT "form_schema_revisions_form_schema_id_fkey" FOREIGN KEY ("form_schema_id") REFERENCES "form_schemas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

