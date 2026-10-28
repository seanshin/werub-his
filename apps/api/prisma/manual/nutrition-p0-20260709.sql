-- 급양 P0 — MealOrder 섭취율·병동·멱등 (2026-07-09)
ALTER TABLE meal_orders ADD COLUMN IF NOT EXISTS ward_name varchar(100);
ALTER TABLE meal_orders ADD COLUMN IF NOT EXISTS intake_percent int;
ALTER TABLE meal_orders ADD COLUMN IF NOT EXISTS intake_recorded_by uuid;
ALTER TABLE meal_orders ADD COLUMN IF NOT EXISTS intake_recorded_at timestamptz;
-- 기존 중복(admission,date,meal) 제거 — 최신 createdAt 1건 유지
DELETE FROM meal_orders a USING meal_orders b
  WHERE a.ctid < b.ctid AND a.admission_id = b.admission_id AND a.date = b.date AND a.meal_type = b.meal_type;
-- prisma @@unique 이름과 일치
CREATE UNIQUE INDEX IF NOT EXISTS meal_orders_admission_id_date_meal_type_key ON meal_orders(admission_id, date, meal_type);
