-- 2026-10-22 v4.118.0 — 중간정산 환불 요청 중복 방지 키(ERP 2차 회신 §3-2) · schema.prisma InterimBillingRefund.requestKey 와 같은 칸 · 추가만
-- 🔴 db push 대신 이 SQL 만 적용한다(db push 는 스키마 밖 수동 인덱스를 지운다 — CLAUDE.md 배포 규칙)
-- 적용: deploy.sh --backup 뒤 · 서버 prisma generate 전에 · 기존 행은 null(유일 인덱스는 null 을 여럿 허용)
ALTER TABLE "interim_billing_refunds" ADD COLUMN IF NOT EXISTS "request_key" VARCHAR(100);
CREATE UNIQUE INDEX IF NOT EXISTS "interim_billing_refunds_request_key_key" ON "interim_billing_refunds"("request_key");
