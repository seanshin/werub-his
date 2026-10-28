-- 성능: 환자별 임상도구 결과 최신순 정렬 인덱스(findByPatient orderBy performedAt desc)
-- 적용:  docker exec -i docker-postgres-1 psql -U hospital -d hospitalrun < clinical-chart-result-perf-index-20260704.sql
-- CONCURRENTLY = 무중단(트랜잭션 밖 실행 필요 · psql -f 로 직접).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ccr_patient_performed
  ON clinical_chart_results(patient_id, performed_at DESC);
