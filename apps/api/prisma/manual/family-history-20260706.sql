-- G4-2: 구조화 가족력 (멱등)
CREATE TABLE IF NOT EXISTS family_histories (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id       UUID NOT NULL,
  relation         VARCHAR(20) NOT NULL,
  diagnosis_code_id UUID,
  condition_name   VARCHAR(200) NOT NULL,
  onset_age        INT,
  is_deceased      BOOLEAN NOT NULL DEFAULT false,
  note             TEXT,
  recorded_by      UUID,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fk_fh_patient FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
  CONSTRAINT fk_fh_diagnosis FOREIGN KEY (diagnosis_code_id) REFERENCES diagnosis_codes(id)
);
CREATE INDEX IF NOT EXISTS idx_family_histories_patient ON family_histories(patient_id);
