-- 간호기록 AI 보조 기획 P0 — NursingNote 에 AI 프로비넌스 컬럼(비파괴 ADD COLUMN).
-- AI는 저자 아님(보조). 법적 책임=signedBy 간호사 불변. 본 컬럼은 감사·투명성·품질지표용.
-- 활성화는 config nursing.aiAssist.enabled(기본 OFF) — 컬럼은 미설정 시에도 무해(전부 default/null).
ALTER TABLE nursing_notes ADD COLUMN IF NOT EXISTS ai_assisted boolean NOT NULL DEFAULT false;
ALTER TABLE nursing_notes ADD COLUMN IF NOT EXISTS ai_model varchar(80);
ALTER TABLE nursing_notes ADD COLUMN IF NOT EXISTS ai_prompt_version varchar(40);
ALTER TABLE nursing_notes ADD COLUMN IF NOT EXISTS ai_source_snapshot jsonb;
ALTER TABLE nursing_notes ADD COLUMN IF NOT EXISTS ai_edit_distance integer;
