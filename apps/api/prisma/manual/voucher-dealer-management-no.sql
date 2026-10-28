-- 딜러 관리번호(WGD-YYYY-NNNN) — db push 드리프트 회피용 수동 마이그레이션
ALTER TABLE voucher_distributors ADD COLUMN IF NOT EXISTS management_no varchar(30);

-- 기존 딜러 백필(연도별 created_at 순서로 채번)
WITH numbered AS (
  SELECT id, 'WGD-' || to_char(created_at, 'YYYY') || '-' ||
         lpad((row_number() OVER (PARTITION BY to_char(created_at, 'YYYY') ORDER BY created_at, id))::text, 4, '0') AS mno
  FROM voucher_distributors
)
UPDATE voucher_distributors d SET management_no = n.mno FROM numbered n
  WHERE d.id = n.id AND d.management_no IS NULL;

-- 유니크 인덱스(Prisma @unique 명명 규칙). NULL 다중 허용(Postgres).
CREATE UNIQUE INDEX IF NOT EXISTS voucher_distributors_management_no_key ON voucher_distributors(management_no);
