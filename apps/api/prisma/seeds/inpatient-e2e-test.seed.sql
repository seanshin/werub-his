-- ============================================================
-- 입원(INPATIENT) progressive billing E2E 테스트 라인
-- ERP 요청(erp-inpatient-lines-request.md): 입원 라인 0건 → 2~3일치 발행
-- 대상: P2026-0005 정민호(NHI, 2026-06-02 입원), admission 4ff38743…
-- 마커: 고정 hex id 'e2e1%' → 검증 후 DELETE FROM ... WHERE id::text LIKE 'e2e1%'
-- 라인: 입원료 13801 ×3일(treatedOn 분리) + 약제 M040703 + 처치 KK059
-- 실행: ssh ... "docker exec -i docker-postgres-1 psql -U hospital -d hospitalrun" < this
-- ============================================================
BEGIN;

-- 멱등 정리(재실행) — 오더가 처방을 FK 로 물므로 오더부터 지운다
DELETE FROM orders        WHERE id::text LIKE 'e2e1%';
DELETE FROM prescriptions WHERE id::text LIKE 'e2e1%';
DELETE FROM encounters    WHERE id::text LIKE 'e2e1%';

-- INPATIENT encounter (admission 연결)
INSERT INTO encounters (id, patient_id, doctor_id, admission_id, visit_type, status, chief_complaint, signed_at, created_at, updated_at)
VALUES ('e2e10000-0000-4000-a000-000000000001',
        '00000000-0000-4000-a000-000000d00005',
        '00000000-0000-4000-a000-000000a00006',
        '4ff38743-a892-4abf-9fc2-c981bb0514d4',
        'INPATIENT', 'SIGNED', 'SEED-IP-E2E 입원 진료비 검증', now(), now(), now());

-- 처방 5건: 입원료 ×3일 + 약제 + 처치
INSERT INTO prescriptions (id, encounter_id, type, procedure_code_id, medication_code_id, quantity, dur_checked, dur_overridden, status, created_at, created_by)
VALUES
 ('e2e10000-0000-4000-a000-000000000101','e2e10000-0000-4000-a000-000000000001','ACTIVITY','881f7506-dd07-46de-9d6b-58d7548f2d88',NULL,1,false,false,'ACTIVE',now(),'00000000-0000-4000-a000-000000a00006'),
 ('e2e10000-0000-4000-a000-000000000102','e2e10000-0000-4000-a000-000000000001','ACTIVITY','881f7506-dd07-46de-9d6b-58d7548f2d88',NULL,1,false,false,'ACTIVE',now(),'00000000-0000-4000-a000-000000a00006'),
 ('e2e10000-0000-4000-a000-000000000103','e2e10000-0000-4000-a000-000000000001','ACTIVITY','881f7506-dd07-46de-9d6b-58d7548f2d88',NULL,1,false,false,'ACTIVE',now(),'00000000-0000-4000-a000-000000a00006'),
 ('e2e10000-0000-4000-a000-000000000201','e2e10000-0000-4000-a000-000000000001','MEDICATION',NULL,'9060f84e-04fb-4efe-b408-86801b91c28a',6,false,false,'ACTIVE',now(),'00000000-0000-4000-a000-000000a00006'),
 ('e2e10000-0000-4000-a000-000000000301','e2e10000-0000-4000-a000-000000000001','ACTIVITY','d884dc39-9f03-47aa-9e68-308954b69938',NULL,2,false,false,'ACTIVE',now(),'00000000-0000-4000-a000-000000a00006');

-- 오더 5건 — 🔴 런타임 정본(PrescriptionService)은 처방·오더를 한 트랜잭션에서 만든다.
-- 처방만 넣으면 그 처방은 조제 큐(orders 기준)·오더 서명 원장에 영영 안 보인다
-- (2026-09-16 실측: 오더 없는 처방 250건은 전부 시드 산출물 · 이 파일이 5건).
INSERT INTO orders (id, prescription_id, department, status, priority, created_at, updated_at)
VALUES
 -- department: ACTIVITY·NURSING 은 제 부서가 없어 정본 TYPE_TO_DEPARTMENT 가 PHARMACY 로 대체한다(스키마 enum 4종)
 ('e2e10000-0000-4000-a000-000000000401','e2e10000-0000-4000-a000-000000000101','PHARMACY','COMPLETED','ROUTINE',now(),now()),
 ('e2e10000-0000-4000-a000-000000000402','e2e10000-0000-4000-a000-000000000102','PHARMACY','COMPLETED','ROUTINE',now(),now()),
 ('e2e10000-0000-4000-a000-000000000403','e2e10000-0000-4000-a000-000000000103','PHARMACY','COMPLETED','ROUTINE',now(),now()),
 ('e2e10000-0000-4000-a000-000000000404','e2e10000-0000-4000-a000-000000000201','PHARMACY','COMPLETED','ROUTINE',now(),now()),
 ('e2e10000-0000-4000-a000-000000000405','e2e10000-0000-4000-a000-000000000301','PHARMACY','COMPLETED','ROUTINE',now(),now());

COMMIT;

SELECT 'IP enc' k, count(*) c FROM encounters WHERE id::text LIKE 'e2e1%'
UNION ALL SELECT 'IP rx', count(*) FROM prescriptions WHERE id::text LIKE 'e2e1%'
UNION ALL SELECT 'IP ord', count(*) FROM orders WHERE id::text LIKE 'e2e1%';
