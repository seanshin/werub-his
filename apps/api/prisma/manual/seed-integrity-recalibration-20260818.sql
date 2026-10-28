-- =============================================================================
-- 시드 데이터 정합화 — 현 시점(2026-08-18) 기준 재교정
-- =============================================================================
--
-- 왜 이 파일이 존재하는가
--   운영 DB(`his.example.org`)는 **가상 병원 시드**다(실환자 없음 — CLAUDE.md §"운영 DB 는
--   가상 병원의 시드 데이터다"). v4.3.0 에서 **생성기**는 고쳤으나 **이미 저장된 행**은
--   그대로 남아 화면과 지표가 서로 모순된 사실을 말하고 있다. 이 SQL 이 그 행들을 정리한다.
--
-- 🔴 평소 규약("시드 데이터 품질 결함은 코드로 교정하지 않는다")은 **화면 방어**에 관한 것이다.
--    이 파일은 그 예외로 **명시적으로 지시받은 시드 정합화**다. 실환자 DB 에는 적용하지 않는다
--    (§0 중단 가드가 막는다).
--
-- ── 이 파일이 지키는 규칙 ─────────────────────────────────────────────────
--   1) **파생만 복원한다.** 없는 소견·판독문·결과값을 지어내지 않는다.
--   2) **모르는 시각을 원장에 박지 않는다.** 시각 역전은 뒤쪽을 당기지 않고
--      **불가능한 쪽을 NULL/미완료**로 되돌린다.
--   3) **알 수 없는 것은 NULL** 이다. `0` 은 다른 사실이다.
--   4) 판정·등급은 가능하면 **원본 컬럼에서 재계산**한다. 정본 규칙을 SQL 로 옮겨 적은 곳은
--      **블록 머리에 정본 파일 경로를 명시**했다 — 그 순간 같은 사실에 정본이 둘이 된다는 것을
--      알고 하는 것이다(P12). 정본이 바뀌면 이 파일은 **재실행 대상이 아니라 폐기 대상**이다.
--   5) 각 블록 앞에 **영향 행수 확인 SELECT** 가 있다. 위험한 블록에는 **중단 가드**가 있다.
--
-- 적용 전
--   ./infra/scripts/deploy.sh --backup
-- 적용
--   ssh -p 819 deploy@198.51.100.73 \
--     "docker exec -i docker-postgres-1 psql -U hospital -d hospitalrun -v ON_ERROR_STOP=1" \
--     < apps/api/prisma/manual/seed-integrity-recalibration-20260818.sql
-- 적용 후
--   seed-integrity-recalibration-verify-20260818.sql 을 돌려 0 이 되는지 확인
--
-- 🔴 선행 조건 2 — §9-e(대기열)는 **배포 `5e3105b8` 이후에만 유효하다**
--   그 배포(2026-08-18 13:25 · v4.3.0)에 W8 수정(`97879f5d` · dev-demo.service.ts)이 들어갔다.
--   그 전에는 매일 09:00 크론이 완료 위장을 다시 만들었다 — **W9 의 교정이 그래서 되살아났다.**
--   §9-e 의 중단 가드가 "배포 이후 생성분이 0인가"를 직접 확인한다.
--   🔴 **재생성이 정말 멈췄는지는 다음 09:00 크론이 돌아야 확정된다.** 검증 SQL 에
--      "교정 후 다시 늘어났는가"를 세는 항목이 있다 — 다음 날 반드시 확인한다.
--
-- 🔴 기준선 재실측 (2026-08-18 14:05) — 다른 에이전트가 최근 6주 임상 활동을 운영 DB 에 넣었다
--   분모가 크게 늘었다: lab_result_items 1,881→3,013 · billing_items 143→1,225 ·
--   encounters 584→746 · orders→1,212 · billings→322 · dispensings→287.
--   **위반 건수는 전 항목 그대로였다**(273·2·4·2·1·18·13·15·102·23·38·59·417·1·1·1·2·1·1).
--   → 새로 들어온 행이 만든 불일치는 **0건**이다. 이 파일의 대상은 전부 기존 시드 행이다.
--   ⚠️ 그럼에도 **적용 직전에 검증 SQL 로 기준선을 다시 잡는다** — 그 사이 또 바뀔 수 있다.
--
-- 선행 조건: `deferred-t1-schema-20260818.sql` 이 **이미 적용돼 있어야 한다**
--   (`education_completions.expires_at` nullable · `qi_measurements.voided_at` 등).
--   2026-08-18 실측: 적용 완료 확인됨. §0 가드가 다시 확인한다.
-- =============================================================================

-- =============================================================================
-- 통합 실행 순서 — 미적용 SQL 3건 재검토 결과 (2026-08-18 운영 실측)
-- =============================================================================
--  #  파일                                          지금도 유효한가            대상
--  ─  ───────────────────────────────────────────  ────────────────────────  ──────
--  0  deferred-t1-schema-20260818.sql               **이미 적용됨**(실측 확인)  —
--     (`quality_indicators.direction/unit/value_scale` · `qi_measurements.voided_at` ·
--      `education_completions.expires_at` nullable 이 전부 DB 에 있다. §0 가드가 재확인한다.)
--
--  1  im-subspecialty-canon-20260818.sql            ✅ **유효**                36건
--     ENDOCRINOLOGY 18 · GASTROENTEROLOGY 17 · '소화기내과' 1 이 아직 남아 있다
--     (정본 GASTRO 8 · ENDOCRINE 16 과 갈라진 채 공존 — 코드 필터가 못 찾는 기록).
--
--  2  radiation-status-canon-20260818.sql           ✅ **유효**                20건
--     계획 IN_PROGRESS 2 · 분획 COMPLETED 16(전부 delivered_dose 있음) · IN_PROGRESS 2.
--     (누적선량 안전은 코드 쪽 ②로 이미 복구됨 — 이 SQL 은 표시·진행률용이다.)
--
--  3  seed-integrity-recalibration-20260818.sql     ← **이 파일**
--
--  4  education-indefinite-expiry-null-20260818.sql ❌ **무의미(no-op)**        0건
--     🔴 `9999-12-31` 우회 표식은 **실측 0건**이다. 대신 정확히 반대 방향의 결함
--        (무기한 과정에 12개월 만료일이 박힘 23건)이 있고 **이 파일 §7 이 그것을 처리**한다.
--        → 이 SQL 은 **건너뛴다**. 돌려도 0행이지만 "해결됐다"는 오해를 만든다.
--
--  5  seed-integrity-recalibration-verify-20260818.sql  (검증 · 읽기 전용)
--
-- 1·2·3 은 서로 다른 테이블을 만지므로 **순서 의존이 없다**. 1·2 를 건너뛰어도 3 은 성립한다.
-- 🔴 각 파일은 **자기 트랜잭션**을 연다 — 한 파일이 중단돼도 다른 파일의 결과는 남는다.
--    중간에 멈추면 어디까지 적용됐는지 검증 SQL 로 확인한 뒤 이어간다.
-- =============================================================================

BEGIN;

-- =============================================================================
-- §0  중단 가드 — 실환자 DB 오적용 방지
-- =============================================================================
-- 🔴 이 SQL 은 임상·회계 값을 대량으로 다시 쓴다. 붙은 DB 가 **가상 병원 시드가 아니면**
--    여기서 트랜잭션 전체를 중단한다. (사람 눈에만 맡기면 언젠가 건너뛴다.)

DO $$
DECLARE
  v_hospital text;
  v_patients int;
  v_seed_uuid int;
  v_seed_ratio numeric;
BEGIN
  SELECT value #>> '{}' INTO v_hospital FROM system_configs WHERE key = 'hospital.name';
  IF v_hospital IS DISTINCT FROM '위루비병원' THEN
    RAISE EXCEPTION '중단: 이 DB 는 알려진 가상 병원 시드가 아닙니다(hospital.name=%). 실환자 DB 일 수 있습니다.', COALESCE(v_hospital, '(없음)')
      USING HINT = '실환자 데이터에는 이 SQL 을 적용하지 마십시오. 적용이 필요하면 항목별로 사람이 개별 판단해야 합니다.';
  END IF;

  SELECT count(*), count(*) FILTER (WHERE id::text LIKE '00000000-0000-4000-%')
    INTO v_patients, v_seed_uuid FROM patients;
  v_seed_ratio := CASE WHEN v_patients > 0 THEN v_seed_uuid::numeric / v_patients ELSE 0 END;
  -- 2026-08-18 실측: 874명 중 830명(95.0%)이 결정적 시드 UUID
  IF v_seed_ratio < 0.80 THEN
    RAISE EXCEPTION '중단: 결정적 시드 UUID 비율이 % 퍼센트(환자 %명 중 %명)로 낮습니다 — 실환자가 유입된 DB 일 수 있습니다.',
      round(v_seed_ratio * 100, 1), v_patients, v_seed_uuid
      USING HINT = '실환자가 섞였다면 대량 UPDATE 대신 항목별 개별 판단이 필요합니다.';
  END IF;

  -- 선행 스키마(deferred-t1) 확인 — 없으면 §7·§1 이 조용히 다른 뜻이 된다
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name='education_completions' AND column_name='expires_at' AND is_nullable='NO') THEN
    RAISE EXCEPTION '중단: education_completions.expires_at 이 아직 NOT NULL 입니다.'
      USING HINT = 'deferred-t1-schema-20260818.sql 을 먼저 적용하십시오.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_name='qi_measurements' AND column_name='voided_at') THEN
    RAISE EXCEPTION '중단: qi_measurements.voided_at 이 없습니다.'
      USING HINT = 'deferred-t1-schema-20260818.sql 을 먼저 적용하십시오.';
  END IF;
END $$;


-- =============================================================================
-- §1  의료질지표 측정 — 분자·값·판정 재파생 (실측 300건 중 273건 불일치)
-- =============================================================================
-- 무엇이 어긋났나 (2026-08-18 실측으로 **역산 규칙까지 특정**했다)
--   시드가 **값을 먼저 정하고** 분자를 `round(value × denominator / 100)` 으로 역산했다.
--   배율이 100 이 아닌 지표에서 값과 분자·분모가 갈라진다:
--     · ×1000 지표(낙상·감염 7종) → 재산출이 **10배**   (0.72 ↔ 65/9025×1000 = 7.20)
--     · 배율 1 지표(평균·건수 7종) → 재산출이 **1/100**  (평균재원일수 6.02 ↔ 18/304 = 0.06)
--     · ×100 지표(11종)           → 정수 반올림 오차만(≤0.5)
--
-- 🔴 어느 컬럼이 사실인가 — **`value` 다.**
--   `value` 는 임상적으로 말이 되는 값(낙상 0.65~1.47/1000 · 재원일수 6.02일 · 만족도 80~90점)이고,
--   `numerator` 는 그 값에서 **잘못된 상수 100 으로 기계 역산된 결과**다.
--   반대로 `value` 를 `numerator/denominator×scale` 로 재산출하면
--   **평균재원일수 0.06일 · 환자만족도 0.85점 · 환자불만 0건** 이 된다 — 정합하지만 거짓이다.
--   따라서 여기서는 **잘못된 상수로 만들어진 파생 컬럼(numerator)을 올바른 배율로 다시 파생**시킨다.
--   (임상 사건 건수를 새로 지어내는 것이 아니라, 이미 기계가 만든 파생을 고쳐 다는 것이다.)
--
-- 🔴 정본 전사 고지 — 아래 두 가지를 SQL 로 옮겨 적었다. **정본이 둘이 되는 것을 알고 있다.**
--   ① 배율(scale): `apps/api/src/modules/quality/indicator-policy.ts` · `resolveValueScale()`
--      (`×1000` → 1000 · `×100` → 100 · `평균|건수$|점수|'/'포함` → 1 · 그 외 DEFAULT_VALUE_SCALE=100)
--      2026-08-18 실측: 25지표 전부 formula 에서 배율이 확정된다(ASSUMED 0건).
--   ② 방향(direction): 같은 파일 `DIRECTION_BY_NAME` 등재표.
--      25지표 전부가 등재표에 있고 `quality_indicators.direction` 컬럼은 전부 NULL 이다.
--      **컬럼에 쓰지 않는다** — 컬럼에 쓰면 정본이 영구히 둘이 되고(canon ①이 ②를 항상 이긴다)
--      코드 등재표를 고쳐도 DB 가 이긴다. 여기서는 판정 1회 산출에만 쓰고 흔적을 남기지 않는다.
--   ③ 값 산출: `computeMeasurementValue()` = `round(numerator/denominator × scale, 2)`
--      (`Decimal(5,2)` 저장 계약. MEASUREMENT_VALUE_MAX = 999.99)
--
-- 🔴 되돌릴 수 없다 — 원래 numerator/value 는 백업에만 남는다.
--    (`voided_at` 로 무효화하는 대안도 검토했으나, 300건 중 273건을 무효화하면 지표 추이가
--     통째로 사라진다. 값이 임상적으로 타당한 이상 파생을 맞추는 쪽이 손실이 적다.)
--
-- 대안(적용하지 않음): 전량 무효화
--   UPDATE qi_measurements SET voided_at = now(), void_reason = '시드 역산 오류 — 분자/분모 신뢰 불가';
--   → 화면이 "측정 없음"이 되어 정직하지만, 이 DB 의 유일한 지표 이력이 사라진다.

-- ① 영향 행수 확인
WITH ind AS (
  SELECT i.id,
         COALESCE(CASE WHEN i.formula ~ '[×xX*]\s*1000' THEN 1000
                       WHEN i.formula ~ '[×xX*]\s*100'  THEN 100
                       WHEN i.formula ~ '평균' OR i.formula LIKE '%/%'
                         OR i.formula ~ '건수\s*$' OR i.formula ~ '점수' THEN 1 END, 100) AS scale
  FROM quality_indicators i)
SELECT count(*) AS 측정_전체,
       count(*) FILTER (WHERE m.denominator > 0
              AND abs(round((m.numerator::numeric / m.denominator) * ind.scale, 2) - m.value) > 0.011) AS 값_불일치,
       count(*) FILTER (WHERE m.denominator <= 0) AS 분모0_산출불가
FROM qi_measurements m JOIN ind ON ind.id = m.indicator_id;
-- 2026-08-18 기대: 300 / 273 / 0

-- ② 중단 가드 — 산출 불가·저장 한계 초과가 있으면 여기서 멈춘다
DO $$
DECLARE v_bad int; v_overflow int;
BEGIN
  SELECT count(*) INTO v_bad FROM qi_measurements WHERE denominator <= 0;
  IF v_bad > 0 THEN
    RAISE EXCEPTION '중단: 분모가 0 이하인 측정이 %건 있습니다 — 0 으로 나눈 값을 지어낼 수 없습니다.', v_bad
      USING HINT = '해당 행은 voided_at 으로 무효화한 뒤 다시 실행하십시오.';
  END IF;

  WITH ind AS (
    SELECT i.id, COALESCE(CASE WHEN i.formula ~ '[×xX*]\s*1000' THEN 1000
                               WHEN i.formula ~ '[×xX*]\s*100'  THEN 100
                               WHEN i.formula ~ '평균' OR i.formula LIKE '%/%'
                                 OR i.formula ~ '건수\s*$' OR i.formula ~ '점수' THEN 1 END, 100) AS scale
    FROM quality_indicators i)
  SELECT count(*) INTO v_overflow
  FROM qi_measurements m JOIN ind ON ind.id = m.indicator_id
  WHERE round((GREATEST(round(m.value * m.denominator / ind.scale)::int, 0)::numeric / m.denominator) * ind.scale, 2) > 999.99;
  IF v_overflow > 0 THEN
    RAISE EXCEPTION '중단: 재산출 값이 저장 한계(Decimal(5,2) = 999.99)를 넘는 측정이 %건 있습니다.', v_overflow
      USING HINT = '값을 잘라 저장하면 잘린 줄 모르는 수치가 남습니다. 해당 지표의 배율을 먼저 확인하십시오.';
  END IF;
END $$;

-- ③ 교정 — 분자 재파생 → 값 재산출 → 판정 재산출 (한 문장, 순서 의존 없음)
WITH ind AS (
  SELECT i.id, i.target_value,
         COALESCE(CASE WHEN i.formula ~ '[×xX*]\s*1000' THEN 1000
                       WHEN i.formula ~ '[×xX*]\s*100'  THEN 100
                       WHEN i.formula ~ '평균' OR i.formula LIKE '%/%'
                         OR i.formula ~ '건수\s*$' OR i.formula ~ '점수' THEN 1 END, 100) AS scale,
         -- DIRECTION_BY_NAME 전사(indicator-policy.ts) — 공백 제거 키 기준. 등재에 없으면 NULL = 판정 불가.
         CASE replace(replace(i.name, ' ', ''), '　', '')
           WHEN '환자만족도'    THEN 'HIGHER' WHEN '병상가동률'     THEN 'HIGHER'
           WHEN '수술실가동률'  THEN 'HIGHER' WHEN '손위생수행률'   THEN 'HIGHER'
           WHEN '필수교육이수율' THEN 'HIGHER'
           WHEN '30일내재입원율' THEN 'LOWER'  WHEN '병원감염발생률' THEN 'LOWER'
           WHEN '낙상발생률'    THEN 'LOWER'  WHEN '투약오류발생률' THEN 'LOWER'
           WHEN '수술부위감염률' THEN 'LOWER'  WHEN '욕창발생률'     THEN 'LOWER'
           WHEN '수혈부작용발생률' THEN 'LOWER' WHEN '응급실체류시간(중증)' THEN 'LOWER'
           WHEN '평균재원일수'  THEN 'LOWER'  WHEN '수술사망률'     THEN 'LOWER'
           WHEN '외래초진대기시간' THEN 'LOWER' WHEN '검사결과보고시간' THEN 'LOWER'
           WHEN '처방전달시간'  THEN 'LOWER'  WHEN '중심정맥관관련혈류감염률' THEN 'LOWER'
           WHEN '요로감염발생률(도뇨관)' THEN 'LOWER'
           WHEN '인공호흡기관련폐렴발생률' THEN 'LOWER'
           WHEN '직원이직률'    THEN 'LOWER'  WHEN '의료수익대비인건비율' THEN 'LOWER'
           WHEN '환자불만건수'  THEN 'LOWER'  WHEN '진료비청구반송률' THEN 'LOWER'
           ELSE NULL
         END AS direction
  FROM quality_indicators i),
calc AS (
  SELECT m.id, ind.scale, ind.target_value, ind.direction, m.denominator,
         GREATEST(round(m.value * m.denominator / ind.scale)::int, 0) AS new_num
  FROM qi_measurements m JOIN ind ON ind.id = m.indicator_id
  WHERE m.denominator > 0),
final AS (
  SELECT id, new_num, target_value, direction,
         round((new_num::numeric / denominator) * scale, 2) AS new_val
  FROM calc)
UPDATE qi_measurements m
   SET numerator   = f.new_num,
       value       = f.new_val,
       -- evaluateMeetTarget() 전사 — 방향 미상은 NULL(판정 불가). false 로 뭉개지 않는다.
       meet_target = CASE WHEN f.direction IS NULL OR f.target_value IS NULL THEN NULL
                          WHEN f.direction = 'LOWER' THEN f.new_val <= f.target_value
                          ELSE f.new_val >= f.target_value END
  FROM final f
 WHERE m.id = f.id
   AND (m.numerator IS DISTINCT FROM f.new_num OR m.value IS DISTINCT FROM f.new_val);
-- 2026-08-18 기대: 분자 168건·값 219건 변경(최대 값 이동 0.50) · 판정 16건 반전 · 재산출 불일치 0


-- =============================================================================
-- §2  낙상 위험등급 — 점수에서 재파생 (실측 51건 중 2건 불일치)
-- =============================================================================
-- 정본 전사: `apps/api/src/modules/patient-safety/patient-safety.service.ts`
--            `deriveFallRiskLevel()` — score ≥ 45 → HIGH · ≥ 25 → MODERATE · 그 외 LOW
--   (정본 주석이 "자가입력 riskLevel 무시"라고 못박은 그 오염을 시드가 심었다.)
-- 🔴 등급은 **점수에서 나오는 파생**이다 — 점수는 손대지 않는다.
-- 실측 내역: Morse 45 → MODERATE(정본 HIGH) 1건 · Morse 30 → LOW(정본 MODERATE) 1건

SELECT count(*) AS 낙상_전체,
       count(*) FILTER (WHERE risk_level <> CASE WHEN score >= 45 THEN 'HIGH'
                                                 WHEN score >= 25 THEN 'MODERATE' ELSE 'LOW' END) AS 등급_불일치
FROM fall_risk_assessments;
-- 2026-08-18 기대: 51 / 2

UPDATE fall_risk_assessments
   SET risk_level = CASE WHEN score >= 45 THEN 'HIGH' WHEN score >= 25 THEN 'MODERATE' ELSE 'LOW' END
 WHERE risk_level <> CASE WHEN score >= 45 THEN 'HIGH' WHEN score >= 25 THEN 'MODERATE' ELSE 'LOW' END;

-- ⚠️ 등급이 HIGH 로 올라간 건은 정본 경로였다면 `fall.high` 이벤트로 주치의에게 통지됐을 것이다.
--    지난 평가에 대해 지금 알림을 만들어 보내지 않는다 — **지나간 경보를 소급 발송하지 않는다.**


-- =============================================================================
-- §3  검사 결과 flag — 기록된 기준치에서 재파생
-- =============================================================================
-- 🔴 분모부터 실측했다: 결과항목 1,881건 중 **수치값의 flag 불일치는 0건**이다.
--    (기준치가 있는 1,864건 전부 정합 — "flag 가 전부 틀렸다"가 아니었다.)
--    실제로 틀린 것은 아래 세 갈래뿐이다.
--
-- 정본: `apps/api/src/modules/reference-range/reference-range.service.ts` `computeFlag/flagValue`
--       + `packages/shared/src/lab-flags.ts` (flag 집합 = LL/HH/L/H/A/N/null)
-- 🔴 위급(HH/LL) 은 **위급 기준치(criticalLow/High)** 가 있어야 판정된다.
--    `lab_result_items` 에는 정상 기준치(normal_min/max)만 있으므로 **HH/LL 을 만들지 않는다** —
--    가진 적 없는 위급 판정을 지어내면 거짓 경보가 되고, 거짓 경보는 진짜 경보를 죽인다.

-- ③-a 어휘 드리프트: 'NORMAL' → 'N' (정본 flag 집합에 'NORMAL' 은 없다)
SELECT count(*) AS NORMAL_표기 FROM lab_result_items WHERE flag = 'NORMAL';   -- 기대 4
UPDATE lab_result_items SET flag = 'N' WHERE flag = 'NORMAL';

-- ③-b 범위 표기 값(`50-100/HPF` 등)이 '정상'으로 기록된 것
--     시드가 `Number('50-100')` = NaN 으로 비교해 둘 다 false → 'N' 을 박았다(농뇨가 '정상').
--     🔴 값은 손대지 않는다. **범위의 하한조차 정상 상한을 넘으면** 그 결과는 확실히 높다 → 'H'.
--        (하한이 애매하게 걸치는 경우는 판정하지 않는다 — 아래 WHERE 가 그것을 배제한다.)
SELECT id, test_name, value, unit, normal_min, normal_max, flag
FROM lab_result_items
WHERE value ~ '^[0-9]+(\.[0-9]+)?\s*-\s*[0-9]+(\.[0-9]+)?$'
  AND normal_max IS NOT NULL
  AND split_part(replace(value, ' ', ''), '-', 1)::numeric > normal_max;
-- 2026-08-18 기대 2건: UA WBC 50-100 (정상 0~5) · UA RBC 5-10 (정상 0~3)

UPDATE lab_result_items
   SET flag = 'H'
 WHERE value ~ '^[0-9]+(\.[0-9]+)?\s*-\s*[0-9]+(\.[0-9]+)?$'
   AND normal_max IS NOT NULL
   AND split_part(replace(value, ' ', ''), '-', 1)::numeric > normal_max
   AND flag IS DISTINCT FROM 'H';

-- ③-c 수치값 + 기준치가 다 있는데 flag 만 비어 있는 것 → computeFlag 로 채운다
--     🔴 기준치가 **없는** 항목(UA Nitrite 'Positive' 등)은 **NULL 로 둔다**(미판정).
--        정성 판정에 필요한 textNormal 이 이 테이블에 없다 — 모르는 것을 'N'으로 강제하지 않는다.
SELECT count(*) AS flag_없음_기준치있음
FROM lab_result_items
WHERE flag IS NULL AND value ~ '^-?[0-9]+(\.[0-9]+)?$'
  AND (normal_min IS NOT NULL OR normal_max IS NOT NULL);
-- 2026-08-18 기대 1건 (1,5-AG 15.2 · 정상 14~46)

UPDATE lab_result_items
   SET flag = CASE WHEN normal_min IS NOT NULL AND value::numeric < normal_min THEN 'L'
                   WHEN normal_max IS NOT NULL AND value::numeric > normal_max THEN 'H'
                   ELSE 'N' END
 WHERE flag IS NULL AND value ~ '^-?[0-9]+(\.[0-9]+)?$'
   AND (normal_min IS NOT NULL OR normal_max IS NOT NULL);


-- =============================================================================
-- §4  혈액제제 — 만료된 재고가 '사용 가능'으로 남아 있다 (실측 18건)
-- =============================================================================
-- 🔴 실측이 사전 정보보다 컸다: 혈소판 3건이 아니라 **재고 20건 전부가 이미 만료**고,
--    그중 **18건이 status='AVAILABLE'**(출고 가능 재고)이다. 나머지 2건은 ISSUED/TRANSFUSED.
--    유효기간이 전부 `2026-08-15` 로 뭉쳐 있다 — 제제별 유효기간이 아니라
--    데모 날짜 롤포워드가 한 날짜로 밀어놓은 흔적이다.
--
-- 교정: **기록된 `expires_at` 에서 상태를 파생**한다(만료일을 다시 쓰지 않는다).
--   정본 전이표(`blood-bank.service.ts` L56~64)에 AVAILABLE → EXPIRED 가 있으므로 합법 전이다.
--   ISSUED/TRANSFUSED 는 **손대지 않는다** — 이미 출고·수혈된 사실을 되돌릴 수 없다.
--
-- 🔴 적용하면 **출고 가능 혈액 재고가 0 이 된다.** 그것이 지금의 사실이다.
--    재고가 필요하면 신규 입고(화면) 또는 재시드로 채운다 — 만료일을 미루지 않는다.
-- 🔴 되돌릴 수 없다: 정본 전이표는 EXPIRED → DISCARDED 만 허용한다(종말상태 부활 금지).

SELECT product_type, status, count(*) AS 건수,
       count(*) FILTER (WHERE expires_at < now()) AS 이미_만료
FROM blood_products GROUP BY 1, 2 ORDER BY 1, 2;

SELECT count(*) AS 만료인데_사용가능
FROM blood_products WHERE status = 'AVAILABLE' AND expires_at < now();
-- 2026-08-18 기대: 18

UPDATE blood_products
   SET status = 'EXPIRED',
       notes  = COALESCE(NULLIF(notes, '') || ' / ', '')
                || '[2026-08-18 시드 정합화] 유효기간(' || to_char(expires_at, 'YYYY-MM-DD') || ') 경과 — 기록된 만료일에서 상태 파생'
 WHERE status = 'AVAILABLE' AND expires_at < now();

-- ⚠️ 교정하지 않는 것: 제제별 유효기간 자체(PC 는 채혈 후 5일인데 데이터는 85~86일,
--    PRBC 는 35~42일인데 86~113일). 유효기간을 다시 쓰면 **채혈일·입고일과 함께 봐야 하는
--    임상 판단**이고, 위 상태 교정만으로 안전 문제(만료 혈액 출고 가능)는 이미 닫힌다.
--    생성기(prisma/seed.ts·seeds/**) 교정 대상이다.


-- =============================================================================
-- §5  청구 라인 — 비급여인데 본인부담률이 1.0 이 아니다 (실측 20건 중 PENDING 15건만)
-- =============================================================================
-- 정본: `apps/api/src/modules/billing/billing.service.ts` `buildPrescriptionLineItem()`
--   · 비급여(NON_COVERED) → `copayRate = 1` (§2 봉합 주석: "종전 eligibility 율 유지로
--     보험 과다청구되던 것 차단")
--   · `fullCopay = (copayRate >= 1)`
--   시드는 `copay_rate` 와 `insurance_category` 를 **독립 추첨**해 NON_COVERED + 0.0 을 만들었다
--   → 비급여를 보험자가 전액 부담하는 것으로 청구된다.
--
-- 🔴 **수납 완료(PAID) 청구 5건은 손대지 않는다.** 라인 금액을 고치면 본인부담금이 늘어
--    이미 수납한 금액과 어긋난다 — 그것은 재정산·환불이 따르는 **회계 행위**지 데이터 정합이 아니다.
--    사람(원무·회계)에게 넘긴다. 아래 ⑤-c 가 그 목록을 뽑는다.

-- ⑤-a 카테고리 미기입 13건 — 수가마스터에서 파생 (추측 아님)
SELECT count(*) AS 카테고리_NULL,
       count(*) FILTER (WHERE pc.id IS NOT NULL) AS 수가마스터에서_파생가능
FROM billing_items bi LEFT JOIN procedure_codes pc ON pc.id = bi.code_id
WHERE bi.insurance_category IS NULL;
-- 2026-08-18 기대: 13 / 13 (전부 procedure_codes 에 있다)

UPDATE billing_items bi
   SET insurance_category = CASE WHEN pc.insurance_covered = false THEN 'NON_COVERED' ELSE 'COVERED' END
  FROM procedure_codes pc
 WHERE pc.id = bi.code_id AND bi.insurance_category IS NULL;
-- 🔴 수가마스터에 없는 code_id 는 **NULL 로 남긴다** — 급여 여부를 지어내지 않는다.

-- ⑤-b 비급여 라인의 본인부담률·전액부담 표식 재파생 (미수납 청구만)
SELECT b.status, count(*) AS 대상라인, count(DISTINCT b.id) AS 청구건
FROM billing_items bi JOIN billings b ON b.id = bi.billing_id
WHERE bi.insurance_category = 'NON_COVERED' AND bi.copay_rate <> 1.0
GROUP BY 1;
-- 2026-08-18 기대: PENDING 15/15 · PAID 5/5

UPDATE billing_items bi
   SET copay_rate = 1.0, full_copay = true
  FROM billings b
 WHERE b.id = bi.billing_id
   AND b.status = 'PENDING'
   AND bi.insurance_category = 'NON_COVERED'
   AND bi.copay_rate <> 1.0;

-- full_copay 는 율에서 나오는 파생이다 — 미수납 청구 전 라인에 대해 맞춘다
UPDATE billing_items bi
   SET full_copay = (bi.copay_rate >= 1.0)
  FROM billings b
 WHERE b.id = bi.billing_id AND b.status = 'PENDING'
   AND bi.full_copay <> (bi.copay_rate >= 1.0);

-- ⑤-b2 청구 헤더 재산출 (라인이 바뀐 미수납 청구만)
-- 🔴 2026-08-18 실측: 대상 15건 전부 현재 `patient_copay = Σ round(amount × copay_rate)` 로 정합했다.
--    즉 헤더는 라인에서 파생되는 관계가 성립한다 → 라인을 고쳤으니 헤더도 같은 식으로 다시 낸다.
--    의료급여 외래 정액 본인부담(computePatientCopay)이 걸리는 건은 대상에 없다(copay_category 실측 0건).
WITH agg AS (
  SELECT bi.billing_id, sum(round(bi.amount * bi.copay_rate))::int AS copay_sum
  FROM billing_items bi GROUP BY 1)
UPDATE billings b
   SET patient_copay     = a.copay_sum,
       insurance_covered = b.total_amount - a.copay_sum - b.discount_amount
  FROM agg a
 WHERE a.billing_id = b.id
   AND b.status = 'PENDING'
   AND b.patient_copay <> a.copay_sum;

-- ⑤-c 🔴 사람에게 넘길 목록 — 수납 완료 청구의 비급여 오분류(교정하지 않음)
SELECT b.id AS billing_id, b.status, b.paid_at, b.total_amount, b.patient_copay, b.paid_amount,
       bi.id AS item_id, bi.code_name, bi.amount, bi.copay_rate AS 기록된율,
       round(bi.amount * (1.0 - bi.copay_rate))::int AS 보험자_과다부담_추정액
FROM billing_items bi JOIN billings b ON b.id = bi.billing_id
WHERE bi.insurance_category = 'NON_COVERED' AND bi.copay_rate <> 1.0 AND b.status <> 'PENDING'
ORDER BY 보험자_과다부담_추정액 DESC;


-- =============================================================================
-- §6  내원 전 활력 — 거짓 이상 경보 102건 (놓친 경보 0건)
-- =============================================================================
-- 정본 전사: `apps/api/src/modules/vitals/vitals-evaluate.ts` `VITALS_THRESHOLDS` + `evaluateVitals()`
--   위급층(crit)만 이상으로 본다. 경계값 포함(≤ / ≥):
--     SBP ≤80 또는 ≥180 · DBP ≤50 또는 ≥110 · HR ≤40 또는 ≥130
--     BT ≤35.0 또는 ≥38.5 · SpO2 ≤90 · RR ≤8 또는 ≥30 · Pain ≥7
--   🔴 시드는 **warn 층**(SBP ≥140 등)으로 판정해 정상 혈압 150/95 를 ABNORMAL 로 기록했다.
--   🔴 config 오버라이드(`clinical.vitals.thresholds`)가 있으면 이 전사는 틀린다 —
--      2026-08-18 실측: 해당 키 **0건**(오버라이드 없음). ②번 가드가 다시 확인한다.
--
-- 방향: 102건 전부 **거짓 경보**(is_abnormal=true 인데 정본은 정상)이고 **놓친 경보는 0건**이다.
--   거짓 경보를 끄는 것은 안전을 낮추지 않는다 — 거짓 경보가 진짜 경보를 죽인다.

-- ② 중단 가드 — 임계치 오버라이드가 생겼으면 이 전사는 더 이상 정본이 아니다
DO $$
DECLARE v_override int;
BEGIN
  SELECT count(*) INTO v_override FROM system_configs WHERE key = 'clinical.vitals.thresholds';
  IF v_override > 0 THEN
    RAISE EXCEPTION '중단: config `clinical.vitals.thresholds` 오버라이드가 등록돼 있습니다 — 이 SQL 의 임계치 전사가 정본과 다릅니다.'
      USING HINT = 'mergeVitalsThresholds() 결과를 확인하고 §6 블록의 임계치를 맞추거나 이 블록을 건너뛰십시오.';
  END IF;
END $$;

WITH c AS (
  SELECT id, is_abnormal,
    ( (systolic_bp      IS NOT NULL AND (systolic_bp <= 80 OR systolic_bp >= 180))
   OR (diastolic_bp     IS NOT NULL AND (diastolic_bp <= 50 OR diastolic_bp >= 110))
   OR (heart_rate       IS NOT NULL AND (heart_rate <= 40 OR heart_rate >= 130))
   OR (temperature      IS NOT NULL AND (temperature <= 35.0 OR temperature >= 38.5))
   OR (spo2             IS NOT NULL AND spo2 <= 90)
   OR (respiratory_rate IS NOT NULL AND (respiratory_rate <= 8 OR respiratory_rate >= 30))
   OR (pain_score       IS NOT NULL AND pain_score >= 7) ) AS canon
  FROM pre_visit_vitals)
SELECT count(*) AS 활력_전체,
       count(*) FILTER (WHERE is_abnormal AND NOT canon) AS 거짓경보,
       count(*) FILTER (WHERE NOT is_abnormal AND canon) AS 놓친경보
FROM c;
-- 2026-08-18 기대: 519 / 102 / 0

WITH c AS (
  SELECT id,
    ( (systolic_bp      IS NOT NULL AND (systolic_bp <= 80 OR systolic_bp >= 180))
   OR (diastolic_bp     IS NOT NULL AND (diastolic_bp <= 50 OR diastolic_bp >= 110))
   OR (heart_rate       IS NOT NULL AND (heart_rate <= 40 OR heart_rate >= 130))
   OR (temperature      IS NOT NULL AND (temperature <= 35.0 OR temperature >= 38.5))
   OR (spo2             IS NOT NULL AND spo2 <= 90)
   OR (respiratory_rate IS NOT NULL AND (respiratory_rate <= 8 OR respiratory_rate >= 30))
   OR (pain_score       IS NOT NULL AND pain_score >= 7) ) AS canon
  FROM pre_visit_vitals)
UPDATE pre_visit_vitals v SET is_abnormal = c.canon
  FROM c WHERE c.id = v.id AND v.is_abnormal <> c.canon;


-- =============================================================================
-- §7  교육 이수 — 무기한 과정에 12개월 만료일이 박혀 있다 (실측 23건)
-- =============================================================================
-- 🔴 사전 정보(`9999-12-31` 우회값 정리)는 **대상 0건**이다 — 실측에서 9999 표식은 없었다.
--    대신 **정확히 반대 방향**의 결함이 있다:
--      `education_programs.valid_months = 0`(무기한) 인 과정('신규직원 오리엔테이션')의
--      이수 23건 전부에 `completed_at + 12개월` 만료일이 박혀 있다
--      (구 seed.ts 가 validMonths<=0 이면 12개월을 부여했다).
--    스키마가 nullable 로 바뀌었으므로 무기한의 정본은 **NULL** 이다.
--    → `education-indefinite-expiry-null-20260818.sql` 은 지금 **무의미(no-op)** 하고,
--      이 블록이 그 자리를 대신한다.
--
-- 유효기간이 있는 과정의 만료일은 실측 결과 `completed_at + valid_months` 로 전부 정합했다(0건 불일치).

SELECT ep.name, ep.valid_months, count(*) AS 이수건,
       count(*) FILTER (WHERE ec.expires_at IS NOT NULL) AS 만료일_있음
FROM education_completions ec JOIN education_programs ep ON ep.id = ec.program_id
WHERE ep.valid_months <= 0 GROUP BY 1, 2;
-- 2026-08-18 기대: 신규직원 오리엔테이션 / 0 / 23 / 23

UPDATE education_completions ec
   SET expires_at = NULL
  FROM education_programs ep
 WHERE ep.id = ec.program_id AND ep.valid_months <= 0 AND ec.expires_at IS NOT NULL;

-- 구 9999 표식이 남아 있다면 함께 정리(현재 0건이지만 멱등하게 둔다)
UPDATE education_completions ec
   SET expires_at = NULL
  FROM education_programs ep
 WHERE ep.id = ec.program_id
   AND ec.expires_at >= TIMESTAMPTZ '9999-01-01'
   AND COALESCE(ep.valid_months, 12) <= 0;


-- =============================================================================
-- §8  소아 성장 — 생리학적으로 불가능한 계측 + 파생 BMI 불일치
-- =============================================================================
-- 실측(457건)
--   · 신장 > 200cm : 38건 (최대 271.3cm · 14세 9개월) — 시드가 월령에 선형 외삽했다
--   · 두위  > 62cm : 59건 (최대 108.3cm)
--   · BMI 가 신장·체중에서 나오지 않음 : 417건 (BMI 를 독립 난수로 뽑았다)
--
-- 🔴 신장·두위는 **측정치**다 — 참값을 지어낼 수 없다. 성장곡선으로 "그럴듯한 값"을 넣으면
--    측정한 적 없는 수치를 원장에 박는 것이다. → **NULL(미측정)** 로 둔다.
--    임계는 백분위수가 아니라 **생리학적 불가능선**으로 잡았다(성장곡선을 전사하지 않기 위해):
--      · 신장 > 200cm — 대상 최고월령이 177개월(14세 9개월)이다. 어떤 14세도 이 키일 수 없다.
--      · 두위  > 62cm — 성인 최대치를 넘는다.
--    이 선 아래의 "높지만 가능한" 값은 **손대지 않는다** — 이상치와 결함은 다르다.
--
-- 🔴 BMI 는 **신장·체중에서 나오는 파생**이다 → 둘이 다 남아 있을 때만 재산출한다.
--    신장을 NULL 로 만든 행의 BMI 도 NULL 이 된다(분모가 사라졌다 — 0 이 아니다).
--    정본: `apps/api/src/modules/vitals/vitals-evaluate.ts` `calcBmi()` = kg/(m²), 소수 1자리
--          (`NUMERIC_POLICIES.bmi` 경유. 여기서는 같은 자릿수로 옮겨 적었다.)
--
-- ⚠️ 백분위(weight_percentile·height_percentile·bmi_percentile)는 **손대지 않는다** —
--    성장곡선(KDCA/WHO LMS)이 이 저장소에 정본으로 없다. 없는 표를 SQL 에 지어 넣지 않는다.
--    신장이 NULL 이 된 행의 height_percentile 은 근거를 잃으므로 §9 에서 함께 NULL 로 만든다.

SELECT count(*) AS 성장기록,
       count(*) FILTER (WHERE height > 200) AS 신장_불가능,
       count(*) FILTER (WHERE head_circ > 62) AS 두위_불가능,
       count(*) FILTER (WHERE height > 0 AND weight > 0 AND bmi IS NOT NULL
                          AND abs(bmi - round(weight / ((height/100)^2), 1)) > 0.2) AS BMI_파생불일치
FROM pediatric_growths;
-- 2026-08-18 기대: 457 / 38 / 59 / 417

-- ⑧-a 불가능 계측 → NULL (근거를 잃은 백분위도 함께)
UPDATE pediatric_growths
   SET height = NULL, height_percentile = NULL
 WHERE height > 200;

UPDATE pediatric_growths
   SET head_circ = NULL
 WHERE head_circ > 62;

-- ⑧-b BMI 재파생 — 신장·체중이 둘 다 있을 때만. 없으면 NULL(산출 불가).
UPDATE pediatric_growths
   SET bmi = CASE WHEN height IS NOT NULL AND height > 0 AND weight IS NOT NULL AND weight > 0
                  THEN round(weight / ((height/100.0)^2), 1) END,
       bmi_percentile = CASE WHEN height IS NOT NULL AND height > 0 AND weight IS NOT NULL AND weight > 0
                             THEN bmi_percentile END   -- 신장이 사라지면 백분위도 근거를 잃는다
 WHERE bmi IS DISTINCT FROM (CASE WHEN height IS NOT NULL AND height > 0 AND weight IS NOT NULL AND weight > 0
                                  THEN round(weight / ((height/100.0)^2), 1) END);


-- =============================================================================
-- §9  개별 모순 — 건별로 확인한 것만 (각 1건)
-- =============================================================================
-- 🔴 여기 없는 것은 "찾지 못한 것"이 아니라 **실측 0건**이다. §검증 SQL 이 그 목록을 다시 센다.

-- ⑨-a 회복실 입실이 수술 종료보다 20분 앞선다 (1건)
--     🔴 어느 시각이 틀렸는지 알 수 없다 — **수술 종료를 당기지도, 입실을 늦추지도 않는다.**
--        회복실 기록의 시각을 신뢰할 수 없다는 사실을 남기고, 입실 시각을 수술 종료로 맞추지 않는다.
--        arrival_time 은 NOT NULL 이라 NULL 로 둘 수 없으므로 **notes 에 사실을 적고 값은 보존**한다.
SELECT p.id, p.arrival_time, s.ended_at, (s.ended_at - p.arrival_time) AS 역전폭
FROM pacu_records p JOIN surgeries s ON s.id = p.surgery_id
WHERE s.ended_at IS NOT NULL AND p.arrival_time < s.ended_at;
-- 2026-08-18 기대: 1건 (입실 07:49 · 수술 종료 08:09)

UPDATE pacu_records p
   SET notes = COALESCE(NULLIF(p.notes, '') || ' / ', '')
               || '[2026-08-18 시드 정합화] 입실 시각(' || to_char(p.arrival_time, 'YYYY-MM-DD HH24:MI')
               || ')이 수술 종료(' || to_char(s.ended_at, 'YYYY-MM-DD HH24:MI')
               || ')보다 앞섬 — 어느 시각이 맞는지 확인되지 않아 값은 원본 유지. 시각 기반 지표에서 제외할 것.'
  FROM surgeries s
 WHERE s.id = p.surgery_id AND s.ended_at IS NOT NULL AND p.arrival_time < s.ended_at
   AND COALESCE(p.notes, '') NOT LIKE '%[2026-08-18 시드 정합화]%';

-- ⑨-b 간호기록 서명이 기록 시각보다 앞선다 (1건)
--     🔴 서명 시각을 뒤로 미루지 않는다 — **언제 서명됐는지 모른다.** 서명을 되돌린다.
--        (기록 시각은 임상 사실이므로 보존한다.)
SELECT id, recorded_at, signed_at, status FROM nursing_notes WHERE signed_at < recorded_at;
-- 2026-08-18 기대: 1건

UPDATE nursing_notes
   SET signed_at = NULL, signed_by = NULL, status = 'DRAFT'
 WHERE signed_at < recorded_at;

-- ⑨-c 진료기록 상태가 SIGNED 인데 서명 시각이 없다 (1건)
--     🔴 서명 시각을 created_at 으로 추정해 박지 않는다 — 서명을 되돌린다.
--        (서명자 id 는 남아 있으나, 시각 없는 서명은 법정기록으로서 서명이 아니다.)
SELECT id, status, signed_at, signed_by, created_at FROM encounters WHERE status = 'SIGNED' AND signed_at IS NULL;
-- 2026-08-18 기대: 1건

UPDATE encounters SET status = 'DRAFT', signed_by = NULL
 WHERE status = 'SIGNED' AND signed_at IS NULL;

-- ⑨-d 대기열 — 미래 접수 · 시각 역전 (4건)
--     🔴 §"교정하지 않는 것" 도 함께 읽을 것: 대기열의 **완료 위장 456건은 여기서 고치지 않는다**
--        (매일 재생성된다 — 아래 §10 참조). 여기서는 재생성과 무관한 시각 모순만 정리한다.
SELECT id, status, checked_in_at, called_at, started_at, completed_at
FROM waiting_queue
WHERE checked_in_at > now()
   OR (called_at IS NOT NULL AND called_at < checked_in_at)
   OR (completed_at IS NOT NULL AND started_at IS NOT NULL AND completed_at < started_at);
-- 2026-08-18 기대: 4건 (미래 접수 2 · 호출<접수 1 · 완료<시작 1)

-- 미래 접수: 아직 오지 않은 접수다 → 시각을 지어내지 않고 **행 자체를 취소**한다.
--   (checked_in_at 이 NOT NULL 이라 비울 수 없고, 앞당기면 오지 않은 환자를 왔다고 기록하게 된다.)
UPDATE waiting_queue
   SET status = 'CANCELLED',
       reason = COALESCE(NULLIF(reason, '') || ' / ', '')
                || '[2026-08-18 시드 정합화] 접수 시각이 미래 — 실제 접수 아님'
 WHERE checked_in_at > now() AND status NOT IN ('CANCELLED', 'COMPLETED');

-- 호출이 접수보다 앞선다 → 호출 사실의 시각을 모른다. 호출을 되돌린다(접수 시각은 보존).
UPDATE waiting_queue SET called_at = NULL, call_count = 0
 WHERE called_at IS NOT NULL AND called_at < checked_in_at;

-- 완료가 시작보다 앞선다 → 완료 시각을 모른다. 완료를 되돌려 진료 중으로 남긴다.
--   🔴 completed_at 을 started_at 뒤로 밀지 않는다(모르는 시각을 박지 않는다).
UPDATE waiting_queue
   SET completed_at = NULL, status = 'IN_CONSULTATION'
 WHERE completed_at IS NOT NULL AND started_at IS NOT NULL AND completed_at < started_at;


-- =============================================================================
-- §9-e  대기열 완료 위장 456건 → CANCELLED
-- =============================================================================
-- 🔴 이 블록은 **배포 `5e3105b8`(2026-08-18 13:25 · v4.3.0) 이후에만 유효하다.**
--    그 전에 적용하면 다음 날 09:00 크론이 같은 것을 다시 만든다 —
--    이 저장소에서 **이미 한 번 그렇게 되살아났다**(W9 가 교정했는데 재축적됐다.
--    당시 소스 수정이 배포되지 않았기 때문이다. "고쳤다"가 아래층 때문에 되살아난 전형).
--
-- 무엇이 어긋났나
--   외래 대기 COMPLETED 462건 중 **456건이 `called_at`·`started_at`·`encounter_id` 전부 NULL** 이다.
--   호출도 진료 시작도 Encounter 생성도 없이 "완료"만 찍힌 것이다(**P16** — 실행하지 않고 성공 상태만 기록).
--   그 결과 ① "완료 462건"이라는 처리량 실적이 허구가 되고
--         ② 대기시간 지표의 분모가 오염된다.
--
-- 🔴 정본은 **생성기**다 — `apps/api/src/modules/dev-demo/dev-demo.service.ts` L284~311
--    (W8 · `97879f5d`). 그 커밋은 **코드만 고치고 데이터 교정 SQL 을 남기지 않았다**(재사용할 것이 없다).
--    그래서 여기서는 생성기의 **판정 기준과 사유 문구를 그대로** 옮긴다 — 정본이 둘이 되지 않게.
--      · 판정: 호출·진료시작·Encounter 가 전부 없음
--      · 조치: `status = 'CANCELLED'` · `completed_at` **보존**(생성기도 completedAt 을 지우지 않는다)
--      · 사유: 생성기가 쓰는 문자열과 동일
--    생성기 주석의 근거를 그대로 옮기면:
--      "이 사람들은 접수만 하고 진료를 받지 않았다. 그러면 완료가 아니라 취소다.
--       CANCELLED 는 이 저장소 집계 규약상 대기에도 완료에도 세지 않는다 — 정확히 이 경우를 위한 상태다.
--       NO_SHOW 는 '오지 않았다'는 뜻이라 접수 기록이 있는 이들에게는 틀린 말이다."
--
-- 🔴 임상 내용을 지어내지 않는다 — 호출 시각·진료 시작 시각·Encounter 를 **만들어 채우지 않는다.**
--    없었던 진료를 있었던 것으로 만드는 것이 이 결함의 본질이고, 그것을 반복하지 않는다.

-- ① 영향 행수 확인
SELECT count(*) AS 완료위장,
       count(*) FILTER (WHERE appointment_id IS NOT NULL) AS 예약연결,
       min(completed_at) AS 최소완료, max(completed_at) AS 최대완료,
       count(DISTINCT completed_at) AS 완료시각_고유값
FROM waiting_queue
WHERE status = 'COMPLETED' AND called_at IS NULL AND started_at IS NULL AND encounter_id IS NULL;
-- 2026-08-18 14:05 실측: 456 / 3 / 08-08 15:46 / 08-18 10:24 / 46
-- (완료시각이 46개 값에 뭉쳐 있다 = 배치 updateMany 의 단일 `now` 패턴 — 진료 흐름이 아니다)

-- ② 🔴 중단 가드 — 재생성이 정말 멈췄는가
--    배포 시각 이후에 만들어진 완료 위장이 하나라도 있으면 **새 빌드가 여전히 만들고 있다는 뜻**이다.
--    그 상태에서 교정하면 다시 쌓이고, 우리는 "고쳤다"고 잘못 말하게 된다 → 여기서 중단한다.
DO $$
DECLARE
  v_deploy timestamptz := TIMESTAMPTZ '2026-08-18 13:25:00+09';  -- 5e3105b8 배포 시각
  v_after  int;
BEGIN
  SELECT count(*) INTO v_after FROM waiting_queue
   WHERE status = 'COMPLETED' AND called_at IS NULL AND started_at IS NULL AND encounter_id IS NULL
     AND completed_at > v_deploy;
  IF v_after > 0 THEN
    RAISE EXCEPTION '중단: 배포(%) 이후에 생성된 대기열 완료 위장이 %건 있습니다 — 재생성이 멈추지 않았습니다.',
      v_deploy, v_after
      USING HINT = '운영 빌드에 dev-demo.service.ts 의 W8 수정(97879f5d)이 반영됐는지 먼저 확인하십시오. 멈추지 않은 상태에서 교정하면 다시 쌓입니다.';
  END IF;
END $$;

-- ③ 교정
UPDATE waiting_queue
   SET status = 'CANCELLED',
       -- 🔴 생성기(dev-demo.service.ts)가 쓰는 사유 문자열과 **동일하게** 둔다.
       --    문구가 갈리면 "언제 생성기가 만든 것이고 언제 소급 교정한 것인지"를 구분할 수 없다.
       reason = '[데모 롤포워드] 진료 없이 마감 — 진료 실적으로 세지 않음'
 WHERE status = 'COMPLETED' AND called_at IS NULL AND started_at IS NULL AND encounter_id IS NULL;
-- completed_at 은 **지우지 않는다** — 생성기도 지우지 않고, 마감 시각 자체는 실제로 일어난 일이다.
--
-- 🔴 실행 순서 상호작용 — 여기서 **457건**이 갱신된다(①의 456이 아니다).
--    §9-d 가 '호출 < 접수' 1건의 `called_at` 을 NULL 로 만들었고, 그 행은 이미
--    `started_at`·`encounter_id` 가 없었다 → §9-e 의 판정에 새로 걸린다.
--    이것은 **오작동이 아니라 옳은 결과**다(그 행에는 실제로 호출·진료시작·Encounter 가 없다).
--    ①의 456 은 §9-d 이전 기준 숫자이므로 둘이 다른 것이 정상이다 — 세는 시점을 밝혀 둔다.
--
-- 🔴 사유 문자열은 **이미 46건에 붙어 있다**(생성기가 쓴 것). 교정 후 총계는 46 + 457 = 503 이 된다.
--    "503건을 교정했다"고 읽으면 틀린다 — 검증 SQL 이 그 구분을 표시한다.

-- ④ 🔴 연쇄 확인 — 예약 상태는 여기서 고치지 않는다(사람 몫 · §10 ⑨)
--    `infra/scripts/data-stale-cleanup-20260812.sql` 이 "접수가 COMPLETED → 예약도 COMPLETED"
--    라는 파생을 이미 적용했다. 그 접수가 이제 CANCELLED 가 되므로 그 파생은 근거를 잃는다.
SELECT a.id AS appointment_id, a.status AS 예약상태, a.scheduled_at,
       (SELECT count(*) FROM encounters e WHERE e.appointment_id = a.id) AS 진료기록수
FROM waiting_queue w JOIN appointments a ON a.id = w.appointment_id
WHERE w.status = 'CANCELLED'
  AND w.reason = '[데모 롤포워드] 진료 없이 마감 — 진료 실적으로 세지 않음'
  AND a.status = 'COMPLETED';
-- 2026-08-18 기대: 1건 (진료기록수 0)


-- =============================================================================
-- §10  🔴 교정하지 않는 것 — 여기서 고쳐도 되살아나거나, 사람 판단이 필요한 것
-- =============================================================================
-- (SQL 은 없다. 왜 안 고치는지를 남긴다.)
--
-- ① **대기열 완료 위장 456건** — 외래 대기 COMPLETED 462건 중 456건이
--    호출·진료시작·Encounter 가 전부 없다(P16: 실행하지 않고 성공 상태만 기록).
--    🔴 **하루에 736건이 새로 생성된다.** 여기서 CANCELLED 로 고쳐도 내일 다시 생긴다.
--    소스 코드는 이미 고쳐져 있다(`97879f5d` · W8 — `dev-demo.service.ts` 에서 CANCELLED 로 변경).
--    그런데 운영에는 여전히 COMPLETED 가 쌓인다 →
--    **운영 서버가 그 커밋 이전 빌드로 돌고 있을 가능성이 높다**
--    (근거: 오늘자 423건의 completed_at 이 **13개 값에 뭉쳐 있다** — 배치 updateMany 의 단일 `now` 패턴).
--    → 데이터 교정이 아니라 **배포**로 닫아야 한다. 그 전까지 이 축의 수치는 실적이 아니다.
--
-- ② **수납 완료 청구의 비급여 오분류 5건** — §5-c 목록. 재정산·환불이 따르는 회계 행위다.
--
-- ③ **제제별 유효기간**(PC 5일·PRBC 35~42일 규칙과 어긋난 채혈~만료 간격) — §4 말미 참조.
--
-- ④ **DUR 경고 우회 1건에 사유·우회자·시각이 전부 없음**(`prescriptions.dur_overridden = true`).
--    `false` 로 되돌리면 "경고를 무시한 적 없다"는 **더 안전해 보이는 거짓**이 된다.
--    사유를 지어낼 수도 없다. → 감사 대상으로 남긴다.
--      SELECT id, created_at FROM prescriptions
--       WHERE dur_overridden AND (dur_override_reason IS NULL OR btrim(dur_override_reason) = '');
--
-- ⑤ **123세 생존 환자 1명**(MRN HR-20260607-0001 · 1902-10-10). 생년월일을 지어낼 수 없다.
--
-- ⑥ **결과지 내용의 교차 오염**(예: 뇌파 결과지에 심전도 판독문) — 임상 내용이다.
--    판독문을 다시 쓰는 것은 날조다. 생성기 교정 + 사람 확인 대상.
--
-- ⑦ **영상 modality 어휘 분기** — 표본이 3→41건으로 늘어 더 정확히 말할 수 있게 됐다.
--    실측: `CR` 18 · `US` 21 (DICOM 표준·정본 `detectModality` 산출 집합) ·
--          `X-ray` 1(ORDERED) · `XR` 1(REPORTED) — 이 둘만 정본 산출 집합 밖이다.
--    🔴 그래도 고치지 않는다 — `imaging-safety.service.ts` `detectModality()` 는
--       **명시값을 대문자화해 그대로 통과**시키므로(`explicit.trim().toUpperCase()`),
--       '이 컬럼의 허용 어휘'를 못박은 정본이 **어디에도 없다.** 없는 정본을 SQL 이 만들지 않는다.
--    ⚠️ 관련 사실 하나는 남긴다: `IONIZING_MODALITIES` 에 `XR`·`X-RAY` 가 **없다**
--       (`CR`·`DX` 는 있다). 다만 임신 게이트·누적선량은 **오더**의 modality 로 판정하므로
--       이 컬럼 값 때문에 지금 게이트가 뚫리지는 않는다 — **어휘를 못박을 때 함께 볼 것.**
--
-- ⑧ **간호기록 187건 / 진료기록 30건의 `signed_at < created_at`** — **결함이 아니다.**
--    간호기록은 `signed_at = recorded_at`(과거 임상 시각)이고 `created_at` 은 시드 삽입 시각이다.
--    진료기록 30건은 격차가 **0.001초**(삽입 순서 아티팩트)다.
--    🔴 분모부터 실측하지 않았다면 217건을 결함으로 세고 시각을 다시 썼을 것이다.
--
-- ⑨ **취소된 청구 1건에 paid_at 이 있음** — **결함이 아니다.**
--    1,000원 수납 → 같은 초에 1,000원 환불 → 취소. 기록이 일관된다.
--
-- ⑩ **§9-e 로 근거를 잃는 예약 1건**(status=COMPLETED · 진료기록 0 · 연결 접수가 CANCELLED 로 바뀜).
--    🔴 고치지 않는다 — 옳은 목적지 상태가 **모호하고, 어느 쪽이든 모르는 것을 지어내야 한다**:
--      · `CANCELLED` 로 옮기면 `cancelled_at`·`cancel_reason` 이 필요한데 **언제 취소됐는지 모른다**.
--      · `CHECKED_IN` 은 "접수하고 대기 중"이라는 뜻인데 그 접수는 이미 마감됐다.
--    접수 흐름 규약의 판단이므로 원무에 넘긴다. 대상은 §9-e ④ SELECT 가 뽑는다.
--
-- ⑪ **청구 헤더 본인부담 ≠ Σround(라인금액×율) 2건** — 둘 다 **수납 완료(PAID)**,
--    2026-05-28 생성 시드 행이다(180,000 전액 본인부담 · 75,000 전액 보험).
--    ②와 같은 이유로 손대지 않는다 — 수납된 금액을 바꾸는 것은 회계 행위다.


COMMIT;

-- =============================================================================
-- 실측 0건이라 블록이 없는 항목 (검증 SQL 이 계속 감시한다)
-- =============================================================================
--   퇴원일 미래 · 퇴원<입원 · 수술 종료<시작 · 절개<봉합 역전 · 검사 완료<채취 ·
--   검사 검증<완료 · 오더 완료<시작 · 조제 검수<조제 · 영상 판독<촬영 ·
--   예약 취소<생성 · 수혈 종료<시작 · 수혈 2인 확인 동일인 · 병상 점유↔재원 불일치 ·
--   환자 사망일<출생일 · 활력 생리학적 범위 이탈(519건 전부 정상) ·
--   내원 전 활력 BMI 파생 불일치(0건) · 교육 만료일 파생 불일치(0건) ·
--   방사선 누적선량 파생 불일치(0건) · 청구 총액=라인 합(0건 불일치)
