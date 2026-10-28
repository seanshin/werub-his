-- CreateTable
CREATE TABLE "alert_approvals" (
    "id" UUID NOT NULL,
    "code" VARCHAR(60) NOT NULL,
    "snapshot" JSONB NOT NULL,
    "basis" TEXT NOT NULL,
    "approved_by" UUID NOT NULL,
    "approved_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ,
    "revoked_by" UUID,
    "revoke_reason" TEXT,

    CONSTRAINT "alert_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "alert_approvals_code_approved_at_idx" ON "alert_approvals"("code", "approved_at");

