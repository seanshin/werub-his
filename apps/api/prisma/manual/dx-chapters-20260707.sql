-- 상병 KCD 챕터(대분류) category 백필 — 2026-07-07 (멱등·코드마스터 카테고리 필터용)
UPDATE diagnosis_codes SET category = CASE
  WHEN left(code,3) BETWEEN 'A00' AND 'B99' THEN '감염성·기생충성 질환'
  WHEN left(code,3) BETWEEN 'C00' AND 'D48' THEN '신생물(종양)'
  WHEN left(code,3) BETWEEN 'D50' AND 'D89' THEN '혈액·조혈기관·면역'
  WHEN left(code,3) BETWEEN 'E00' AND 'E90' THEN '내분비·영양·대사'
  WHEN left(code,3) BETWEEN 'F00' AND 'F99' THEN '정신 및 행동장애'
  WHEN left(code,3) BETWEEN 'G00' AND 'G99' THEN '신경계통'
  WHEN left(code,3) BETWEEN 'H00' AND 'H59' THEN '눈 및 눈부속기'
  WHEN left(code,3) BETWEEN 'H60' AND 'H95' THEN '귀 및 유돌'
  WHEN left(code,3) BETWEEN 'I00' AND 'I99' THEN '순환계통'
  WHEN left(code,3) BETWEEN 'J00' AND 'J99' THEN '호흡계통'
  WHEN left(code,3) BETWEEN 'K00' AND 'K93' THEN '소화계통'
  WHEN left(code,3) BETWEEN 'L00' AND 'L99' THEN '피부·피하조직'
  WHEN left(code,3) BETWEEN 'M00' AND 'M99' THEN '근골격계·결합조직'
  WHEN left(code,3) BETWEEN 'N00' AND 'N99' THEN '비뇨생식계통'
  WHEN left(code,3) BETWEEN 'O00' AND 'O99' THEN '임신·출산·산후기'
  WHEN left(code,3) BETWEEN 'P00' AND 'P96' THEN '출생전후기 병태'
  WHEN left(code,3) BETWEEN 'Q00' AND 'Q99' THEN '선천기형·염색체이상'
  WHEN left(code,3) BETWEEN 'R00' AND 'R99' THEN '증상·징후·이상소견'
  WHEN left(code,3) BETWEEN 'S00' AND 'T98' THEN '손상·중독·외인 결과'
  WHEN left(code,3) BETWEEN 'U00' AND 'U99' THEN '특수목적 코드'
  WHEN left(code,3) BETWEEN 'V01' AND 'Y98' THEN '이환·사망의 외인'
  WHEN left(code,3) BETWEEN 'Z00' AND 'Z99' THEN '건강상태·보건서비스'
  ELSE category END,
  updated_at = now()
WHERE code_system = 'KCD-8' AND category IS NULL;
