-- 🔴 정정 — 앞선 삽입은 `created_at` 순번으로 계획을 다시 붙였는데 세 행의 시각이 같아
--    순서가 뒤섞였다. 그 결과 **완료 배정에 마일스톤 2건**(허구 실적)·
--    **진행 중 배정에 전건 완료**(완료인데 완료가 아님)가 됐다.
--    계획은 **경로 코드**에 고정한다(순번에 기대지 않는다).
BEGIN;
DELETE FROM milestone_outcomes;

WITH plan(code, done_count, deviate_at) AS (
  VALUES ('CP-AMI-001', 2, NULL::int),   -- 진행 중 — 일부만
         ('CP-CABG-001', 6, NULL::int),  -- 완료 — 전 마일스톤
         ('CP-PNEU-001', 3, 2)           -- 🔴 이탈 표본
), a AS (
  SELECT pa.id, pa.pathway_id, pa.assigned_by, p.code
  FROM pathway_assignments pa JOIN clinical_pathways p ON p.id = pa.pathway_id
), ms AS (
  SELECT m.id, m.pathway_id, m.day,
         ROW_NUMBER() OVER (PARTITION BY m.pathway_id ORDER BY m.sort_order) - 1 AS idx
  FROM pathway_milestones m
)
INSERT INTO milestone_outcomes (id, assignment_id, milestone_id, actual_day, status, variance, performed_by, performed_at)
SELECT gen_random_uuid(), a.id, ms.id,
       ms.day + CASE WHEN plan.deviate_at = ms.idx THEN 1 ELSE 0 END,
       CASE WHEN plan.deviate_at = ms.idx THEN 'DEVIATED' ELSE 'COMPLETED' END,
       CASE WHEN plan.deviate_at = ms.idx THEN '검사 결과 지연으로 익일 시행' ELSE NULL END,
       a.assigned_by, now() - (ms.day || ' days')::interval
FROM a JOIN plan ON plan.code = a.code
       JOIN ms ON ms.pathway_id = a.pathway_id AND ms.idx < plan.done_count;

-- 상태도 경로 코드에 고정해 다시 맞춘다
UPDATE pathway_assignments pa SET
  status = CASE WHEN p.code = 'CP-CABG-001' THEN 'COMPLETED' ELSE 'ACTIVE' END,
  actual_days = CASE WHEN p.code = 'CP-CABG-001' THEN 9 ELSE NULL END,
  completed_at = CASE WHEN p.code = 'CP-CABG-001' THEN now() - interval '1 day' ELSE NULL END,
  deviations = (SELECT count(*) FROM milestone_outcomes o WHERE o.assignment_id = pa.id AND o.status = 'DEVIATED')
FROM clinical_pathways p WHERE p.id = pa.pathway_id;
COMMIT;
-- 🔴 정정 — 앞선 삽입은 `created_at` 순번으로 계획을 다시 붙였는데 세 행의 시각이 같아
--    순서가 뒤섞였다. 그 결과 **완료 배정에 마일스톤 2건**(허구 실적)·
--    **진행 중 배정에 전건 완료**(완료인데 완료가 아님)가 됐다.
--    계획은 **경로 코드**에 고정한다(순번에 기대지 않는다).
BEGIN;
DELETE FROM milestone_outcomes;

WITH plan(code, done_count, deviate_at) AS (
  VALUES ('CP-AMI-001', 2, NULL::int),   -- 진행 중 — 일부만
         ('CP-CABG-001', 6, NULL::int),  -- 완료 — 전 마일스톤
         ('CP-PNEU-001', 3, 2)           -- 🔴 이탈 표본
), a AS (
  SELECT pa.id, pa.pathway_id, pa.assigned_by, p.code
  FROM pathway_assignments pa JOIN clinical_pathways p ON p.id = pa.pathway_id
), ms AS (
  SELECT m.id, m.pathway_id, m.day,
         ROW_NUMBER() OVER (PARTITION BY m.pathway_id ORDER BY m.sort_order) - 1 AS idx
  FROM pathway_milestones m
)
INSERT INTO milestone_outcomes (id, assignment_id, milestone_id, actual_day, status, variance, performed_by, performed_at)
SELECT gen_random_uuid(), a.id, ms.id,
       ms.day + CASE WHEN plan.deviate_at = ms.idx THEN 1 ELSE 0 END,
       CASE WHEN plan.deviate_at = ms.idx THEN 'DEVIATED' ELSE 'COMPLETED' END,
       CASE WHEN plan.deviate_at = ms.idx THEN '검사 결과 지연으로 익일 시행' ELSE NULL END,
       a.assigned_by, now() - (ms.day || ' days')::interval
FROM a JOIN plan ON plan.code = a.code
       JOIN ms ON ms.pathway_id = a.pathway_id AND ms.idx < plan.done_count;

-- 상태도 경로 코드에 고정해 다시 맞춘다
UPDATE pathway_assignments pa SET
  status = CASE WHEN p.code = 'CP-CABG-001' THEN 'COMPLETED' ELSE 'ACTIVE' END,
  actual_days = CASE WHEN p.code = 'CP-CABG-001' THEN 9 ELSE NULL END,
  completed_at = CASE WHEN p.code = 'CP-CABG-001' THEN now() - interval '1 day' ELSE NULL END,
  deviations = (SELECT count(*) FROM milestone_outcomes o WHERE o.assignment_id = pa.id AND o.status = 'DEVIATED')
FROM clinical_pathways p WHERE p.id = pa.pathway_id;
COMMIT;
