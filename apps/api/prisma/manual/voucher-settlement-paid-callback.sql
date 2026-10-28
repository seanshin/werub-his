-- B3/DB-4: 정산 지급 회신(settlement.paid 콜백·ERP→HIS) 필드
-- 비파괴. 적용: npx prisma db execute --file prisma/manual/voucher-settlement-paid-callback.sql --url "$DATABASE_URL"
ALTER TABLE voucher_settlements ADD COLUMN IF NOT EXISTS paid_at timestamptz;
ALTER TABLE voucher_settlements ADD COLUMN IF NOT EXISTS erp_voucher_ref varchar(120);
ALTER TABLE voucher_settlements ADD COLUMN IF NOT EXISTS amount_paid_krw integer;
ALTER TABLE voucher_settlements ADD COLUMN IF NOT EXISTS withholding_krw integer;
ALTER TABLE voucher_settlements ADD COLUMN IF NOT EXISTS paid_callback_event_id varchar(120);
