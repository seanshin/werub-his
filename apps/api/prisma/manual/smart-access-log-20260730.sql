-- SmartAccessLog — 외부 SMART 앱 FHIR 접근 기록(신규 테이블·additive)
CREATE TABLE IF NOT EXISTS smart_access_logs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     varchar(100) NOT NULL,
  client_name   varchar(200),
  user_id       uuid,
  patient_id    uuid,
  resource_type varchar(50) NOT NULL,
  action        varchar(20) NOT NULL,
  path          varchar(300) NOT NULL,
  scope         varchar(500),
  ip_address    varchar(45),
  user_agent    text,
  at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "smart_access_logs_client_id_at_idx"  ON smart_access_logs (client_id, at);
CREATE INDEX IF NOT EXISTS "smart_access_logs_user_id_at_idx"    ON smart_access_logs (user_id, at);
CREATE INDEX IF NOT EXISTS "smart_access_logs_patient_id_at_idx" ON smart_access_logs (patient_id, at);
