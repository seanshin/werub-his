-- 사전연명의료 철회 기록자·사유 / 협진 종결 시각·종결자 (2026-10-10 · 전부 nullable — 기존 행은 null = 모름)
-- AlterTable
ALTER TABLE "advance_directives" ADD COLUMN "revoked_by" UUID,
ADD COLUMN "revoke_reason" TEXT;

-- AlterTable
ALTER TABLE "consultations" ADD COLUMN "closed_at" TIMESTAMPTZ,
ADD COLUMN "closed_by" UUID;

-- AddForeignKey
ALTER TABLE "advance_directives" ADD CONSTRAINT "advance_directives_revoked_by_fkey" FOREIGN KEY ("revoked_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consultations" ADD CONSTRAINT "consultations_closed_by_fkey" FOREIGN KEY ("closed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
