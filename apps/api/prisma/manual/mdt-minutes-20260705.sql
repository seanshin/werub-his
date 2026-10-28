-- MDT 회의록 자동생성(가산·nullable)
ALTER TABLE mdt_conferences ADD COLUMN IF NOT EXISTS minutes TEXT;
ALTER TABLE mdt_conferences ADD COLUMN IF NOT EXISTS minutes_generated_at TIMESTAMPTZ;
