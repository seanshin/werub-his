-- M-2: 활성화 무차별대입 잠금
-- 비파괴. 적용: npx prisma db execute --file prisma/manual/voucher-activation-lockout.sql --url "$DATABASE_URL"
ALTER TABLE checkup_vouchers ADD COLUMN IF NOT EXISTS activation_fail_count integer NOT NULL DEFAULT 0;
ALTER TABLE checkup_vouchers ADD COLUMN IF NOT EXISTS activation_locked_until timestamptz;
