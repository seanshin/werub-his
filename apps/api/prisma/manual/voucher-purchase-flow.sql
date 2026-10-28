-- 검진권 구매 흐름 완결 G1·G2 (구현)
-- 비파괴 추가 컬럼. db push 드리프트(procedure_codes) 회피용 수동 적용.
-- 적용: npx prisma db execute --file prisma/manual/voucher-purchase-flow.sql --url "$DATABASE_URL"

-- G1: 활성화코드 봉투암호화 저장(딜러 전달용·활성화 후 소각)
ALTER TABLE checkup_vouchers ADD COLUMN IF NOT EXISTS activation_code_enc text;
