-- 프로토콜 OPD/ER(P1c) — ProtocolInstance.emergencyVisitId. db push 미실행 → 수동 적용.
ALTER TABLE protocol_instances ADD COLUMN IF NOT EXISTS emergency_visit_id uuid;
CREATE INDEX IF NOT EXISTS protocol_instances_emergency_visit_id_idx ON protocol_instances(emergency_visit_id);
