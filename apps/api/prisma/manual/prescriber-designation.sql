-- 처방 작성자(책임 처방의) 지정 + 위임 인증
-- 적용: docker exec -i docker-postgres-1 psql -U hospital -d hospitalrun < this.sql
-- 안전: 모두 IF NOT EXISTS — 재실행 무해

-- 1) 처방에 책임 처방의(지정) 컬럼. NULL = createdBy(입력자 본인)
ALTER TABLE prescriptions ADD COLUMN IF NOT EXISTS prescriber_id UUID;

-- 2) step-up 승인에 위임 요청자(입력자) — 입력자가 지정 처방의 승인 토큰을 1회 수령
ALTER TABLE step_up_approvals ADD COLUMN IF NOT EXISTS requester_id UUID;

-- 인덱스: 위임 처방의별 책임 처방 조회
CREATE INDEX IF NOT EXISTS idx_prescriptions_prescriber ON prescriptions (prescriber_id);
CREATE INDEX IF NOT EXISTS idx_stepup_requester ON step_up_approvals (requester_id, status);
