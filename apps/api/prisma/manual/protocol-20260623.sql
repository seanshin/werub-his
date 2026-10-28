-- 환자여정 프로토콜 오케스트레이션 — db push 미실행(드리프트) → 수동 적용.
-- 적용: docker exec -i docker-postgres-1 psql -U hospital -d hospitalrun -f <this>
CREATE TABLE IF NOT EXISTS protocol_templates (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code       varchar(40) NOT NULL UNIQUE,
  name       varchar(120) NOT NULL,
  domain     varchar(16) NOT NULL,
  version    int NOT NULL DEFAULT 1,
  status     varchar(12) NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS protocol_steps (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES protocol_templates(id) ON DELETE CASCADE,
  key         varchar(40) NOT NULL,
  title       varchar(120) NOT NULL,
  sort_order  int NOT NULL,
  phase       varchar(16),
  owner_roles text[] NOT NULL DEFAULT '{}',
  action_type varchar(12) NOT NULL DEFAULT 'CHECK',
  gate        boolean NOT NULL DEFAULT false,
  gate_rule   varchar(40),
  chart_view  varchar(20),
  sla_minutes int,
  transitions jsonb,
  UNIQUE (template_id, key)
);
CREATE INDEX IF NOT EXISTS protocol_steps_template_id_idx ON protocol_steps(template_id);

CREATE TABLE IF NOT EXISTS protocol_instances (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id      uuid NOT NULL REFERENCES protocol_templates(id),
  template_version int NOT NULL,
  patient_id       uuid NOT NULL,
  surgery_id       uuid,
  encounter_id     uuid,
  admission_id     uuid,
  current_step_key varchar(40),
  status           varchar(12) NOT NULL DEFAULT 'ACTIVE',
  started_at       timestamptz NOT NULL DEFAULT now(),
  completed_at     timestamptz
);
CREATE INDEX IF NOT EXISTS protocol_instances_patient_id_idx ON protocol_instances(patient_id);
CREATE INDEX IF NOT EXISTS protocol_instances_surgery_id_idx ON protocol_instances(surgery_id);

CREATE TABLE IF NOT EXISTS protocol_step_states (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id    uuid NOT NULL REFERENCES protocol_instances(id) ON DELETE CASCADE,
  step_key       varchar(40) NOT NULL,
  status         varchar(12) NOT NULL DEFAULT 'PENDING',
  completed_by   uuid,
  completed_at   timestamptz,
  blocked_reason text,
  UNIQUE (instance_id, step_key)
);
