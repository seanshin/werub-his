-- 병동 간 전동 요청 → 수락(2026-09-30) · 추가만(테이블 1·인덱스 2 + 부분 유니크 1) — 앞부분은 prisma migrate diff 출력 그대로
-- CreateTable
CREATE TABLE "bed_transfer_requests" (
    "id" UUID NOT NULL,
    "admission_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "from_bed_id" UUID NOT NULL,
    "target_ward_id" UUID NOT NULL,
    "target_bed_id" UUID,
    "reason" TEXT NOT NULL,
    "status" VARCHAR(12) NOT NULL DEFAULT 'REQUESTED',
    "requested_by_id" UUID NOT NULL,
    "requested_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_by_id" UUID,
    "decided_at" TIMESTAMPTZ,
    "decision_note" TEXT,
    "accepted_bed_id" UUID,

    CONSTRAINT "bed_transfer_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bed_transfer_requests_status_target_ward_id_idx" ON "bed_transfer_requests"("status", "target_ward_id");

-- CreateIndex
CREATE INDEX "bed_transfer_requests_admission_id_idx" ON "bed_transfer_requests"("admission_id");


-- 입원 하나에 열린(REQUESTED) 요청은 하나 — Prisma 스키마로 표현할 수 없는 부분 유니크(ER 베드 보드 배정과 같은 방식)
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_bed_transfer_open" ON "bed_transfer_requests" ("admission_id") WHERE "status" = 'REQUESTED';
