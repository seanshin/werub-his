-- 언어팩 사람 검수(i18n-human-review P0) — 신규 모델 2 + enum 1. additive·비파괴.
-- 정본 기획서: docs/01-plan/features/i18n-human-review.plan.md §2.1
-- 🔴 운영 적용: psql 직접 실행 → prisma/ rsync → prisma generate → nest build
--    (deploy.sh --api 는 prisma generate 를 하지 않는다 — 신규 모델은 이 순서를 지킨다)
-- 🔴 2026-09-09 실측: 로컬 개발 DB 에 두 테이블이 **없다**. 운영 DB 는 이 세션에서 확인하지 않았다.

CREATE TYPE "TranslationOverrideStatus" AS ENUM ('PROPOSED', 'APPROVED', 'REJECTED', 'MERGED');

CREATE TABLE "translation_overrides" (
    "id" UUID NOT NULL,
    "locale" VARCHAR(16) NOT NULL,
    "key" VARCHAR(500) NOT NULL,
    "area" VARCHAR(40) NOT NULL,
    "draft_value" TEXT NOT NULL,
    "base_value" TEXT,
    "status" "TranslationOverrideStatus" NOT NULL DEFAULT 'PROPOSED',
    "note" TEXT,
    "proposed_by" UUID,
    "proposed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMPTZ,
    "merged_at" TIMESTAMPTZ,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "translation_overrides_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "translation_override_transitions" (
    "id" UUID NOT NULL,
    "override_id" UUID NOT NULL,
    "from_status" "TranslationOverrideStatus",
    "to_status" "TranslationOverrideStatus" NOT NULL,
    "actor_id" UUID,
    "at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" VARCHAR(500),

    CONSTRAINT "translation_override_transitions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "translation_overrides_locale_status_idx" ON "translation_overrides"("locale", "status");

CREATE INDEX "translation_overrides_area_locale_idx" ON "translation_overrides"("area", "locale");

CREATE INDEX "translation_overrides_status_proposed_at_idx" ON "translation_overrides"("status", "proposed_at");

CREATE UNIQUE INDEX "translation_overrides_locale_key_key" ON "translation_overrides"("locale", "key");

CREATE INDEX "translation_override_transitions_override_id_at_idx" ON "translation_override_transitions"("override_id", "at");

-- 외래키 — 전이 원장은 오버레이 행에 매달린다(RESTRICT: 이력이 있는 행은 지워지지 않는다)
ALTER TABLE "translation_override_transitions" ADD CONSTRAINT "translation_override_transitions_override_id_fkey" FOREIGN KEY ("override_id") REFERENCES "translation_overrides"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
