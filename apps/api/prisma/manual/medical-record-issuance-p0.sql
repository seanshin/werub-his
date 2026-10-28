-- 의무기록 사본(A그룹) 발급 P0 — DocumentRequest 확장 + IssuanceArtifact
-- 적용: docker exec -i docker-postgres-1 psql -U hospital -d hospitalrun < this.sql
-- 안전: 전부 IF NOT EXISTS / nullable — 재실행 무해, 무중단. schema.prisma 와 동일.

-- 1) document_requests 컬럼 확장
ALTER TABLE document_requests ADD COLUMN IF NOT EXISTS requestor_account_id UUID;
ALTER TABLE document_requests ADD COLUMN IF NOT EXISTS record_types        JSONB;
ALTER TABLE document_requests ADD COLUMN IF NOT EXISTS issued_document_id  VARCHAR(60);
ALTER TABLE document_requests ADD COLUMN IF NOT EXISTS sla_due_at          TIMESTAMPTZ;

-- 2) 발급 산출물(스냅샷 동결)
CREATE TABLE IF NOT EXISTS issuance_artifacts (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id         UUID NOT NULL,
  record_type        VARCHAR(30) NOT NULL,
  source_ids         JSONB NOT NULL,
  snapshot_json      JSONB NOT NULL,
  issued_document_id VARCHAR(60),
  page_count         INT,
  created_by         UUID NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fk_issuance_artifact_request FOREIGN KEY (request_id) REFERENCES document_requests(id)
);
CREATE INDEX IF NOT EXISTS idx_issuance_artifacts_request ON issuance_artifacts (request_id);
