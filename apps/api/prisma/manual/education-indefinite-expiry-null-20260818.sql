-- =============================================================================
-- 🔴 2026-08-18 재실측 결과: **대상 0건 — 이 SQL 은 돌려도 아무것도 하지 않는다(no-op).**
--
--   `expires_at >= '9999-01-01'` 인 행이 운영 DB 에 **하나도 없다**.
--   대신 정확히 **반대 방향**의 결함이 있다:
--     `education_programs.valid_months = 0`(무기한)인 과정의 이수 23건 전부에
--     `completed_at + 12개월` 만료일이 박혀 있다(구 seed.ts 가 validMonths<=0 이면 12개월 부여).
--   → 그 교정은 `seed-integrity-recalibration-20260818.sql` **§7** 이 한다. 이 파일은 건너뛴다.
--   (아래 원문은 이력으로 남긴다 — 다른 환경/재시드 후에는 다시 대상이 생길 수 있다.)
-- =============================================================================

-- =============================================================================
-- 교육 이수 만료일 — 무기한 표식(9999-12-31) → NULL 정리
-- 2026-08-18 · 적용은 사람이 판단한다(코드가 DB 를 직접 고치지 않는다)
-- =============================================================================
--
-- 배경
--   `education_completions.expires_at` 이 NOT NULL 이던 시절, "만료 없음"(과정의
--   validMonths = 0)을 담을 자리가 없어 `9999-12-31 23:59:59.999` 를 **표식**으로 썼다.
--   그 값은 원장에 "9999년에 만료된다"는 틀린 사실을 박은 것이다.
--
--   스키마가 nullable 로 전환되어(2026-08-18) 무기한의 정본은 **NULL** 이 되었다.
--   코드는 새 기록에 NULL 을 쓰고, 읽을 때는 `isIndefiniteExpiry()` 가 NULL 과 구 9999 표식을
--   모두 무기한으로 판정한다(하위호환). 따라서 이 SQL 을 적용하지 않아도 화면은 정확하다 —
--   **원장의 값 자체를 사실로 되돌리려면** 적용한다.
--
-- 🔴 주의
--   - 실행 전 반드시 ①번으로 대상 건수를 확인한다. 0 이면 아무것도 하지 않는다.
--   - `9999-…` 를 쓴 적 없는 시드(prisma/seed.ts 는 validMonths<=0 이면 12개월을 부여)에서는
--     대상이 0 건일 수 있다. 0 행은 '결함 없음'이 아니라 '해당 데이터 없음'이다.
--   - 정리 후 `education_programs.valid_months = 0` 인 과정의 신규 이수는 코드가 NULL 을 쓴다.
-- =============================================================================

-- ① 대상 실측 (먼저 이것만 실행한다)
SELECT
  ec.expires_at,
  ep.name          AS program_name,
  ep.valid_months,
  COUNT(*)         AS rows
FROM education_completions ec
JOIN education_programs ep ON ep.id = ec.program_id
WHERE ec.expires_at >= TIMESTAMPTZ '9999-01-01'
GROUP BY ec.expires_at, ep.name, ep.valid_months
ORDER BY rows DESC;

-- ② 🔴 표식이 붙은 행 중 프로그램이 실제로 무기한이 아닌 것 — 이 행들은 **자동 정리 대상이 아니다**.
--    (무기한 과정이 아닌데 9999 가 박혀 있다면 잘못 기록된 것이므로 사람이 개별 판단한다.
--     추정으로 만료일을 만들어 넣지 않는다.)
SELECT ec.id, ec.staff_id, ep.name, ep.valid_months, ec.completed_at, ec.expires_at
FROM education_completions ec
JOIN education_programs ep ON ep.id = ec.program_id
WHERE ec.expires_at >= TIMESTAMPTZ '9999-01-01'
  AND COALESCE(ep.valid_months, 12) > 0;

-- ③ 정리 (①이 0 건이 아니고 ②가 0 건일 때만 실행)
BEGIN;

UPDATE education_completions ec
SET    expires_at = NULL
FROM   education_programs ep
WHERE  ep.id = ec.program_id
  AND  ec.expires_at >= TIMESTAMPTZ '9999-01-01'
  AND  COALESCE(ep.valid_months, 12) <= 0;

-- 정리 결과 확인 — 남아 있는 9999 표식이 있으면 ② 대상이므로 롤백하고 사람이 본다
SELECT COUNT(*) AS remaining_marker_rows
FROM   education_completions
WHERE  expires_at >= TIMESTAMPTZ '9999-01-01';

COMMIT;
-- ROLLBACK;  -- remaining_marker_rows 가 예상과 다르면 이쪽

-- ④ 사후 확인 — 무기한(NULL) 건수와 만료 임박 집계가 서로 겹치지 않는지
SELECT
  COUNT(*) FILTER (WHERE expires_at IS NULL)                                    AS indefinite_rows,
  COUNT(*) FILTER (WHERE expires_at IS NOT NULL AND expires_at <  now())        AS expired_rows,
  COUNT(*) FILTER (WHERE expires_at IS NOT NULL AND expires_at >= now()
                                              AND expires_at <= now() + INTERVAL '30 days') AS due_soon_rows
FROM education_completions;
