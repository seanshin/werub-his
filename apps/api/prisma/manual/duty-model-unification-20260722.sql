-- 당직 모델 이원화 실통합 P1 (2026-07-22, duty-model-unification.plan.md)
-- staff_schedules(비OFF) → duty_entries 이관. 멱등(NOT EXISTS 스킵)·원본 보존.
-- OFF는 이관하지 않음 — 승인 LeaveRequest가 정본(통합뷰에서 병합).
-- 실행: docker exec -i docker-postgres-1 psql -U hospital hospitalrun < duty-model-unification-20260722.sql

BEGIN;

-- [리포트] 이관 전 현황
SELECT 'before: staff_schedules non-OFF' AS label, count(*) FROM staff_schedules WHERE shift_type <> 'OFF';
SELECT 'before: duty_entries' AS label, count(*) FROM duty_entries;

-- [리포트] 이관 불가(Staff.userId 없음) — 있으면 수동 매핑 대상
SELECT 'skipped: no user_id' AS label, ss.staff_id, ss.date, ss.shift_type
FROM staff_schedules ss JOIN staff s ON s.id = ss.staff_id
WHERE ss.shift_type <> 'OFF' AND s.user_id IS NULL;

-- 이관 본문 (DutyEntry 쓰기 규약: staffName=성+이름, role 소문자, department 없으면 '미지정')
INSERT INTO duty_entries (id, date, shift, staff_id, staff_name, role, department, created_at)
SELECT gen_random_uuid(), ss.date, ss.shift_type, s.user_id::text,
       COALESCE(u.family_name, '') || COALESCE(u.given_name, ''),
       CASE u.role WHEN 'DOCTOR' THEN 'doctor' WHEN 'NURSE' THEN 'nurse' ELSE lower(u.role::text) END,
       COALESCE(u.department, '미지정'),
       now()
FROM staff_schedules ss
JOIN staff s ON s.id = ss.staff_id AND s.user_id IS NOT NULL
JOIN users u ON u.id = s.user_id
WHERE ss.shift_type <> 'OFF'
  AND NOT EXISTS (
    SELECT 1 FROM duty_entries de
    WHERE de.staff_id = s.user_id::text AND de.date = ss.date AND de.shift = ss.shift_type
  );

-- [리포트] 이관 후 현황
SELECT 'after: duty_entries' AS label, count(*) FROM duty_entries;

COMMIT;
