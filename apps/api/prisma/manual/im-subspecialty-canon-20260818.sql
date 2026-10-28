-- 내과 세부전문과 어휘 정본화 — 이연 회수 T2-3 (2026-08-18)
--
-- 🔴 배경: 같은 개념에 어휘가 네 벌이었다.
--    코드 정본 `GASTRO`/`ENDOCRINE` · 리치니스 시드 `GASTROENTEROLOGY`/`ENDOCRINOLOGY` ·
--    진료 입력 화면이 저장한 **한글**(`소화기내과` …).
--    조회 화면·지표 추이표는 코드로 필터하므로, 다른 어휘로 저장된 기록은
--    **저장한 사람에게도 보이지 않는다**(운영 표본 20명에서 15건 확인).
--
-- 코드 쪽은 이미 정본 하나로 모았다(shared `IM_SUBSPECIALTIES` · 시드 · DTO `@IsIn` · 화면).
-- 이 SQL 은 **이미 저장된 행**을 정본 어휘로 옮긴다.
--
-- ⚠️ 적용 판단은 사람 몫이다. 현재 운영 DB 는 가상 병원 시드이므로 **재시드로도 해소**된다
--    (`npx ts-node --transpile-only prisma/seeds/dept-richness.ts`).
--    실환자 데이터에서는 이 UPDATE 가 진료 기록의 분류를 바꾸는 변경이라 기록 관리 책임자 확인이 필요하다.
--
-- 실행 전 확인:
--   SELECT subspecialty, count(*) FROM internal_medicine_exams GROUP BY 1 ORDER BY 2 DESC;

BEGIN;

UPDATE internal_medicine_exams SET subspecialty = 'GASTRO'
 WHERE subspecialty IN ('GASTROENTEROLOGY', '소화기내과');

UPDATE internal_medicine_exams SET subspecialty = 'ENDOCRINE'
 WHERE subspecialty IN ('ENDOCRINOLOGY', '내분비내과');

UPDATE internal_medicine_exams SET subspecialty = 'CARDIOLOGY'   WHERE subspecialty = '심장내과';
UPDATE internal_medicine_exams SET subspecialty = 'PULMONOLOGY'  WHERE subspecialty = '호흡기내과';
UPDATE internal_medicine_exams SET subspecialty = 'NEPHROLOGY'   WHERE subspecialty = '신장내과';
UPDATE internal_medicine_exams SET subspecialty = 'HEMATO_ONCOLOGY' WHERE subspecialty = '혈액종양내과';
UPDATE internal_medicine_exams SET subspecialty = 'INFECTIOUS'   WHERE subspecialty = '감염내과';
UPDATE internal_medicine_exams SET subspecialty = 'RHEUMATOLOGY' WHERE subspecialty = '류마티스내과';

-- 남은 정본 밖 값이 있으면 커밋하지 않고 눈으로 본다(모르는 어휘를 임의로 매핑하지 않는다).
SELECT subspecialty, count(*) AS rows
  FROM internal_medicine_exams
 WHERE subspecialty NOT IN ('CARDIOLOGY','PULMONOLOGY','GASTRO','ENDOCRINE',
                            'NEPHROLOGY','HEMATO_ONCOLOGY','INFECTIOUS','RHEUMATOLOGY')
 GROUP BY 1;

COMMIT;
