-- 재활 세션 청구코드 매핑(가산·nullable)
ALTER TABLE rehab_sessions ADD COLUMN IF NOT EXISTS billing_code VARCHAR(20);
ALTER TABLE rehab_sessions ADD COLUMN IF NOT EXISTS billing_code_name VARCHAR(200);
ALTER TABLE rehab_sessions ADD COLUMN IF NOT EXISTS billing_unit_price INTEGER;
