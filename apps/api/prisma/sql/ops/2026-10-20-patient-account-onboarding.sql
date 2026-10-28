-- 2026-10-20 v4.99.0 — 포털 첫 안내(온보딩) 계정 단위 기록 칸
-- schema.prisma PatientAccount.onboardingCompletedAt 과 같은 칸 · 추가만(null 허용 · 기존 행은 null = 아직 안 봄)
-- 🔴 db push 대신 이 SQL 만 적용한다(db push 는 스키마 밖 수동 인덱스를 지운다 — CLAUDE.md 배포 규칙)
-- 적용: deploy.sh --backup 뒤 · 서버 prisma generate 전에
ALTER TABLE patient_accounts ADD COLUMN IF NOT EXISTS onboarding_completed_at timestamptz;
