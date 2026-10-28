-- 검진권 딜러 발송·수령확인(채널분리 승인) — db push 드리프트 회피용 수동 마이그레이션
-- 활성화코드 별도 이메일 발송 + 딜러 수령확인(코드 입력) 전 판매 불가 게이트

-- 딜러 수령확인 게이트(null=미확인=판매불가)
ALTER TABLE checkup_vouchers
  ADD COLUMN IF NOT EXISTS dealer_confirmed_at timestamptz;

-- 배분 발송(활성화코드 이메일) 감사
ALTER TABLE voucher_allocations
  ADD COLUMN IF NOT EXISTS recipient_email varchar(200),
  ADD COLUMN IF NOT EXISTS emailed_at timestamptz,
  ADD COLUMN IF NOT EXISTS delivery_channel varchar(20);

-- 기존 보유 검진권(이미 딜러 소유)은 소급 확인 처리(레거시 판매 차단 방지)
UPDATE checkup_vouchers SET dealer_confirmed_at = now()
  WHERE current_owner_type = 'DISTRIBUTOR' AND dealer_confirmed_at IS NULL;
