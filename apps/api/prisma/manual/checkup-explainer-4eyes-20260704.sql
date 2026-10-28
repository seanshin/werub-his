-- 검진해석 감수 4-eyes·변경 재감수 — content_hash 컬럼 + 검수 로그 테이블(가산적)
-- 적용:  docker exec -i docker-postgres-1 psql -U hospital -d hospitalrun < checkup-explainer-4eyes-20260704.sql
-- 이후 서버 npx prisma generate + nest build.

ALTER TABLE checkup_explainer_contents ADD COLUMN IF NOT EXISTS content_hash varchar(64);

CREATE TABLE IF NOT EXISTS checkup_explainer_reviews (
  id                uuid PRIMARY KEY,
  content_id        uuid NOT NULL,
  test_code         varchar(30) NOT NULL,
  decision          varchar(20) NOT NULL,
  content_hash      varchar(64),
  note              text,
  reviewed_by       uuid NOT NULL,
  reviewed_by_name  varchar(100) NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cer_content_created ON checkup_explainer_reviews(content_id, created_at);
