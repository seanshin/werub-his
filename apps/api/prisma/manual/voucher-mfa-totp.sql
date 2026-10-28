-- 검진권 딜러 MFA(TOTP) — 보안 하드닝. db push 미실행 → 수동 적용(비파괴 ADD COLUMN).
ALTER TABLE voucher_distributor_accounts ADD COLUMN IF NOT EXISTS mfa_secret text;
ALTER TABLE voucher_distributor_accounts ADD COLUMN IF NOT EXISTS mfa_enrolled_at timestamptz;
