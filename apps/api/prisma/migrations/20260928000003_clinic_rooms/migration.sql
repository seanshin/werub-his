-- 외래 진료실 ↔ 공간 연결(spatial-flow-vision-3d P0-5) — 테이블 1 추가. 기존 테이블·행 무변경.
-- 🔴 연결은 사람이 한다(관리 화면) — 마이그레이션이 이름 일치로 채우지 않는다.

-- CreateTable
CREATE TABLE "clinic_rooms" (
    "id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "space_node_id" UUID,
    "updated_by_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "clinic_rooms_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "clinic_rooms_name_key" ON "clinic_rooms"("name");

-- AddForeignKey
ALTER TABLE "clinic_rooms" ADD CONSTRAINT "clinic_rooms_space_node_id_fkey" FOREIGN KEY ("space_node_id") REFERENCES "space_nodes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

