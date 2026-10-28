-- 영수증 의료법 세밀화 — 잔여 3건 데이터 모델 (멱등 ADD COLUMN IF NOT EXISTS)
-- ① 급여 라인별 100/100 전액본인부담 마킹  ② 감면(discount)  (③ 진위 QR은 issued_documents 재사용)
-- prisma db push가 procedure_codes 드리프트로 막혀 manual DDL로 적용(로컬+운영).

-- ① BillingItem.fullCopay — 급여 항목의 100분의100 본인부담(전액본인부담) 마킹
ALTER TABLE billing_items ADD COLUMN IF NOT EXISTS full_copay boolean NOT NULL DEFAULT false;

-- ② Billing 감면(discount) — 수납 시 감면액·사유
ALTER TABLE billings ADD COLUMN IF NOT EXISTS discount_amount integer NOT NULL DEFAULT 0;
ALTER TABLE billings ADD COLUMN IF NOT EXISTS discount_reason varchar(200);
