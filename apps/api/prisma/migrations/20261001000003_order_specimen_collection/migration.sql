-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "specimen_collected_at" TIMESTAMPTZ,
ADD COLUMN     "specimen_collected_by_id" UUID,
ADD COLUMN     "specimen_collection_note" VARCHAR(200),
ADD COLUMN     "specimen_collection_recorded_at" TIMESTAMPTZ,
ADD COLUMN     "specimen_collection_source" VARCHAR(20);

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_specimen_collected_by_id_fkey" FOREIGN KEY ("specimen_collected_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

