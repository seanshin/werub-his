-- 검진권 해시체인 무결성 — voucher_events append-only 강제 (설계 §14.3, C-3)
-- DELETE 차단 + 무결성 컬럼(hash/prev_hash/payload/type/serial/voucher_id/actor/created_at) 불변.
-- 앵커 메타(anchor_id/anchor_status/anchor_attempts/anchored_at)는 cron 갱신 허용.
-- 적용: docker exec docker-postgres-1 psql -U hospital hospitalrun -f - < 이 파일

CREATE OR REPLACE FUNCTION voucher_events_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'voucher_events is append-only (DELETE blocked)';
  END IF;
  IF NEW.voucher_id IS DISTINCT FROM OLD.voucher_id
     OR NEW.serial   IS DISTINCT FROM OLD.serial
     OR NEW.type     IS DISTINCT FROM OLD.type
     OR NEW.prev_hash IS DISTINCT FROM OLD.prev_hash
     OR NEW.hash     IS DISTINCT FROM OLD.hash
     OR NEW.payload::text IS DISTINCT FROM OLD.payload::text
     OR NEW.actor_type IS DISTINCT FROM OLD.actor_type
     OR NEW.actor_id  IS DISTINCT FROM OLD.actor_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'voucher_events integrity columns are immutable (append-only)';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_voucher_events_append_only ON voucher_events;
CREATE TRIGGER trg_voucher_events_append_only
  BEFORE UPDATE OR DELETE ON voucher_events
  FOR EACH ROW EXECUTE FUNCTION voucher_events_append_only();
