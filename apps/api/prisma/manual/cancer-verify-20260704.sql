-- cancer-registry 확인자/일시 기록 — 가산·nullable
ALTER TABLE cancer_registries ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;
ALTER TABLE cancer_registries ADD COLUMN IF NOT EXISTS verified_by UUID;
