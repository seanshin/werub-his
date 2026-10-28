-- C-2 동의서 개정(재동의) — sign request.superseded 수신 시 현행 아님 표시. 비파괴 ADD COLUMN.
ALTER TABLE consent_forms ADD COLUMN IF NOT EXISTS superseded_by varchar(80);
ALTER TABLE consent_forms ADD COLUMN IF NOT EXISTS superseded_at timestamptz;
