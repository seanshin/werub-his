-- AlterTable
ALTER TABLE "safety_incidents" ADD COLUMN     "kops_manual_at" TIMESTAMPTZ,
ADD COLUMN     "kops_manual_by" UUID,
ADD COLUMN     "kops_manual_ref" VARCHAR(60);
