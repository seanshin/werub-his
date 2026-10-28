-- 병리 검체 처리단계 실 테이블(가산)
CREATE TABLE IF NOT EXISTS pathology_processing_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  specimen_id UUID NOT NULL,
  step VARCHAR(20) NOT NULL,
  notes TEXT,
  performed_by UUID,
  performed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_path_proc_specimen ON pathology_processing_steps(specimen_id, performed_at);
