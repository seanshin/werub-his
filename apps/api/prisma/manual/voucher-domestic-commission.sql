-- 국내 유치업자 차등 수수료 상한
-- 비파괴: 정책 컬럼 추가(기본 15% — 의료해외진출법 유치 수수료 규제 잠정값, 법무확정 후 교체).
-- 적용: npx prisma db execute --file prisma/manual/voucher-domestic-commission.sql --url "$DATABASE_URL"

ALTER TABLE voucher_policies ADD COLUMN IF NOT EXISTS domestic_max_commission_rate integer NOT NULL DEFAULT 15;
