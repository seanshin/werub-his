-- 2026-10-22 v4.117.0 — 입원 중간정산 환불 원장(ERP 회신 R5 계약) · schema.prisma InterimBillingRefund 와 같은 칸 · 추가만
-- 🔴 db push 대신 이 SQL 만 적용한다(db push 는 스키마 밖 수동 인덱스를 지운다 — CLAUDE.md 배포 규칙)
-- 적용: deploy.sh --backup 뒤 · 서버 prisma generate 전에
CREATE TABLE IF NOT EXISTS "interim_billing_refunds" (
    "id" UUID NOT NULL,
    "interim_billing_id" UUID NOT NULL,
    "amount" INTEGER NOT NULL,
    "method" VARCHAR(20) NOT NULL,
    "reason" TEXT NOT NULL,
    "refunded_by" UUID,
    "refunded_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "interim_billing_refunds_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "interim_billing_refunds_interim_billing_id_idx" ON "interim_billing_refunds"("interim_billing_id");
CREATE INDEX IF NOT EXISTS "interim_billing_refunds_refunded_at_idx" ON "interim_billing_refunds"("refunded_at");
DO $$ BEGIN
  ALTER TABLE "interim_billing_refunds" ADD CONSTRAINT "interim_billing_refunds_interim_billing_id_fkey"
    FOREIGN KEY ("interim_billing_id") REFERENCES "interim_billings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
