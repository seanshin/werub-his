-- CreateTable
CREATE TABLE "wifi_survey_samples" (
    "id" UUID NOT NULL,
    "floor_key" VARCHAR(10) NOT NULL,
    "floor_level" INTEGER NOT NULL,
    "x" DOUBLE PRECISION NOT NULL,
    "y" DOUBLE PRECISION NOT NULL,
    "zone_id" UUID,
    "readings" JSONB NOT NULL,
    "measured_at" TIMESTAMPTZ NOT NULL,
    "collected_by_id" UUID NOT NULL,
    "note" VARCHAR(200),
    "voided_at" TIMESTAMPTZ,
    "voided_by_id" UUID,
    "void_reason" VARCHAR(200),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wifi_survey_samples_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "wifi_survey_samples_floor_key_voided_at_idx" ON "wifi_survey_samples"("floor_key", "voided_at");
