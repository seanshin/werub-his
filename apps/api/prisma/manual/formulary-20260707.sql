-- 원내 처방집(포뮬러리)·등재 요청 — 2026-07-07 (멱등)
CREATE TABLE IF NOT EXISTS formulary_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  domain VARCHAR(20) NOT NULL,
  code_type VARCHAR(30) NOT NULL,
  code_id UUID,
  preset_key VARCHAR(40),
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  note TEXT,
  committee VARCHAR(60),
  decided_at TIMESTAMPTZ,
  decided_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS formulary_items_uniq ON formulary_items(domain, code_type, code_id, preset_key);
CREATE INDEX IF NOT EXISTS formulary_items_domain_status ON formulary_items(domain, status);
CREATE INDEX IF NOT EXISTS formulary_items_code ON formulary_items(code_id);

CREATE TABLE IF NOT EXISTS formulary_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  domain VARCHAR(20) NOT NULL,
  code_type VARCHAR(30) NOT NULL,
  code_id UUID,
  code_label VARCHAR(300),
  free_text VARCHAR(300),
  reason TEXT NOT NULL,
  urgency VARCHAR(10) NOT NULL DEFAULT 'ROUTINE',
  requested_by UUID NOT NULL,
  department VARCHAR(100),
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  decision TEXT,
  decided_by UUID,
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS formulary_requests_status ON formulary_requests(status, domain);
CREATE INDEX IF NOT EXISTS formulary_requests_by ON formulary_requests(requested_by);

-- 체크리스트(AI 큐레이션) — 2026-07-07 추가(멱등)
CREATE TABLE IF NOT EXISTS formulary_lists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  domain VARCHAR(20) NOT NULL,
  name VARCHAR(120) NOT NULL,
  description VARCHAR(300),
  items JSONB NOT NULL,
  ai_generated BOOLEAN NOT NULL DEFAULT false,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS formulary_lists_domain ON formulary_lists(domain);
