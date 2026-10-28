-- CreateTable
CREATE TABLE "device_lines" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "admission_id" UUID,
    "device_type" VARCHAR(20) NOT NULL,
    "site" VARCHAR(80),
    "inserted_at" TIMESTAMPTZ NOT NULL,
    "inserted_by" UUID NOT NULL,
    "removed_at" TIMESTAMPTZ,
    "removed_by" UUID,
    "note" TEXT,
    "voided_at" TIMESTAMPTZ,
    "voided_by" UUID,
    "void_reason" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "device_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "device_lines_patient_id_removed_at_idx" ON "device_lines"("patient_id", "removed_at");

-- CreateIndex
CREATE INDEX "device_lines_admission_id_idx" ON "device_lines"("admission_id");

-- CreateIndex
CREATE INDEX "device_lines_device_type_inserted_at_idx" ON "device_lines"("device_type", "inserted_at");

