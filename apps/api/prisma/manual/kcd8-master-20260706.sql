-- KCD-8 상병마스터 임포트 — 2026-07-06 운영 적용 완료(기록용·멱등)
-- 원천: 공공데이터포털 "건강보험심사평가원_상병마스터_20250930" CSV(47,798행·CP949)
-- 정제: 완전코드(청구가능)만·상병기호 중복 dedup·점 표기 변환(A000→A00.0, 기존 시드 관례)
--       → 18,117 고유 완전코드, 기존 KCD-8 시드 127건과 겹침 60건은 시드 유지(비파괴)
-- 결과: diagnosis_codes KCD-8 127 → 18,184건
-- 재적용: 정제 CSV(code,name_ko,name_en)를 컨테이너 /tmp/dx-import.csv 로 넣고 실행
BEGIN;
CREATE TEMP TABLE tmp_dx (code varchar(20), name_ko varchar(500), name_en varchar(500));
COPY tmp_dx FROM '/tmp/dx-import.csv' WITH (FORMAT csv);
INSERT INTO diagnosis_codes (id, code_system, code, name_ko, name_en, is_active, valid_from, created_at, updated_at)
SELECT gen_random_uuid(), 'KCD-8', t.code, t.name_ko, NULLIF(t.name_en,''), true, DATE '2026-01-01', now(), now()
FROM tmp_dx t
WHERE NOT EXISTS (SELECT 1 FROM diagnosis_codes d WHERE d.code_system='KCD-8' AND d.code=t.code);
COMMIT;
