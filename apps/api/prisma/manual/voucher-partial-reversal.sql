-- A2+: 부분환불 비례 역상환 — 누적 역상환액 추적
-- 비파괴. 적용: npx prisma db execute --file prisma/manual/voucher-partial-reversal.sql --url "$DATABASE_URL"
ALTER TABLE voucher_redemptions ADD COLUMN IF NOT EXISTS reversed_amount integer NOT NULL DEFAULT 0;
-- 기존 완전역상환분 backfill(reversed_at 있던 행 = 전액 역상환됨)
UPDATE voucher_redemptions SET reversed_amount = amount_used WHERE reversed_at IS NOT NULL AND reversed_amount = 0;
