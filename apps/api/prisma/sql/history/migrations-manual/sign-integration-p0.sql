-- 외부 서명서비스(sign) 연동 P0 — additive·비파괴 컬럼 (멱등 ADD COLUMN IF NOT EXISTS)
-- sign팀 승인분(A). EXTERNAL 활성화·blockchainSignature 제거는 공동 게이트(C) 이후.
-- ※ sign팀 "signMode"는 기존 consent_forms.sign_mode(서명기기)와 충돌 → sign_provider로 명명.

ALTER TABLE consent_forms ADD COLUMN IF NOT EXISTS sign_provider varchar(20) DEFAULT 'SIMULATION';
ALTER TABLE consent_forms ADD COLUMN IF NOT EXISTS signature_request_id varchar(64);
ALTER TABLE consent_forms ADD COLUMN IF NOT EXISTS sign_status varchar(24);
ALTER TABLE consent_forms ADD COLUMN IF NOT EXISTS sign_participant_id varchar(64);
ALTER TABLE consent_forms ADD COLUMN IF NOT EXISTS sign_cert_serial varchar(64);
ALTER TABLE consent_forms ADD COLUMN IF NOT EXISTS audit_cert_uri text;

ALTER TABLE patients ADD COLUMN IF NOT EXISTS sign_cert_serial varchar(64);
ALTER TABLE users ADD COLUMN IF NOT EXISTS sign_cert_serial varchar(64);
