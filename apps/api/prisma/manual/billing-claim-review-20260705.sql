-- 청구 심사결과 → Billing 반영(원본 보존·조정액 기록) — 가산·nullable
ALTER TABLE billings ADD COLUMN IF NOT EXISTS reviewed_insurance_amount INTEGER;
ALTER TABLE billings ADD COLUMN IF NOT EXISTS insurance_reduced_amount INTEGER;
ALTER TABLE billings ADD COLUMN IF NOT EXISTS insurance_adjusted_at TIMESTAMPTZ;
