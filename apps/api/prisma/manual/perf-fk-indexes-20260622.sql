-- 성능: prescriptions FK 인덱스(질병통계 groupBy·수가/약가 조인). db push 미실행 → 수동 적용.
-- 무중단(CONCURRENTLY). 인덱스명은 Prisma 자동명과 일치(향후 db push 재생성 방지).
-- 적용: docker exec docker-postgres-1 psql -U hospital -d hospitalrun -f <this> (또는 -c 개별 실행)
CREATE INDEX CONCURRENTLY IF NOT EXISTS prescriptions_procedure_code_id_idx ON prescriptions(procedure_code_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS prescriptions_medication_code_id_idx ON prescriptions(medication_code_id);
