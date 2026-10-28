-- B2-a: 딜러 송금/세무 마스터 — ERP AP 지급·원천징수용
-- 비파괴. 적용: npx prisma db execute --file prisma/manual/voucher-dealer-tax-bank.sql --url "$DATABASE_URL"
ALTER TABLE voucher_distributors ADD COLUMN IF NOT EXISTS tax_id varchar(40);
ALTER TABLE voucher_distributors ADD COLUMN IF NOT EXISTS bank_info jsonb;
