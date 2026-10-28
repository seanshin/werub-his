-- 검진권 딜러 국내/해외 구분
-- 비파괴: 컬럼 추가(기존 딜러는 OVERSEAS 기본) + license_number nullable화(해외는 면제).
-- 적용: npx prisma db execute --file prisma/manual/voucher-dealer-type.sql --url "$DATABASE_URL"

ALTER TABLE voucher_distributors ADD COLUMN IF NOT EXISTS dealer_type varchar(12) NOT NULL DEFAULT 'OVERSEAS';
ALTER TABLE voucher_distributors ADD COLUMN IF NOT EXISTS contract_ref varchar(120);
ALTER TABLE voucher_distributors ALTER COLUMN license_number DROP NOT NULL;
