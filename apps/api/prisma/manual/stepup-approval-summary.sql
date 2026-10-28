-- 위임 승인에 "무엇을 승인하는지"(약품/검사명) 요약 — approve-blind 방지
-- 재실행 무해
ALTER TABLE step_up_approvals ADD COLUMN IF NOT EXISTS summary VARCHAR(120);
