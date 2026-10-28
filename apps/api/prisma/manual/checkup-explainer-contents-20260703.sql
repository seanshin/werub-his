-- 검진결과 해석 감수 콘텐츠 (개발-독립 인프라) — 운영 DB 수동 적용
-- 적용:  docker exec -i docker-postgres-1 psql -U hospital -d hospitalrun < checkup-explainer-contents-20260703.sql
-- 이후 서버 npx prisma generate + nest build.

CREATE TABLE IF NOT EXISTS checkup_explainer_contents (
  id                 uuid PRIMARY KEY,
  test_code          varchar(30) NOT NULL UNIQUE,
  test_name          varchar(200) NOT NULL,
  plain_what         text,
  plain_meaning      text,
  lifestyle_info     text,
  when_to_see_doctor text,
  source_ref         varchar(300),
  status             varchar(20) NOT NULL DEFAULT 'DRAFT',
  version            integer NOT NULL DEFAULT 1,
  reviewed_by        uuid,
  reviewed_by_name   varchar(100),
  reviewed_at        timestamptz,
  review_note        text,
  created_by         uuid NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cec_status ON checkup_explainer_contents(status);
