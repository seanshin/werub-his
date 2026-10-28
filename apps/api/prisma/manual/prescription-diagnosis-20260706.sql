-- G2-5: 처방↔진단 연결 (멱등)
ALTER TABLE prescriptions ADD COLUMN IF NOT EXISTS diagnosis_code_id UUID;
DO $$ BEGIN
  ALTER TABLE prescriptions ADD CONSTRAINT fk_rx_diagnosis FOREIGN KEY (diagnosis_code_id) REFERENCES diagnosis_codes(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
