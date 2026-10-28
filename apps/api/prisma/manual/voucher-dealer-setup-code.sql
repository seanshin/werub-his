-- 딜러 초기설정(이메일 인증코드로 비밀번호 등록) — db push 드리프트 회피용 수동 마이그레이션
-- 관리자는 비번을 정하지 않고, 시스템이 랜덤 비번 + 인증코드를 이메일로 발송 → 딜러가 코드로 비밀번호 설정

ALTER TABLE voucher_distributor_accounts
  ADD COLUMN IF NOT EXISTS setup_code_hash varchar(120),
  ADD COLUMN IF NOT EXISTS setup_code_expiry timestamptz,
  ADD COLUMN IF NOT EXISTS email_verified_at timestamptz;

-- 기존 계정은 이미 비번 설정·운영 중 → 인증완료로 백필(로그인 차단 방지)
UPDATE voucher_distributor_accounts SET email_verified_at = now() WHERE email_verified_at IS NULL;
