-- 데이터 정합성 교정 (2026-08-10)
--
-- 대상 = **파생 도출 가능한 것만**. 추정·날조 금지(2026-08-03 교정 원칙 승계).
-- 실행:
--   docker exec -i docker-postgres-1 psql -U hospital -d hospitalrun -f /tmp/data-integrity-fix-20260810.sql
--
-- ── 배경 ────────────────────────────────────────────────────────────────
-- 응급 방문이 COMPLETED 로 마감됐는데 `emergency_bed_assignments.released_at` 이 NULL 로 남아
-- 병상이 **영구 OCCUPIED** 였다(GEN-1·ACUTE-1). 원인 = 데모 크론 refreshEmergency 의 묵은 재실
-- 마감이 방문 상태만 바꾸고 병상을 반납하지 않았다(ER 축의 "결정≠퇴실" 함정이 데모 경로에서 재현).
-- 코드는 동일 커밋에서 봉합(마감을 tx 로 묶어 배정 해제+병상 반납).
--
-- 🔴 해제 시각의 근거: 방문이 실제로 마감된 시각 = `emergency_visits.updated_at`(크론 실행 시각).
--    `disposition_at` 은 크론이 `arrival_at + 4h` 로 **소급 설정**한 값이라 배정 시각보다 이르다
--    → 그걸 쓰면 released_at < assigned_at 이 되어 더 큰 모순이 된다. 관측된 사실만 쓴다.
-- ────────────────────────────────────────────────────────────────────────

\timing off
BEGIN;

-- 교정 전 상태 기록
\echo '── 교정 전'
SELECT count(*) AS "미해제 배정(방문 종결됨)"
  FROM emergency_bed_assignments e JOIN emergency_visits v ON v.id = e.visit_id
 WHERE e.released_at IS NULL AND v.status = 'COMPLETED';

-- 1) 배정 해제 — 해제 시각 = 방문 마감 시각(updated_at). 사유는 출처를 남긴다.
WITH target AS (
  SELECT e.id, v.updated_at AS closed_at
    FROM emergency_bed_assignments e JOIN emergency_visits v ON v.id = e.visit_id
   WHERE e.released_at IS NULL AND v.status = 'COMPLETED'
)
UPDATE emergency_bed_assignments e
   SET released_at = GREATEST(t.closed_at, e.assigned_at),  -- 배정보다 이른 해제는 만들지 않는다
       release_reason = 'DEMO_CLOSE'
  FROM target t
 WHERE e.id = t.id;

-- 2) 병상 반납 — 재원 입원도, 미해제 응급 배정도 없는 OCCUPIED 병상만.
--    ⚠ 입원(admissions)과 응급(emergency_bed_assignments) **양쪽**을 봐야 한다.
--      한쪽만 보면 정상 점유를 해제해 버린다(2026-08-10 실측: 입원만 보면 오탐 8건).
UPDATE beds b
   SET status = 'AVAILABLE'
 WHERE b.status = 'OCCUPIED'
   AND NOT EXISTS (SELECT 1 FROM admissions a WHERE a.bed_id = b.id AND a.status = 'ADMITTED')
   AND NOT EXISTS (SELECT 1 FROM emergency_bed_assignments e WHERE e.bed_id = b.id AND e.released_at IS NULL);

-- 3) 서명 진료의 서명자 복원 — 8/3 교정에서 빠진 잔여. doctor_id 는 **관측된 사실**이라 복원 가능,
--    서명 시각은 추정 금지 → signed_at 이 없으면 그대로 둔다(둘 중 복원 가능한 것만).
UPDATE encounters
   SET signed_by = doctor_id
 WHERE status = 'SIGNED' AND signed_by IS NULL AND doctor_id IS NOT NULL;

\echo '── 교정 후'
SELECT count(*) AS "미해제 배정(방문 종결됨)"
  FROM emergency_bed_assignments e JOIN emergency_visits v ON v.id = e.visit_id
 WHERE e.released_at IS NULL AND v.status = 'COMPLETED';
SELECT count(*) AS "유령 점유(입원·응급 모두 없음)"
  FROM beds b
 WHERE b.status = 'OCCUPIED'
   AND NOT EXISTS (SELECT 1 FROM admissions a WHERE a.bed_id = b.id AND a.status = 'ADMITTED')
   AND NOT EXISTS (SELECT 1 FROM emergency_bed_assignments e WHERE e.bed_id = b.id AND e.released_at IS NULL);
SELECT count(*) AS "서명자 없는 서명 진료"
  FROM encounters WHERE status = 'SIGNED' AND signed_by IS NULL;

COMMIT;
