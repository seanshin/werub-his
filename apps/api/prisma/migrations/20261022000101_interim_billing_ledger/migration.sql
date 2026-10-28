-- 2026-10-22 v4.116.0 — 입원 중간정산 산정 근거·무효·수납 원장(interim_billing_payments) · 회차 유일 · 추가만(운영 적용본 prisma/sql/ops/2026-10-22-interim-billing-ledger.sql)
-- AlterTable
ALTER TABLE "interim_billings" ADD COLUMN     "copay_rate" DECIMAL(5,4),
ADD COLUMN     "created_by" UUID,
ADD COLUMN     "daily_rate" DECIMAL(12,0),
ADD COLUMN     "days" INTEGER,
ADD COLUMN     "paid_by" UUID,
ADD COLUMN     "price_basis" VARCHAR(30),
ADD COLUMN     "stay_code" VARCHAR(20),
ADD COLUMN     "void_reason" TEXT,
ADD COLUMN     "voided_at" TIMESTAMPTZ,
ADD COLUMN     "voided_by" UUID;

-- CreateTable
CREATE TABLE "interim_billing_payments" (
    "id" UUID NOT NULL,
    "interim_billing_id" UUID NOT NULL,
    "method" VARCHAR(20) NOT NULL,
    "amount" INTEGER NOT NULL,
    "card_approval_no" VARCHAR(30),
    "card_company" VARCHAR(30),
    "installment" INTEGER,
    "cash_receipt_no" VARCHAR(30),
    "processed_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "interim_billing_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "interim_billing_payments_interim_billing_id_idx" ON "interim_billing_payments"("interim_billing_id");

-- CreateIndex
CREATE INDEX "interim_billing_payments_created_at_idx" ON "interim_billing_payments"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "interim_billings_admission_id_sequence_no_key" ON "interim_billings"("admission_id", "sequence_no");

-- AddForeignKey
ALTER TABLE "interim_billing_payments" ADD CONSTRAINT "interim_billing_payments_interim_billing_id_fkey" FOREIGN KEY ("interim_billing_id") REFERENCES "interim_billings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

