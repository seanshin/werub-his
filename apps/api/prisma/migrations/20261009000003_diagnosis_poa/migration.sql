-- CreateTable
CREATE TABLE "diagnosis_poa" (
    "id" UUID NOT NULL,
    "admission_id" UUID NOT NULL,
    "diagnosis_code" VARCHAR(20) NOT NULL,
    "poa" VARCHAR(2) NOT NULL,
    "recorded_by" UUID NOT NULL,
    "recorded_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "diagnosis_poa_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "diagnosis_poa_admission_id_diagnosis_code_key" ON "diagnosis_poa"("admission_id", "diagnosis_code");

