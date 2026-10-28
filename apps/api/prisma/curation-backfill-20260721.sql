-- ═══════════════════════════════════════════════════════════════════
-- 안전 게이트 큐레이션 초기값 백필 (2026-07-21)
-- 대상: procedure_codes.modality/uses_contrast · medication_codes 마약류/향정 분류
-- 멱등: 미설정(NULL) 행만 갱신 — 관리자 화면(admin/codes ⚙)에서 정정한 값은 덮지 않음.
-- 재실행 안전. 규칙은 휴리스틱 초기값이며 최종 확정은 관리자 큐레이션.
--
-- 오탐 방지 보정(운영 데이터 실측 기반):
--  · name LIKE '%CT%'는 ACTH(검사) 오탐 → '전산화단층' 문자열/HA 접두사만 사용
--  · '핵의학' 단독은 검체검사(핵의학적 방법=RIA) 오탐 → PET/SPECT/신티/감마/스캔만
--  · 코데인은 복합제(한외마약) 오분류 방지 → 성분 단일 기재만 마약 처리
-- ═══════════════════════════════════════════════════════════════════

-- ── A. 영상 수가 modality — 순서 중요(먼저 매칭된 규칙 우선) ──
UPDATE procedure_codes SET modality='RF' WHERE modality IS NULL AND name_ko LIKE '%투시%';
UPDATE procedure_codes SET modality='CT' WHERE modality IS NULL AND (code LIKE 'HA%' OR name_ko LIKE '%전산화단층%');
UPDATE procedure_codes SET modality='MR' WHERE modality IS NULL AND (code LIKE 'HE%' OR name_ko ~ 'MRI|MRA|자기공명');
UPDATE procedure_codes SET modality='US' WHERE modality IS NULL AND (code LIKE 'HC%' OR name_ko LIKE '%초음파%');
UPDATE procedure_codes SET modality='MG' WHERE modality IS NULL AND name_ko LIKE '%유방촬영%';
UPDATE procedure_codes SET modality='NM' WHERE modality IS NULL
  AND (name_ko ~ 'PET|SPECT|신티그|감마카메라' OR (name_ko LIKE '%스캔%' AND name_ko NOT LIKE '%핵의학적 방법%'));
UPDATE procedure_codes SET modality='CR' WHERE modality IS NULL AND code LIKE 'G%';

-- 정정: 유방촬영은 HA181(일반)/HA182(확대)/HA183(DBT 단층영상합성) 계열 — HA 접두사 CT 규칙에 선점됨(운영 실측) → MG
UPDATE procedure_codes SET modality='MG' WHERE code ~ '^HA18[123]' AND name_ko LIKE '%유방%';

-- 조영제 사용 — modality가 확정된 영상 행위 중 명칭에 '조영'(검체/재료 오탐 방지)
UPDATE procedure_codes SET uses_contrast=true
 WHERE uses_contrast=false AND modality IS NOT NULL AND name_ko LIKE '%조영%';

-- ── B. 마약류(NARCOTIC) — 단일 고위험 오피오이드 ──
UPDATE medication_codes SET narcotic_type='NARCOTIC', control_schedule='II'
 WHERE narcotic_type IS NULL AND control_schedule IS NULL
   AND (name_ko ~ '모르핀|몰핀|펜타닐|옥시코돈|페티딘|페치딘|레미펜타닐|수펜타닐|알펜타닐|하이드로몰폰|히드로모르폰|메타돈|타펜타돌|부프레노르핀'
     OR ingredient ~* 'morphine|fentanyl|oxycodone|pethidine|remifentanil|sufentanil|alfentanil|hydromorphone|methadone|tapentadol|buprenorphine');

-- 코데인/디히드로코데인 — 성분 단일 기재만(복합제=한외마약 가능성 → 사람 확정)
UPDATE medication_codes SET narcotic_type='NARCOTIC', control_schedule='II'
 WHERE narcotic_type IS NULL AND control_schedule IS NULL
   AND ingredient ~* 'codeine' AND ingredient !~ '[,+/]';

-- ── C. 향정신성(PSYCHOTROPIC) ──
-- 벤조디아제핀류·졸피뎀 — 라목(확신 높음)
UPDATE medication_codes SET narcotic_type='PSYCHOTROPIC', psychotropic_group='라', control_schedule='IV'
 WHERE narcotic_type IS NULL AND control_schedule IS NULL
   AND (name_ko ~ '미다졸람|디아제팜|로라제팜|알프라졸람|클로나제팜|트리아졸람|브로마제팜|에티졸람|플루라제팜|클로르디아제폭시드|졸피뎀'
     OR ingredient ~* 'midazolam|diazepam|lorazepam|alprazolam|clonazepam|triazolam|bromazepam|etizolam|flurazepam|chlordiazepoxide|zolpidem');

-- 메틸페니데이트 — 나목
UPDATE medication_codes SET narcotic_type='PSYCHOTROPIC', psychotropic_group='나', control_schedule='II'
 WHERE narcotic_type IS NULL AND control_schedule IS NULL
   AND (name_ko ~ '메틸페니데이트|콘서타|페니드' OR ingredient ~* 'methylphenidate');

-- 케타민·프로포폴·바르비탈류·식욕억제제 — 향정 확실·세부 목은 사람 확정(group NULL 유지)
UPDATE medication_codes SET narcotic_type='PSYCHOTROPIC', control_schedule='III'
 WHERE narcotic_type IS NULL AND control_schedule IS NULL
   AND (name_ko ~ '케타민|케타라' OR ingredient ~* 'ketamine');
UPDATE medication_codes SET narcotic_type='PSYCHOTROPIC', control_schedule='IV'
 WHERE narcotic_type IS NULL AND control_schedule IS NULL
   AND (name_ko ~ '프로포폴|포폴' OR ingredient ~* 'propofol');
UPDATE medication_codes SET narcotic_type='PSYCHOTROPIC', control_schedule='III'
 WHERE narcotic_type IS NULL AND control_schedule IS NULL
   AND (name_ko ~ '페노바르비탈|펜토바르비탈|티오펜탈' OR ingredient ~* 'phenobarbital|pentobarbital|thiopental');
UPDATE medication_codes SET narcotic_type='PSYCHOTROPIC', control_schedule='IV'
 WHERE narcotic_type IS NULL AND control_schedule IS NULL
   AND (name_ko ~ '펜터민|펜디메트라진|마진돌|디에틸프로피온' OR ingredient ~* 'phentermine|phendimetrazine|mazindol|diethylpropion');

-- ── 검증 요약 ──
SELECT 'modality 분포' AS metric, modality, COUNT(*) FROM procedure_codes WHERE modality IS NOT NULL GROUP BY modality ORDER BY modality;
SELECT '조영제 행위' AS metric, COUNT(*) FROM procedure_codes WHERE uses_contrast=true;
SELECT '마약류 분류' AS metric, narcotic_type, control_schedule, psychotropic_group, COUNT(*) FROM medication_codes WHERE narcotic_type IS NOT NULL GROUP BY narcotic_type, control_schedule, psychotropic_group ORDER BY narcotic_type, control_schedule;
