-- 상담데스크 확장 P1 — 추가 DDL (additive only, no data loss)

-- ConsultSession 컬럼 추가
ALTER TABLE consult_sessions ADD COLUMN IF NOT EXISTS team_id uuid;
ALTER TABLE consult_sessions ADD COLUMN IF NOT EXISTS ai_mode varchar(8) NOT NULL DEFAULT 'AUTO';
ALTER TABLE consult_sessions ADD COLUMN IF NOT EXISTS escalated_to_id uuid;
ALTER TABLE consult_sessions ADD COLUMN IF NOT EXISTS lead_escalated_at timestamp(3);
ALTER TABLE consult_sessions ADD COLUMN IF NOT EXISTS escalation_reason varchar(300);
ALTER TABLE consult_sessions ADD COLUMN IF NOT EXISTS first_response_at timestamp(3);
CREATE INDEX IF NOT EXISTS consult_sessions_team_id_idx ON consult_sessions(team_id);

-- ConsultMessage 컬럼 추가
ALTER TABLE consult_messages ADD COLUMN IF NOT EXISTS sender_id uuid;
ALTER TABLE consult_messages ADD COLUMN IF NOT EXISTS visibility varchar(10) NOT NULL DEFAULT 'PATIENT';

-- ConsultTeam 테이블
CREATE TABLE IF NOT EXISTS consult_teams (
  id uuid PRIMARY KEY,
  name varchar(40) NOT NULL,
  description varchar(200),
  categories jsonb,
  locales jsonb,
  default_ai_mode varchar(8) NOT NULL DEFAULT 'AUTO',
  is_default boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_at timestamp(3) NOT NULL DEFAULT now(),
  updated_at timestamp(3) NOT NULL DEFAULT now()
);

-- ConsultAgent 테이블
CREATE TABLE IF NOT EXISTS consult_agents (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL UNIQUE,
  team_id uuid,
  role varchar(8) NOT NULL,
  status varchar(8) NOT NULL DEFAULT 'OFFLINE',
  skills jsonb,
  max_concurrent integer NOT NULL DEFAULT 5,
  created_at timestamp(3) NOT NULL DEFAULT now(),
  updated_at timestamp(3) NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS consult_agents_team_id_idx ON consult_agents(team_id);

-- 기본팀 시드(없으면) + 기존 세션 백필 + 기존 담당직원 AGENT 백필
INSERT INTO consult_teams (id, name, description, categories, locales, default_ai_mode, is_default, active)
SELECT gen_random_uuid(), '일반상담', '미분류 상담 수용 기본팀', '["GENERAL"]'::jsonb, NULL, 'AUTO', true, true
WHERE NOT EXISTS (SELECT 1 FROM consult_teams WHERE is_default = true);

UPDATE consult_sessions
SET team_id = (SELECT id FROM consult_teams WHERE is_default = true LIMIT 1)
WHERE team_id IS NULL;

INSERT INTO consult_agents (id, user_id, team_id, role, status, max_concurrent)
SELECT gen_random_uuid(), s.assignee_id, (SELECT id FROM consult_teams WHERE is_default = true LIMIT 1), 'AGENT', 'OFFLINE', 5
FROM (SELECT DISTINCT assignee_id FROM consult_sessions WHERE assignee_id IS NOT NULL) s
WHERE NOT EXISTS (SELECT 1 FROM consult_agents a WHERE a.user_id = s.assignee_id);
