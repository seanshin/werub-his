-- A1: 검진권 수납 결제 — BillingPayment 분할라인 + redeem↔Billing 링크
-- 비파괴. 적용: npx prisma db execute --file prisma/manual/voucher-billing-payment.sql --url "$DATABASE_URL"

-- redeem↔Billing 링크(visitId XOR billingId)
ALTER TABLE voucher_redemptions ALTER COLUMN visit_id DROP NOT NULL;
ALTER TABLE voucher_redemptions ADD COLUMN IF NOT EXISTS billing_id uuid;
CREATE INDEX IF NOT EXISTS voucher_redemptions_billing_id_idx ON voucher_redemptions (billing_id);

-- 복합결제 분할라인
CREATE TABLE IF NOT EXISTS billing_payments (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  billing_id            uuid NOT NULL,
  method                varchar(20) NOT NULL,
  amount                integer NOT NULL,
  voucher_serial        varchar(40),
  voucher_redemption_id uuid,
  card_approval_no      varchar(30),
  cash_receipt_no       varchar(30),
  processed_by          uuid,
  created_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS billing_payments_billing_id_idx ON billing_payments (billing_id);
