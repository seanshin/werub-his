-- 2026-10-27 낙상·욕창 위험 재평가 주기 개발 시드 — prisma/seeds/nursing-rules-dev-seed.ts 와 같은 값(기계 대조 test/seed/nursing-rules-dev-seed.spec.ts)
-- 🔴 원내 규정 아님 — label 표식 '개발 시드(DEV-SEED)' · 없을 때만 · 적용: deploy.sh --backup 뒤
BEGIN;
INSERT INTO system_configs (id, key, value, category, label, updated_by, created_at, updated_at)
SELECT gen_random_uuid(), 'nursing.riskReassess.intervalHours', '{"FALL_RISK":{"HIGH":2,"MODERATE":4,"LOW":8},"PRESSURE_ULCER":{"HIGH":4,"MODERATE":8,"LOW":24}}'::jsonb, 'nursing', '개발 시드(DEV-SEED) — 원내 규정 아님', NULL, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM system_configs WHERE key = 'nursing.riskReassess.intervalHours');
COMMIT;
