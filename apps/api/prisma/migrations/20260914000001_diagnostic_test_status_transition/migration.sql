-- 기초검사 상태 전이 기록(diagnostics-board-enhancement P2 — 2026-09-14)
-- 🔴 종전 전이 EP 는 취소·보류 사유를 `critical_note`(위험소견 메모)에 덮어썼다. 사유·행위자·시각을 자기 칸에 둔다.
-- 가산 전용(nullable 컬럼 3개) — 기존 행·기존 흐름에 영향 없음. `db push` 로도 같은 모양이 생긴다(DROP 없음).
-- 컬럼마다 문장을 나눈다 — 설치 재현성 가드의 기준선 대조 파서가 문장 단위로 읽는다.

-- AlterTable
ALTER TABLE "diagnostic_tests" ADD COLUMN "status_reason" VARCHAR(300);
ALTER TABLE "diagnostic_tests" ADD COLUMN "status_changed_by" UUID;
ALTER TABLE "diagnostic_tests" ADD COLUMN "status_changed_at" TIMESTAMPTZ;
