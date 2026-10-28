-- G1-3: 오더세트 대상연령·금기 조건 (멱등)
ALTER TABLE order_sets ADD COLUMN IF NOT EXISTS age_group VARCHAR(20);
ALTER TABLE order_sets ADD COLUMN IF NOT EXISTS contraindications JSONB;
