-- Hospital RUN — Materialized Views for Dashboard Performance
-- 실행: psql -U hospital -d hospitalrun -f materialized_views.sql
-- 갱신: REFRESH MATERIALIZED VIEW CONCURRENTLY mv_monthly_revenue;

-- 1. 월별 매출 집계
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_monthly_revenue AS
SELECT
  date_trunc('month', created_at) AS month,
  COUNT(*) AS billing_count,
  SUM(total_amount) AS total_revenue,
  SUM(paid_amount) AS paid_revenue,
  SUM(insurance_covered) AS insurance_total,
  SUM(patient_copay) AS copay_total
FROM billings
WHERE status = 'PAID'
GROUP BY date_trunc('month', created_at)
ORDER BY month DESC;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_monthly_revenue_month ON mv_monthly_revenue (month);

-- 2. 진료과별 월간 통계
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_department_monthly AS
SELECT
  date_trunc('month', e.created_at) AS month,
  u.department,
  COUNT(DISTINCT e.id) AS encounter_count,
  COUNT(DISTINCT e.patient_id) AS patient_count,
  COALESCE(SUM(b.total_amount), 0) AS revenue
FROM encounters e
JOIN users u ON e.doctor_id = u.id
LEFT JOIN billings b ON b.encounter_id = e.id AND b.status = 'PAID'
WHERE e.status = 'SIGNED'
GROUP BY date_trunc('month', e.created_at), u.department
ORDER BY month DESC, revenue DESC;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_dept_monthly ON mv_department_monthly (month, department);

-- 3. 일별 병상 가동률 스냅샷
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_daily_bed_occupancy AS
SELECT
  date_trunc('day', a.admit_date) AS day,
  COUNT(DISTINCT a.id) AS admitted_count,
  (SELECT COUNT(*) FROM beds) AS total_beds
FROM admissions a
WHERE a.status IN ('ADMITTED', 'DISCHARGED')
GROUP BY date_trunc('day', a.admit_date)
ORDER BY day DESC;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_daily_bed ON mv_daily_bed_occupancy (day);

-- 갱신 함수 (cron으로 10분마다 실행)
-- SELECT refresh_dashboard_views();
CREATE OR REPLACE FUNCTION refresh_dashboard_views()
RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_monthly_revenue;
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_department_monthly;
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_daily_bed_occupancy;
END;
$$ LANGUAGE plpgsql;
