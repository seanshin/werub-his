-- e-sign #6 — IssuedDocument 에 signatureRequestId 바인딩(ERP 계약 등 비동의 문서 완료 매칭). 비파괴 ADD COLUMN.
ALTER TABLE issued_documents ADD COLUMN IF NOT EXISTS signature_request_id varchar(64);
CREATE INDEX IF NOT EXISTS issued_documents_signature_request_id_idx ON issued_documents (signature_request_id);
