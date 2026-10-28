-- 스키마(schema.prisma)가 표현하지 못해 **운영 DB 에만 수동 DDL 로 걸려 있던** 제약·트리거·인덱스 — 2026-09-13 상용 릴리즈 T2-1/T2-2.
--
-- 🔴 왜 이 파일이 필요한가: 기준선(`00000000000001_baseline`)은 schema.prisma 에서 생성된다. 그런데 아래 객체들은
--    Prisma 가 표현하지 못해(부분 유니크·표현식 유니크·트리거) **psql 로 운영에만 적용**됐고, 일부는 DDL 원문이
--    저장소에 **SQL 파일로도 없었다**(스키마 주석·기획서에만 적혀 있었다). 빈 DB 에 설치하면 이것들이 빠진다 —
--    인덱스 몇 개가 빠지는 성능 차이가 아니라, **동시 배정 방지·중복 방지·원장 불변성이 사라지는 정합성 차이**다.
--
-- 🔴 운영 DB 에는 이미 걸려 있으므로 `migrate resolve --applied` 로 표시만 한다(실행하지 않는다).
--    🔴 단 **운영에 없는 것이 있다**(2026-09-13 실측 — §5 보조 인덱스 4 없음 · `manual-index-inventory.md` §4) —
--    resolve 전에 `pg_indexes`·`pg_trigger` 로 존재를 확인한다(없는 것을 적용됨으로 표시하면 이력이 거짓이 된다). 절차: `docs/05-reference/sql-inventory.md` §운영 적용.
--
-- 모든 문장은 멱등(IF NOT EXISTS / OR REPLACE / DROP IF EXISTS)이다.

-- ── 1. ER 베드 동시 배정 방지(정합성) ──────────────────────────────────────────────
-- 출처: schema.prisma `EmergencyBedAssignment` 주석 · `docs/01-plan/features/emergency-bed-board.plan.md:80-81`
--       · `er-bed.service.ts` 가 이 인덱스 위반을 409 로 번역한다(인덱스가 없으면 **같은 베드에 두 환자가 배정된다**).
--       🔴 저장소에 SQL 파일이 없던 DDL 이다.
CREATE UNIQUE INDEX IF NOT EXISTS uq_er_bed_active ON emergency_bed_assignments (bed_id) WHERE released_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_er_visit_active ON emergency_bed_assignments (visit_id) WHERE released_at IS NULL;

-- ── 2. 동의서 템플릿 최신본 (name, language) 유일성(정합성) ─────────────────────────
-- 출처: schema.prisma `ConsentTemplate` 주석 — "부분 unique(수동 DDL: is_latest=true 한정)"(`8bff91fd` 2026-07-21 name 단독 @unique 제거와 함께 도입).
--       🔴 DDL 원문은 저장소에 없다. 이름은 **운영 실측 이름** `consent_templates_name_lang_latest_key` 를 쓴다(2026-09-13 `pg_indexes` —
--       `docs/05-reference/manual-index-inventory.md` §3). 처음엔 `uq_consent_templates_name_language_latest` 로 지었는데,
--       `IF NOT EXISTS` 는 **이름**만 보므로 운영에서 실행하면 같은 정의의 유니크 인덱스가 2벌 생길 자리였다.
--       그래서 이름을 맞추고, 같은 정의가 **어떤 이름으로든** 이미 있으면 만들지 않는다.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    JOIN pg_class t ON t.oid = i.indrelid
    WHERE t.relname = 'consent_templates' AND i.indisunique
      AND pg_get_indexdef(i.indexrelid) ~* '\(name, language\) WHERE \(is_latest = true\)'
  ) THEN
    CREATE UNIQUE INDEX consent_templates_name_lang_latest_key ON consent_templates (name, language) WHERE is_latest = true;
  END IF;
END $$;

-- ── 3. 포뮬러리 NULL 포함 중복 방지(정합성) ─────────────────────────────────────────
-- 출처: `prisma/manual/review-p1-20260707.sql` — 스키마의 formulary_items_uniq 는 NULLS DISTINCT 라
--       (code_id|preset_key 한쪽 NULL) 행의 중복을 못 막는다.
CREATE UNIQUE INDEX IF NOT EXISTS formulary_items_uniq_nn
  ON formulary_items (domain, code_type, coalesce(code_id::text, '-'), coalesce(preset_key, '-'));

-- ── 4. 검진권 해시체인 append-only(원장 불변성) ─────────────────────────────────────
-- 출처: `prisma/manual/voucher-append-only.sql`(설계 §14.3, C-3) — DELETE 차단·무결성 컬럼 불변.
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

-- ── 5. 스키마 @@index 로 표현되지 않은 보조 인덱스(성능) ────────────────────────────
-- 출처: `manual/portal-f4-f7-20260707.sql`(부분 인덱스) · `manual/prescriber-designation.sql` · `manual/protocol-opd-er-20260623.sql`
CREATE INDEX IF NOT EXISTS idx_docreq_bundle ON document_requests (bundle_id) WHERE bundle_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_prescriptions_prescriber ON prescriptions (prescriber_id);
CREATE INDEX IF NOT EXISTS idx_stepup_requester ON step_up_approvals (requester_id, status);
CREATE INDEX IF NOT EXISTS protocol_instances_emergency_visit_id_idx ON protocol_instances (emergency_visit_id);

-- 🔴 여기 넣지 않은 것: 경영 머티리얼라이즈드 뷰(`prisma/sql/optional/materialized_views.sql`) —
--    운영 적용 0건·코드 참조 0(대시보드는 라이브 쿼리). 넣으면 새 설치만 MV 를 갖게 되어 운영과 갈라진다.
