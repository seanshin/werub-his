-- A2: 검진권 결제 환불·취소 역상환 추적
-- 비파괴. 적용: npx prisma db execute --file prisma/manual/voucher-redeem-reversal.sql --url "$DATABASE_URL"
ALTER TABLE voucher_redemptions ADD COLUMN IF NOT EXISTS reversed_at timestamptz;
ALTER TABLE voucher_redemptions ADD COLUMN IF NOT EXISTS reversal_reason varchar(200);
