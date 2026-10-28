-- 방사선치료 상태 어휘 정본화 — 이연 회수 T2-4 (2026-08-18)
--
-- 🔴 어휘가 갈라져 있었다(운영 실측):
--    계획: 서버·정본 `IN_TREATMENT` ↔ 시드 일부 `IN_PROGRESS`(5건 중 2건)
--    분획: 서버·정본 `DELIVERED`/`DELIVERING` ↔ 시드 일부 `COMPLETED`/`IN_PROGRESS`
--
-- 🔴 분획 어휘 오염은 표시 문제로 끝나지 않았다 — 누적선량 합산이 `status='DELIVERED'` 조건이라
--    이미 조사한 분획(계획당 8회·16Gy)이 **합산에서 통째로 빠져** 총선량 초과 차단이 헛돌았다.
--    코드 쪽은 두 방향으로 막았다:
--      ① 어휘 정본화(shared `RADIATION_*_STATUS_LABEL` · 시드 교정 · 서버 허용목록)
--      ② 누적선량을 **상태가 아니라 기록된 선량**(`delivered_dose IS NOT NULL`)으로 합산
--    ②가 있으므로 이 SQL 을 적용하지 않아도 선량 안전은 복구된다. 이 SQL 은 표시·진행률용이다.
--
-- ⚠️ 적용은 사람 몫. 현재 운영 DB 는 가상 병원 시드라 **재시드로도 해소**된다.
--
-- 실행 전 확인:
--   SELECT status, count(*) FROM radiation_plans GROUP BY 1;
--   SELECT status, count(*) FROM radiation_fractions GROUP BY 1;

BEGIN;

UPDATE radiation_plans SET status = 'IN_TREATMENT' WHERE status = 'IN_PROGRESS';

-- 분획: 조사 기록(선량·시각)이 있는 행만 DELIVERED 로 옮긴다.
-- 기록이 없는데 상태만 COMPLETED 인 행은 **손대지 않는다** — 조사 사실을 지어낼 수 없다.
UPDATE radiation_fractions
   SET status = 'DELIVERED'
 WHERE status = 'COMPLETED'
   AND delivered_dose IS NOT NULL;

UPDATE radiation_fractions
   SET status = 'DELIVERING'
 WHERE status = 'IN_PROGRESS';

-- 남은 정본 밖 값 확인(있으면 커밋 전에 눈으로 본다)
SELECT 'plan' AS kind, status, count(*) FROM radiation_plans
 WHERE status NOT IN ('PLANNED','APPROVED','IN_TREATMENT','COMPLETED','CANCELLED','ON_HOLD') GROUP BY 1,2
UNION ALL
SELECT 'fraction', status, count(*) FROM radiation_fractions
 WHERE status NOT IN ('SCHEDULED','DELIVERING','DELIVERED','SKIPPED','CANCELLED') GROUP BY 1,2;

COMMIT;
