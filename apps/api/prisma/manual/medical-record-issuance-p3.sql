-- 의무기록 발급 P3 — 수령(delivery) 처리 + 수수료 산정 근거. db push 미실행 → 수동 적용.
ALTER TABLE document_requests ADD COLUMN IF NOT EXISTS delivered_at timestamptz;
ALTER TABLE document_requests ADD COLUMN IF NOT EXISTS delivered_by uuid;
ALTER TABLE document_requests ADD COLUMN IF NOT EXISTS delivery_ref varchar(120);
ALTER TABLE document_requests ADD COLUMN IF NOT EXISTS fee_breakdown jsonb;
