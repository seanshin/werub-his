-- 상병 제한 속성 백필 — 2026-07-07 운영 적용 완료(기록용·멱등)
-- 원천: HIRA 상병마스터(20250930) — 주상병사용구분 N·성별구분(X=여/Y=남)·상한/하한연령
-- 결과: 주상병불가 3,834 · 성별제한 1,121 · 연령제한 697 (완전코드 5,031개 제한 보유)
-- 재적용: (code,np,sex,amin,amax) CSV를 /tmp/dx-restrict.csv 로 넣고 실행
-- 성별: 앱은 sex_restriction을 환자 sex(M/F)와 직접 비교(encounter.service.ts) → SQL이 X/Y를 F/M로 변환(아래).
--       원본 HIRA(X=여/Y=남) 또는 사전변환(M/F) CSV 모두 안전. (운영 DB는 이미 M/F: F 978·M 143)
BEGIN;
ALTER TABLE diagnosis_codes ADD COLUMN IF NOT EXISTS not_primary boolean NOT NULL DEFAULT false;
ALTER TABLE diagnosis_codes ADD COLUMN IF NOT EXISTS sex_restriction varchar(1);
ALTER TABLE diagnosis_codes ADD COLUMN IF NOT EXISTS age_min int;
ALTER TABLE diagnosis_codes ADD COLUMN IF NOT EXISTS age_max int;
CREATE TEMP TABLE tmp_rx (code varchar(20), np varchar(1), sex varchar(1), amin varchar(5), amax varchar(5));
COPY tmp_rx FROM '/tmp/dx-restrict.csv' WITH (FORMAT csv);
UPDATE diagnosis_codes d SET
  not_primary = (t.np = '1'),
  sex_restriction = CASE WHEN upper(t.sex)='X' THEN 'F' WHEN upper(t.sex)='Y' THEN 'M' ELSE NULLIF(t.sex,'') END,
  age_min = NULLIF(t.amin,'')::int,
  age_max = NULLIF(t.amax,'')::int,
  updated_at = now()
FROM tmp_rx t WHERE d.code_system='KCD-8' AND d.code = t.code;
COMMIT;
