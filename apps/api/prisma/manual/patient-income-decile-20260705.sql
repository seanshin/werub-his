-- 본인부담상한제 소득분위 — Patient 정규 필드(가산·nullable)
ALTER TABLE patients ADD COLUMN IF NOT EXISTS income_decile INTEGER;
