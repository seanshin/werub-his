-- ============================================================
-- ERP 진료비 계산(D-6) 검증용 시드 — ~100 billing_items
-- 식별/정리: 환자 mrn 'SEED-ERP-%', billing cashier_note='SEED-ERP-CALC'
-- 멱등: 재실행 시 아래 CLEANUP가 기존 시드 제거 후 재생성
-- 생성: 보험구분 5종(NHI/MEDICAID/SELF_PAY 기존 + INDUSTRIAL/AUTO 신규환자)
--       × 실 EDI 코드(단가>0) × codeType(TARIFF/DRUG) × copayRate × 급여/비급여
-- 실행: docker exec ... psql -U hospital -d hospitalrun -f <this>
-- ============================================================
BEGIN;

-- ---------- CLEANUP (재실행 멱등) ----------
DELETE FROM billing_items WHERE billing_id IN (SELECT id FROM billings WHERE cashier_note = 'SEED-ERP-CALC');
DELETE FROM billings WHERE cashier_note = 'SEED-ERP-CALC';
DELETE FROM encounters WHERE patient_id IN (SELECT id FROM patients WHERE mrn LIKE 'SEED-ERP-%');
DELETE FROM patients WHERE mrn LIKE 'SEED-ERP-%';

-- ---------- 1. 신규 환자 10명 (INDUSTRIAL 5 + AUTO 5) ----------
INSERT INTO patients (id, mrn, family_name, given_name, date_of_birth, gender, insurance_type, created_at, updated_at, created_by, updated_by)
SELECT gen_random_uuid(),
       'SEED-ERP-P' || lpad(g::text, 3, '0'),
       '시드', '환자' || g,
       ('1970-01-01'::date + (g * 137))::date,
       (ARRAY['MALE','FEMALE'])[1 + (g % 2)]::"Gender",
       (CASE WHEN g <= 5 THEN 'INDUSTRIAL' ELSE 'AUTO' END)::"InsuranceType",
       now(), now(),
       (SELECT id FROM users WHERE role = 'ADMIN' LIMIT 1),
       (SELECT id FROM users WHERE role = 'ADMIN' LIMIT 1)
FROM generate_series(1, 10) g;

-- ---------- 2. 신규 환자 encounters ----------
INSERT INTO encounters (id, patient_id, doctor_id, visit_type, created_at, updated_at)
SELECT gen_random_uuid(), p.id,
       (SELECT user_id FROM staff WHERE category = 'MEDICAL' AND user_id IS NOT NULL ORDER BY id LIMIT 1),
       'OUTPATIENT', now(), now()
FROM patients p WHERE p.mrn LIKE 'SEED-ERP-%';

-- ---------- 3. 코드 풀(100): 실 EDI 코드, 단가>0 ----------
CREATE TEMP TABLE _cpool ON COMMIT DROP AS
SELECT row_number() OVER () AS rn, code_id, code, name_ko, unit_price, ctype FROM (
  (SELECT id AS code_id, code, name_ko, unit_price, 'PROCEDURE'::text AS ctype
    FROM procedure_codes WHERE unit_price BETWEEN 3000 AND 250000 ORDER BY random() LIMIT 70)
  UNION ALL
  (SELECT id, code, name_ko, unit_price, 'MEDICATION'::text
    FROM medication_codes WHERE unit_price > 0 ORDER BY random() LIMIT 30)
) x;

-- ---------- 4. 대상 encounter 50개 (신규 INDUSTRIAL/AUTO 우선 + 기존 free) ----------
CREATE TEMP TABLE _enc ON COMMIT DROP AS
SELECT row_number() OVER () AS rn, e.id AS encounter_id, e.patient_id
FROM encounters e
WHERE NOT EXISTS (SELECT 1 FROM billings b WHERE b.encounter_id = e.id)
ORDER BY (e.patient_id IN (SELECT id FROM patients WHERE mrn LIKE 'SEED-ERP-%')) DESC, e.id
LIMIT 50;

-- ---------- 5. billings 50 ----------
-- 🔴 PAID 는 **수납 기록을 동반해야 한다.** 종전엔 status 만 PAID 로 넣고 paid_at·paid_amount 를
--    컬럼 목록에서 통째로 빠뜨려, "수납 완료인데 결제액 0·결제시각 없음" 17건이 운영 DB 에 남았다
--    (2026-08-10 실측). 금액은 아래 7단계에서 billing_items 합계로 채우므로 여기선 시각만 먼저 박고
--    금액은 같은 단계에서 함께 채운다 — 상태와 증거가 갈라지지 않게.
INSERT INTO billings (id, encounter_id, patient_id, total_amount, insurance_covered, patient_copay, status, paid_at, cashier_note, created_at, updated_at)
SELECT gen_random_uuid(), encounter_id, patient_id, 0, 0, 0,
       (ARRAY['PENDING','PAID','PENDING']::"BillingStatus"[])[1 + (rn % 3)],
       CASE WHEN (ARRAY['PENDING','PAID','PENDING']::"BillingStatus"[])[1 + (rn % 3)] = 'PAID'
            THEN now() - (rn || ' hours')::interval END,
       'SEED-ERP-CALC', now() - (rn || ' hours')::interval, now()
FROM _enc;

-- ---------- 6. billing_items 2/billing = 100 ----------
CREATE TEMP TABLE _bil ON COMMIT DROP AS
SELECT row_number() OVER () AS rn, id AS billing_id FROM billings WHERE cashier_note = 'SEED-ERP-CALC';

-- 🔴 종전 결함: copay_rate 와 insurance_category 를 **서로 다른 식으로 독립 추첨**했다.
--    (b.rn=9, s=1) 처럼 NON_COVERED 이면서 copay_rate=0.0000 이 나오는 조합이 있었고,
--    그러면 아래 7번 합계에서 `insurance_covered = total - 0` 이 되어 **비급여를 보험자가 전액 부담**한다.
--    정본은 `billing.service.ts` 의 `effCopayRate = isCovered ? copayRate : 1` / `fullCopay = effCopayRate >= 1` —
--    비급여는 **무조건 전액 본인부담**이다. 급여 여부를 먼저 정하고 율을 거기서 파생시킨다.
--    (종전엔 full_copay 컬럼을 INSERT 목록에서 아예 빼서 전액본인부담 표시도 못 했다.)
INSERT INTO billing_items (id, billing_id, code_type, code_id, code_name, quantity, unit_price, amount, copay_rate, insurance_category, full_copay)
SELECT gen_random_uuid(), b.billing_id, c.ctype, c.code_id, c.name_ko,
       q.qty, c.unit_price, c.unit_price * q.qty,
       CASE WHEN (b.rn + s) % 5 = 0 THEN 1.0000
            ELSE (ARRAY[0.2000, 0.3000, 0.5000]::numeric[])[1 + ((b.rn * 2 + s) % 3)] END,
       (CASE WHEN (b.rn + s) % 5 = 0 THEN 'NON_COVERED' ELSE 'COVERED' END),
       ((b.rn + s) % 5 = 0)
FROM _bil b
CROSS JOIN generate_series(0, 1) s
JOIN LATERAL (SELECT * FROM _cpool WHERE rn = 1 + ((b.rn * 2 + s) % 100)) c ON true
JOIN LATERAL (SELECT (1 + ((b.rn + s) % 3)) AS qty) q ON true;

-- ---------- 7. billing 합계 갱신(라인 합산) ----------
UPDATE billings b
SET total_amount = t.total,
    patient_copay = t.copay,
    insurance_covered = t.total - t.copay,
    -- PAID 는 결제액도 함께 채운다 — 상태(PAID)와 증거(paid_amount)가 갈라지면
    -- "수납 완료인데 결제액 0"이라는 모순이 남고, 관제·매출 집계가 그것을 0으로 읽는다.
    paid_amount = CASE WHEN b.status = 'PAID' THEN t.copay ELSE b.paid_amount END
FROM (SELECT billing_id, sum(amount)::int total, sum(round(amount * copay_rate))::int copay
      FROM billing_items GROUP BY billing_id) t
WHERE b.id = t.billing_id AND b.cashier_note = 'SEED-ERP-CALC';

COMMIT;

-- ---------- 검증 ----------
SELECT '환자(보험구분)' AS k, insurance_type::text, count(*) FROM patients WHERE mrn LIKE 'SEED-ERP-%' GROUP BY insurance_type
UNION ALL
SELECT 'billings', '', count(*) FROM billings WHERE cashier_note='SEED-ERP-CALC'
UNION ALL
SELECT 'billing_items', '', count(*) FROM billing_items WHERE billing_id IN (SELECT id FROM billings WHERE cashier_note='SEED-ERP-CALC');
