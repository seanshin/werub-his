-- 간호차트 보완(가·다) — db push 드리프트 회피용 수동 마이그레이션
-- (가) 간호기록 무결성: nursing_notes 서명/상태 컬럼
-- (다) 간호과정(ADPIE): NIC(중재)·NOC(결과) 테이블

-- (가) nursing_notes 무결성 컬럼(작성=서명 기본)
ALTER TABLE nursing_notes
  ADD COLUMN IF NOT EXISTS status varchar(12) NOT NULL DEFAULT 'SIGNED',
  ADD COLUMN IF NOT EXISTS signed_at timestamptz,
  ADD COLUMN IF NOT EXISTS signed_by uuid;

-- (다) NIC 간호중재
CREATE TABLE IF NOT EXISTS nursing_interventions (
  id uuid PRIMARY KEY,
  nursing_diagnosis_id uuid NOT NULL REFERENCES nursing_diagnoses(id),
  nic_code varchar(20),
  name varchar(300) NOT NULL,
  detail text,
  frequency varchar(100),
  status varchar(15) NOT NULL DEFAULT 'PLANNED',
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS nursing_interventions_diagnosis_idx ON nursing_interventions(nursing_diagnosis_id);

-- (다) NOC 간호결과
CREATE TABLE IF NOT EXISTS nursing_outcomes (
  id uuid PRIMARY KEY,
  nursing_diagnosis_id uuid NOT NULL REFERENCES nursing_diagnoses(id),
  noc_code varchar(20),
  name varchar(300) NOT NULL,
  baseline_score int,
  target_score int,
  current_score int,
  status varchar(15) NOT NULL DEFAULT 'NOT_MET',
  evaluated_at timestamptz,
  evaluated_by uuid,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS nursing_outcomes_diagnosis_idx ON nursing_outcomes(nursing_diagnosis_id);
