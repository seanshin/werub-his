-- 공간 자산 배치 원장(spatial-flow-vision-3d §5-A) — 테이블 1 추가. 기존 테이블·행 무변경.
-- 🔴 자산당 활성 배치 하나는 서비스의 advisory lock 이 보장한다(부분 유니크 인덱스는 db push 가 DROP 하므로 두지 않는다).
-- 🔴 기존 자유 텍스트 location 컬럼은 건드리지 않는다(원장과의 불일치는 화면이 드러낸다).

-- CreateTable
CREATE TABLE "asset_placements" (
    "id" UUID NOT NULL,
    "asset_kind" VARCHAR(30) NOT NULL,
    "asset_id" UUID NOT NULL,
    "space_node_id" UUID NOT NULL,
    "x" DECIMAL(8,2),
    "y" DECIMAL(8,2),
    "source" VARCHAR(16) NOT NULL,
    "note" VARCHAR(300),
    "legacy_text_at_placement" VARCHAR(200),
    "placed_by_id" UUID,
    "placed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMPTZ,
    "ended_by_id" UUID,
    "end_reason" VARCHAR(300),

    CONSTRAINT "asset_placements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "asset_placements_asset_kind_asset_id_idx" ON "asset_placements"("asset_kind", "asset_id");
CREATE INDEX "asset_placements_space_node_id_idx" ON "asset_placements"("space_node_id");
CREATE INDEX "asset_placements_ended_at_idx" ON "asset_placements"("ended_at");

-- AddForeignKey
ALTER TABLE "asset_placements" ADD CONSTRAINT "asset_placements_space_node_id_fkey" FOREIGN KEY ("space_node_id") REFERENCES "space_nodes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
