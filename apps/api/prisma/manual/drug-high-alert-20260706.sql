-- ISMP 고위험 약물(High-Alert) 분류 백필 — 2026-07-06 운영 적용 완료(기록용·멱등)
-- 근거: ISMP High-Alert Medications(급성기) 핵심 8분류 중 급여목록 성분 매칭 7분류.
-- ingredient(영문 주성분, HIRA 급여표 유래) 패턴 기반 — 표시만 추가(기존 플래그 제거 없음).
-- 결과: 634품목 — ANTICOAGULANT 184 · CHEMOTHERAPY 166 · OPIOID 155 ·
--        CONCENTRATED_ELECTROLYTE 46 · SEDATIVE 36 · INSULIN 31 · NEUROMUSCULAR_BLOCKER 16
-- 카테고리 키는 dur.service.ts HIGH_ALERT_LABELS와 일치(한글 라벨 표시).

BEGIN;
CREATE TEMP TABLE tmp_ha (category text, pat text);
INSERT INTO tmp_ha VALUES
 ('INSULIN','%insulin%'),
 ('ANTICOAGULANT','%warfarin%'),('ANTICOAGULANT','%heparin%'),('ANTICOAGULANT','%enoxaparin%'),('ANTICOAGULANT','%dalteparin%'),('ANTICOAGULANT','%rivaroxaban%'),('ANTICOAGULANT','%apixaban%'),('ANTICOAGULANT','%edoxaban%'),('ANTICOAGULANT','%dabigatran%'),('ANTICOAGULANT','%fondaparinux%'),('ANTICOAGULANT','%argatroban%'),
 ('OPIOID','%fentanyl%'),('OPIOID','%morphine%'),('OPIOID','%oxycodone%'),('OPIOID','%hydromorphone%'),('OPIOID','%remifentanil%'),('OPIOID','%sufentanil%'),('OPIOID','%alfentanil%'),('OPIOID','%pethidine%'),('OPIOID','%tapentadol%'),('OPIOID','%methadone%'),('OPIOID','%buprenorphine%'),
 ('CHEMOTHERAPY','%methotrexate%'),('CHEMOTHERAPY','%cisplatin%'),('CHEMOTHERAPY','%carboplatin%'),('CHEMOTHERAPY','%oxaliplatin%'),('CHEMOTHERAPY','%doxorubicin%'),('CHEMOTHERAPY','%epirubicin%'),('CHEMOTHERAPY','%cyclophosphamide%'),('CHEMOTHERAPY','%ifosfamide%'),('CHEMOTHERAPY','%fluorouracil%'),('CHEMOTHERAPY','%gemcitabine%'),('CHEMOTHERAPY','%paclitaxel%'),('CHEMOTHERAPY','%docetaxel%'),('CHEMOTHERAPY','%vincristine%'),('CHEMOTHERAPY','%vinblastine%'),('CHEMOTHERAPY','%vinorelbine%'),('CHEMOTHERAPY','%etoposide%'),('CHEMOTHERAPY','%irinotecan%'),('CHEMOTHERAPY','%cytarabine%'),
 ('NEUROMUSCULAR_BLOCKER','%rocuronium%'),('NEUROMUSCULAR_BLOCKER','%vecuronium%'),('NEUROMUSCULAR_BLOCKER','%atracurium%'),('NEUROMUSCULAR_BLOCKER','%suxamethonium%'),('NEUROMUSCULAR_BLOCKER','%succinylcholine%'),
 ('SEDATIVE','%midazolam%'),('SEDATIVE','%propofol%'),('SEDATIVE','%dexmedetomidine%'),('SEDATIVE','%ketamine%'),
 ('THROMBOLYTIC','%alteplase%'),('THROMBOLYTIC','%tenecteplase%'),('THROMBOLYTIC','%urokinase%'),('THROMBOLYTIC','%streptokinase%');

UPDATE medication_codes m
SET high_alert_flag = true, high_alert_category = h.category, updated_at = now()
FROM (SELECT DISTINCT ON (m2.id) m2.id, t.category
      FROM medication_codes m2 JOIN tmp_ha t ON m2.ingredient ILIKE t.pat
      WHERE m2.high_alert_flag = false ORDER BY m2.id) h
WHERE m.id = h.id;

-- 고농도전해질: KCl·인산칼륨·고장식염수 — 주사제만(경구 칼륨은 제외)
UPDATE medication_codes SET high_alert_flag = true, high_alert_category = 'CONCENTRATED_ELECTROLYTE', updated_at = now()
WHERE high_alert_flag = false
  AND (ingredient ILIKE '%potassium chloride%' OR ingredient ILIKE '%potassium phosphate%' OR ingredient ILIKE '%sodium chloride%3%')
  AND (dosage_form ILIKE '%주%' OR name_ko LIKE '%주%');
COMMIT;
