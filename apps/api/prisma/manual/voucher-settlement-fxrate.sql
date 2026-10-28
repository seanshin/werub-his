-- DB-2: 정산 환율 스냅샷(BOK 기준환율) 소스 추적
-- 비파괴(fx_rate 기존). 적용: npx prisma db execute --file prisma/manual/voucher-settlement-fxrate.sql --url "$DATABASE_URL"
ALTER TABLE voucher_settlements ADD COLUMN IF NOT EXISTS fx_rate_source varchar(12);
