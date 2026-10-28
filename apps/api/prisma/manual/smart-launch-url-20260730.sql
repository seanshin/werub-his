-- SmartClient.launchUrl (EHR launch 진입점) — additive. 기존 행은 NULL(런처에 미노출).
ALTER TABLE smart_clients ADD COLUMN IF NOT EXISTS launch_url varchar(500);
