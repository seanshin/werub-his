-- 위급값 경보 클로즈드루프 상태 확장(agent-emr-alignment 2-1) — 컬럼 추가만(nullable).
-- 🔴 기존 행은 건드리지 않는다(일어난 사실은 소급하지 않는다) — 상태·시각 백필 없음.
-- 상태 어휘(VARCHAR 그대로): PENDING · ESCALATED · ACKNOWLEDGED · ACTED · CLOSED

ALTER TABLE "critical_value_alerts" ADD COLUMN "escalated_at" TIMESTAMPTZ;
ALTER TABLE "critical_value_alerts" ADD COLUMN "acted_by" UUID;
ALTER TABLE "critical_value_alerts" ADD COLUMN "acted_at" TIMESTAMPTZ;
ALTER TABLE "critical_value_alerts" ADD COLUMN "closed_by" UUID;
ALTER TABLE "critical_value_alerts" ADD COLUMN "closed_at" TIMESTAMPTZ;
