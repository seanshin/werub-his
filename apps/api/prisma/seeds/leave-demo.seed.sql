-- 휴가/연차 데모 시드 — Clinic W.Sign 개발중(SIMULATION 결재) 대응. 추가 전용·멱등.
-- 직원(Staff 연결 User)에 연차 부여 + 샘플 휴가신청(승인/반려)
BEGIN;

-- 연차 잔여(올해) — Staff 연결된 활성 직원에게 ANNUAL 15일 부여(used 0~3 랜덤 결정적)
INSERT INTO leave_balances (id, user_id, year, type, granted, used)
SELECT gen_random_uuid(), s.user_id, EXTRACT(year FROM now())::int, 'ANNUAL', 15,
       (('x'||substr(md5(s.user_id::text),1,2))::bit(8)::int % 4)
FROM staff s
WHERE s.user_id IS NOT NULL AND s.status='ACTIVE'
  AND NOT EXISTS (SELECT 1 FROM leave_balances b WHERE b.user_id=s.user_id AND b.year=EXTRACT(year FROM now())::int AND b.type='ANNUAL');

-- 샘플 휴가신청 2건(승인 1·반려 1) — 데모. 마커 reason='SEED-LEAVE'
INSERT INTO leave_requests (id, user_id, type, from_date, to_date, days, reason, status, decided_at, created_at)
SELECT gen_random_uuid(), s.user_id, 'ANNUAL', now()-interval '5 days', now()-interval '4 days', 2, 'SEED-LEAVE 연차', 'APPROVED', now()-interval '5 days', now()-interval '6 days'
FROM staff s WHERE s.user_id IS NOT NULL AND s.status='ACTIVE' ORDER BY s.employee_number LIMIT 1;

INSERT INTO leave_requests (id, user_id, type, from_date, to_date, days, reason, status, decided_at, created_at)
SELECT gen_random_uuid(), s.user_id, 'ANNUAL', now()+interval '3 days', now()+interval '12 days', 8, 'SEED-LEAVE 장기연차(한도초과 반려)', 'REJECTED', now(), now()-interval '1 day'
FROM staff s WHERE s.user_id IS NOT NULL AND s.status='ACTIVE' ORDER BY s.employee_number OFFSET 1 LIMIT 1;

COMMIT;

SELECT '연차잔여 행' k, count(*)::text v FROM leave_balances WHERE year=EXTRACT(year FROM now())::int
UNION ALL SELECT '샘플 휴가신청', count(*)::text FROM leave_requests WHERE reason LIKE 'SEED-LEAVE%';
