-- 병상 ↔ 도면 공간(2026-10-02 · 통합 상황판 3D 병상) — null = 미연결 · 사람이 잇는다(층·호실 일치는 제안만)
-- AlterTable
ALTER TABLE "beds" ADD COLUMN     "space_node_id" UUID;

-- CreateIndex
CREATE INDEX "beds_space_node_id_idx" ON "beds"("space_node_id");

-- AddForeignKey
ALTER TABLE "beds" ADD CONSTRAINT "beds_space_node_id_fkey" FOREIGN KEY ("space_node_id") REFERENCES "space_nodes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

