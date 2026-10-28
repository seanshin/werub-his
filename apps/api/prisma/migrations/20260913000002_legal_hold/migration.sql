-- 법적 보존명령(legal hold) — 상용 릴리즈 T10-7 (2026-09-13)
-- 생성: prisma migrate diff --from-schema-datamodel(직전 스키마) --to-schema-datamodel prisma/schema.prisma --script
--       + append-only 트리거(아래 — 스키마로 표현할 수 없어 SQL 로 둔다).
-- 🔴 운영 적용 주의: 운영 DB 는 아직 `db push` 경로다. 이 두 테이블은 **추가만** 하므로 `db push` 로 안전하게 생긴다.
--    다만 트리거는 `db push` 가 만들지 않는다 → migrate 표시(T2 `migrate resolve --applied`) 전에 운영에 테이블이 먼저 생겼다면
--    이 파일의 트리거 절을 한 번 수동 적용하거나, 이 마이그레이션은 resolve 하지 말고 `migrate deploy` 로 적용한다.

-- CreateTable
CREATE TABLE "legal_holds" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "scope" VARCHAR(40) NOT NULL DEFAULT 'ALL',
    "reason" TEXT NOT NULL,
    "basis" VARCHAR(200),
    "set_by" UUID NOT NULL,
    "set_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "legal_holds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "legal_hold_releases" (
    "id" UUID NOT NULL,
    "hold_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "requested_by" UUID NOT NULL,
    "approved_by" UUID NOT NULL,
    "approval_id" UUID NOT NULL,
    "released_by" UUID NOT NULL,
    "released_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "legal_hold_releases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "legal_holds_patient_id_idx" ON "legal_holds"("patient_id");

-- CreateIndex
CREATE UNIQUE INDEX "legal_hold_releases_hold_id_key" ON "legal_hold_releases"("hold_id");

-- AddForeignKey
ALTER TABLE "legal_hold_releases" ADD CONSTRAINT "legal_hold_releases_hold_id_fkey" FOREIGN KEY ("hold_id") REFERENCES "legal_holds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 🔴 append-only — 보존명령과 해제 기록은 고치거나 지우지 않는다(해제는 새 행으로만 남는다).
CREATE OR REPLACE FUNCTION legal_hold_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'legal hold 기록은 append-only 다 — % 금지(%)', TG_OP, TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER legal_holds_append_only
  BEFORE UPDATE OR DELETE ON "legal_holds"
  FOR EACH ROW EXECUTE FUNCTION legal_hold_append_only();

CREATE TRIGGER legal_hold_releases_append_only
  BEFORE UPDATE OR DELETE ON "legal_hold_releases"
  FOR EACH ROW EXECUTE FUNCTION legal_hold_append_only();
