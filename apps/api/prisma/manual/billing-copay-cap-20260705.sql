-- 본인부담상한제 사전급여 기록 — 가산·nullable
ALTER TABLE billings ADD COLUMN IF NOT EXISTS copay_cap_excess INTEGER;
