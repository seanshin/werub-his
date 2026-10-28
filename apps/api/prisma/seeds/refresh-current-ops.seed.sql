-- ============================================================
-- 현 시점 운영 데이터 리프레시 — 오래된 환자 마감 + 신규 시드
-- 마감: 입원 퇴원·대기열 완료·수납 완료(SEED-ERP-CALC 제외)
-- 신규: 입원 5(재원 1~9일) + 대기열 10(접수~수납대기~완료, 분 단위)
-- 마커: admit_reason='SEED-CURRENT' / waiting_queue.reason='SEED-CURRENT'
-- 실행: docker exec -i docker-postgres-1 psql -U hospital -d hospitalrun < <this>
-- ============================================================
BEGIN;

-- ============ PART 0: 신규 시드 재실행 정리(멱등) ============
DELETE FROM waiting_queue WHERE reason = 'SEED-CURRENT';
UPDATE beds SET status='AVAILABLE'::"BedStatus" WHERE id IN (SELECT bed_id FROM admissions WHERE admit_reason='SEED-CURRENT');
DELETE FROM admissions WHERE admit_reason = 'SEED-CURRENT';

-- ============ PART 1: 오래된 환자 마감 ============
-- 입원 → 퇴원(5일 재원 후, 과거)
-- 🔴 종전 결함: `admit_date + 5일` 을 조건 없이 박아, **어제 입원한 환자의 퇴원일이 4일 뒤(미래)** 가 됐다.
--    이미 '퇴원'으로 기록된 법정 입퇴원 기록의 퇴원일이 아직 오지 않은 날이다(재원일수 집계도 음수 구간이 생긴다).
--    퇴원일은 입원일 이후이면서 **지금을 넘지 않는다** — 5일이 지나지 않았으면 지금으로 마감한다.
UPDATE admissions SET status='DISCHARGED'::"AdmissionStatus",
       discharge_date = LEAST(admit_date + interval '5 days', now()), updated_at=now()
  WHERE status='ADMITTED'::"AdmissionStatus";
-- 병상 해제
UPDATE beds SET status='AVAILABLE'::"BedStatus" WHERE status='OCCUPIED'::"BedStatus";
-- 대기열 활성 → 완료
UPDATE waiting_queue SET status='COMPLETED', completed_at = COALESCE(completed_at, checked_in_at + interval '30 min')
  WHERE status IN ('WAITING','CALLED','IN_CONSULTATION','CASHIER_WAITING');
-- 수납 완료(ERP 검증 시드 제외)
UPDATE billings SET status='PAID'::"BillingStatus", paid_at = now() - interval '3 days', paid_amount = patient_copay, payment_method='CARD', updated_at=now()
  WHERE status IN ('PENDING','PARTIAL') AND (cashier_note IS DISTINCT FROM 'SEED-ERP-CALC');

-- ============ PART 2: 신규 입원 5 (현 시점, 재원 1~9일) ============
WITH pat AS (SELECT row_number() OVER () rn, id FROM (SELECT id FROM patients WHERE mrn NOT LIKE 'SEED-ERP-%' ORDER BY id LIMIT 20) p),
     bed AS (SELECT row_number() OVER () rn, id FROM (SELECT id FROM beds WHERE status='AVAILABLE'::"BedStatus" ORDER BY id LIMIT 5) b),
     doc AS (SELECT row_number() OVER () rn, id FROM (SELECT id FROM users WHERE role='DOCTOR'::"UserRole" ORDER BY id LIMIT 5) d)
INSERT INTO admissions (id, patient_id, bed_id, admitting_doctor_id, attending_doctor_id, admit_date, status, admit_reason, created_at, updated_at)
SELECT gen_random_uuid(), pat.id, bed.id, doc.id, doc.id,
       now() - ((g.g * 1.8)::text || ' days')::interval, 'ADMITTED'::"AdmissionStatus", 'SEED-CURRENT', now(), now()
FROM generate_series(1,5) g JOIN pat ON pat.rn=g.g JOIN bed ON bed.rn=g.g JOIN doc ON doc.rn=g.g;

UPDATE beds SET status='OCCUPIED'::"BedStatus" WHERE id IN (SELECT bed_id FROM admissions WHERE admit_reason='SEED-CURRENT');

-- ============ PART 3: 신규 대기열 10 (현 시점, 분 단위 스테이지) ============
WITH pat AS (SELECT row_number() OVER () rn, id FROM (SELECT id FROM patients WHERE mrn NOT LIKE 'SEED-ERP-%' ORDER BY id DESC LIMIT 12) p),
     doc AS (SELECT row_number() OVER () rn, id FROM (SELECT id FROM users WHERE role='DOCTOR'::"UserRole" ORDER BY id LIMIT 12) d),
     stages(rn, status, ci, st, co, dept) AS (VALUES
       (1,'WAITING',10,NULL::int,NULL::int,'내과'),(2,'WAITING',25,NULL,NULL,'정형외과'),(3,'WAITING',40,NULL,NULL,'소아과'),(4,'WAITING',55,NULL,NULL,'내과'),
       (5,'IN_CONSULTATION',65,20,NULL,'내과'),(6,'IN_CONSULTATION',72,45,NULL,'외과'),
       (7,'CASHIER_WAITING',100,80,10,'내과'),(8,'CASHIER_WAITING',110,85,35,'정형외과'),(9,'CASHIER_WAITING',120,95,50,'내과'),
       (10,'COMPLETED',130,100,5,'가정의학과'))
INSERT INTO waiting_queue (id, patient_id, doctor_id, department_name, queue_number, status, checked_in_at, called_at, started_at, completed_at, reason, created_at)
SELECT gen_random_uuid(), pat.id, doc.id, s.dept, 100 + s.rn, s.status,
       now() - (s.ci::text || ' min')::interval,
       CASE WHEN s.st IS NOT NULL THEN now() - ((s.st + 5)::text || ' min')::interval END,
       CASE WHEN s.st IS NOT NULL THEN now() - (s.st::text || ' min')::interval END,
       -- 🔴 종전 결함: 수납 대기(CASHIER_WAITING) 3건에도 completed_at 을 채웠다.
       --    이 파일 PART 1 은 completed_at 을 'COMPLETED'의 증거로 쓰고, 정본
       --    `waiting-queue.service` 도 완료/취소/노쇼에만 채운다("진료를 마친 게 아니다").
       --    대기열 완료 건수·평균 소요시간 집계가 수납 대기 건을 완료로 읽었다.
       CASE WHEN s.status = 'COMPLETED' AND s.co IS NOT NULL THEN now() - (s.co::text || ' min')::interval END,
       'SEED-CURRENT', now()
FROM stages s JOIN pat ON pat.rn=s.rn JOIN doc ON doc.rn=s.rn;

COMMIT;

-- 검증
SELECT '신규입원(ADMITTED)' k, count(*) FROM admissions WHERE admit_reason='SEED-CURRENT'
UNION ALL SELECT '신규대기열', count(*) FROM waiting_queue WHERE reason='SEED-CURRENT'
UNION ALL SELECT '남은 ADMITTED(전체)', count(*) FROM admissions WHERE status='ADMITTED'::"AdmissionStatus"
UNION ALL SELECT '남은 활성대기열', count(*) FROM waiting_queue WHERE status IN ('WAITING','CALLED','IN_CONSULTATION','CASHIER_WAITING')
UNION ALL SELECT '미수납 billings(SEED-ERP 제외)', count(*) FROM billings WHERE status IN ('PENDING','PARTIAL') AND cashier_note IS DISTINCT FROM 'SEED-ERP-CALC';
