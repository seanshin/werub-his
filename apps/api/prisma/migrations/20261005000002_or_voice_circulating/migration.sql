-- 수술방 차트 P1(2026-10-05) — 순회 간호 자리 · 음성 세션을 수술 단위로도 연다
-- AlterTable
ALTER TABLE "surgeries" ADD COLUMN "circulating_nurse_id" UUID;

-- AlterTable
ALTER TABLE "voice_command_sessions" ALTER COLUMN "encounter_id" DROP NOT NULL,
ADD COLUMN "surgery_id" UUID;

-- CreateIndex
CREATE INDEX "voice_command_sessions_surgery_id_idx" ON "voice_command_sessions"("surgery_id");
