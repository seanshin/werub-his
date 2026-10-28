-- 영수증 자격 스냅샷 — billings 테이블 자격 컬럼 추가(추가 전용, idempotent)
ALTER TABLE billings ADD COLUMN IF NOT EXISTS copay_category varchar(24);
ALTER TABLE billings ADD COLUMN IF NOT EXISTS eligibility_status varchar(16);
ALTER TABLE billings ADD COLUMN IF NOT EXISTS eligibility_check_id uuid;
ALTER TABLE billings ADD COLUMN IF NOT EXISTS special_exemption varchar(40);
