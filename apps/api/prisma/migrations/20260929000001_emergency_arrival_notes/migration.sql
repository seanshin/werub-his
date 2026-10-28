-- CreateTable
CREATE TABLE "emergency_arrival_notes" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "kind" VARCHAR(12) NOT NULL,
    "arrival_at" TIMESTAMPTZ,
    "arrival_mode" VARCHAR(20),
    "ems_unit" VARCHAR(100),
    "found_location" VARCHAR(300),
    "found_at" TIMESTAMPTZ,
    "circumstance" TEXT,
    "consciousness" VARCHAR(16),
    "injury_types" JSONB,
    "companion_type" VARCHAR(20),
    "companion_name" VARCHAR(100),
    "companion_contact" VARCHAR(100),
    "companion_relation" VARCHAR(100),
    "belongings" JSONB,
    "identifying_features" TEXT,
    "police_involved" BOOLEAN,
    "police_agency" VARCHAR(100),
    "police_officer" VARCHAR(100),
    "police_case_no" VARCHAR(100),
    "info_source" VARCHAR(20),
    "note" TEXT,
    "recorded_by_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "emergency_arrival_notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "emergency_arrival_notes_patient_id_created_at_idx" ON "emergency_arrival_notes"("patient_id", "created_at");

-- AddForeignKey
ALTER TABLE "emergency_arrival_notes" ADD CONSTRAINT "emergency_arrival_notes_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

