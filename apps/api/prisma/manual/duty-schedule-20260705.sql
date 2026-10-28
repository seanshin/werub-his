-- 당직/근무표 영속화 — 3 테이블(가산)
CREATE TABLE IF NOT EXISTS duty_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL,
  shift VARCHAR(10) NOT NULL,
  staff_id VARCHAR(50) NOT NULL,
  staff_name VARCHAR(100) NOT NULL,
  role VARCHAR(20) NOT NULL,
  department VARCHAR(50) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_duty_entries_date ON duty_entries(date);
CREATE INDEX IF NOT EXISTS idx_duty_entries_staff_date ON duty_entries(staff_id, date);
CREATE INDEX IF NOT EXISTS idx_duty_entries_dept_date ON duty_entries(department, date);

CREATE TABLE IF NOT EXISTS duty_swap_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id VARCHAR(50) NOT NULL,
  requester_name VARCHAR(100) NOT NULL,
  target_id VARCHAR(50) NOT NULL,
  target_name VARCHAR(100) NOT NULL,
  original_date VARCHAR(10) NOT NULL,
  original_shift VARCHAR(10) NOT NULL,
  swap_date VARCHAR(10) NOT NULL,
  swap_shift VARCHAR(10) NOT NULL,
  reason TEXT NOT NULL,
  status VARCHAR(10) NOT NULL DEFAULT 'PENDING',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_duty_swap_status ON duty_swap_requests(status);

CREATE TABLE IF NOT EXISTS duty_leave_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id VARCHAR(50) NOT NULL,
  staff_name VARCHAR(100) NOT NULL,
  department VARCHAR(50) NOT NULL,
  start_date VARCHAR(10) NOT NULL,
  end_date VARCHAR(10) NOT NULL,
  type VARCHAR(15) NOT NULL,
  reason TEXT NOT NULL,
  status VARCHAR(10) NOT NULL DEFAULT 'PENDING',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_duty_leave_status ON duty_leave_requests(status);
