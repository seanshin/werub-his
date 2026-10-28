-- pharmacy DUR 오버라이드 감사(규제 §37) — 가산·nullable
ALTER TABLE prescriptions ADD COLUMN IF NOT EXISTS dur_override_reason TEXT;
ALTER TABLE prescriptions ADD COLUMN IF NOT EXISTS dur_override_by UUID;
ALTER TABLE prescriptions ADD COLUMN IF NOT EXISTS dur_override_at TIMESTAMPTZ;
