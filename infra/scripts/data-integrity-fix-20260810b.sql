-- 데이터 정합성 교정 2차 (2026-08-10) — 시드 청구의 수납 증거 복원
--
-- 대상 = `cashier_note='SEED-ERP-CALC'` 로 **출처가 확정된 시드 청구 17건**.
-- 상태는 PAID 인데 `paid_amount=0`·`paid_at IS NULL` 이라 "수납 완료인데 결제 증거 0"이었다.
-- 원인 = 해당 시드가 INSERT 컬럼 목록에서 paid_at/paid_amount 를 통째로 빠뜨린 것(동일 커밋에서 봉합).
--
-- 🔴 이것은 **실 수납 기록의 날조가 아니다.** 실제 환자 수납분이면 손대지 않는다.
--    출처 태그로 시드임이 확정됐고, 그 시드의 의도가 "수납 완료된 청구"였음이 코드에 남아 있다
--    → 시드 의도를 복원하는 것. 태그 없는 청구는 **한 건도 건드리지 않는다**.
--
-- 실행: docker exec -i docker-postgres-1 psql -U hospital -d hospitalrun -f /tmp/data-integrity-fix-20260810b.sql

\timing off
BEGIN;

\echo '── 교정 전(시드 태그 한정)'
SELECT count(*) AS "PAID인데 결제증거 없음(SEED-ERP-CALC)"
  FROM billings WHERE cashier_note = 'SEED-ERP-CALC'
   AND status = 'PAID' AND coalesce(paid_amount, 0) = 0 AND patient_copay > 0;

UPDATE billings
   SET paid_amount = patient_copay,
       paid_at     = created_at   -- 시드가 만든 청구라 생성 시각이 유일한 근거(추정 시각을 지어내지 않는다)
 WHERE cashier_note = 'SEED-ERP-CALC'
   AND status = 'PAID'
   AND coalesce(paid_amount, 0) = 0
   AND patient_copay > 0;

\echo '── 교정 후'
SELECT count(*) AS "잔여(시드 태그)"
  FROM billings WHERE cashier_note = 'SEED-ERP-CALC'
   AND status = 'PAID' AND coalesce(paid_amount, 0) = 0 AND patient_copay > 0;
SELECT count(*) AS "잔여(전체·태그 무관)"
  FROM billings WHERE status = 'PAID' AND coalesce(paid_amount, 0) = 0 AND coalesce(patient_copay, 0) > 0;

COMMIT;
