-- =============================================================================
-- 시드 데이터 정합화 — 검증 쿼리 (2026-08-18)
-- =============================================================================
-- `seed-integrity-recalibration-20260818.sql` 적용 후 **교정이 실제로 먹었는지** 센다.
-- 🔴 읽기 전용이다. 아무것도 바꾸지 않는다.
--
--   ssh -p 819 deploy@198.51.100.73 \
--     "docker exec -i docker-postgres-1 psql -U hospital -d hospitalrun -P pager=off" \
--     < apps/api/prisma/manual/seed-integrity-recalibration-verify-20260818.sql
--
-- 판정 규칙
--   · `잔여` 가 **기대값**이면 통과. 기대값이 0 이 아닌 항목은 **의도적으로 남긴 것**이고
--     그 이유가 옆 칸에 적혀 있다(교정하지 않기로 한 것 — 본 SQL §10).
--   · 🔴 이 표는 **적용 전에도 돌려야 한다.** 적용 전 값이 '적용 전 실측'과 다르면
--     데이터가 그 사이 바뀐 것이므로 교정 SQL 을 다시 실측한 뒤 적용한다.
--
-- 🔴 `적용전_실측` 열의 출처 (2026-08-18 14:05 재실측 · 최근 6주 임상 활동 유입 후)
--   그 사이 분모가 크게 늘었다(lab_result_items 1,881→3,013 · billing_items 143→1,225 ·
--   encounters 584→746). **위반 건수는 전 항목 그대로였다** → 새로 들어온 행이 만든 불일치는 **0건**이다.
--   즉 이 열은 지금도 유효하다. 그래도 적용 직전에 한 번 더 돌린다(그 사이 또 바뀔 수 있다).
-- =============================================================================

\pset format aligned
\pset border 2

SELECT '── 교정 대상 (적용 후 0 이어야 함) ──' AS 구분;

WITH ind AS (
  SELECT i.id,
         COALESCE(CASE WHEN i.formula ~ '[×xX*]\s*1000' THEN 1000
                       WHEN i.formula ~ '[×xX*]\s*100'  THEN 100
                       WHEN i.formula ~ '평균' OR i.formula LIKE '%/%'
                         OR i.formula ~ '건수\s*$' OR i.formula ~ '점수' THEN 1 END, 100) AS scale
  FROM quality_indicators i)
SELECT '§1 QI 값이 분자/분모×배율에서 나오지 않음' AS 항목,
       count(*) FILTER (WHERE m.denominator > 0
              AND abs(round((m.numerator::numeric / m.denominator) * ind.scale, 2) - m.value) > 0.011) AS 잔여,
       273 AS 적용전_실측, 0 AS 기대, count(*) AS 분모
FROM qi_measurements m JOIN ind ON ind.id = m.indicator_id

UNION ALL SELECT '§1 QI 값이 저장 한계(999.99) 초과', count(*) FILTER (WHERE value > 999.99), 0, 0, count(*) FROM qi_measurements
UNION ALL SELECT '§1 QI 분모 0 이하(산출 불가)',        count(*) FILTER (WHERE denominator <= 0), 0, 0, count(*) FROM qi_measurements

UNION ALL SELECT '§2 낙상 등급이 점수 파생과 다름',
  count(*) FILTER (WHERE risk_level <> CASE WHEN score >= 45 THEN 'HIGH' WHEN score >= 25 THEN 'MODERATE' ELSE 'LOW' END),
  2, 0, count(*) FROM fall_risk_assessments

UNION ALL SELECT '§3 검사 flag 정본 밖 어휘(NORMAL 등)',
  count(*) FILTER (WHERE flag IS NOT NULL AND flag NOT IN ('N','L','H','LL','HH','A','AA')), 4, 0, count(*) FROM lab_result_items
UNION ALL SELECT '§3 범위값이 정상 상한을 넘는데 H 아님',
  count(*) FILTER (WHERE value ~ '^[0-9]+(\.[0-9]+)?\s*-\s*[0-9]+(\.[0-9]+)?$' AND normal_max IS NOT NULL
                     AND split_part(replace(value,' ',''),'-',1)::numeric > normal_max AND flag IS DISTINCT FROM 'H'),
  2, 0, count(*) FROM lab_result_items
UNION ALL SELECT '§3 수치+기준치 있는데 flag 없음',
  count(*) FILTER (WHERE flag IS NULL AND value ~ '^-?[0-9]+(\.[0-9]+)?$' AND (normal_min IS NOT NULL OR normal_max IS NOT NULL)),
  1, 0, count(*) FROM lab_result_items
UNION ALL SELECT '§3 수치 flag 가 기준치와 어긋남(정본 어휘 기준)',
  count(*) FILTER (WHERE normal_min IS NOT NULL AND normal_max IS NOT NULL AND value ~ '^-?[0-9]+(\.[0-9]+)?$'
    AND ( (value::numeric < normal_min AND COALESCE(flag,'') NOT IN ('L','LL'))
       OR (value::numeric > normal_max AND COALESCE(flag,'') NOT IN ('H','HH'))
       OR (value::numeric BETWEEN normal_min AND normal_max AND COALESCE(flag,'N') NOT IN ('N')) )),
  4, 0, count(*) FROM lab_result_items
  -- 🔴 적용 전 4건은 전부 어휘 드리프트('NORMAL')다 — 판정 자체가 틀린 행은 0건이었다(분모 1,864).
  --    §3-a 가 'NORMAL' → 'N' 으로 옮기면 0 이 된다.

UNION ALL SELECT '§4 만료인데 사용 가능 재고',
  count(*) FILTER (WHERE status = 'AVAILABLE' AND expires_at < now()), 18, 0, count(*) FROM blood_products

UNION ALL SELECT '§5 청구 라인 카테고리 미기입(수가마스터에 있음)',
  count(*) FILTER (WHERE bi.insurance_category IS NULL AND pc.id IS NOT NULL), 13, 0, count(*)
  FROM billing_items bi LEFT JOIN procedure_codes pc ON pc.id = bi.code_id
UNION ALL SELECT '§5 비급여인데 본인부담률≠1.0 (미수납 청구)',
  count(*) FILTER (WHERE bi.insurance_category='NON_COVERED' AND bi.copay_rate<>1.0 AND b.status='PENDING'), 15, 0, count(*)
  FROM billing_items bi JOIN billings b ON b.id = bi.billing_id
UNION ALL SELECT '§5 full_copay 가 율 파생과 다름 (미수납 청구)',
  count(*) FILTER (WHERE b.status='PENDING' AND bi.full_copay <> (bi.copay_rate >= 1.0)), 0, 0, count(*)
  FROM billing_items bi JOIN billings b ON b.id = bi.billing_id

UNION ALL SELECT '§6 활력 거짓 이상 경보',
  count(*) FILTER (WHERE is_abnormal AND NOT (
      (systolic_bp IS NOT NULL AND (systolic_bp<=80 OR systolic_bp>=180))
   OR (diastolic_bp IS NOT NULL AND (diastolic_bp<=50 OR diastolic_bp>=110))
   OR (heart_rate IS NOT NULL AND (heart_rate<=40 OR heart_rate>=130))
   OR (temperature IS NOT NULL AND (temperature<=35.0 OR temperature>=38.5))
   OR (spo2 IS NOT NULL AND spo2<=90)
   OR (respiratory_rate IS NOT NULL AND (respiratory_rate<=8 OR respiratory_rate>=30))
   OR (pain_score IS NOT NULL AND pain_score>=7))), 102, 0, count(*) FROM pre_visit_vitals
UNION ALL SELECT '§6 활력 놓친 이상 경보 (적용 전후 모두 0 이어야 함)',
  count(*) FILTER (WHERE NOT is_abnormal AND (
      (systolic_bp IS NOT NULL AND (systolic_bp<=80 OR systolic_bp>=180))
   OR (diastolic_bp IS NOT NULL AND (diastolic_bp<=50 OR diastolic_bp>=110))
   OR (heart_rate IS NOT NULL AND (heart_rate<=40 OR heart_rate>=130))
   OR (temperature IS NOT NULL AND (temperature<=35.0 OR temperature>=38.5))
   OR (spo2 IS NOT NULL AND spo2<=90)
   OR (respiratory_rate IS NOT NULL AND (respiratory_rate<=8 OR respiratory_rate>=30))
   OR (pain_score IS NOT NULL AND pain_score>=7))), 0, 0, count(*) FROM pre_visit_vitals

UNION ALL SELECT '§7 무기한 과정인데 만료일이 박혀 있음',
  count(*) FILTER (WHERE ep.valid_months <= 0 AND ec.expires_at IS NOT NULL), 23, 0, count(*)
  FROM education_completions ec JOIN education_programs ep ON ep.id = ec.program_id
UNION ALL SELECT '§7 9999 우회 표식 잔존',
  count(*) FILTER (WHERE expires_at >= TIMESTAMPTZ '9999-01-01'), 0, 0, count(*) FROM education_completions
UNION ALL SELECT '§7 만료일이 이수일+유효개월과 다름(적용 전에도 0)',
  count(*) FILTER (WHERE ec.expires_at IS NOT NULL AND ep.valid_months > 0
    AND ec.expires_at::date <> (ec.completed_at + (ep.valid_months||' months')::interval)::date), 0, 0, count(*)
  FROM education_completions ec JOIN education_programs ep ON ep.id = ec.program_id

UNION ALL SELECT '§8 소아 신장 > 200cm (생리학적 불가능)',
  count(*) FILTER (WHERE height > 200), 38, 0, count(*) FROM pediatric_growths
UNION ALL SELECT '§8 소아 두위 > 62cm (생리학적 불가능)',
  count(*) FILTER (WHERE head_circ > 62), 59, 0, count(*) FROM pediatric_growths
UNION ALL SELECT '§8 소아 BMI 가 신장·체중 파생과 다름',
  count(*) FILTER (WHERE height > 0 AND weight > 0 AND bmi IS NOT NULL
    AND abs(bmi - round(weight/((height/100.0)^2),1)) > 0.2), 417, 0, count(*) FROM pediatric_growths
UNION ALL SELECT '§8 신장 없는데 BMI 가 남아 있음',
  count(*) FILTER (WHERE (height IS NULL OR weight IS NULL) AND bmi IS NOT NULL), 0, 0, count(*) FROM pediatric_growths

UNION ALL SELECT '§9-a PACU 입실 < 수술 종료 (값은 보존 · notes 표기만)',
  (SELECT count(*) FROM pacu_records p JOIN surgeries s ON s.id=p.surgery_id
    WHERE s.ended_at IS NOT NULL AND p.arrival_time < s.ended_at
      AND COALESCE(p.notes,'') NOT LIKE '%[2026-08-18 시드 정합화]%'), 1, 0, count(*) FROM pacu_records
UNION ALL SELECT '§9-b 간호기록 서명 < 기록 시각',
  count(*) FILTER (WHERE signed_at IS NOT NULL AND signed_at < recorded_at), 1, 0, count(*) FROM nursing_notes
UNION ALL SELECT '§9-c 진료기록 SIGNED 인데 서명 시각 없음',
  count(*) FILTER (WHERE status='SIGNED' AND signed_at IS NULL), 1, 0, count(*) FROM encounters
UNION ALL SELECT '§9-d 대기열 접수 시각이 미래',
  count(*) FILTER (WHERE checked_in_at > now() AND status NOT IN ('CANCELLED','COMPLETED')), 2, 0, count(*) FROM waiting_queue
UNION ALL SELECT '§9-d 대기열 호출 < 접수',
  count(*) FILTER (WHERE called_at IS NOT NULL AND called_at < checked_in_at), 1, 0, count(*) FROM waiting_queue
UNION ALL SELECT '§9-d 대기열 완료 < 시작',
  count(*) FILTER (WHERE completed_at IS NOT NULL AND started_at IS NOT NULL AND completed_at < started_at), 1, 0, count(*) FROM waiting_queue
UNION ALL SELECT '§9-e 대기열 완료 위장(호출·진료시작·Encounter 전무)',
  count(*) FILTER (WHERE status='COMPLETED' AND called_at IS NULL AND started_at IS NULL AND encounter_id IS NULL),
  456, 0, count(*) FROM waiting_queue
;


SELECT '── 🔴 재발 감시 — 교정 후 다시 늘어났는가 (다음 09:00 크론 이후 확인) ──' AS 구분;

-- 🔴 §9-e 교정은 **재생성이 멈췄다는 전제** 위에 있다. 그 전제는 아직 확정되지 않았다 —
--    배포(2026-08-18 13:25 · `5e3105b8`)에 W8 수정이 들어갔지만, 크론은 **매일 09:00** 에만 돈다.
--    따라서 **2026-08-19 09:00 이후에 이 표를 다시 돌려야** 전제가 확인된다.
--    🔴 그 전까지 "고쳤다"고 말하지 않는다. 이 저장소는 이미 한 번 그렇게 되살아났다(W9).
--
--    · `배포후_신규` 가 0 이 아니면 → **재생성이 멈추지 않았다.** 운영 빌드를 확인한다.
--    · `마지막_완료위장` 이 배포 시각보다 뒤면 → 같은 뜻이다.
SELECT
  '완료 위장 총계(교정 후 0 이어야 함)' AS 항목,
  count(*) FILTER (WHERE status='COMPLETED' AND called_at IS NULL AND started_at IS NULL AND encounter_id IS NULL) AS 값
FROM waiting_queue
UNION ALL SELECT '🔴 배포(2026-08-18 13:25) 이후 새로 생긴 완료 위장',
  count(*) FILTER (WHERE status='COMPLETED' AND called_at IS NULL AND started_at IS NULL AND encounter_id IS NULL
                     AND completed_at > TIMESTAMPTZ '2026-08-18 13:25:00+09') FROM waiting_queue
UNION ALL SELECT '롤포워드 사유로 CANCELLED (생성기 46 + 교정 457 = 503 기대)',
  count(*) FILTER (WHERE status='CANCELLED' AND reason='[데모 롤포워드] 진료 없이 마감 — 진료 실적으로 세지 않음') FROM waiting_queue
  -- 🔴 이 값은 "교정 건수"가 아니다. 적용 전 이미 46건이 같은 사유를 달고 있었다(생성기가 쓴 것).
  --    교정분은 457(§9-d 가 called_at 을 지운 1건이 판정에 새로 걸린다 — 교정 SQL §9-e ③ 주석 참조).
UNION ALL SELECT '오늘 09:00 크론이 만든 대기열 행(참고)',
  count(*) FILTER (WHERE created_at >= date_trunc('day', now()) + interval '9 hours'
                     AND created_at <  date_trunc('day', now()) + interval '10 hours') FROM waiting_queue;

SELECT '마지막 완료 위장의 completed_at (배포 시각보다 앞서야 함)' AS 항목,
       max(completed_at) AS 값, TIMESTAMPTZ '2026-08-18 13:25:00+09' AS 배포시각
FROM waiting_queue
WHERE status='COMPLETED' AND called_at IS NULL AND started_at IS NULL AND encounter_id IS NULL;


SELECT '── 🔴 교정하지 않기로 한 것 (0 이 되면 안 된다 — 사람·배포가 닫는다) ──' AS 구분;

SELECT '① (해소) 대기열 완료 위장 → §9-e 로 교정 대상이 됨' AS 항목,
       count(*) FILTER (WHERE status='COMPLETED' AND started_at IS NULL AND called_at IS NULL AND encounter_id IS NULL) AS 잔여,
       '배포 5e3105b8 로 재생성 차단 · 위 재발 감시표를 다음 09:00 이후 확인' AS 조치
FROM waiting_queue
UNION ALL SELECT '② 수납 완료 청구의 비급여 오분류(회계 재정산)',
  (SELECT count(*) FROM billing_items bi JOIN billings b ON b.id=bi.billing_id
    WHERE bi.insurance_category='NON_COVERED' AND bi.copay_rate<>1.0 AND b.status<>'PENDING'), '원무·회계 판단'
UNION ALL SELECT '③ 제제별 유효기간 규칙 위반(PC 5일·PRBC 35~42일)',
  (SELECT count(*) FROM blood_products
    WHERE (product_type='PC'   AND expires_at - collected_at > interval '7 days')
       OR (product_type='PRBC' AND expires_at - collected_at > interval '42 days')), '시드 생성기 교정'
UNION ALL SELECT '④ DUR 우회에 사유·우회자·시각 없음',
  (SELECT count(*) FROM prescriptions WHERE dur_overridden AND (dur_override_reason IS NULL OR btrim(dur_override_reason)='')), '감사 대상'
UNION ALL SELECT '⑤ 생존 환자 나이 > 120세',
  (SELECT count(*) FROM patients WHERE NOT is_deceased AND date_of_birth < now() - interval '120 years'), '생년월일 확인(사람)'
UNION ALL SELECT '⑦ 영상 modality 가 정본 산출 집합 밖(X-ray·XR)',
  (SELECT count(*) FROM imaging_results WHERE modality NOT IN ('CT','CTA','MR','US','MG','RF','NM','PT','CR','DX','XA','OT')),
  '허용 어휘를 못박은 정본이 없다 — 만들 때 IONIZING_MODALITIES 와 함께'
UNION ALL SELECT '⑧ 간호기록 signed_at < created_at (결함 아님 — 소급 시드)',
  (SELECT count(*) FROM nursing_notes WHERE signed_at IS NOT NULL AND signed_at < created_at), '교정 금지'
UNION ALL SELECT '⑧ 진료기록 signed_at < created_at (결함 아님 — 0.001초 삽입 순서)',
  (SELECT count(*) FROM encounters WHERE signed_at IS NOT NULL AND signed_at < created_at), '교정 금지'
UNION ALL SELECT '⑩ §9-e 로 근거를 잃는 예약(COMPLETED·진료기록 0)',
  (SELECT count(*) FROM waiting_queue w JOIN appointments a ON a.id=w.appointment_id
    WHERE a.status='COMPLETED' AND w.status='CANCELLED'
      AND w.reason='[데모 롤포워드] 진료 없이 마감 — 진료 실적으로 세지 않음'
      AND NOT EXISTS (SELECT 1 FROM encounters e WHERE e.appointment_id=a.id)), '원무 판단(취소시각을 지어낼 수 없다)'
UNION ALL SELECT '⑪ 청구 헤더 본인부담 ≠ Σround(라인금액×율) — 둘 다 PAID',
  (SELECT count(*) FROM billings b JOIN (SELECT billing_id, sum(round(amount*copay_rate)) s FROM billing_items GROUP BY 1) a
     ON a.billing_id=b.id WHERE b.patient_copay <> a.s), '회계 판단(②와 동일)'
;


SELECT '── 실측 0건이라 손대지 않은 불변식 (계속 감시) ──' AS 구분;

SELECT '퇴원 < 입원' AS 불변식, count(*) FILTER (WHERE discharge_date IS NOT NULL AND discharge_date < admit_date) AS 위반 FROM admissions
UNION ALL SELECT '퇴원일이 미래', count(*) FILTER (WHERE discharge_date > now()) FROM admissions
UNION ALL SELECT 'DISCHARGED 인데 퇴원일 없음', count(*) FILTER (WHERE status='DISCHARGED' AND discharge_date IS NULL) FROM admissions
UNION ALL SELECT '수술 종료 < 시작', count(*) FILTER (WHERE ended_at IS NOT NULL AND started_at IS NOT NULL AND ended_at < started_at) FROM surgeries
UNION ALL SELECT '수술 봉합 < 절개', count(*) FILTER (WHERE closure_time IS NOT NULL AND incision_time IS NOT NULL AND closure_time < incision_time) FROM surgeries
UNION ALL SELECT 'COMPLETED 인데 수술 종료시각 없음', count(*) FILTER (WHERE status='COMPLETED' AND ended_at IS NULL) FROM surgeries
UNION ALL SELECT '검사 완료 < 채취', count(*) FILTER (WHERE completed_at IS NOT NULL AND collected_at IS NOT NULL AND completed_at < collected_at) FROM lab_results
UNION ALL SELECT '검사 검증 < 완료', count(*) FILTER (WHERE verified_at IS NOT NULL AND completed_at IS NOT NULL AND verified_at < completed_at) FROM lab_results
UNION ALL SELECT '검사 COMPLETED 인데 완료시각 없음', count(*) FILTER (WHERE status IN ('COMPLETED','VERIFIED') AND completed_at IS NULL) FROM lab_results
UNION ALL SELECT '오더 완료 < 시작', count(*) FILTER (WHERE completed_at IS NOT NULL AND started_at IS NOT NULL AND completed_at < started_at) FROM orders
UNION ALL SELECT '오더 완료시각 있는데 상태≠COMPLETED', count(*) FILTER (WHERE completed_at IS NOT NULL AND status <> 'COMPLETED') FROM orders
UNION ALL SELECT '조제 검수 < 조제', count(*) FILTER (WHERE verified_at IS NOT NULL AND dispensed_at IS NOT NULL AND verified_at < dispensed_at) FROM dispensings
UNION ALL SELECT '조제 수량 합 불일치', count(*) FILTER (WHERE total_prescribed_qty IS NOT NULL AND partial_qty IS NOT NULL AND remaining_qty IS NOT NULL AND total_prescribed_qty <> partial_qty + remaining_qty) FROM dispensings
UNION ALL SELECT '영상 판독 < 촬영', count(*) FILTER (WHERE reported_at IS NOT NULL AND acquired_at IS NOT NULL AND reported_at < acquired_at) FROM imaging_results
UNION ALL SELECT '예약 취소 < 생성', count(*) FILTER (WHERE cancelled_at IS NOT NULL AND cancelled_at < created_at) FROM appointments
UNION ALL SELECT '상태≠CANCELLED 인데 취소시각 있음', count(*) FILTER (WHERE status <> 'CANCELLED' AND cancelled_at IS NOT NULL) FROM appointments
UNION ALL SELECT '수혈 종료 < 시작', count(*) FILTER (WHERE end_time IS NOT NULL AND start_time IS NOT NULL AND end_time < start_time) FROM blood_transfusions
UNION ALL SELECT '수혈 2인 확인이 동일인', count(*) FILTER (WHERE verified_by_nurse1 = verified_by_nurse2) FROM blood_transfusions
UNION ALL SELECT '수혈 부작용 있는데 유형 없음', count(*) FILTER (WHERE reaction_occurred AND (reaction_type IS NULL OR btrim(reaction_type)='')) FROM blood_transfusions
UNION ALL SELECT '병상 OCCUPIED 인데 재원 없음', (SELECT count(*) FROM beds b WHERE b.status='OCCUPIED' AND NOT EXISTS (SELECT 1 FROM admissions a WHERE a.bed_id=b.id AND a.status='ADMITTED')) FROM (SELECT 1) t
UNION ALL SELECT '환자 사망일 < 출생일', count(*) FILTER (WHERE death_date IS NOT NULL AND death_date < date_of_birth) FROM patients
UNION ALL SELECT '환자 사망인데 사망일 없음', count(*) FILTER (WHERE is_deceased AND death_date IS NULL) FROM patients
UNION ALL SELECT '내원 전 활력 생리학적 범위 이탈', count(*) FILTER (WHERE (systolic_bp IS NOT NULL AND (systolic_bp<50 OR systolic_bp>300)) OR (temperature IS NOT NULL AND (temperature<30 OR temperature>45)) OR (spo2 IS NOT NULL AND (spo2<50 OR spo2>100))) FROM pre_visit_vitals
UNION ALL SELECT '내원 전 활력 수축기 ≤ 이완기', count(*) FILTER (WHERE systolic_bp IS NOT NULL AND diastolic_bp IS NOT NULL AND systolic_bp <= diastolic_bp) FROM pre_visit_vitals
UNION ALL SELECT '방사선 선량 기록 없는데 누적선량 있음', count(*) FILTER (WHERE cumulative_dose IS NOT NULL AND delivered_dose IS NULL) FROM radiation_fractions
UNION ALL SELECT '청구 총액 ≠ 보험+본인+할인', count(*) FILTER (WHERE total_amount <> insurance_covered + patient_copay + discount_amount) FROM billings
UNION ALL SELECT '청구 PAID 인데 수납시각 없음', count(*) FILTER (WHERE status='PAID' AND paid_at IS NULL) FROM billings
;


SELECT '── §1 QI 상세 — 지표별 재파생 후 상태 ──' AS 구분;

WITH ind AS (
  SELECT i.id, i.name, i.target_value,
         COALESCE(CASE WHEN i.formula ~ '[×xX*]\s*1000' THEN 1000
                       WHEN i.formula ~ '[×xX*]\s*100'  THEN 100
                       WHEN i.formula ~ '평균' OR i.formula LIKE '%/%'
                         OR i.formula ~ '건수\s*$' OR i.formula ~ '점수' THEN 1 END, 100) AS scale
  FROM quality_indicators i)
SELECT ind.name AS 지표, ind.scale AS 배율, ind.target_value AS 목표, count(*) AS 측정,
       count(*) FILTER (WHERE abs(round((m.numerator::numeric/m.denominator)*ind.scale,2) - m.value) > 0.011) AS 미파생,
       count(*) FILTER (WHERE m.meet_target IS NULL) AS 판정불가,
       round(min(m.value),2) AS 최소, round(max(m.value),2) AS 최대
FROM qi_measurements m JOIN ind ON ind.id = m.indicator_id
GROUP BY 1,2,3 ORDER BY 5 DESC, 1;
-- 적용 후 기대: 미파생 전부 0 · 판정불가 0(25지표 전부 방향 등재됨)
