-- 2026-10-01 SQL 튜닝 2차 — 대기열 환자 기준 조회 인덱스 · 운영 무중단 적용본(트랜잭션 밖 한 문장씩).
-- 근거: 20분 스캔 통계에서 waiting_queue 순차 스캔 27회·21.5만 행 · 포털 "오늘 내 대기"가 7,978행을 버리고 1행 사용.
-- 되돌리기: DROP INDEX CONCURRENTLY "waiting_queue_patient_id_checked_in_at_idx"
CREATE INDEX CONCURRENTLY IF NOT EXISTS "waiting_queue_patient_id_checked_in_at_idx" ON "waiting_queue"("patient_id", "checked_in_at");
