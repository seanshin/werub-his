-- 2026-10-22 v4.117.0 — 입원 중간정산 환불 원장(ERP 회신 R5 계약) · 추가만(운영 적용본 prisma/sql/ops/2026-10-22-interim-billing-refunds.sql)
-- CreateTable
CREATE TABLE "interim_billing_refunds" (
    "id" UUID NOT NULL,
    "interim_billing_id" UUID NOT NULL,
    "amount" INTEGER NOT NULL,
    "method" VARCHAR(20) NOT NULL,
    "reason" TEXT NOT NULL,
    "refunded_by" UUID,
    "refunded_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "interim_billing_refunds_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "interim_billing_refunds_interim_billing_id_idx" ON "interim_billing_refunds"("interim_billing_id");

-- CreateIndex
CREATE INDEX "interim_billing_refunds_refunded_at_idx" ON "interim_billing_refunds"("refunded_at");

-- AddForeignKey
ALTER TABLE "interim_billing_refunds" ADD CONSTRAINT "interim_billing_refunds_interim_billing_id_fkey" FOREIGN KEY ("interim_billing_id") REFERENCES "interim_billings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

