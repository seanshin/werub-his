-- 퇴원약 오더화 — 퇴원 때 가져갈 약을 처방 원장에 (2026-09-30) · 추가만(기본값 있는 열 1)
ALTER TABLE "prescriptions" ADD COLUMN IF NOT EXISTS "discharge_med" BOOLEAN NOT NULL DEFAULT false;
