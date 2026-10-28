-- 2026-10-22 v4.118.0 — 중간정산 환불 요청 중복 방지 키(ERP 2차 회신 §3-2) · 추가만(운영 적용본 prisma/sql/ops/2026-10-22-interim-refund-request-key.sql)
-- AlterTable
ALTER TABLE "interim_billing_refunds" ADD COLUMN "request_key" VARCHAR(100);

-- CreateIndex
CREATE UNIQUE INDEX "interim_billing_refunds_request_key_key" ON "interim_billing_refunds"("request_key");
