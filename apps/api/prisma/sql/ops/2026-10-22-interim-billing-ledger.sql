-- 2026-10-22 v4.116.0 — 입원 중간정산 산정 근거·무효·수납 원장 · 회차 유일
-- schema.prisma InterimBilling(+10칸 · @@unique(admission_id, sequence_no)) · InterimBillingPayment 와 같은 칸 · 추가만
--  · 기존 중간정산은 근거 칸 null(이 칸 전 생성분 — 단가 출처를 모른다 · 지어내지 않는다) · 기존 수납은 원장 줄 없음(수단 모름)
-- 🔴 회차 유일 인덱스는 같은 입원·같은 회차가 둘이면 실패한다 — 적용 전 확인(2026-10-22 운영 실측 1건 · 중복 0)
--    SELECT admission_id, sequence_no, count(*) FROM interim_billings GROUP BY 1,2 HAVING count(*) > 1;
-- 🔴 db push 대신 이 SQL 만 적용한다(db push 는 스키마 밖 수동 인덱스를 지운다 — CLAUDE.md 배포 규칙)
-- 적용: deploy.sh --backup 뒤 · 서버 prisma generate 전에
ALTER TABLE "interim_billings"
  ADD COLUMN IF NOT EXISTS "copay_rate" DECIMAL(5,4),
  ADD COLUMN IF NOT EXISTS "created_by" UUID,
  ADD COLUMN IF NOT EXISTS "daily_rate" DECIMAL(12,0),
  ADD COLUMN IF NOT EXISTS "days" INTEGER,
  ADD COLUMN IF NOT EXISTS "paid_by" UUID,
  ADD COLUMN IF NOT EXISTS "price_basis" VARCHAR(30),
  ADD COLUMN IF NOT EXISTS "stay_code" VARCHAR(20),
  ADD COLUMN IF NOT EXISTS "void_reason" TEXT,
  ADD COLUMN IF NOT EXISTS "voided_at" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "voided_by" UUID;

CREATE TABLE IF NOT EXISTS "interim_billing_payments" (
    "id" UUID NOT NULL,
    "interim_billing_id" UUID NOT NULL,
    "method" VARCHAR(20) NOT NULL,
    "amount" INTEGER NOT NULL,
    "card_approval_no" VARCHAR(30),
    "card_company" VARCHAR(30),
    "installment" INTEGER,
    "cash_receipt_no" VARCHAR(30),
    "processed_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "interim_billing_payments_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "interim_billing_payments_interim_billing_id_idx" ON "interim_billing_payments"("interim_billing_id");
CREATE INDEX IF NOT EXISTS "interim_billing_payments_created_at_idx" ON "interim_billing_payments"("created_at");
CREATE UNIQUE INDEX IF NOT EXISTS "interim_billings_admission_id_sequence_no_key" ON "interim_billings"("admission_id", "sequence_no");
DO $$ BEGIN
  ALTER TABLE "interim_billing_payments" ADD CONSTRAINT "interim_billing_payments_interim_billing_id_fkey"
    FOREIGN KEY ("interim_billing_id") REFERENCES "interim_billings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
