-- 수납 카드사·할부개월 보관 — 가산적(ADD COLUMN NULL) · 데이터 손실 0
--
-- 🔴 배경: 수납 화면(`/billing/[id]`)이 카드사(select)·할부개월(select)을 입력받아 전송하는데
--    `PayBillingDto` 에도 `billing_payments` 에도 자리가 없어 전역 whitelist 가 조용히 지웠다.
--    응답은 200, 토스트는 "수납이 완료되었습니다" — 카드 정산 대사에 필요한 값만 사라졌다.
--    승인번호(card_approval_no)만으로는 카드사 매출전표 대사가 되지 않는다.
--
-- 적용:  docker exec -i docker-postgres-1 psql -U hospital -d hospitalrun < billing-payment-card-company-20260826.sql
-- 이후 서버 npx prisma generate + nest build.
--
-- 🔴 소급 복원은 하지 않는다 — 지나간 수납의 카드사는 어디에도 남아 있지 않다(모르는 값을
--    원장에 지어 넣지 않는다). 이 컬럼은 적용 시점 이후 수납분부터 채워진다.

ALTER TABLE billing_payments ADD COLUMN IF NOT EXISTS card_company varchar(30);
ALTER TABLE billing_payments ADD COLUMN IF NOT EXISTS installment integer;

COMMENT ON COLUMN billing_payments.card_company IS '카드사(신용/체크 매입사) — 정산 대사용';
COMMENT ON COLUMN billing_payments.installment IS '할부 개월 수(0/1 = 일시불)';
