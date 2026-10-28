-- 응급실 퇴실 시각(2026-10-03 · 결정 D9 emergency.departureTimeSource = DEPARTED_AT_FIELD) — null = 떠난 시각 모름
-- AlterTable
ALTER TABLE "emergency_visits" ADD COLUMN     "departed_at" TIMESTAMPTZ,
ADD COLUMN     "departed_at_source" VARCHAR(20);
