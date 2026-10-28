-- 워크스테이션-디바이스 연동(P0+P1) — 신규 테이블 2(가산적·데이터 손실 0)
-- 적용:  docker exec -i docker-postgres-1 psql -U hospital -d hospitalrun < workstation-device-20260704.sql
-- 이후 서버 npx prisma generate + nest build.

CREATE TABLE IF NOT EXISTS workstation_profiles (
  id uuid PRIMARY KEY, code varchar(30) NOT NULL UNIQUE, label varchar(100) NOT NULL,
  department varchar(50), location varchar(100),
  default_station_ids jsonb NOT NULL DEFAULT '[]', terminal_id uuid,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_wsp_terminal ON workstation_profiles(terminal_id);

CREATE TABLE IF NOT EXISTS peripheral_devices (
  id uuid PRIMARY KEY, workstation_profile_id uuid NOT NULL,
  type varchar(20) NOT NULL, name varchar(100) NOT NULL,
  connection varchar(15) NOT NULL DEFAULT 'NETWORK', host varchar(120), port integer, config jsonb,
  is_default boolean NOT NULL DEFAULT false, status varchar(10) NOT NULL DEFAULT 'UNKNOWN',
  last_seen_at timestamptz, is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pd_ws_type ON peripheral_devices(workstation_profile_id, type);
