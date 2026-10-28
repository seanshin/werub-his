-- 2026-10-20 v4.99.0 — 포털 첫 안내(온보딩) 계정 단위 기록 · PatientAccount.onboardingCompletedAt(null 허용 · 추가만)
ALTER TABLE "patient_accounts" ADD COLUMN IF NOT EXISTS "onboarding_completed_at" TIMESTAMPTZ;
