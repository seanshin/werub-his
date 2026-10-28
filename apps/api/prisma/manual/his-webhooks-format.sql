-- his_webhooks 발신 포맷(RAW|SLACK) — W.Channel(Slack 호환) 리치카드 지원
-- 적용: docker exec -i docker-postgres-1 psql -U hospital -d hospitalrun < this.sql
-- 안전: IF NOT EXISTS·무중단. ⚠️ 배포 시 서버 prisma generate 필수.
ALTER TABLE his_webhooks      ADD COLUMN IF NOT EXISTS format VARCHAR(10) NOT NULL DEFAULT 'RAW';
ALTER TABLE integration_outbox ADD COLUMN IF NOT EXISTS format VARCHAR(10);
