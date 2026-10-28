-- 앰비언트 대화 스트림 P0 (2026-07-30) — additive only
-- ScribeSession.source + voice_utterances. db push가 무관 경고(voucher unique)로 거부되어 수동 DDL.

ALTER TABLE scribe_sessions
  ADD COLUMN IF NOT EXISTS source VARCHAR(16) NOT NULL DEFAULT 'RECORDING';

CREATE TABLE IF NOT EXISTS voice_utterances (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id    UUID NOT NULL,
  seq           INTEGER NOT NULL,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  text          TEXT NOT NULL,
  edited_text   TEXT,
  speaker       VARCHAR(12) NOT NULL DEFAULT 'UNKNOWN',
  speaker_source VARCHAR(12) NOT NULL DEFAULT 'HEURISTIC',
  confidence    DOUBLE PRECISION,
  dropped_sec   DOUBLE PRECISION,
  deleted       BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT voice_utterances_session_seq_key UNIQUE (session_id, seq)
);

CREATE INDEX IF NOT EXISTS voice_utterances_session_id_idx ON voice_utterances(session_id);
