-- 2026-10-27 간호 원내 규정 개발 시드 — prisma/seeds/nursing-rules-dev-seed.ts 와 같은 값(기계 대조 test/seed/nursing-rules-dev-seed.spec.ts)
-- 🔴 원내 규정 아님 — label 표식 '개발 시드(DEV-SEED)' → 서버가 출처 SEED 로 말한다 · 관리자가 저장하면 표식이 사라진다
-- 🔴 없을 때만 넣는다(사람이 저장한 값을 덮지 않는다) · 적용: deploy.sh --backup 뒤
BEGIN;
INSERT INTO system_configs (id, key, value, category, label, updated_by, created_at, updated_at)
SELECT gen_random_uuid(), 'nursing.pain.reassessRule', '{"thresholdScore":4,"withinMinutes":60,"afterAnalgesicMinutes":60}'::jsonb, 'nursing', '개발 시드(DEV-SEED) — 원내 규정 아님', NULL, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM system_configs WHERE key = 'nursing.pain.reassessRule');
INSERT INTO system_configs (id, key, value, category, label, updated_by, created_at, updated_at)
SELECT gen_random_uuid(), 'nursing.handoff.ackTakeOverMode', '"OFFER_BOTH"'::jsonb, 'nursing', '개발 시드(DEV-SEED) — 원내 규정 아님', NULL, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM system_configs WHERE key = 'nursing.handoff.ackTakeOverMode');
INSERT INTO system_configs (id, key, value, category, label, updated_by, created_at, updated_at)
SELECT gen_random_uuid(), 'nursing.restraint.checkIntervalMinutes', '120'::jsonb, 'nursing', '개발 시드(DEV-SEED) — 원내 규정 아님', NULL, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM system_configs WHERE key = 'nursing.restraint.checkIntervalMinutes');
COMMIT;
