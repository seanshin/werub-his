-- 만성질환 측정 자동 미러링 P1 — sourceId(멱등)·context(급성/만성) 추가. 멱등·추가형. db push 차단 환경 → 수동 적용.
ALTER TABLE chronic_observations ADD COLUMN IF NOT EXISTS source_id varchar(80);
ALTER TABLE chronic_observations ADD COLUMN IF NOT EXISTS context   varchar(10) NOT NULL DEFAULT 'CHRONIC';
-- 미러 멱등(동일 원천 1건). sourceId NULL(수기 입력)은 Postgres 다중 NULL 허용으로 충돌 없음.
CREATE UNIQUE INDEX IF NOT EXISTS chronic_observations_source_source_id_key
  ON chronic_observations (source, source_id);
CREATE INDEX IF NOT EXISTS chronic_observations_patient_code_context_measured_idx
  ON chronic_observations (patient_id, code, context, measured_at);
