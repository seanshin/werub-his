-- 2026-10-01 SQL 튜닝 2차 — 대기열 환자 기준 조회 인덱스(신규 설치·migrate 용 · 트랜잭션 안이라 CONCURRENTLY 없음).
-- 운영 무중단 적용본: prisma/sql/2026-10-01-waiting-queue-patient-index.concurrently.sql
CREATE INDEX IF NOT EXISTS "waiting_queue_patient_id_checked_in_at_idx" ON "waiting_queue"("patient_id", "checked_in_at");
