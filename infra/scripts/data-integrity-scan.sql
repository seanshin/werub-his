-- 데이터 정합성 스캔 (2026-08-03 신설)
--
-- 도메인 횡단 불변식을 한 번에 훑는다. **비파괴 — 읽기 전용**.
-- 실행:
--   docker exec docker-postgres-1 psql -U hospital -d hospitalrun -f /tmp/data-integrity-scan.sql
--
-- severity: 🔴=임상/재무 영향 · 🟡=운영 혼선 · ⚪=관측(정상일 수 있음)
-- count 0 이 목표가 아닌 항목도 있다(⚪) — 판정은 사람이 한다.

\pset format aligned
\pset border 2
\timing off

WITH checks AS (

-- ══════════ 오더 ↔ 처방 ══════════
SELECT '🔴' AS sev, '01 취소 오더인데 처방 ACTIVE' AS chk, count(*) AS n
  FROM orders o JOIN prescriptions p ON p.id = o.prescription_id
  WHERE o.status = 'CANCELLED' AND p.status = 'ACTIVE'
UNION ALL
SELECT '🔴', '02 취소 처방인데 오더 진행중', count(*)
  FROM orders o JOIN prescriptions p ON p.id = o.prescription_id
  WHERE p.status = 'CANCELLED' AND o.status IN ('ORDERED', 'RECEIVED', 'IN_PROGRESS')
UNION ALL
SELECT '🔴', '03 취소 처방인데 예정 투약(MAR) 잔존', count(*)
  FROM medication_administrations ma JOIN prescriptions p ON p.id = ma.prescription_id
  WHERE p.status = 'CANCELLED' AND ma.status = 'SCHEDULED'
UNION ALL
-- 처방 중단(2026-09-30) — 중단은 접수 전 오더를 취소하고 **중단 시각 이후** 예정 투약만 지운다(이전 예정분은 기록 대기로 남는 것이 정상)
SELECT '🔴', '73 중단 처방인데 접수 전 오더 잔존', count(*)
  FROM orders o JOIN prescriptions p ON p.id = o.prescription_id
  WHERE p.status = 'DISCONTINUED' AND o.status = 'ORDERED'
UNION ALL
SELECT '🔴', '74 중단 처방인데 중단 시각 이후 예정 투약(MAR) 잔존', count(*)
  FROM medication_administrations ma JOIN prescriptions p ON p.id = ma.prescription_id
  WHERE p.status = 'DISCONTINUED' AND ma.status = 'SCHEDULED'
    AND (p.discontinued_at IS NULL OR ma.scheduled_at >= p.discontinued_at)
UNION ALL
-- 환자 여정 원장(2026-10-01 여정 P0-9 · patient-journey-model.plan.md §5.12 Q4·Q5) — **수만 센다**(자동 교정·소급 수정 없음).
--   75 같은 환자·유형·밀리초 묶음: 이중 발행인지 같은 순간의 서로 다른 사실인지 원장만으로 가를 수 없다(멱등 키 도입 전 과거 행 포함).
--   76 어휘 밖 저장값: 어휘 가드는 **발행 지점**만 본다 — 시드·과거 코드가 쓴 이름(`ROUND` 등)은 여기서만 보인다.
--      아래 목록은 shared `JOURNEY_EVENT_TYPES` 와 기계 대조된다(`test/journey/journey-p0-guards.spec.ts`).
SELECT '⚪', '75 여정 원장 — 같은 환자·유형·밀리초 묶음(중복 의심)', count(*)
  FROM (SELECT patient_id, event_type, event_at FROM patient_journey_events GROUP BY 1, 2, 3 HAVING count(*) > 1) x
UNION ALL
SELECT '⚪', '76 여정 원장 — 어휘 밖 이름으로 저장된 행', count(*)
  FROM patient_journey_events
  WHERE event_type <> ALL (ARRAY[
    'RECEPTION_CHECKIN','RECEPTION_CALLED','ENCOUNTER_START','ENCOUNTER_SIGNED','ENCOUNTER_AMENDED','APPOINTMENT_BOOKED','PRESCRIPTION_ADDED','ORDER_CREATED',
    'ORDER_COMPLETED','LAB_RESULT','IMAGING_RESULT','DISPENSED','MEDICATION_ADMINISTERED','TRANSFUSION_COMPLETED','CANCER_REGISTRY_CANDIDATE','MDT_DECISION',
    'PROTOCOL_STEP','BILLING_CREATED','BILLING_PAID','BILLING_AMEND_REVIEW','BILLING_CREATE_FAILED','CLAIM_REVIEW','ER_ARRIVAL','ER_TRIAGE',
    'ER_TREATMENT_START','ER_DISPOSITION','ER_CHECKOUT','ER_BILLING_FAILED','ER_BED_ASSIGNED','ER_BED_MOVED','ER_BED_RELEASED','GOLDEN_PATHWAY_ACTIVATED',
    'ADMISSION','ADMISSION_CANCELLED','BED_TRANSFER','TRANSFER_CARE','DISCHARGE','SURGERY_START','SURGERY_COMPLETE','PACU_ADMISSION',
    'PACU_DISCHARGE','NEWBORN_CRITICAL','CONSENT_REQUESTED','CONSENT_SIGNED','CONSENT_COMPLETED','CONSENT_REVOKED','CHECKUP_RESERVED','CHECKUP_CHECKIN',
    'CHECKUP_STATION_ARRIVE','CHECKUP_STATION_COMPLETE','CHECKUP_CRITICAL','CHECKUP_COMPLETE','CHECKUP_CANCELLED','CHRONIC_ALERT','CSSD_RECALL','voc.received',
    'voc.answered','voc.closed','PATIENT_MESSAGE_SENT','PATIENT_MESSAGE_REPLIED','DIAGNOSTIC_CANCELLED','DIAGNOSTIC_ON_HOLD','DIAGNOSTIC_RESUMED'
  ]::text[])
UNION ALL
-- 여정 P1(2026-10-01 · §5.12 Q1·Q3) — **P1 이후 실업무 행(data_origin='LIVE')만** 센다. 과거 행은 판정 대상이 아니다(소급 없음).
--   77 방문 단위 필수 유형인데 방문 단위(episode) 관계가 없는 행 — 목록은 shared `JOURNEY_EPISODE_REQUIRED` 와 기계 대조
--   78 응급 도착 사건의 발생 시각이 응급 방문 원장의 도착 시각과 다르다 — 같은 사실에 시각이 둘(P12)
SELECT '🟡', '77 여정 원장 — 방문 단위 귀속 없는 신규 행', count(*)
  FROM patient_journey_events e
  WHERE e.data_origin = 'LIVE'
    AND e.event_type = ANY (ARRAY['RECEPTION_CHECKIN','RECEPTION_CALLED','ER_ARRIVAL','ER_TRIAGE','ER_TREATMENT_START','ER_DISPOSITION','ER_CHECKOUT','ER_BED_ASSIGNED','ER_BED_MOVED','ER_BED_RELEASED','ADMISSION','ADMISSION_CANCELLED','BED_TRANSFER','TRANSFER_CARE','DISCHARGE','SURGERY_START','SURGERY_COMPLETE','PACU_ADMISSION','PACU_DISCHARGE','CHECKUP_RESERVED','CHECKUP_CHECKIN','CHECKUP_STATION_ARRIVE','CHECKUP_STATION_COMPLETE','CHECKUP_COMPLETE','CHECKUP_CANCELLED']::text[])
    AND NOT EXISTS (SELECT 1 FROM patient_journey_event_objects o WHERE o.event_id = e.id AND o.qualifier = 'episode')
UNION ALL
SELECT '🟡', '78 여정 원장 — 응급 도착 발생 시각 ≠ 응급 방문 도착 시각', count(*)
  FROM patient_journey_events e
  JOIN emergency_visits v ON v.id = e.ref_id
  WHERE e.data_origin = 'LIVE' AND e.event_type = 'ER_ARRIVAL' AND e.ref_type = 'EmergencyVisit'
    AND e.occurred_at IS DISTINCT FROM v.arrival_at
UNION ALL
-- 여정 P2(2026-10-01 · §5.2 I5·I6 · §5.12 Q2·Q6) — **수와 분모만**(자동 교정·사건 생성 없음 — 소급하지 않는다).
--   경계 시각은 shared `JOURNEY_REF_ATTACHED_SINCE`(귀속까지 갖춘 발행 코드 커밋 시각)와 기계 대조된다(`test/journey/journey-p2.spec.ts`).
--   🔴 커밋 시각 ≠ 운영 배포 시각 — 그 사이 구간의 부재는 코드가 없어서다(첫 판정 때 감안).
--   79 응급 진료 시작 시각이 있는데 진료 시작 사건이 없는 방문(I5)
--   80 퇴원·전원된 입원인데 퇴원 사건이 없는 입원(I5)
--   81 종결 사건이 둘 이상인 방문 단위(정정 제외 · 활동이 기록된 P2 이후 행만)(I6)
SELECT '🟡', '79 여정 원장 — 응급 진료 시작 사건 누락(상태–사건 대조)', count(*)
  FROM emergency_visits v
  WHERE v.treatment_started_at >= '2026-09-14T14:33:36+09:00'::timestamptz
    AND NOT EXISTS (SELECT 1 FROM patient_journey_events e
                    WHERE e.ref_type = 'EmergencyVisit' AND e.ref_id = v.id AND e.event_type = 'ER_TREATMENT_START')
UNION ALL
SELECT '🟡', '80 여정 원장 — 퇴원 사건 누락(상태–사건 대조)', count(*)
  FROM admissions a
  WHERE a.status IN ('DISCHARGED', 'TRANSFERRED') AND a.discharge_date >= '2026-10-01T10:42:38+09:00'::timestamptz
    AND NOT EXISTS (SELECT 1 FROM patient_journey_events e
                    WHERE e.ref_type = 'ADMISSION' AND e.ref_id = a.id AND e.event_type = 'DISCHARGE')
UNION ALL
SELECT '🟡', '81 여정 원장 — 종결 사건이 둘 이상인 방문 단위', count(*)
  FROM (SELECT o.object_type, o.object_id, e.activity
          FROM patient_journey_event_objects o JOIN patient_journey_events e ON e.id = o.event_id
          WHERE o.qualifier = 'episode' AND e.transition = 'COMPLETED' AND e.supersedes_id IS NULL
            AND e.activity IN ('ER_VISIT', 'INPATIENT_STAY', 'CHECKUP_VISIT', 'OR_STAY')
          GROUP BY 1, 2, 3 HAVING count(*) > 1) x
UNION ALL
-- 여정 P2 확장(2026-10-01 · I5 상태–사건 대조를 응급 도착·입원·수술·PACU 로) — 수만 센다(사건을 만들지 않는다 · 소급 없음).
--   경계 = shared `JOURNEY_REF_ATTACHED_SINCE`(발행이 원 기록 id 를 싣기 시작한 커밋 · `git log -S` 로 확인 · 기계 대조).
--   🔴 첫 운영 측정은 **전부 시드**였다(시드 UUID·감사 기록 없음 — 시드 생성기가 상태만 쓰고 사건을 남기지 않는다). 코드 경로는
--      전부 발행한다(구조 가드 `journey-i5-extension.spec.ts`). 이 수가 늘면 그때가 신호다.
--   82 응급 방문인데 도착 사건이 없다 · 83 입원인데 입원 사건이 없다
--   84 수술 시작·종료 시각이 있는데 그 사건이 없다 · 85 PACU 입실·퇴실인데 그 사건이 없다
SELECT '🟡', '82 여정 원장 — 응급 도착 사건 누락(상태–사건 대조)', count(*)
  FROM emergency_visits v
  WHERE v.created_at >= '2026-10-01T10:42:38+09:00'::timestamptz
    AND NOT EXISTS (SELECT 1 FROM patient_journey_events e
                    WHERE e.ref_type = 'EmergencyVisit' AND e.ref_id = v.id AND e.event_type = 'ER_ARRIVAL')
UNION ALL
SELECT '🟡', '83 여정 원장 — 입원 사건 누락(상태–사건 대조)', count(*)
  FROM admissions a
  WHERE a.created_at >= '2026-07-10T10:34:18+09:00'::timestamptz
    AND NOT EXISTS (SELECT 1 FROM patient_journey_events e
                    WHERE e.ref_type = 'ADMISSION' AND e.ref_id = a.id AND e.event_type = 'ADMISSION')
UNION ALL
SELECT '🟡', '84 여정 원장 — 수술 시작·종료 사건 누락(상태–사건 대조)', count(*)
  FROM surgeries s
  WHERE (s.started_at >= '2026-10-01T10:42:38+09:00'::timestamptz
         AND NOT EXISTS (SELECT 1 FROM patient_journey_events e
                         WHERE e.ref_type = 'SURGERY' AND e.ref_id = s.id AND e.event_type = 'SURGERY_START'))
     OR (s.ended_at >= '2026-05-08T19:56:43+09:00'::timestamptz
         AND NOT EXISTS (SELECT 1 FROM patient_journey_events e
                         WHERE e.ref_type = 'SURGERY' AND e.ref_id = s.id AND e.event_type = 'SURGERY_COMPLETE'))
UNION ALL
SELECT '🟡', '85 여정 원장 — PACU 입실·퇴실 사건 누락(상태–사건 대조)', count(*)
  FROM pacu_records p
  WHERE (p.arrival_time >= '2026-07-04T10:03:14+09:00'::timestamptz
         AND NOT EXISTS (SELECT 1 FROM patient_journey_events e
                         WHERE e.ref_type = 'PACU' AND e.ref_id = p.id AND e.event_type = 'PACU_ADMISSION'))
     OR (p.discharge_time >= '2026-07-04T10:03:14+09:00'::timestamptz
         AND NOT EXISTS (SELECT 1 FROM patient_journey_events e
                         WHERE e.ref_type = 'PACU' AND e.ref_id = p.id AND e.event_type = 'PACU_DISCHARGE'))
UNION ALL
-- 2026-10-01 LIS 검사코드 카탈로그 — 결과 항목(lab_test_codes)이 가리키는 처방 코드가 **없거나** 실제 수가 마스터에서 **검사 범위 밖**(다른 행위)인 패널.
--   이 패널의 결과 항목은 카탈로그(전체 동기화 포함)로 LIS 에 가지 않는다. 범위 규칙은 `lis-reference.service.ts` labScope 와 같다(B/C/D 접두·검사 분류·LOINC).
--   🔴 첫 측정 18(처방 코드 없음 11 · 범위 밖 7 — 일반혈액 결과 항목이 '심전도검사' E6541 에 붙는 등 시드 EDI 코드가 실코드와 충돌). 자동 교정 없음 — EDI 매핑은 코드 마스터 검수.
--   86 결과 항목의 처방 코드가 없거나 검사 범위 밖인 패널(처방 코드 수)
SELECT '🟡', '86 검사 결과 항목 — 카탈로그에 실리지 않는 패널(처방 코드 없음·검사 범위 밖)', count(*)
  FROM (SELECT DISTINCT l.edi_code FROM lab_test_codes l WHERE l.is_active AND l.edi_code IS NOT NULL) x
  WHERE NOT EXISTS (
    SELECT 1 FROM procedure_codes p
    WHERE p.code = x.edi_code AND p.is_active AND p.valid_from <= now() AND (p.valid_to IS NULL OR p.valid_to >= now())
      AND (p.code LIKE 'B%' OR p.code LIKE 'C%' OR p.code LIKE 'D%' OR p.category IN ('검사료', '기초검사', '수혈검사') OR p.loinc_code IS NOT NULL))
UNION ALL
-- 2026-10-03 위치 원장 — 한 환자에 열린 위치(left_at IS NULL)는 하나여야 한다("지금 어디"는 하나).
--   🔴 같은 순간 들어온 여정 사건 둘이 서로의 열린 위치를 못 본 채 각자 열었다(FloorService.recordLocation 에 환자별 잠금 신설).
--   첫 측정 18(잠금 이전 행 — 그 환자의 다음 위치 기록이 전부 닫는다). 자동 교정 없음 — 줄어드는 목록.
--   87 열린 위치가 둘 이상인 환자 수
SELECT '🟡', '87 위치 원장 — 열린 위치가 둘 이상인 환자', count(*)
  FROM (SELECT patient_id FROM patient_locations WHERE left_at IS NULL GROUP BY patient_id HAVING count(*) > 1) x
UNION ALL
SELECT '🟡', '04 취소 오더에 취소 시각 없음', count(*)
  FROM orders WHERE status = 'CANCELLED' AND cancelled_at IS NULL
UNION ALL
SELECT '🟡', '05 완료 오더에 완료 시각 없음', count(*)
  FROM orders WHERE status = 'COMPLETED' AND completed_at IS NULL
UNION ALL
SELECT '🟡', '06 진행중 오더에 시작 시각 없음', count(*)
  FROM orders WHERE status = 'IN_PROGRESS' AND started_at IS NULL
UNION ALL
SELECT '⚪', '07 ACTIVE 처방인데 오더 없음(검사/영상/약)', count(*)
  FROM prescriptions p
  WHERE p.status = 'ACTIVE' AND p.type IN ('LAB', 'IMAGING', 'MEDICATION')
    AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.prescription_id = p.id)
UNION ALL
SELECT '🟡', '08 오더 시각 역전(완료 < 시작)', count(*)
  FROM orders WHERE completed_at IS NOT NULL AND started_at IS NOT NULL AND completed_at < started_at

-- ══════════ 진료 기록 ══════════
UNION ALL
SELECT '🔴', '09 서명된 진료인데 진단 없음', count(*)
  FROM encounters e
  WHERE e.status = 'SIGNED'
    AND NOT EXISTS (SELECT 1 FROM encounter_diagnoses d WHERE d.encounter_id = e.id)
UNION ALL
SELECT '🟡', '10 서명된 진료인데 서명 시각/서명자 없음', count(*)
  FROM encounters WHERE status = 'SIGNED' AND (signed_at IS NULL OR signed_by IS NULL)
UNION ALL
SELECT '🟡', '11 서명된 진료인데 SOAP 전부 비어있음', count(*)
  FROM encounters
  WHERE status = 'SIGNED'
    AND coalesce(subjective,'') = '' AND coalesce(objective,'') = ''
    AND coalesce(assessment,'') = '' AND coalesce(plan,'') = ''
UNION ALL
SELECT '⚪', '12 30일 넘은 DRAFT 진료(미완결)', count(*)
  FROM encounters WHERE status = 'DRAFT' AND created_at < now() - interval '30 days'
UNION ALL
SELECT '🔴', '13 처방이 달린 진료가 DRAFT', count(*)
  FROM encounters e
  WHERE e.status = 'DRAFT' AND EXISTS (SELECT 1 FROM prescriptions p WHERE p.encounter_id = e.id)

-- ══════════ 입퇴원 · 병상 ══════════
UNION ALL
SELECT '🔴', '14 퇴원했는데 병상 점유중', count(*)
  FROM admissions a JOIN beds b ON b.id = a.bed_id
  WHERE a.status = 'DISCHARGED' AND b.status = 'OCCUPIED'
    AND NOT EXISTS (SELECT 1 FROM admissions a2 WHERE a2.bed_id = a.bed_id AND a2.status = 'ADMITTED')
UNION ALL
SELECT '🔴', '15 입원중인데 병상 미배정', count(*)
  FROM admissions WHERE status = 'ADMITTED' AND bed_id IS NULL
UNION ALL
SELECT '🔴', '16 같은 병상에 재원 환자 2명 이상', count(*)
  FROM (SELECT bed_id FROM admissions WHERE status = 'ADMITTED' AND bed_id IS NOT NULL
        GROUP BY bed_id HAVING count(*) > 1) x
UNION ALL
SELECT '🔴', '17 퇴원일이 입원일보다 빠름', count(*)
  FROM admissions WHERE discharge_date IS NOT NULL AND discharge_date < admit_date
UNION ALL
SELECT '🟡', '18 퇴원했는데 퇴원일 없음', count(*)
  FROM admissions WHERE status = 'DISCHARGED' AND discharge_date IS NULL
UNION ALL
SELECT '🟡', '19 퇴원했는데 퇴원요약 없음', count(*)
  FROM admissions WHERE status = 'DISCHARGED' AND coalesce(discharge_summary,'') = ''
UNION ALL
SELECT '🔴', '20 같은 환자가 동시에 2건 재원', count(*)
  FROM (SELECT patient_id FROM admissions WHERE status = 'ADMITTED'
        GROUP BY patient_id HAVING count(*) > 1) x

-- ══════════ 예약 · 대기 ══════════
UNION ALL
SELECT '🟡', '21 지난 예약이 아직 SCHEDULED', count(*)
  FROM appointments WHERE status = 'SCHEDULED' AND scheduled_at < now() - interval '1 day'
UNION ALL
SELECT '🟡', '22 취소 예약인데 취소 시각 없음', count(*)
  FROM appointments WHERE status = 'CANCELLED' AND cancelled_at IS NULL
UNION ALL
SELECT '🟡', '23 하루 넘게 대기중인 접수', count(*)
  FROM waiting_queue WHERE status IN ('WAITING', 'CALLED') AND created_at < now() - interval '1 day'
UNION ALL
SELECT '🟡', '24 완료 대기인데 완료 시각 없음', count(*)
  FROM waiting_queue WHERE status = 'COMPLETED' AND completed_at IS NULL

-- ══════════ 검사 · 영상 ══════════
UNION ALL
-- 상태 규약: COMPLETED = 결과 입력 완료(**검증 전**) · VERIFIED = 검증 완료.
-- ⚠️ "COMPLETED 인데 verified_at 없음" 은 정상이다 — 그걸 결함으로 세면 241건 오탐이 난다(2026-08-03 경험).
SELECT '🔴', '25 VERIFIED 인데 검증 스탬프 없음', count(*)
  FROM lab_results WHERE status = 'VERIFIED' AND (verified_at IS NULL OR verified_by IS NULL)
UNION ALL
SELECT '🟡', '25b COMPLETED 인데 검증 스탬프 잔존', count(*)
  FROM lab_results WHERE status = 'COMPLETED' AND (verified_at IS NOT NULL OR verified_by IS NOT NULL)
UNION ALL
SELECT '⚪', '25c 검증 대기 중인 결과(운영 지표)', count(*)
  FROM lab_results WHERE status = 'COMPLETED'
UNION ALL
SELECT '🟡', '26 검사 시각 역전(완료 < 채취)', count(*)
  FROM lab_results WHERE completed_at IS NOT NULL AND collected_at IS NOT NULL AND completed_at < collected_at
UNION ALL
-- 🔴 **취소된 오더**의 워크리스트 실패는 결함이 아니다(취소했으니 등록될 이유가 없다).
--    2026-08-10 실측: FAILED 2건이 전량 CANCELLED 였다. 활성 오더만 센다.
SELECT '🔴', '27 영상 워크리스트 등록 실패 잔존', count(*)
  FROM orders WHERE worklist_status = 'FAILED' AND status <> 'CANCELLED'

-- ══════════ 청구 ══════════
UNION ALL
-- 🔴 본인부담이 0 인 청구(전액 공단·무료)는 결제액 0 이 **정상**이다 — 제외하지 않으면 오탐이 섞인다
--    (2026-08-10 실측: 18건 중 1건이 그런 경우였다).
SELECT '🔴', '28 PAID 인데 결제액 없음/0', count(*)
  FROM billings WHERE status = 'PAID' AND coalesce(paid_amount, 0) = 0 AND coalesce(patient_copay, 0) > 0
UNION ALL
SELECT '🔴', '29 PAID 인데 결제 시각 없음', count(*)
  FROM billings WHERE status = 'PAID' AND paid_at IS NULL
UNION ALL
SELECT '🔴', '30 환불액이 결제액 초과', count(*)
  FROM billings WHERE coalesce(refund_amount, 0) > coalesce(paid_amount, 0)
UNION ALL
SELECT '🔴', '31 청구 총액 ≠ 라인 합계', count(*)
  FROM (SELECT b.id FROM billings b JOIN billing_items bi ON bi.billing_id = b.id
        GROUP BY b.id, b.total_amount HAVING b.total_amount <> sum(bi.amount)) x
UNION ALL
-- 🔴 진찰료 라인이 **0원**인 청구 — 라인은 있어 32번엔 안 걸리지만 수가 마스터가 비어(단가 0)
--    진찰료를 못 받고 있다(2026-09-03 실측 7건). AA257 재진진찰료 unit_price=0 · AA157 초진 부재.
--    billing.service 가 이제 방송(billing.consult_code_missing)으로 남기지만, 잔여는 여기서 센다.
SELECT '🟡', '32b 진찰료 라인이 0원(수가 마스터 결손)', count(distinct b.id)
  FROM billings b JOIN billing_items bi ON bi.billing_id = b.id
  WHERE bi.code_type = 'PROCEDURE' AND bi.code_name LIKE '%진찰료%' AND bi.unit_price = 0
UNION ALL
SELECT '🟡', '32 청구 라인이 없는 청구', count(*)
  FROM billings b WHERE NOT EXISTS (SELECT 1 FROM billing_items bi WHERE bi.billing_id = b.id)

-- ══════════ 환자 마스터 ══════════
UNION ALL
SELECT '🔴', '33 MRN 중복', count(*)
  FROM (SELECT mrn FROM patients WHERE mrn IS NOT NULL GROUP BY mrn HAVING count(*) > 1) x
UNION ALL
SELECT '🟡', '34 병합된 환자에 신규 진료 발생', count(*)
  FROM encounters e JOIN patients p ON p.id = e.patient_id
  WHERE p.merged_into_id IS NOT NULL
UNION ALL
SELECT '🔴', '35 사망 환자에 사망일 이후 진료', count(*)
  FROM encounters e JOIN patients p ON p.id = e.patient_id
  WHERE p.is_deceased AND p.death_date IS NOT NULL AND e.created_at > p.death_date
UNION ALL
SELECT '🟡', '36 생년월일이 미래이거나 150세 초과', count(*)
  FROM patients WHERE date_of_birth > current_date OR date_of_birth < current_date - interval '150 years'
UNION ALL
-- 🔴 DTO 검증 하한이 150년이라 123세(1902년생)가 **정상 통과**해 검사 워크리스트에 떴다(2026-08-12).
--    주민번호 앞 2자리를 세기 오판하면(02→1902 대신 2002) 정확히 이 모양이 된다.
--    실존 최고령 기록이 122세이므로 110세 초과는 **오타를 의심할 만하다** — 다만 어느 쪽이 참인지는
--    사람만 안다. 자동 교정 금지, 확인 대상으로만 올린다.
SELECT '⚪', '36b 110세 초과 — 생년 오타 의심(자동교정 금지)', count(*)
  FROM patients WHERE date_of_birth BETWEEN current_date - interval '150 years' AND current_date - interval '110 years'

-- ══════════ 알림 · 감사 ══════════
UNION ALL
SELECT '🟡', '37 존재하지 않는 사용자의 알림', count(*)
  FROM notifications n WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = n.user_id)
UNION ALL
SELECT '⚪', '38 미래 시각으로 기록된 감사', count(*)
  FROM audit_logs WHERE timestamp > now() + interval '1 hour'
UNION ALL
SELECT '🔴', '39 검진권 체인 불일치', count(*)
  FROM checkup_vouchers WHERE chain_valid = false

-- ══════════ 병상 점유 (2026-08-10 신설) ══════════
-- 🔴 함정: 병상은 **입원(admissions)과 응급(emergency_bed_assignments) 양쪽**으로 점유된다.
--    한쪽만 보고 "OCCUPIED 인데 재원자 없음"을 세면 오탐이 쏟아진다
--    (2026-08-10 실측: 입원만 보면 8건 오탐 — 그 병상엔 다른 환자가 재원 중이었다).
--    불변식은 **상태를 만드는 경로를 전부** 확인하고 세운다.
UNION ALL
SELECT '🔴', '40 응급 방문 종결인데 병상 미반납', count(*)
  FROM emergency_bed_assignments e JOIN emergency_visits v ON v.id = e.visit_id
  WHERE e.released_at IS NULL AND v.status = 'COMPLETED'
UNION ALL
SELECT '🔴', '41 유령 점유(입원·응급 모두 없음)', count(*)
  FROM beds b
  WHERE b.status = 'OCCUPIED'
    AND NOT EXISTS (SELECT 1 FROM admissions a WHERE a.bed_id = b.id AND a.status = 'ADMITTED')
    AND NOT EXISTS (SELECT 1 FROM emergency_bed_assignments e WHERE e.bed_id = b.id AND e.released_at IS NULL)
UNION ALL
SELECT '🔴', '42 재원자 있는데 병상이 OCCUPIED 아님', count(*)
  FROM admissions a JOIN beds b ON b.id = a.bed_id
  WHERE a.status = 'ADMITTED' AND b.status <> 'OCCUPIED'
UNION ALL
SELECT '🔴', '43 한 병상에 재원자 2명 이상', count(*)
  FROM (SELECT bed_id FROM admissions WHERE status = 'ADMITTED' AND bed_id IS NOT NULL
         GROUP BY bed_id HAVING count(*) > 1) x
UNION ALL
SELECT '🟡', '44 퇴원했는데 배정 이력 미반납', count(*)
  FROM bed_assignments ba JOIN admissions a ON a.id = ba.admission_id
  WHERE a.status IN ('DISCHARGED', 'TRANSFERRED') AND ba.released_at IS NULL

-- ══════════ 환자 마스터 위생 (2026-08-10 신설) ══════════
UNION ALL
SELECT '🔴', '45 MRN 중복', count(*)
  FROM (SELECT mrn FROM patients GROUP BY mrn HAVING count(*) > 1) x
UNION ALL
SELECT '🟡', '46 여권번호 중복', count(*)
  FROM (SELECT passport_number FROM patients
         WHERE passport_number IS NOT NULL AND passport_number <> ''
         GROUP BY passport_number HAVING count(*) > 1) x
UNION ALL
SELECT '🔴', '47 환자 이름이 비어있음', count(*)
  FROM patients WHERE coalesce(family_name, '') = '' AND coalesce(given_name, '') = ''
UNION ALL
-- 🔴 치료실 화면은 **'오늘' 예정만** 본다. 예정일이 지난 미완료 치료 오더는 어느 화면에도 뜨지 않아
--    조용히 방치된다(2026-08-12 실측 8건·예정일 77일 경과). 완료도 취소도 아닌 채 남은 오더는
--    사람이 판단해야 한다 — 자동 종결 금지.
-- 🔴 **취소된 치료가 미완료인 것은 정상이다.** 상위 오더가 취소됐는지 함께 봐야
--    "방치된 것"과 "닫힌 것"이 갈린다(2026-08-12 정리 후 8건이 남아 보이던 오탐).
SELECT '🟡', '48 예정일 30일 지난 미완료 치료 오더(취소되지도 않음)', count(*)
  FROM therapy_orders t
  JOIN orders o ON o.id = t.order_id
  WHERE t.completed_at IS NULL
    AND t.scheduled_date < current_date - interval '30 days'
    AND o.status <> 'CANCELLED'
UNION ALL
-- 🔴 같은 병의 세 번째 사례. **날짜 기반 워크스테이션은 '오늘' 것만 조회**하므로
--    (`where: { date: today }`) 지난 미처리 업무는 어느 화면에도 뜨지 않고 조용히 쌓인다.
--    치료 오더(48)·식사 오더(48b)·응급 방문(48c) 이 모두 같은 모양이다.
SELECT '🟡', '48b 30일 지난 미처리 식사 오더(영양 화면은 오늘만 봄)', count(*)
  FROM meal_orders
  WHERE status IN ('ORDERED', 'PREPARED') AND date < current_date - interval '30 days'
UNION ALL
SELECT '🟡', '48c 30일 지난 미종결 응급 방문(자동정리 OFF 면 안 사라짐)', count(*)
  FROM emergency_visits
  WHERE disposition IS NULL AND arrival_at < current_date - interval '30 days'
UNION ALL
-- 🔴 수술 일정이 **두 곳에 따로** 있다(`surgeries.scheduled_at` / `or_schedules.start_time`)
--    — 둘은 관계가 없어 서로 다른 값을 가질 수 있다. 실측 4건 중 2건이 어긋났다
--    (박철수 08:30 vs 13:00 · 신유리 08:30 vs 15:00). 같은 화면 위아래가 다른 시각을 말한다.
--    수술 시각은 금식·마취 준비와 직결된다. **어느 쪽이 참인지는 사람만 안다 — 자동 교정 금지.**
SELECT '🔴', '49 수술 예정시각 ≠ 수술실 배정시각(같은 수술·둘 다 미완료)', count(*)
  FROM or_schedules os
  JOIN surgeries s ON s.id = os.surgery_id
  WHERE s.status NOT IN ('COMPLETED', 'CANCELLED')
    AND to_char(s.scheduled_at AT TIME ZONE 'Asia/Seoul', 'HH24:MI') <> os.start_time
UNION ALL
-- 🔴 `anesthesia_type` 이 자유 문자열이라 **영문 코드와 한글이 섞여** 저장된다
--    (실측 `GENERAL` 1 / `전신마취` 5 · `LOCAL` 1 / `국소마취` 1). 표시는 shared 정본이
--    둘 다 받아 막고 있지만, 저장 값 통일은 마이그레이션이 필요하다.
-- 🔴 `or_schedules.start_time` 은 **문자열**이고 목록이 그 문자열로 정렬된다.
--    0 을 안 채운 값(`9:00`)이 하나 섞이면 사전순에서 `15:00` 뒤로 가, **오전 9시 수술이
--    오후 3시 뒤에** 표시된다(2026-09-03 운영 실측 — 정확히 그 상태였다).
--    수술 순서는 금식·마취 준비와 직결된다. DTO 에 `HH:MM` 정규식을 걸었고, 여기서는 잔여를 센다.
SELECT '🔴', '49b 수술실 시각이 HH:MM(0 채움) 형식이 아님(목록 정렬이 뒤집힘)', count(*)
  FROM or_schedules
  WHERE start_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
     OR end_time   !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
UNION ALL
SELECT '⚪', '50 마취 종류가 한글로 저장됨(코드 통일 대상)', count(*)
  FROM surgeries
  WHERE anesthesia_type IS NOT NULL
    AND anesthesia_type !~ '^[A-Z_]+$'
UNION ALL
-- 🔴 '묵은 미종결'의 네 번째 사례. 회복실에 **39일째 재실**인 환자가 3명 있었다(실측).
--    PACU 는 보통 수 시간이다 — 퇴실 처리가 안 된 채 남으면 평균 체류·병상 가용이 왜곡된다.
SELECT '🟡', '48d 24시간 넘게 PACU 재실(퇴실 처리 누락 의심)', count(*)
  FROM pacu_records
  WHERE discharge_time IS NULL AND arrival_time < now() - interval '24 hours'
UNION ALL
-- 🔴 다섯 번째 사례. 응급 베드가 **7일째 '청소 중'** 이었다(실측 2병상·화면은 붉게 지연 표시 중).
--    청소 완료 처리는 **사람의 행위**라 대신 눌러 줄 수 없다 — 다만 그동안 가용 병상이
--    그만큼 줄어 있으므로 눈에 띄게 한다.
SELECT '🟡', '48e 24시간 넘게 청소 중인 베드(가용 병상이 그만큼 줄어 있다)', count(*)
  FROM beds b
  WHERE b.status = 'CLEANING'
    AND EXISTS (
      SELECT 1 FROM emergency_bed_assignments a
      WHERE a.bed_id = b.id AND a.released_at < now() - interval '24 hours'
    )

-- ══════════ 시각 정합(2026-08-28 추가) ══════════
-- 🔴 번호가 `50` 으로 겹쳐 있었다 — `50` 은 마취 종류 항목이 이미 쓰고 있고
--    계획서가 그 번호로 지칭한다(`screen-walkthrough-audit.plan.md`). 항목은 **번호로 불리므로**
--    겹치면 대화에서 다른 것을 가리킨다. 나중에 붙은 이 블록을 58~61 로 옮겼다.
-- 🔴 스캔이 이 축을 안 보고 있었다. 실측으로 186·30·6건이 있었는데 한 번도 드러난 적이 없다.
--    원인은 데이터가 아니라 **생성기**였다 — 시드가 `createdAt` 을 안 넣어 삽입 시각이 박혔고,
--    데모 롤포워드는 일 단위로만 옮겨 "일어난 일"을 미래로 보냈다. 둘 다 고쳤고, 여기서 감시한다.
UNION ALL
-- 🔴 **1초 미만 역전은 아티팩트다**(2026-09-03 실측). 같은 트랜잭션 안에서 `signedAt` 과
--    `createdAt` 이 각자 `now()` 를 잡으면 밀리초 단위로 뒤집힌다 — 사람이 고칠 사실이 아니다.
--    실측: 59번 30건이 **전부 1초 미만**이었고, 58번은 182건이 하루 이상(진짜 시드 흔적)·4건만 1초 미만.
--    전부 적색으로 띄우면 거짓 경보가 진짜 적색을 묻는다.
--    ("조건이 참인가"가 아니라 "얼마나 참인가"를 재야 아티팩트와 사실이 갈린다 — 판정 규칙 §7)
-- 🔴 (2026-09-03 판정) 잔존 182건은 **전부 created_at = 2026-06-22 17:52:27 단일 순간** — 백필 배치가
--    삽입 시각을 created_at 에 박고 signed_at 은 임상 시각을 담은 시드 흔적이다(생성기는 이미 수정됨).
--    같은 created_at 을 20행 이상이 공유하면 일괄 삽입이다(간호기록은 사람이 건별로 쓴다) —
--    그 배치를 ⚪ 58c 로 분리해 적색은 **생성기 수정 이후의 신규 역전**만 가리키게 한다.
--    데이터는 교정하지 않는다(모르는 시각을 지어내면 그것이 거짓 원장).
--    🔴 군집은 **분 단위 절단**으로 잡는다 — 마이크로초는 행마다 달라 원시값 GROUP BY 는 무동작이었다
--    (재주입식 검증: 원시값 판정은 58c=0 으로 헛돌았다 · 실측 182행=고유 182·분 단위 2군집).
SELECT '🔴', '58 간호기록 서명이 생성보다 앞(1초 초과·백필 배치 제외)', count(*)
  FROM nursing_notes WHERE signed_at IS NOT NULL AND created_at - signed_at > interval '1 second'
   AND date_trunc('minute', created_at) NOT IN
       (SELECT date_trunc('minute', created_at) FROM nursing_notes GROUP BY 1 HAVING count(*) >= 20)
UNION ALL
-- ⚪ 버리지 않는다 — 배치 삽입분 역전은 규모 추이만 본다(늘면 새 백필이 들어온 것)
SELECT '⚪', '58c 백필 배치 삽입분 서명 역전(생성시각=일괄 삽입·시드 흔적)', count(*)
  FROM nursing_notes WHERE signed_at IS NOT NULL AND created_at - signed_at > interval '1 second'
   AND date_trunc('minute', created_at) IN
       (SELECT date_trunc('minute', created_at) FROM nursing_notes GROUP BY 1 HAVING count(*) >= 20)
UNION ALL
SELECT '🔴', '59 진료 서명이 생성보다 앞(1초 초과)', count(*)
  FROM encounters WHERE signed_at IS NOT NULL AND created_at - signed_at > interval '1 second'
UNION ALL
-- 🔴 아티팩트도 **버리지 않는다** — 관측 항목(⚪)으로 남겨 규모가 갑자기 늘면 보이게 한다
--    (0 이 목표가 아닌 항목이다. 늘어나면 시각 기록 방식이 바뀐 것이다)
SELECT '⚪', '58b 서명·생성 1초 미만 역전(트랜잭션 아티팩트)', 
       (SELECT count(*) FROM nursing_notes WHERE signed_at IS NOT NULL AND signed_at < created_at AND created_at - signed_at <= interval '1 second')
     + (SELECT count(*) FROM encounters WHERE signed_at IS NOT NULL AND signed_at < created_at AND created_at - signed_at <= interval '1 second')
UNION ALL
-- 🔴 접수·호출·진료시작·완료는 **일어난 일**의 시각이라 미래일 수 없다.
--    (예약 `scheduled_at` 은 반대로 미래가 정상이므로 여기서 세지 않는다 — 성격을 구분한다)
SELECT '🔴', '60 미래 시각의 대기열 기록(일어난 일이 미래에 있다)', count(*)
  FROM waiting_queue
  WHERE checked_in_at > now() OR called_at > now() OR started_at > now() OR completed_at > now()
UNION ALL
SELECT '🟡', '61 퇴원요약 서명이 생성보다 앞', count(*)
  FROM discharge_summaries WHERE signed_at IS NOT NULL AND signed_at < created_at

-- ══════════ 거버넌스(2026-08-28 추가) ══════════
-- ⚪ 0 이 목표가 아니다 — **드러나야 하는 수**다. 근거 없이 발효된 표준이 몇 건인지 센다.
UNION ALL
SELECT '⚪', '54 발효 중인데 의결 근거 없는 임상경로(줄어들어야 하는 목록)', count(*)
  FROM clinical_pathways WHERE status = 'ACTIVE' AND governance_ref IS NULL
UNION ALL
SELECT '⚪', '55 발행자가 기록되지 않은 발효 임상경로', count(*)
  FROM clinical_pathways WHERE status = 'ACTIVE' AND published_by IS NULL
UNION ALL
-- 🔴 배정 상태와 마일스톤 실적이 어긋나면 화면이 허구 실적을 말한다
SELECT '🔴', '56 완료 배정인데 마일스톤 미완(허구 실적)', count(*)
  FROM pathway_assignments a WHERE a.status = 'COMPLETED'
    AND (SELECT count(*) FROM milestone_outcomes o WHERE o.assignment_id = a.id)
      < (SELECT count(*) FROM pathway_milestones m WHERE m.pathway_id = a.pathway_id)
UNION ALL
SELECT '🔴', '57 이탈 카운트가 실제 이탈 결과 수와 불일치', count(*)
  FROM pathway_assignments a
  WHERE a.deviations <> (SELECT count(*) FROM milestone_outcomes o
                          WHERE o.assignment_id = a.id AND o.status = 'DEVIATED')

-- ══════════ 2026-09-15 추가 — 09-13~14 결함에서 나온 모순(운영 읽기 전용 실측 후 채택) ══════════
-- 🔴 규칙을 지어내지 않는다: 각 항목은 이미 코드에 있는 정본 판정을 SQL 로 옮긴 것이다.
--    채택하지 않은 후보 2건과 사유는 docs/05-reference/sentinel-invariants-2026-09-15.md.
UNION ALL
-- 휴진 판정 정본 `clinic-schedule/closure-impact.ts` 의 AFFECTED(종일 휴진 · 같은 period 세션 안 예약)만 센다.
-- NEEDS_REVIEW(시간표 밖 예약·종일 세션+반일 휴진)는 규칙으로 말할 수 없어 세지 않는다. 오늘(KST) 이후 예약만 — 지난 날 잔존은 시드 롤포워드 소음.
-- 요일은 JS getUTCDay 와 같은 0=일요일(PostgreSQL extract(dow)). 운영 09-15 실측 0(휴진 등록 0건).
SELECT '🔴', '67 휴진이 등록된 날·의사에 살아 있는 예약(정본 AFFECTED)', count(*)
  FROM appointments a
  WHERE a.status NOT IN ('CANCELLED', 'NO_SHOW', 'COMPLETED')
    AND (a.scheduled_at AT TIME ZONE 'Asia/Seoul')::date >= (now() AT TIME ZONE 'Asia/Seoul')::date
    AND (
      EXISTS (SELECT 1 FROM clinic_closures c
               WHERE c.doctor_id = a.doctor_id AND c.date = (a.scheduled_at AT TIME ZONE 'Asia/Seoul')::date
                 AND (c.period IS NULL OR c.period = 'ALL'))
      OR EXISTS (SELECT 1 FROM clinic_closures c
                   JOIN clinic_schedules s ON s.doctor_id = c.doctor_id AND s.is_active
                                         AND s.period = c.period AND s.day_of_week = extract(dow FROM c.date)
                  WHERE c.doctor_id = a.doctor_id AND c.date = (a.scheduled_at AT TIME ZONE 'Asia/Seoul')::date
                    AND c.period IS NOT NULL AND c.period <> 'ALL'
                    AND a.scheduled_at >= ((c.date + s.start_time::time) AT TIME ZONE 'Asia/Seoul')
                    AND a.scheduled_at + a.duration * interval '1 minute' <= ((c.date + s.end_time::time) AT TIME ZONE 'Asia/Seoul'))
    )
UNION ALL
-- 분납 회차 금액 합 ≠ 계획 총액 — 조회 EP(summary.scheduleMismatch)는 값을 고치지 않고 알리기만 한다. 회차가 하나도 없는 계획은 세지 않는다.
-- 운영 09-15 실측 0(분납 계획 0건).
SELECT '🟡', '68 분납 회차 금액 합이 계획 총액과 다름', count(*)
  FROM installment_plans p
  WHERE EXISTS (SELECT 1 FROM installment_payments x WHERE x.plan_id = p.id)
    AND p.total_amount <> (SELECT sum(x.amount) FROM installment_payments x WHERE x.plan_id = p.id)
UNION ALL
-- 기초검사 취소·보류는 사유·행위자가 필수(2026-09-14 전이 정본). 전이 시각 컬럼(status_changed_at)이 있는 행만 —
-- 그 이전 행은 기록할 칸이 없었으므로 소급해 세지 않는다. 운영 09-15 실측 0(취소·보류 0건).
SELECT '🟡', '69 기초검사 취소·보류인데 사유·행위자 없음(09-14 전이 정본 이후)', count(*)
  FROM diagnostic_tests
  WHERE status IN ('CANCELLED', 'ON_HOLD') AND status_changed_at IS NOT NULL
    AND (status_reason IS NULL OR btrim(status_reason) = '' OR status_changed_by IS NULL)
UNION ALL
-- 폐기된 기구 개체는 패키지에 넣을 수 없다(재포장 거부 정본). 폐기 뒤에 연결된 행은 그 거부를 우회한 쓰기다.
-- 운영 09-15 실측 0(개체 등록 0건).
SELECT '🔴', '70 폐기된 기구 개체가 폐기 뒤 멸균 패키지에 연결', count(*)
  FROM sterile_package_units spu JOIN instrument_units u ON u.id = spu.unit_id
  WHERE u.status = 'RETIRED' AND u.retired_at IS NOT NULL AND spu.added_at > u.retired_at

UNION ALL
-- 퇴직은 HR 한 곳에서 끝나지 않는다 — `hr.service.ts resign()` 은 Staff.status·resignDate 만 바꾸고
-- **User.isActive·세션·이미 발급된 토큰은 그대로 둔다**(2026-09-11 외부 코드 대조로 지적 · HEAD 재현).
-- 회수는 자격 오프보딩(2인 승인 · 기기·패스키·인증서 폐기 + 강제 로그아웃 + isActive=false)에만 있고
-- HR 퇴직과 이어져 있지 않다. 퇴직 처리만 한 직원은 계정이 살아 있다.
-- 🔴 **자동으로 끊는 방향은 사람 판단**(퇴직일이 미래인 선등록도 있다) — 여기서는 **드러내기만** 한다.
SELECT '🔴', '71 퇴직(RESIGNED)인데 시스템 계정이 살아 있음(HR 퇴직↔계정 회수 미연결)', count(*)
  FROM staff s JOIN users u ON u.id = s.user_id
  WHERE s.status = 'RESIGNED' AND u.is_active = true

-- ══════════ 진료 대화 전사 보존(2026-09-23 추가 · VoiceEMR §13 D6) ══════════
-- 설정 `scribe.transcript.retention`(일)은 2026-09-22 실측까지 **읽는 코드가 0건**이었다 — 전사(`voice_utterances`)·
-- 세션 `transcript` 는 영구 보존이었다. 파기는 사람 판단(법무 미결)이라 여기서는 **드러내기만** 한다(줄어들어야 하는 목록).
-- 기간은 DB 의 설정 행에서만 읽는다 — 코드 기본값(90)은 정책이 아니라 SQL 에 박지 않는다.
-- 종료 = APPLIED/FAILED/DELETED(TRANSCRIBED·DRAFTED 는 미반영 대기라 세지 않는다) · 세션에 종료 시각 컬럼이 없어 updated_at 으로 근사(늦게 세는 쪽).
-- 보존명령(세션 legal_hold · 활성 LegalHold 환자)은 제외 — 그것은 남아 있는 것이 맞다. `draft_snapshot` 은 대상이 아니다(서명 편집거리 근거).
UNION ALL
SELECT '🟡', '72 보존기간 넘긴 종료 스크라이브 세션에 전사·발화 잔존(줄어들어야 하는 목록)', count(*)
  FROM scribe_sessions s
  JOIN system_configs c ON c.key = 'scribe.transcript.retention' AND jsonb_typeof(c.value) = 'number'
  WHERE s.status IN ('APPLIED', 'FAILED', 'DELETED') AND s.legal_hold = false
    AND s.updated_at < now() - ((c.value #>> '{}')::numeric * interval '1 day')
    AND (s.transcript IS NOT NULL OR EXISTS (SELECT 1 FROM voice_utterances u WHERE u.session_id = s.id))
    AND NOT EXISTS (SELECT 1 FROM legal_holds h LEFT JOIN legal_hold_releases r ON r.hold_id = h.id
                     WHERE h.patient_id = s.patient_id AND r.id IS NULL)
UNION ALL
-- 🔴 설정 행이 없으면 72 는 0 이 아니라 **평가되지 않은 것**이다(JOIN 이 비어 0 이 된다) — 그 상태에서 남아 있는 종료 세션 전사를
--    이 행이 대신 센다. 72 가 0 이고 이 행이 0 이 아니면 "보존기간 없이 남아 있음"이다. 설정 행이 생기면 이 행은 0 으로 내려간다.
SELECT '⚪', '72b 전사 보존기간 설정 행 없음(scribe.transcript.retention) — 기간 없이 남아 있는 종료 세션 전사·발화(72 평가 안 됨)', count(*)
  FROM scribe_sessions s
  WHERE NOT EXISTS (SELECT 1 FROM system_configs c WHERE c.key = 'scribe.transcript.retention' AND jsonb_typeof(c.value) = 'number')
    AND s.status IN ('APPLIED', 'FAILED', 'DELETED')
    AND (s.transcript IS NOT NULL OR EXISTS (SELECT 1 FROM voice_utterances u WHERE u.session_id = s.id))

-- ══════════ 인프라 신호(2026-08-29 추가) ══════════
-- 🔴 이 서버의 PostgreSQL 은 **9개 프로젝트가 공유**한다(HospitalRun·OpenPACS·ERP·LIS…).
--    그래서 **남의 프로젝트가 우리 테이블을 팽창시킬 수 있다** — 아래는 그 신호다.
--
-- 🔴 실측(2026-08-29): `erp_app` 이 `pg_try_advisory_lock` 을 잡은 채
--    **25일 19시간** 트랜잭션을 열어두고 있었다(`idle in transaction`).
--    그동안 VACUUM 은 돌아도 **그 트랜잭션에 보이는 죽은 튜플을 회수하지 못한다** —
--    hospitalrun 의 xmin 지연이 **11,567,811 트랜잭션**이었고
--    `procedure_codes` 는 2026-06-10 이후 vacuum 되지 못했다(죽은 튜플 15,678 · 9.4%).
--
-- 🔴 **우리가 고칠 수 있는 것이 아니다**(다른 프로젝트의 커넥션이다) — **드러내는 것**이 우리 일이다.
--    이 값이 잡히면 그 프로젝트 담당에게 알린다. 우리가 끊지 않는다.
UNION ALL
SELECT '🟡', '65 장기 idle in transaction(공유 DB · VACUUM 회수를 막는다)', count(*)
  FROM pg_stat_activity
  WHERE state = 'idle in transaction' AND xact_start < now() - interval '1 hour'
UNION ALL
-- 🔴 20억에 가까워지면 PostgreSQL 이 **쓰기를 거부**한다(wraparound 보호).
--    1억은 여유롭지만, 위 idle 트랜잭션이 살아 있으면 계속 밀린다 — 추세를 본다.
SELECT '🟡', '66 hospitalrun xmin 지연 1억 초과(공유 DB 트랜잭션 정체)', count(*)
  FROM pg_database WHERE datname = current_database() AND age(datfrozenxid) > 100000000

)
SELECT sev AS "구분", chk AS "점검 항목", n AS "건수"
FROM checks
WHERE n > 0
ORDER BY CASE sev WHEN '🔴' THEN 1 WHEN '🟡' THEN 2 ELSE 3 END, chk;
