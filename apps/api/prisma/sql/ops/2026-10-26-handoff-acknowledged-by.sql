-- 2026-10-26 v4.123.0 — 인수 확인한 사람(관리자 대리 확인 구별) · schema.prisma ClinicalHandoff.acknowledgedBy 와 같은 칸 · 추가만
-- 🔴 db push 대신 이 SQL 만 적용한다 · deploy.sh --backup 뒤 · 서버 prisma generate 전에 · 기존 확인분은 null(누가 했는지 모른다 — 채우지 않는다)
ALTER TABLE "clinical_handoffs" ADD COLUMN IF NOT EXISTS "acknowledged_by" UUID;
