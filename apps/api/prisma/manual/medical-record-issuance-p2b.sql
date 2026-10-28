-- 진단서 포털 요청 — DocumentRequest.encounter_id(관련 진료 선택)
-- 적용: docker exec -i docker-postgres-1 psql -U hospital -d hospitalrun < this.sql
-- 안전: IF NOT EXISTS·nullable·무중단. ⚠️ 배포 시 서버 prisma generate 필수.
ALTER TABLE document_requests ADD COLUMN IF NOT EXISTS encounter_id UUID;
