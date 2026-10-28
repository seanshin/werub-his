-- AlterTable
ALTER TABLE "patient_journey_events" ADD COLUMN     "data_origin" VARCHAR(10) NOT NULL DEFAULT 'UNKNOWN',
ADD COLUMN     "emitter" VARCHAR(80),
ADD COLUMN     "occurred_at" TIMESTAMPTZ,
ADD COLUMN     "occurred_at_precision" VARCHAR(10),
ADD COLUMN     "occurred_at_source" VARCHAR(20) NOT NULL DEFAULT 'UNKNOWN',
ADD COLUMN     "planned_at" TIMESTAMPTZ;

-- CreateTable
CREATE TABLE "patient_journey_event_objects" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "object_type" VARCHAR(40) NOT NULL,
    "object_id" UUID NOT NULL,
    "qualifier" VARCHAR(20) NOT NULL,

    CONSTRAINT "patient_journey_event_objects_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "patient_journey_event_objects_object_type_object_id_idx" ON "patient_journey_event_objects"("object_type", "object_id");

-- CreateIndex
CREATE UNIQUE INDEX "patient_journey_event_objects_event_id_object_type_object_i_key" ON "patient_journey_event_objects"("event_id", "object_type", "object_id", "qualifier");

-- CreateIndex
CREATE INDEX "patient_journey_events_patient_id_occurred_at_idx" ON "patient_journey_events"("patient_id", "occurred_at");

-- AddForeignKey
ALTER TABLE "patient_journey_event_objects" ADD CONSTRAINT "patient_journey_event_objects_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "patient_journey_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

