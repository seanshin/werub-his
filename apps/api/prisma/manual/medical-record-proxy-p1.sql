-- 의무기록 발급 P1 — 대리인 자격 검증(의료법 §21). 추가 컬럼(멱등). db push 차단 환경 → 수동 적용.
-- 기능 게이트: env MEDICAL_RECORD_PROXY_ENABLED (기본 false). 법무 확정 후 활성.
ALTER TABLE document_requests ADD COLUMN IF NOT EXISTS requester_type      varchar(10) NOT NULL DEFAULT 'SELF';
ALTER TABLE document_requests ADD COLUMN IF NOT EXISTS requester_relation  varchar(30);
ALTER TABLE document_requests ADD COLUMN IF NOT EXISTS legal_basis         varchar(20);
ALTER TABLE document_requests ADD COLUMN IF NOT EXISTS proxy_documents     jsonb;
ALTER TABLE document_requests ADD COLUMN IF NOT EXISTS proxy_verify_status varchar(10) NOT NULL DEFAULT 'NONE';
ALTER TABLE document_requests ADD COLUMN IF NOT EXISTS proxy_verified_by   uuid;
ALTER TABLE document_requests ADD COLUMN IF NOT EXISTS proxy_verified_at   timestamptz;
