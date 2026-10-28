-- AlterTable
ALTER TABLE "patient_journey_events" ADD COLUMN     "activity" VARCHAR(40),
ADD COLUMN     "idempotency_key" VARCHAR(160),
ADD COLUMN     "outcome" VARCHAR(40),
ADD COLUMN     "supersedes_id" UUID,
ADD COLUMN     "transition" VARCHAR(20);

-- CreateIndex
CREATE UNIQUE INDEX "patient_journey_events_idempotency_key_key" ON "patient_journey_events"("idempotency_key");

-- CreateIndex
CREATE INDEX "patient_journey_events_activity_transition_idx" ON "patient_journey_events"("activity", "transition");

