-- 서명본 보존(2026-10-03) — 서명된 진료기록·퇴원요약 정정 시 직전 서명본(내용·서명 시각·서명자)을 남긴다
-- CreateTable
CREATE TABLE "signed_record_versions" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "record_type" VARCHAR(30) NOT NULL,
    "record_id" UUID NOT NULL,
    "signed_at" TIMESTAMPTZ,
    "signed_by" UUID,
    "content" JSONB NOT NULL,
    "superseded_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "superseded_by" UUID,
    "changed_fields" JSONB NOT NULL DEFAULT '[]',

    CONSTRAINT "signed_record_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "signed_record_versions_patient_id_superseded_at_idx" ON "signed_record_versions"("patient_id", "superseded_at");

-- CreateIndex
CREATE INDEX "signed_record_versions_record_type_record_id_idx" ON "signed_record_versions"("record_type", "record_id");
