-- ═══════════════════════════════════════════════════════════════════
-- 외국인 환자 데모 시드 (2026-07-21) — 멱등(mrn ON CONFLICT DO NOTHING)
-- 4유형×다국적 12명(+보관 1명 포함). created_by/updated_by = 첫 ADMIN 계정.
-- MRN 'XX-DEMO-###' 형식으로 데모 식별 가능. 재실행 안전.
-- ═══════════════════════════════════════════════════════════════════

WITH admin AS (SELECT id FROM users WHERE role='ADMIN' ORDER BY created_at LIMIT 1)
INSERT INTO patients (
  id, mrn, family_name, given_name, name_en, date_of_birth, gender,
  nationality, preferred_language, passport_number, passport_expiry, visa_type,
  alien_registration_no, phone, email, patient_source, insurance_type,
  travel_insurance, embassy_contact, interpreter_needed, deposit_required,
  address, is_active, archived_at, created_by, updated_by, created_at, updated_at
)
SELECT v.*, admin.id, admin.id, now(), now() FROM (
  VALUES
  -- 외국인 관광객(FT) 5
  (gen_random_uuid(), 'FT-DEMO-001', 'Smith', 'John', 'John Smith', DATE '1985-03-14', 'MALE'::"Gender",
   'USA', 'en', 'US1234567', DATE '2030-05-01', 'B-2', NULL, '+1-212-555-0101', 'john.smith@example.com',
   'FOREIGN_TOURIST', 'SELF_PAY'::"InsuranceType",
   '{"company":"Allianz Travel","policyNo":"ATP-2026-88121","contactNo":"+1-800-555-0199"}'::jsonb, NULL, true, true,
   '{"detail":"서울시 강남구 테헤란로 ○○호텔 1203호","type":"LOCAL_STAY"}'::jsonb, true, NULL),
  (gen_random_uuid(), 'FT-DEMO-002', '王', '伟', 'Wang Wei', DATE '1990-11-02', 'MALE'::"Gender",
   'CHN', 'zh', 'E87654321', DATE '2028-09-15', 'C-3', NULL, '+86-138-0000-1122', 'wangwei@example-cn.example',
   'FOREIGN_TOURIST', 'SELF_PAY'::"InsuranceType", NULL, NULL, true, true,
   '{"detail":"부산시 해운대구 △△리조트 805호","type":"LOCAL_STAY"}'::jsonb, true, NULL),
  (gen_random_uuid(), 'FT-DEMO-003', 'Иванова', 'Ольга', 'Olga Ivanova', DATE '1978-07-21', 'FEMALE'::"Gender",
   'RUS', 'ru', 'RU5544332', DATE '2027-12-31', 'C-3', NULL, '+7-903-555-7788', 'olga.iv@example-ru.example',
   'FOREIGN_TOURIST', 'SELF_PAY'::"InsuranceType",
   '{"company":"Ingosstrakh","policyNo":"ING-77-334455","contactNo":"+7-495-555-0100"}'::jsonb, NULL, true, true,
   NULL, true, NULL),
  (gen_random_uuid(), 'FT-DEMO-004', 'Бат-Эрдэнэ', 'Сарнай', 'Sarnai Bat-Erdene', DATE '1995-01-30', 'FEMALE'::"Gender",
   'MNG', 'mn', 'MN0099887', DATE '2029-03-20', 'C-3', NULL, '+976-9911-2233', NULL,
   'FOREIGN_TOURIST', 'SELF_PAY'::"InsuranceType", NULL, '주한몽골대사관 +82-2-794-1350', true, true,
   NULL, true, NULL),
  (gen_random_uuid(), 'FT-DEMO-005', 'Nguyễn', 'Thị Lan', 'Nguyen Thi Lan', DATE '1988-09-09', 'FEMALE'::"Gender",
   'VNM', 'vi', 'VN2233445', DATE '2026-08-30', 'C-3', NULL, '+84-90-555-6677', 'lan.nguyen@example-vn.example',
   'FOREIGN_TOURIST', 'SELF_PAY'::"InsuranceType", NULL, NULL, true, true,
   '{"detail":"서울시 중구 □□게스트하우스 302호","type":"LOCAL_STAY"}'::jsonb, true, NULL),
  -- 외국인 거주자(FR) 3
  (gen_random_uuid(), 'FR-DEMO-001', 'Johnson', 'Emily', 'Emily Johnson', DATE '1992-04-18', 'FEMALE'::"Gender",
   'USA', 'en', 'US7788990', DATE '2031-01-10', 'E-7', '920418-6234567', '+82-10-2222-3344', 'emily.j@example.com',
   'FOREIGN_RESIDENT', 'NHI'::"InsuranceType", NULL, NULL, false, false,
   '{"detail":"서울시 마포구 서교동 ○○아파트 101동 502호","type":"LOCAL_STAY"}'::jsonb, true, NULL),
  (gen_random_uuid(), 'FR-DEMO-002', 'Sharma', 'Raj', 'Raj Sharma', DATE '1983-12-05', 'MALE'::"Gender",
   'IND', 'en', 'IN4455667', DATE '2029-06-22', 'E-9', '831205-5345678', '+82-10-7777-8899', NULL,
   'FOREIGN_RESIDENT', 'NHI'::"InsuranceType", NULL, NULL, true, false,
   NULL, true, NULL),
  (gen_random_uuid(), 'FR-DEMO-003', 'Батбаяр', 'Тэмүүлэн', 'Temuulen Batbayar', DATE '1999-06-15', 'MALE'::"Gender",
   'MNG', 'mn', 'MN7766554', DATE '2028-02-28', 'D-2', '990615-5456789', '+82-10-5555-1212', 'temuulen@example-mn.example',
   'FOREIGN_RESIDENT', 'NHI'::"InsuranceType", NULL, NULL, true, false,
   NULL, true, NULL),
  -- 재외동포(OK) 2
  (gen_random_uuid(), 'OK-DEMO-001', '김', '영수', 'Youngsoo Kim', DATE '1970-02-25', 'MALE'::"Gender",
   'USA', 'ko', 'US3322110', DATE '2032-11-05', 'F-4', NULL, '+1-310-555-4455', 'yskim@example.com',
   'OVERSEAS_KOREAN', 'SELF_PAY'::"InsuranceType", NULL, NULL, false, true,
   '{"detail":"서울시 서초구 반포동 (단기 체류)","type":"LOCAL_STAY"}'::jsonb, true, NULL),
  (gen_random_uuid(), 'OK-DEMO-002', '박', '지현', 'Jihyun Park', DATE '1986-10-11', 'FEMALE'::"Gender",
   'CAN', 'ko', 'CA6677889', DATE '2030-07-19', 'F-4', NULL, '+1-604-555-9900', 'jihyun.park@example-ca.example',
   'OVERSEAS_KOREAN', 'SELF_PAY'::"InsuranceType", NULL, NULL, false, true,
   NULL, true, NULL),
  -- 원격 해외환자(RI) 2 — 1명은 보관 처리(데모)
  (gen_random_uuid(), 'RI-DEMO-001', 'Al-Rashid', 'Fatima', 'Fatima Al-Rashid', DATE '1975-05-08', 'FEMALE'::"Gender",
   'ARE', 'ar', 'AE1122334', DATE '2029-10-14', NULL, NULL, '+971-50-555-6611', 'fatima.ar@example-ae.example',
   'REMOTE_INTERNATIONAL', 'SELF_PAY'::"InsuranceType", NULL, '주한UAE대사관 보증 문의', true, true,
   NULL, true, NULL),
  (gen_random_uuid(), 'RI-DEMO-002', 'Tanaka', 'Hiroshi', 'Hiroshi Tanaka', DATE '1968-08-19', 'MALE'::"Gender",
   'JPN', 'ja', 'JP9988776', DATE '2027-04-02', NULL, NULL, '+81-90-5555-7788', 'h.tanaka@example-jp.example',
   'REMOTE_INTERNATIONAL', 'SELF_PAY'::"InsuranceType", NULL, NULL, false, true,
   NULL, false, now())
) AS v(id, mrn, family_name, given_name, name_en, date_of_birth, gender,
       nationality, preferred_language, passport_number, passport_expiry, visa_type,
       alien_registration_no, phone, email, patient_source, insurance_type,
       travel_insurance, embassy_contact, interpreter_needed, deposit_required,
       address, is_active, archived_at)
CROSS JOIN admin
ON CONFLICT (mrn) DO NOTHING;

-- 비상연락처 데모(관광객 2명) — 멱등: 동일 환자에 기존 비상연락처 없을 때만
INSERT INTO patient_contacts (id, patient_id, relationship, relationship_detail, name, phone, is_emergency_contact, priority)
SELECT gen_random_uuid(), p.id, 'OTHER', '배우자', 'Jane Smith', '+1-212-555-0102', true, 1
FROM patients p WHERE p.mrn='FT-DEMO-001'
  AND NOT EXISTS (SELECT 1 FROM patient_contacts c WHERE c.patient_id=p.id AND c.is_emergency_contact);
INSERT INTO patient_contacts (id, patient_id, relationship, relationship_detail, name, phone, is_emergency_contact, priority)
SELECT gen_random_uuid(), p.id, 'OTHER', '아버지', 'Nguyễn Văn Minh', '+84-91-555-0000', true, 1
FROM patients p WHERE p.mrn='FT-DEMO-005'
  AND NOT EXISTS (SELECT 1 FROM patient_contacts c WHERE c.patient_id=p.id AND c.is_emergency_contact);

-- 검증
SELECT patient_source, COUNT(*), COUNT(*) FILTER (WHERE NOT is_active) AS archived
FROM patients WHERE mrn LIKE '%-DEMO-%' GROUP BY patient_source ORDER BY patient_source;

-- 한글 호칭 이름(호출용) 백필 — 멱등(미설정만)
UPDATE patients SET korean_name = v.kn FROM (VALUES
  ('FT-DEMO-001','스미스 존'), ('FT-DEMO-002','왕 웨이'), ('FT-DEMO-003','이바노바 올가'),
  ('FT-DEMO-004','사르나이'), ('FT-DEMO-005','응우옌 란'), ('FR-DEMO-001','존슨 에밀리'),
  ('FR-DEMO-002','샤르마 라지'), ('FR-DEMO-003','테무렌'), ('RI-DEMO-001','파티마'), ('RI-DEMO-002','다나카 히로시')
) AS v(mrn, kn) WHERE patients.mrn = v.mrn AND patients.korean_name IS NULL;
