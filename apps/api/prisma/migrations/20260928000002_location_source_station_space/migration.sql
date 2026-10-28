-- 공간·동선 P0 정본화(spatial-flow-vision-3d P0-1·P0-4·P0-5·P0-9)
-- ① patient_locations.source(출처)·granularity(해상도) ② ck_stations.space_node_id(스테이션 ↔ 공간 정본) ③ space_nodes 기하 출처 표식
-- 🔴 출처 백필은 **기록된 사실에서만 파생**한다(추정 금지):
--    event_type='QR_CHECKIN' = 관측(QR) · metadata.demo=true = 시뮬레이션(데모 이동 시드) · 그 밖에 event_type 있음 = 여정 이벤트 번역(추정)
--    · 둘 다 없음 = 출처 미상(UNKNOWN — 데모 시드가 만든 것으로 보이나 행에 그 표식이 없다 · 지어내지 않는다)
-- 🔴 source 는 DB 기본값을 두지 않는다 — 쓰는 코드가 관측인지 추정인지 밝혀야 한다.

-- AlterTable: patient_locations
ALTER TABLE "patient_locations" ADD COLUMN "granularity" VARCHAR(10) NOT NULL DEFAULT 'ZONE';
ALTER TABLE "patient_locations" ADD COLUMN "source" VARCHAR(20);
UPDATE "patient_locations" SET "source" = CASE
  WHEN "event_type" = 'QR_CHECKIN' THEN 'OBSERVED_QR'
  WHEN "metadata" ->> 'demo' = 'true' THEN 'SIMULATED'
  WHEN "event_type" IS NOT NULL THEN 'INFERRED_EVENT'
  ELSE 'UNKNOWN'
END;
ALTER TABLE "patient_locations" ALTER COLUMN "source" SET NOT NULL;

-- AlterTable: ck_stations — 연결은 사람이 한다(관리 화면·API). 여기서 채우지 않는다(가상병원 배치를 마이그레이션에 박지 않음)
ALTER TABLE "ck_stations" ADD COLUMN "space_node_id" UUID;
ALTER TABLE "ck_stations" ADD CONSTRAINT "ck_stations_space_node_id_fkey" FOREIGN KEY ("space_node_id") REFERENCES "space_nodes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 기하 출처 표식: bounds 를 쓰는 곳은 격자 자동배치 시드(seed-floor-metadata.ts) 하나뿐 — 그 사실을 표식으로 남긴다
UPDATE "space_nodes"
   SET "metadata" = jsonb_set("metadata", '{geometrySource}', '"GRID_AUTO"')
 WHERE "metadata" ? 'bounds' AND NOT ("metadata" ? 'geometrySource');
