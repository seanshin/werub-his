-- 2026-09-15 코드 매핑 크론 배치는 사람 행위자가 없다 — created_by 를 NULL 허용으로(추가 제약 해제만 · 기존 행 불변)
ALTER TABLE "mapping_batch_jobs" ALTER COLUMN "created_by" DROP NOT NULL;
