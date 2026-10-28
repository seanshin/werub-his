-- 성능: PacuRecord 인덱스 부재 교정(pkey만 존재) — surgeryId·patientId·dischargeTime·arrivalTime
-- 적용:  docker exec docker-postgres-1 psql -U hospital -d hospitalrun -f pacu-indexes-20260704.sql
-- CONCURRENTLY = 무중단(트랜잭션 밖 실행 · psql -f 로 직접).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pacu_surgery ON pacu_records(surgery_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pacu_patient ON pacu_records(patient_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pacu_discharge ON pacu_records(discharge_time);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pacu_arrival ON pacu_records(arrival_time);
