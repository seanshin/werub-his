-- 진단서·소견서(B그룹) 작성·전자서명 P2 — IssuanceArtifact 확장
-- 적용: docker exec -i docker-postgres-1 psql -U hospital -d hospitalrun < this.sql
-- 안전: IF NOT EXISTS·nullable·무중단·재실행 무해. schema.prisma 와 동일.
-- ⚠️ 배포 시 서버 npx prisma generate 필수(신규 컬럼 — stale client 빌드 실패 방지).

ALTER TABLE issuance_artifacts ADD COLUMN IF NOT EXISTS authored_json JSONB;
ALTER TABLE issuance_artifacts ADD COLUMN IF NOT EXISTS signed_by     UUID;
ALTER TABLE issuance_artifacts ADD COLUMN IF NOT EXISTS signed_at     TIMESTAMPTZ;
ALTER TABLE issuance_artifacts ADD COLUMN IF NOT EXISTS signature_ref VARCHAR(120);
