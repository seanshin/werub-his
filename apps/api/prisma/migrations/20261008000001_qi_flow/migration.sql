-- 의료질관리 흐름(QI-FLOW-001 · 2026-10-08) — 측정 출처·층·사고 필드·재원일수·기구일수·보고서 스냅샷·인증 기준/평가.
-- 전부 추가·NULL 허용·기본값. 유일키 qi_measurements (indicator_id, period) → (+stratum_key, +source_key) 확장(기존 행은 '','MANUAL' — 충돌 없음).

-- DropIndex
DROP INDEX "qi_measurements_indicator_id_period_key";

-- AlterTable
ALTER TABLE "safety_incidents" ADD COLUMN     "anonymous" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "closed_at" TIMESTAMPTZ,
ADD COLUMN     "closed_by" UUID,
ADD COLUMN     "harm_level" VARCHAR(20),
ADD COLUMN     "reviewed_at" TIMESTAMPTZ,
ADD COLUMN     "reviewer_id" UUID,
ADD COLUMN     "ward_id" UUID,
ALTER COLUMN "reporter_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "quality_indicators" ADD COLUMN     "committee_code" VARCHAR(20),
ADD COLUMN     "owner_id" UUID,
ADD COLUMN     "supplier_key" VARCHAR(60);

-- AlterTable
ALTER TABLE "qi_measurements" ADD COLUMN     "computed_by" VARCHAR(80),
ADD COLUMN     "created_by" UUID,
ADD COLUMN     "evidence" JSONB,
ADD COLUMN     "source" VARCHAR(12),
ADD COLUMN     "source_key" VARCHAR(12) NOT NULL DEFAULT 'MANUAL',
ADD COLUMN     "stratum_key" VARCHAR(80) NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "qi_improvement_actions" ADD COLUMN     "baseline_source" VARCHAR(12) NOT NULL DEFAULT 'SUPPLIER',
ADD COLUMN     "indicator_id" UUID,
ALTER COLUMN "indicator_key" DROP NOT NULL;

-- CreateTable
CREATE TABLE "patient_day_snapshots" (
    "id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "ward_key" VARCHAR(60) NOT NULL DEFAULT '',
    "patient_days" INTEGER NOT NULL,
    "computed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "patient_day_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_day_entries" (
    "id" UUID NOT NULL,
    "period" VARCHAR(7) NOT NULL,
    "ward_key" VARCHAR(60) NOT NULL DEFAULT '',
    "device_type" VARCHAR(20) NOT NULL,
    "days" INTEGER NOT NULL,
    "entered_by" UUID NOT NULL,
    "entered_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "device_day_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qi_report_snapshots" (
    "id" UUID NOT NULL,
    "period" VARCHAR(7) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "body" JSONB NOT NULL,
    "measurement_ids" JSONB NOT NULL,
    "status" VARCHAR(12) NOT NULL DEFAULT 'DRAFT',
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submitted_at" TIMESTAMPTZ,
    "agenda_id" UUID,
    "sha256" VARCHAR(64),

    CONSTRAINT "qi_report_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accreditation_standards" (
    "id" UUID NOT NULL,
    "framework" VARCHAR(10) NOT NULL,
    "chapter" VARCHAR(120) NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "title" VARCHAR(300) NOT NULL,
    "measurable_element" TEXT,
    "indicator_ids" JSONB,
    "source_ref" VARCHAR(300),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accreditation_standards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accreditation_assessments" (
    "id" UUID NOT NULL,
    "standard_id" UUID NOT NULL,
    "cycle" VARCHAR(20) NOT NULL,
    "judgment" VARCHAR(12) NOT NULL,
    "evidence_text" TEXT,
    "attachments" JSONB,
    "owner_id" UUID,
    "due_date" DATE,
    "assessed_by" UUID NOT NULL,
    "assessed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verified_by" UUID,
    "verified_at" TIMESTAMPTZ,

    CONSTRAINT "accreditation_assessments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "patient_day_snapshots_date_idx" ON "patient_day_snapshots"("date");

-- CreateIndex
CREATE UNIQUE INDEX "patient_day_snapshots_date_ward_key_key" ON "patient_day_snapshots"("date", "ward_key");

-- CreateIndex
CREATE UNIQUE INDEX "device_day_entries_period_ward_key_device_type_key" ON "device_day_entries"("period", "ward_key", "device_type");

-- CreateIndex
CREATE INDEX "qi_report_snapshots_period_created_at_idx" ON "qi_report_snapshots"("period", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "accreditation_standards_framework_code_key" ON "accreditation_standards"("framework", "code");

-- CreateIndex
CREATE INDEX "accreditation_assessments_standard_id_cycle_assessed_at_idx" ON "accreditation_assessments"("standard_id", "cycle", "assessed_at");

-- CreateIndex
CREATE INDEX "safety_incidents_ward_id_occurred_at_idx" ON "safety_incidents"("ward_id", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "qi_measurements_indicator_id_period_stratum_key_source_key_key" ON "qi_measurements"("indicator_id", "period", "stratum_key", "source_key");

-- AddForeignKey
ALTER TABLE "accreditation_assessments" ADD CONSTRAINT "accreditation_assessments_standard_id_fkey" FOREIGN KEY ("standard_id") REFERENCES "accreditation_standards"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
