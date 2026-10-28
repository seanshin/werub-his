-- HIS 이벤트 웹훅 구독 등록(his_webhooks) + outbox 팬아웃 서명 컬럼
-- 적용: docker exec -i docker-postgres-1 psql -U hospital -d hospitalrun < this.sql
-- 안전: IF NOT EXISTS·무중단·재실행 무해. ⚠️ 배포 시 서버 prisma generate 필수.

ALTER TABLE integration_outbox ADD COLUMN IF NOT EXISTS secret VARCHAR(200);

CREATE TABLE IF NOT EXISTS his_webhooks (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name             VARCHAR(100) NOT NULL,
  target_url       VARCHAR(400) NOT NULL,
  events           VARCHAR(50)[] NOT NULL,
  secret           VARCHAR(200) NOT NULL,
  is_active        BOOLEAN NOT NULL DEFAULT true,
  description      VARCHAR(300),
  last_delivery_at TIMESTAMPTZ,
  created_by       UUID,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_his_webhooks_active ON his_webhooks (is_active);
