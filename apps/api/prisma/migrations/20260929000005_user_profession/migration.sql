-- 직종(오더 입력 범위) — 2026-09-29 · 추가 전용(기존 행은 NULL = 역할 기본 직종)
ALTER TABLE "users" ADD COLUMN "profession" VARCHAR(40);
