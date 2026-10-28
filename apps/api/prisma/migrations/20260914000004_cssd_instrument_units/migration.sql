-- CSSD 기구 개체 수명·멸균 횟수(cssd-inventory 잔여) — 테이블 2 추가 + 품목 한도 컬럼(nullable). 기존 행 무변경.
-- 🔴 멸균 횟수·최초 사용일은 컬럼으로 두지 않는다 — sterile_package_units ↔ sterile_packages(sterilized_at·used_at) 에서 파생.
-- 🔴 max_cycles NULL = 한도 미설정(경보 없음) — 값을 지어내지 않는다.

-- AlterTable
ALTER TABLE "instrument_items" ADD COLUMN     "max_cycles" INTEGER;

-- CreateTable
CREATE TABLE "instrument_units" (
    "id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "serial_no" VARCHAR(60) NOT NULL,
    "max_cycles" INTEGER,
    "status" VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    "retired_at" TIMESTAMPTZ,
    "retired_by" UUID,
    "retire_note" VARCHAR(300),
    "note" VARCHAR(300),
    "created_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "instrument_units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sterile_package_units" (
    "package_id" UUID NOT NULL,
    "unit_id" UUID NOT NULL,
    "added_by" UUID,
    "added_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sterile_package_units_pkey" PRIMARY KEY ("package_id","unit_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "instrument_units_serial_no_key" ON "instrument_units"("serial_no");

-- CreateIndex
CREATE INDEX "instrument_units_item_id_idx" ON "instrument_units"("item_id");

-- CreateIndex
CREATE INDEX "sterile_package_units_unit_id_idx" ON "sterile_package_units"("unit_id");

-- AddForeignKey
ALTER TABLE "instrument_units" ADD CONSTRAINT "instrument_units_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "instrument_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sterile_package_units" ADD CONSTRAINT "sterile_package_units_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "sterile_packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sterile_package_units" ADD CONSTRAINT "sterile_package_units_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "instrument_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
