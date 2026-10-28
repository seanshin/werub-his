-- 바우처 정산 보강(H-2 4-eyes / H-3 claw-back 미정산 이월)
-- 비파괴적 추가 컬럼·인덱스. db push 드리프트(procedure_codes) 회피용 수동 적용.
-- 적용: docker exec -i docker-postgres-1 psql -U hospital -d hospitalrun < voucher-settlement-clawback.sql

-- H-2: 정산 확정자(산출자≠확정자) 기록
ALTER TABLE voucher_settlements ADD COLUMN IF NOT EXISTS confirmed_by uuid;
ALTER TABLE voucher_settlements ADD COLUMN IF NOT EXISTS confirmed_at timestamptz;

-- H-3: 환불 claw-back을 미정산 상태로 추적 → 다음 정산으로 이월
ALTER TABLE voucher_refunds ADD COLUMN IF NOT EXISTS distributor_id uuid;
ALTER TABLE voucher_refunds ADD COLUMN IF NOT EXISTS settled_at timestamptz;
ALTER TABLE voucher_refunds ADD COLUMN IF NOT EXISTS settlement_id uuid;
CREATE INDEX IF NOT EXISTS voucher_refunds_distributor_id_settled_at_idx
  ON voucher_refunds (distributor_id, settled_at);

-- 기존 환불행 backfill: sale_id로 딜러 귀속(claw-back 있는 과거 환불을 차기 정산에 포함)
UPDATE voucher_refunds r
   SET distributor_id = s.distributor_id
  FROM voucher_sales s
 WHERE r.sale_id = s.id
   AND r.distributor_id IS NULL;
