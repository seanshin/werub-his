-- ============================================================
-- 자격 본인부담 특수케이스 검증용 시드 (ERP his_copay_rate SoT 검증)
-- 목적: backfill 진료라인(GET /integration/billing/lines)이 의료급여 1/2종·산정특례·자격상실에서
--       medicalAidClass·specialCaseType·eligibilityStatus·fullCopay·insuranceProductCode를
--       비-null로 방출하는지 ERP가 검증할 수 있게 실 라인 데이터를 만든다.
-- 식별/정리: 환자 mrn 'SEED-ELIG-%', billing cashier_note='SEED-ELIG-VALIDATION'
-- 멱등: 재실행 시 CLEANUP가 기존 시드 제거 후 재생성
-- 코호트(환자 14): 의료급여1종×2·2종×2 · 산정특례V027×2 · 자격상실×2 · 보훈PATRIOT · 차상위 · 건보일반 · 산재 · 자보 · 자비
-- 실행: npx prisma db execute --schema prisma/schema.prisma --file prisma/seeds/eligibility-validation.seed.sql
-- ============================================================
BEGIN;

-- ---------- CLEANUP (멱등) ----------
DELETE FROM billing_items WHERE billing_id IN (SELECT id FROM billings WHERE cashier_note = 'SEED-ELIG-VALIDATION');
DELETE FROM billings WHERE cashier_note = 'SEED-ELIG-VALIDATION';
DELETE FROM eligibility_checks WHERE source = 'SEED-VALID' AND patient_id IN (SELECT id FROM patients WHERE mrn LIKE 'SEED-ELIG-%');
DELETE FROM encounters WHERE patient_id IN (SELECT id FROM patients WHERE mrn LIKE 'SEED-ELIG-%');
DELETE FROM patients WHERE mrn LIKE 'SEED-ELIG-%';

-- ---------- 코호트 정의 (전체 자격 매트릭스 — ERP 자격 SoT 마무리용) ----------
-- 1,2 의료급여1종 · 3,4 의료급여2종 · 5,6 산정특례V027 · 7,8 자격상실 · 9 보훈PATRIOT
-- 10 차상위 · 11 건보일반 · 12 산재 · 13 자보 · 14 자비
CREATE TEMP TABLE _cohort ON COMMIT DROP AS
SELECT g,
       'SEED-ELIG-P' || lpad(g::text, 3, '0')               AS mrn,
       (CASE WHEN g <= 4 THEN 'MEDICAID'
             WHEN g = 12 THEN 'INDUSTRIAL'
             WHEN g = 13 THEN 'AUTO'
             WHEN g = 14 THEN 'SELF_PAY'
             ELSE 'NHI' END)::"InsuranceType"                AS insurance_type,
       (CASE WHEN g IN (1,2) THEN 'MA_TYPE1'
             WHEN g IN (3,4) THEN 'MA_TYPE2'
             WHEN g IN (5,6) THEN 'SPECIAL_EXEMPTION'
             WHEN g IN (7,8) THEN 'NHI'
             WHEN g = 9 THEN 'PATRIOT'
             WHEN g = 10 THEN 'NEAR_POOR'
             WHEN g = 11 THEN 'NHI'
             WHEN g = 12 THEN 'INDUSTRIAL'
             WHEN g = 13 THEN 'AUTO'
             ELSE 'SELF_PAY' END)                            AS copay_category,
       (CASE WHEN g IN (7,8) THEN 'EXPIRED' ELSE 'VERIFIED' END) AS elig_status,
       (CASE WHEN g IN (5,6) THEN 'V027' ELSE NULL END)      AS special_exemption,
       -- 라인 본인부담률: 1종0 · 2종15% · 특례5% · 자격상실100% · 보훈0(국비) · 차상위14% · 건보30% · 산재/자보0 · 자비100%
       (CASE WHEN g IN (1,2) THEN 0.0000
             WHEN g IN (3,4) THEN 0.1500
             WHEN g IN (5,6) THEN 0.0500
             WHEN g IN (7,8) THEN 1.0000
             WHEN g = 9 THEN 0.0000
             WHEN g = 10 THEN 0.1400
             WHEN g = 11 THEN 0.3000
             WHEN g IN (12,13) THEN 0.0000
             ELSE 1.0000 END)::numeric                       AS copay_rate,
       (g IN (7,8,14))                                       AS full_copay  -- 자격상실·자비=전액본인부담
FROM generate_series(1, 14) g;

-- ---------- 1. 환자 8명 ----------
INSERT INTO patients (id, mrn, family_name, given_name, date_of_birth, gender, insurance_type, created_at, updated_at, created_by, updated_by)
SELECT gen_random_uuid(), c.mrn, '자격검증', '환자' || c.g,
       ('1955-01-01'::date + (c.g * 211))::date,
       (ARRAY['MALE','FEMALE'])[1 + (c.g % 2)]::"Gender",
       c.insurance_type, now(), now(),
       (SELECT id FROM users WHERE role = 'ADMIN' LIMIT 1),
       (SELECT id FROM users WHERE role = 'ADMIN' LIMIT 1)
FROM _cohort c;

-- ---------- 2. eligibility_checks (자격 스냅샷 원천, source=SEED-VALIDATION) ----------
INSERT INTO eligibility_checks (id, patient_id, insurance_type, status, copay_category, special_exemption, exemption_expiry, source, visit_type, message, queried_at)
SELECT gen_random_uuid(), p.id, c.insurance_type, c.elig_status, c.copay_category, c.special_exemption,
       (CASE WHEN c.special_exemption IS NOT NULL THEN now() + interval '180 days' ELSE NULL END),
       'SEED-VALID', 'OUTPATIENT',
       '자격검증 시드(' || c.copay_category || '/' || c.elig_status || ')', now()
FROM _cohort c JOIN patients p ON p.mrn = c.mrn;

-- ---------- 3. encounters (자격 링크 포함) ----------
INSERT INTO encounters (id, patient_id, doctor_id, visit_type, eligibility_check_id, created_at, updated_at)
SELECT gen_random_uuid(), p.id,
       (SELECT user_id FROM staff WHERE category = 'MEDICAL' AND user_id IS NOT NULL ORDER BY id LIMIT 1),
       'OUTPATIENT',
       (SELECT id FROM eligibility_checks ec WHERE ec.patient_id = p.id AND ec.source = 'SEED-VALID' ORDER BY ec.queried_at DESC LIMIT 1),
       now(), now()
FROM _cohort c JOIN patients p ON p.mrn = c.mrn;

-- ---------- 5. billings (자격 스냅샷 동봉) ----------
INSERT INTO billings (id, encounter_id, patient_id, total_amount, insurance_covered, patient_copay, status,
                      cashier_note, copay_category, eligibility_status, eligibility_check_id, special_exemption,
                      created_at, updated_at)
SELECT gen_random_uuid(), e.id, p.id, 0, 0, 0, 'PENDING',
       'SEED-ELIG-VALIDATION', c.copay_category, c.elig_status, e.eligibility_check_id, c.special_exemption,
       now() - (c.g || ' hours')::interval, now()
FROM _cohort c
JOIN patients p ON p.mrn = c.mrn
JOIN encounters e ON e.patient_id = p.id;

-- ---------- 6. billing_items: 진찰료(수가) + 약품 2라인 (master LATERAL 직접 선택, 결정적) ----------
-- 수가 라인(급여)
INSERT INTO billing_items (id, billing_id, code_type, code_id, code_name, quantity, unit_price, amount, copay_rate, insurance_category, full_copay)
SELECT gen_random_uuid(), b.id, 'PROCEDURE', pr.id, pr.name_ko, 1, pr.unit_price, pr.unit_price,
       c.copay_rate, 'COVERED', c.full_copay
FROM billings b
JOIN patients p ON p.id = b.patient_id
JOIN _cohort c ON c.mrn = p.mrn
JOIN LATERAL (SELECT id, name_ko, unit_price FROM procedure_codes
              WHERE unit_price BETWEEN 3000 AND 150000 ORDER BY md5(b.id::text || 'p') LIMIT 1) pr ON true
WHERE b.cashier_note = 'SEED-ELIG-VALIDATION';

-- 약품 라인(급여, 보험 제품코드 보유분 우선 — insuranceProductCode 방출 검증)
INSERT INTO billing_items (id, billing_id, code_type, code_id, code_name, quantity, unit_price, amount, copay_rate, insurance_category, full_copay)
SELECT gen_random_uuid(), b.id, 'MEDICATION', md.id, md.name_ko, 2, md.unit_price, md.unit_price * 2,
       c.copay_rate, 'COVERED', c.full_copay
FROM billings b
JOIN patients p ON p.id = b.patient_id
JOIN _cohort c ON c.mrn = p.mrn
JOIN LATERAL (SELECT id, name_ko, unit_price FROM medication_codes
              WHERE unit_price > 0 ORDER BY (insurance_code IS NOT NULL) DESC, md5(b.id::text || 'm') LIMIT 1) md ON true
WHERE b.cashier_note = 'SEED-ELIG-VALIDATION';

-- ---------- 7. billing 합계 재계산(라인 합) ----------
UPDATE billings b
SET total_amount = t.total,
    patient_copay = t.copay,
    insurance_covered = t.total - t.copay
FROM (SELECT billing_id, sum(amount)::int total, sum(round(amount * copay_rate))::int copay
      FROM billing_items GROUP BY billing_id) t
WHERE b.id = t.billing_id AND b.cashier_note = 'SEED-ELIG-VALIDATION';

COMMIT;

-- ---------- 검증 ----------
SELECT '코호트(자격구분)' AS k, copay_category || '/' || eligibility_status AS v, count(*)::text n
FROM billings WHERE cashier_note = 'SEED-ELIG-VALIDATION' GROUP BY 2
UNION ALL
SELECT 'billing_items(full_copay)', full_copay::text, count(*)::text
FROM billing_items WHERE billing_id IN (SELECT id FROM billings WHERE cashier_note='SEED-ELIG-VALIDATION') GROUP BY 2;
