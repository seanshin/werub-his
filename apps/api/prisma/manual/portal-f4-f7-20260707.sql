-- 환자포털 P1-b(F-4 실손보험 서류 번들) + P1-c(F-7 처방 AI 쉬운 설명) DDL — 멱등
-- 적용: docker exec -i docker-postgres-1 psql -U hospital -d hospitalrun < <this>
-- (schema.prisma 동반 변경 — 배포 시 서버 prisma generate 필수)

BEGIN;

-- F-4: 서류 요청 묶음
ALTER TABLE document_requests ADD COLUMN IF NOT EXISTS bundle_id uuid;
CREATE INDEX IF NOT EXISTS idx_docreq_bundle ON document_requests (bundle_id) WHERE bundle_id IS NOT NULL;

-- F-7: 약품 코드 단위 설명 캐시
CREATE TABLE IF NOT EXISTS drug_explain_cache (
  medication_code_id uuid PRIMARY KEY,
  item_code          varchar(20),
  content            jsonb NOT NULL,
  source_version     varchar(40),
  created_at         timestamptz NOT NULL DEFAULT now()
);

COMMIT;
