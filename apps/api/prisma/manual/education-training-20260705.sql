-- 수련교육 영속화 — 4 테이블(가산)
CREATE TABLE IF NOT EXISTS training_logbooks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR(50) NOT NULL, date DATE NOT NULL, category VARCHAR(20) NOT NULL,
  procedure_name VARCHAR(200), icd_code VARCHAR(20), role VARCHAR(20) NOT NULL DEFAULT 'ASSISTANT',
  supervisor VARCHAR(100), department VARCHAR(50), patient_age INTEGER,
  complexity VARCHAR(20) NOT NULL DEFAULT 'MODERATE', outcome VARCHAR(20) NOT NULL DEFAULT 'SUCCESSFUL',
  reflection TEXT, verified BOOLEAN NOT NULL DEFAULT false, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_training_logbook_user_date ON training_logbooks(user_id, date);

CREATE TABLE IF NOT EXISTS epa_assessments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR(50) NOT NULL, epa_number VARCHAR(20) NOT NULL, epa_title VARCHAR(200),
  entrustment_level INTEGER NOT NULL DEFAULT 1, assessor VARCHAR(100), assessor_role VARCHAR(50),
  clinical_context TEXT, strengths TEXT, improvements TEXT, feedback TEXT,
  assessed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_epa_user_number ON epa_assessments(user_id, epa_number);

CREATE TABLE IF NOT EXISTS training_rotations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  resident_id VARCHAR(50) NOT NULL, resident_name VARCHAR(100) NOT NULL, department VARCHAR(50) NOT NULL,
  start_date VARCHAR(10) NOT NULL, end_date VARCHAR(10) NOT NULL, supervisor VARCHAR(100),
  objectives JSONB, assigned_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_training_rotation_dept ON training_rotations(department);

CREATE TABLE IF NOT EXISTS case_presentations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(300) NOT NULL, presenter VARCHAR(100), department VARCHAR(50),
  presentation_date DATE NOT NULL, case_type VARCHAR(20) NOT NULL DEFAULT 'CLINICAL',
  diagnosis VARCHAR(300), summary TEXT, learning_points JSONB, attendees JSONB, feedback TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_case_presentation_dept ON case_presentations(department);
