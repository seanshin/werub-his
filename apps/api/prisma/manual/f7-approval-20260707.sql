-- F-7 약사 승인제 (2026-07-07 사용자 결정) — 멱등
-- 생성 설명은 원내 약사 승인분만 환자 노출. 재생성(개정) 시 승인 리셋(안전 측 처리).
ALTER TABLE drug_explain_cache ADD COLUMN IF NOT EXISTS approved_by uuid;
ALTER TABLE drug_explain_cache ADD COLUMN IF NOT EXISTS approved_at timestamptz;
