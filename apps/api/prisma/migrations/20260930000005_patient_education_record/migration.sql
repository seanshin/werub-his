-- 환자 교육 기록(2026-09-30) · 추가만(테이블 1·인덱스 2·외래키 1) — prisma migrate diff 출력 그대로
-- CreateTable
CREATE TABLE "patient_education_records" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "admission_id" UUID,
    "encounter_id" UUID,
    "topic" VARCHAR(30) NOT NULL,
    "content" TEXT NOT NULL,
    "learner" VARCHAR(24) NOT NULL,
    "learner_note" VARCHAR(200),
    "methods" JSONB,
    "understanding" VARCHAR(16),
    "barriers" VARCHAR(200),
    "follow_up_needed" BOOLEAN,
    "educated_at" TIMESTAMPTZ NOT NULL,
    "educator_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voided_at" TIMESTAMPTZ,
    "voided_by_id" UUID,
    "void_reason" TEXT,

    CONSTRAINT "patient_education_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "patient_education_records_patient_id_educated_at_idx" ON "patient_education_records"("patient_id", "educated_at");

-- CreateIndex
CREATE INDEX "patient_education_records_admission_id_idx" ON "patient_education_records"("admission_id");

-- AddForeignKey
ALTER TABLE "patient_education_records" ADD CONSTRAINT "patient_education_records_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

