-- 진료 첨부(타블렛 펜 스케치·도해) — db push 미실행(드리프트) → 수동 적용.
-- 적용: docker exec -i docker-postgres-1 psql -U hospital -d hospitalrun -f <this>
CREATE TABLE IF NOT EXISTS encounter_attachments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  encounter_id uuid NOT NULL REFERENCES encounters(id) ON DELETE CASCADE,
  kind         varchar(16) NOT NULL DEFAULT 'SKETCH',
  url          text NOT NULL,
  mime_type    varchar(64) NOT NULL,
  note         text,
  uploaded_by  uuid NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS encounter_attachments_encounter_id_idx ON encounter_attachments(encounter_id);
